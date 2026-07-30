// ============================================================================
// send-notification — drains the public.notifications queue
// ----------------------------------------------------------------------------
// Multi-channel delivery for the notification system requirement. Rows are
// queued by database triggers (0007) or by staff from the admin UI; this
// function performs the actual Email/SMS send and writes the delivery result
// back to the row.
//
// Invoke with:
//   { }                      -> drain up to `limit` queued rows (default 25)
//   { id: "<uuid>" }         -> deliver one specific notification
//   { action: "reminders" }  -> run the daily reminder sweeps, then drain
//
// Required secrets (supabase secrets set ...):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (provided by the platform)
//   RESEND_API_KEY, NOTIFY_EMAIL_FROM         (email)
//   SEMAPHORE_API_KEY [, SEMAPHORE_SENDER]    (SMS, Philippines)
//   or TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
//   CRON_SECRET                               (optional, for schedulers)
// ============================================================================

import { adminClient, authorize } from "../_shared/auth.ts";
import { json, preflight } from "../_shared/cors.ts";

const MAX_ATTEMPTS = 3;
const DEFAULT_BATCH = 25;

interface NotificationRow {
  id: string;
  channel: "email" | "sms";
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

// ─── Email via Resend ───────────────────────────────────────────────────────

async function sendEmail(row: NotificationRow): Promise<SendResult> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("NOTIFY_EMAIL_FROM");

  if (!apiKey || !from) {
    return { ok: false, skipped: true, error: "Email provider not configured." };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [row.recipient],
      subject: subjectFor(row.kind),
      text: `${row.message}\n\n— Uy-Laurio Law Office`,
    }),
  });

  if (!res.ok) {
    return { ok: false, error: `Resend ${res.status}: ${(await res.text()).slice(0, 300)}` };
  }

  const body = await res.json().catch(() => ({}));
  return { ok: true, providerId: body?.id };
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
    case "appointment_reminder": return "Reminder: appointment tomorrow";
    default:                     return "Update on your legal transaction";
  }
}

// ─── SMS via Semaphore (PH) with Twilio fallback ─────────────────────────────

function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("09")) return `+63${digits.slice(1)}`;
  if (digits.startsWith("63")) return `+${digits}`;
  return digits;
}

async function sendSms(row: NotificationRow): Promise<SendResult> {
  const semaphoreKey = Deno.env.get("SEMAPHORE_API_KEY");
  const phone = normalizePhone(row.recipient);

  if (semaphoreKey) {
    const params = new URLSearchParams({
      apikey: semaphoreKey,
      number: phone,
      message: row.message,
    });
    const sender = Deno.env.get("SEMAPHORE_SENDER");
    if (sender) params.set("sendername", sender);

    const res = await fetch("https://api.semaphore.co/api/v4/messages", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });

    if (!res.ok) {
      return { ok: false, error: `Semaphore ${res.status}: ${(await res.text()).slice(0, 300)}` };
    }
    const body = await res.json().catch(() => null);
    const id = Array.isArray(body) ? String(body[0]?.message_id ?? "") : undefined;
    return { ok: true, providerId: id };
  }

  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  const fromNumber = Deno.env.get("TWILIO_FROM_NUMBER");

  if (sid && token && fromNumber) {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: phone, From: fromNumber, Body: row.message }),
    });

    if (!res.ok) {
      return { ok: false, error: `Twilio ${res.status}: ${(await res.text()).slice(0, 300)}` };
    }
    const body = await res.json().catch(() => ({}));
    return { ok: true, providerId: body?.sid };
  }

  return { ok: false, skipped: true, error: "SMS provider not configured." };
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
      result = row.channel === "email" ? await sendEmail(row) : await sendSms(row);
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
