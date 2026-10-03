// admin-users: super admin account actions that need the Auth admin API.
// suspend   -> profile suspended (fails every RLS check) + Auth ban (blocks sign-in)
// reinstate -> reverses both
// reset_password -> sets a new password chosen by the super admin
import { HttpError, json, requireCaller, serve, serviceClient } from "../_shared/http.ts";

const BAN_FOREVER = "876000h"; // ~100 years

serve(async (req) => {
  const caller = await requireCaller(req);
  if (!caller.profile.is_super_admin) throw new HttpError(403, "Super admin only.");

  const body = await req.json().catch(() => ({}));
  const userId = String(body.user_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new HttpError(400, "Choose an account.");

  const admin = serviceClient();
  const { data: target } = await admin.from("profiles").select("id, username").eq("id", userId).single();
  if (!target) throw new HttpError(404, "That account no longer exists.");

  switch (body.action) {
    case "suspend": {
      if (userId === caller.id) throw new HttpError(400, "You cannot suspend your own account.");
      const reason = String(body.reason ?? "").trim().slice(0, 500) || null;
      const { error } = await admin.from("profiles")
        .update({ status: "suspended", suspended_reason: reason }).eq("id", userId);
      if (error) throw error;
      const { error: banError } = await admin.auth.admin.updateUserById(userId, { ban_duration: BAN_FOREVER });
      if (banError) throw banError;
      break;
    }
    case "reinstate": {
      const { error } = await admin.from("profiles")
        .update({ status: "active", suspended_reason: null }).eq("id", userId);
      if (error) throw error;
      const { error: banError } = await admin.auth.admin.updateUserById(userId, { ban_duration: "none" });
      if (banError) throw banError;
      break;
    }
    case "reset_password": {
      const password = String(body.password ?? "");
      if (password.length < 8) throw new HttpError(400, "Passwords need at least 8 characters.");
      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      if (error) throw error;
      break;
    }
    default:
      throw new HttpError(400, "Unknown action.");
  }

  console.log(`super admin ${caller.profile.username} ran ${body.action} on ${target.username}`);
  return json({ ok: true });
});
