-- Supabase grants EXECUTE on new public functions to anon/authenticated by default.
-- Only the sign-in screen RPCs need anon; trigger functions need no caller grants.
alter function public.touch_updated_at() set search_path = public;

revoke execute on function
  public.is_super_admin(), public.ws_role(uuid), public.can_read_ws(uuid), public.can_write_ws(uuid),
  public.is_ws_admin(uuid), public.can_read_contact(uuid), public.can_write_contact(uuid),
  public.shares_workspace(uuid), public.storage_contact(text),
  public.add_member(uuid, text, text), public.super_admin_workspaces()
  from anon, public;

revoke execute on function
  public.touch_updated_at(), public.handle_new_user(), public.handle_new_workspace(),
  public.guard_profiles(), public.guard_workspaces(), public.guard_members(), public.guard_contacts(),
  public.prepare_interaction(), public.bump_last_contacted()
  from anon, authenticated, public;

-- RLS policies call these as the signed-in user. Supabase already grants
-- authenticated EXECUTE by default; this keeps it explicit everywhere.
grant execute on function
  public.is_super_admin(), public.ws_role(uuid), public.can_read_ws(uuid), public.can_write_ws(uuid),
  public.is_ws_admin(uuid), public.can_read_contact(uuid), public.can_write_contact(uuid),
  public.shares_workspace(uuid), public.storage_contact(text),
  public.add_member(uuid, text, text), public.super_admin_workspaces()
  to authenticated;
