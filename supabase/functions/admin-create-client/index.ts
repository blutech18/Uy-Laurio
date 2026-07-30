// ============================================================================
// admin-create-client — staff-side client account creation
// ----------------------------------------------------------------------------
// "Client Account Management" requires authorized personnel to add client
// records. Creating an auth user needs the service role, which must never reach
// the browser, so it happens here behind an admin check on the caller's JWT.
//
// Body:
//   {
//     email:    string   (required)
//     fullName: string   (required)
//     phone?:   string
//     notes?:   string
//     password?: string  -> if omitted, a recovery/invite link is emailed
//   }
// ============================================================================

import { adminClient, authorize } from "../_shared/auth.ts";
import { json, preflight } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const caller = await authorize(req);
  if (!caller || caller.kind !== "admin") {
    return json({ error: "Administrator access required." }, 403);
  }

  const body = await req.json().catch(() => null);
  const email = String(body?.email ?? "").trim().toLowerCase();
  const fullName = String(body?.fullName ?? "").trim();
  const phone = body?.phone ? String(body.phone).trim() : null;
  const notes = body?.notes ? String(body.notes).trim() : null;
  const password = body?.password ? String(body.password) : null;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "A valid email address is required." }, 400);
  }
  if (!fullName) {
    return json({ error: "The client's full name is required." }, 400);
  }
  if (password && password.length < 8) {
    return json({ error: "Password must be at least 8 characters." }, 400);
  }

  const db = adminClient();

  const { data: created, error: createError } = await db.auth.admin.createUser({
    email,
    password: password ?? undefined,
    email_confirm: true,
    user_metadata: { full_name: fullName, phone },
  });

  if (createError || !created.user) {
    const message = createError?.message ?? "Could not create the account.";
    const status = /already/i.test(message) ? 409 : 400;
    return json({ error: message }, status);
  }

  // handle_new_user() already inserted the profile; fill in the staff-only bits.
  const { data: profile, error: profileError } = await db
    .from("profiles")
    .update({ full_name: fullName, phone, notes })
    .eq("id", created.user.id)
    .select("*")
    .single();

  if (profileError) {
    return json({ error: profileError.message }, 500);
  }

  // Send a set-password link when staff did not set one.
  let inviteSent = false;
  if (!password) {
    const redirectTo = Deno.env.get("FUNCTION_ALLOWED_ORIGIN");
    const { error: linkError } = await db.auth.resetPasswordForEmail(
      email,
      redirectTo && redirectTo !== "*" ? { redirectTo } : undefined,
    );
    inviteSent = !linkError;
  }

  await db.from("activity_log").insert({
    actor_id: caller.userId ?? null,
    actor_email: caller.email ?? null,
    action: "client.created",
    entity_type: "profile",
    entity_id: created.user.id,
    metadata: { email, full_name: fullName, invite_sent: inviteSent },
  });

  return json({ ok: true, profile, inviteSent }, 201);
});
