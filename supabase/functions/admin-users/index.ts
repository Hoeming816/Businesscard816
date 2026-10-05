// admin-users: super admin account actions that need the Auth admin API.
// suspend   -> profile suspended (fails every RLS check) + Auth ban (blocks sign-in)
// reinstate -> reverses suspend or delete
// reset_password -> sets a new password chosen by the super admin
// delete    -> moves the account to Deleted users: status 'deleted' + Auth ban.
//              Its cards, photos, notes and recordings are kept, so reinstate
//              brings everything back.
// purge     -> only for a deleted account: erases it for good (login, cards,
//              notes, recordings, photos, share offers). Team workspaces it
//              owns that still have other members pass to the super admin
//              doing it, so nobody else loses their cards.
import { HttpError, json, requireCaller, serve, serviceClient } from "../_shared/http.ts";

const BAN_FOREVER = "876000h"; // ~100 years

serve(async (req) => {
  const caller = await requireCaller(req);
  if (!caller.profile.is_super_admin) throw new HttpError(403, "Super admin only.");

  const body = await req.json().catch(() => ({}));
  const userId = String(body.user_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new HttpError(400, "Choose an account.");

  const admin = serviceClient();
  const { data: target } = await admin.from("profiles").select("id, username, is_super_admin, status").eq("id", userId).single();
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
        .update({ status: "active", suspended_reason: null, deleted_at: null }).eq("id", userId);
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
    case "delete": {
      if (userId === caller.id) throw new HttpError(400, "You cannot delete your own account.");
      if (target.is_super_admin) await requireAnotherSuperAdmin(admin);
      const { error } = await admin.from("profiles")
        .update({ status: "deleted", deleted_at: new Date().toISOString() }).eq("id", userId);
      if (error) throw error;
      const { error: banError } = await admin.auth.admin.updateUserById(userId, { ban_duration: BAN_FOREVER });
      if (banError) throw banError;
      break;
    }
    case "purge": {
      if (userId === caller.id) throw new HttpError(400, "You cannot delete your own account.");
      if (target.status !== "deleted") throw new HttpError(400, "Delete the account first; it can then be deleted permanently from Deleted users.");
      if (String(body.confirm_username ?? "").trim().toLowerCase() !== target.username) {
        throw new HttpError(400, `Type ${target.username} to confirm.`);
      }
      await deleteAccount(admin, userId, caller.id);
      break;
    }
    default:
      throw new HttpError(400, "Unknown action.");
  }

  console.log(`super admin ${caller.profile.username} ran ${body.action} on ${target.username}`);
  return json({ ok: true });
});

type Admin = ReturnType<typeof serviceClient>;

async function requireAnotherSuperAdmin(admin: Admin) {
  const { count } = await admin.from("profiles").select("id", { count: "exact", head: true })
    .eq("is_super_admin", true).eq("status", "active");
  if ((count ?? 0) <= 1) throw new HttpError(400, "You cannot delete the last super admin.");
}

async function deleteAccount(admin: Admin, userId: string, keeperId: string) {
  // Team workspaces this account owns that other people still use go to the
  // super admin doing the delete; the rest are removed with the account.
  const { data: owned, error: wsError } = await admin.from("workspaces").select("id").eq("owner_id", userId);
  if (wsError) throw wsError;
  const removedWs: string[] = [];
  for (const { id } of owned ?? []) {
    const { count } = await admin.from("workspace_members").select("user_id", { count: "exact", head: true })
      .eq("workspace_id", id).neq("user_id", userId);
    if ((count ?? 0) > 0) {
      const { error } = await admin.from("workspaces").update({ owner_id: keeperId }).eq("id", id);
      if (error) throw error;
      const { error: mError } = await admin.from("workspace_members")
        .upsert({ workspace_id: id, user_id: keeperId, role: "admin", status: "active" }, { onConflict: "workspace_id,user_id" });
      if (mError) throw mError;
    } else {
      removedWs.push(id);
    }
  }

  // Files the database cascade can't reach: card photos and recordings that
  // belong to this account or sit in a workspace that goes with it.
  const cardFiles = new Set<string>();
  const audioFiles = new Set<string>();
  const addContacts = (rows: { front_path: string | null; back_path: string | null }[] | null) =>
    (rows ?? []).forEach((c) => { if (c.front_path) cardFiles.add(c.front_path); if (c.back_path) cardFiles.add(c.back_path); });
  const addAudio = (rows: { audio_path: string | null }[] | null) =>
    // A long recording is saved in parts: audio_path lists them, one per line.
    (rows ?? []).forEach((i) => String(i.audio_path ?? "").split("\n").map((p) => p.trim()).filter(Boolean).forEach((p) => audioFiles.add(p)));

  addContacts((await admin.from("contacts").select("front_path, back_path").eq("created_by", userId)).data);
  addAudio((await admin.from("interactions").select("audio_path").eq("created_by", userId).not("audio_path", "is", null)).data);
  if (removedWs.length) {
    addContacts((await admin.from("contacts").select("front_path, back_path").in("workspace_id", removedWs)).data);
    addAudio((await admin.from("interactions").select("audio_path").in("workspace_id", removedWs).not("audio_path", "is", null)).data);
  }
  await removeFiles(admin, "cards", [...cardFiles]);
  await removeFiles(admin, "recordings", [...audioFiles]);

  // Removing the login cascades to the profile, its cards, notes, memberships,
  // share offers and the workspaces it still owns.
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw error;
}

async function removeFiles(admin: Admin, bucket: string, paths: string[]) {
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await admin.storage.from(bucket).remove(paths.slice(i, i + 100));
    if (error) throw error;
  }
}
