// ============================================================================
// send-notification — drains the public.notifications queue
// ----------------------------------------------------------------------------
// Multi-channel delivery for the notification system requirement. Rows are
// queued by database triggers (0007) or by staff from the admin UI; this
// function performs the actual email send and writes the delivery result
// back to the row.
//
// Invoke with:
//   { }                      -> drain up to `limit` queued rows (default 25)
//   { id: "<uuid>" }         -> deliver one specific notification
//   { action: "reminders" }  -> run the daily reminder sweeps, then drain
//
// Required secrets (supabase secrets set ...):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (provided by the platform)
//   BREVO_API_KEY, BREVO_FROM_EMAIL           (email)
//   SITE_URL                                  (link in emails)
//   CRON_SECRET                               (optional, for schedulers)
// ============================================================================

import { adminClient, authorize } from "../_shared/auth.ts";
import { json, preflight } from "../_shared/cors.ts";

const MAX_ATTEMPTS = 3;
const DEFAULT_BATCH = 25;

interface NotificationRow {
  id: string;
  channel: "email" | "sms"; // "sms" rows are legacy and are skipped
  recipient: string;
  message: string;
  kind: string;
  attempts: number;
  case_id: string | null;
}

interface SendResult {
  ok: boolean;
  providerId?: string;
  error?: string;
  skipped?: boolean;
}

// ─── Email via Brevo ─────────────────────────────────────────────────────────

// ─── Branded HTML email ─────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Short heading shown inside the email body, per notification type. */
function headingFor(kind: string): string {
  switch (kind) {
    case "case_created":         return "We received your request";
    case "case_completed":       return "Your transaction is complete";
    case "case_cancelled":       return "Your request was cancelled";
    case "requirement_request":  return "Documents needed";
    case "document_verified":    return "Document verified";
    case "document_rejected":    return "Document needs re-submission";
    case "appointment_booked":   return "Appointment confirmed";
    case "appointment_reminder": return "Appointment reminder";
    case "appointment_admin":    return "Appointment update";
    case "phase_update":         return "Your case has moved forward";
    case "status_update":        return "Case status updated";
    default:                     return "A message from the office";
  }
}

function renderEmail(row: NotificationRow): { html: string; text: string } {
  const siteUrl = (Deno.env.get("SITE_URL") ?? "").replace(/\/+$/, "");
  const heading = escapeHtml(headingFor(row.kind));
  const body = escapeHtml(row.message).replace(/\r?\n/g, "<br>");
  const button = siteUrl
    ? `<tr><td style="padding:8px 36px 32px;">
         <a href="${siteUrl}" style="display:inline-block;background:#8A1C1F;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:13px 28px;border-radius:10px;">Open your portal</a>
       </td></tr>`
    : "";

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${heading}</title></head>
<body style="margin:0;padding:0;background:#F4F5F7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F5F7;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e6e6e9;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
        <tr><td style="background:#8A1C1F;padding:26px 36px;text-align:left;">
          <div style="font-family:Georgia,'Times New Roman',serif;font-size:21px;font-weight:700;letter-spacing:1px;color:#ffffff;">UY-LAURIO</div>
          <div style="font-size:11px;letter-spacing:2.5px;color:rgba(255,255,255,0.7);margin-top:3px;text-transform:uppercase;">Law Office &middot; Client Portal</div>
        </td></tr>
        <tr><td style="height:4px;background:#344248;font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:32px 36px 8px;">
          <h1 style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:1.3;color:#1E1E1E;">${heading}</h1>
          <p style="margin:0;font-size:15px;line-height:1.7;color:#344248;">${body}</p>
        </td></tr>
        ${button}
        <tr><td style="padding:0 36px;"><div style="border-top:1px solid #ececf0;"></div></td></tr>
        <tr><td style="padding:20px 36px 28px;font-size:12px;line-height:1.7;color:#8a8f98;">
          1st Flr., Bolonio Valdez Bldg., D. Silang St. corner P. Burgos St.,<br>Brgy. 10, Batangas City, 4200<br><br>
          This is an automated message from the Uy-Laurio Law Office client portal. Please do not reply to this email.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { html, text: `${row.message}\n\n— Uy-Laurio Law Office` };
}

// Brevo (BREVO_API_KEY + BREVO_FROM_EMAIL). Only a
// verified sender address is needed, not a whole domain.
async function sendViaBrevo(row: NotificationRow): Promise<SendResult> {
  const fromEmail = Deno.env.get("BREVO_FROM_EMAIL");
  if (!fromEmail) {
    return { ok: false, skipped: true, error: "BREVO_FROM_EMAIL is not set." };
  }

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": Deno.env.get("BREVO_API_KEY")!,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: { email: fromEmail, name: Deno.env.get("BREVO_FROM_NAME") ?? "Uy-Laurio Law Office" },
      to: [{ email: row.recipient }],
      subject: subjectFor(row.kind),
      htmlContent: renderEmail(row).html,
      textContent: renderEmail(row).text,
    }),
  });

  if (!res.ok) {
    return { ok: false, error: `Brevo ${res.status}: ${(await res.text()).slice(0, 300)}` };
  }
  const body = await res.json().catch(() => ({}));
  return { ok: true, providerId: String(body?.messageId ?? "") };
}

async function sendEmail(row: NotificationRow): Promise<SendResult> {
  if (!Deno.env.get("BREVO_API_KEY")) {
    return { ok: false, skipped: true, error: "Email provider not configured." };
  }
  return sendViaBrevo(row);
}

function subjectFor(kind: string): string {
  switch (kind) {
    case "case_created":         return "We received your request — Uy-Laurio Law Office";
    case "case_completed":       return "Your transaction is complete";
    case "case_cancelled":       return "Your request has been cancelled";
    case "requirement_request":  return "Action needed: missing documentary requirements";
    case "document_verified":    return "Document verified";
    case "document_rejected":    return "Document needs re-submission";
    case "appointment_booked":   return "Appointment confirmed";
    case "appointment_admin":    return "Appointment update - Uy-Laurio Law Office";
    case "appointment_reminder": return "Reminder: appointment tomorrow";
    default:                     return "Update on your legal transaction";
  }
}

// ─── Queue processing ───────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const caller = await authorize(req);
  if (!caller) return json({ error: "Unauthorized" }, 401);

  const payload = await req.json().catch(() => ({}));
  const db = adminClient();
  const summary = { reminders: 0, processed: 0, sent: 0, failed: 0, skipped: 0 };

  if (payload?.action === "reminders") {
    const [a, b] = await Promise.all([
      db.rpc("queue_requirement_reminders"),
      db.rpc("queue_appointment_reminders"),
    ]);
    summary.reminders = (a.data ?? 0) + (b.data ?? 0);
  }

  let query = db
    .from("notifications")
    .select("id, channel, recipient, message, kind, attempts, case_id")
    .in("delivery_status", ["queued", "failed"])
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(Math.min(Number(payload?.limit ?? DEFAULT_BATCH), 100));

  if (payload?.id) query = db
    .from("notifications")
    .select("id, channel, recipient, message, kind, attempts, case_id")
    .eq("id", payload.id)
    .limit(1);

  const { data: rows, error } = await query;
  if (error) return json({ error: error.message }, 500);

  for (const row of (rows ?? []) as NotificationRow[]) {
    // Atomic claim in Postgres (see migration 0010): a filtered update over
    // PostgREST cannot reliably report whether this worker won the row, which
    // risks sending the same message twice.
    const { data: claimed, error: claimError } = await db.rpc("claim_notification", {
      p_id: row.id,
    });

    if (claimError) {
      summary.failed += 1;
      continue;
    }
    if (claimed !== true) continue; // another worker already took it

    summary.processed += 1;

    let result: SendResult;
    try {
      result = row.channel === "email"
        ? await sendEmail(row)
        : { ok: false, skipped: true, error: "SMS is no longer used." };
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : "Unknown send error" };
    }

    if (result.ok) {
      summary.sent += 1;
      await db.from("notifications").update({
        delivery_status: "sent",
        status: "confirmed",
        sent_at: new Date().toISOString(),
        provider_message_id: result.providerId ?? null,
        error: null,
      }).eq("id", row.id);
    } else if (result.skipped) {
      summary.skipped += 1;
      await db.from("notifications").update({
        delivery_status: "skipped",
        error: result.error ?? "Provider not configured.",
      }).eq("id", row.id);
    } else {
      summary.failed += 1;
      await db.from("notifications").update({
        delivery_status: "failed",
        error: result.error ?? "Delivery failed.",
      }).eq("id", row.id);
    }
  }

  return json({ ok: true, ...summary });
});
