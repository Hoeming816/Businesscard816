-- Sign-up approval: a new account waits for the super admin before it works.
--
-- Sign-up creates the account with status 'pending'. Every access check
-- already requires status = 'active' (ws_role, me_active, the edge functions'
-- requireCaller), so a pending account can read nothing but its own profile
-- row: no cards, photos, meetings, tasks, notes, shares or AI. On top of that,
-- restrictive policies below refuse every table and storage file to an
-- account that is not active, whatever any other policy says.
--
-- The super admin approves (status becomes 'active') or rejects (the login and
-- its empty profile and workspace are erased, so the username is free again).
--
-- hoeming816, the only possible super admin, is never held back. Existing
-- accounts are not touched and stay active. No rows are updated.

alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles add constraint profiles_status_check
  check (status in ('active', 'pending', 'suspended', 'deleted'));

-- New auth user -> pending profile + personal workspace.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uname text := lower(coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)));
  fname text := coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), uname);
begin
  insert into profiles (id, username, full_name, status)
  values (new.id, uname, fname, case when uname = 'hoeming816' then 'active' else 'pending' end);
  insert into workspaces (name, owner_id) values (fname || '''s cards', new.id);
  return new;
end;
$$;

-- Approve: the account can use the app from its next sign-in.
create or replace function public.approve_signup(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only the super admin can approve sign-ups.';
  end if;
  update profiles set status = 'active' where id = p_user and status = 'pending';
  if not found then
    raise exception 'This sign-up was already answered.';
  end if;
end;
$$;

-- Reject: erase the pending login. Its profile, empty workspace and
-- membership go with it (on delete cascade). A pending account can't have
-- saved anything, so there are no files to remove.
create or replace function public.reject_signup(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only the super admin can reject sign-ups.';
  end if;
  if not exists (select 1 from profiles where id = p_user and status = 'pending') then
    raise exception 'This sign-up was already answered.';
  end if;
  delete from auth.users where id = p_user;
end;
$$;

revoke all on function public.approve_signup(uuid) from public, anon;
revoke all on function public.reject_signup(uuid) from public, anon;
grant execute on function public.approve_signup(uuid) to authenticated;
grant execute on function public.reject_signup(uuid) to authenticated;

-- Belt and braces: an account that isn't active (pending, suspended or
-- deleted) gets nothing from any table or storage file, whatever the other
-- policies allow. Restrictive policies are ANDed with the existing ones.
-- profiles is left out so a pending person can still read their own row,
-- which is how the app knows to show "waiting for approval".
do $$
declare t text;
begin
  foreach t in array array['workspaces', 'workspace_members', 'contacts', 'interactions',
                           'card_shares', 'tasks', 'note_topics', 'notes'] loop
    execute format('drop policy if exists %I on public.%I', t || '_active_only', t);
    execute format('create policy %I on public.%I as restrictive for all to authenticated
                      using ((select public.me_active())) with check ((select public.me_active()))',
                   t || '_active_only', t);
  end loop;
end $$;

drop policy if exists objects_active_only on storage.objects;
create policy objects_active_only on storage.objects as restrictive for all to authenticated
  using ((select public.me_active())) with check ((select public.me_active()));
