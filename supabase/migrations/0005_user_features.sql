-- Per-user feature switches, set by a super admin on the Super admin page.
-- profiles.features holds only the switches that were changed, e.g.
-- {"share": false, "meeting": true}. A feature that is not listed uses its
-- default: everything is on except meeting. Super admins have everything.
--
--   scan_ai   AI reading of scanned cards (scan-card function)              default on
--   share     sharing cards with members                                     default on
--   meeting   Meeting Minutes tab, recordings, transcription and AI minutes  default off
--             (recordings bucket uploads, meeting-notes function)

alter table public.profiles add column if not exists features jsonb not null default '{}'::jsonb;
alter table public.profiles drop constraint if exists profiles_features_object;
alter table public.profiles add constraint profiles_features_object check (jsonb_typeof(features) = 'object');

-- Is a feature on for the caller? Unset features use their default.
create or replace function public.feature_on(p_feature text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select case when p.is_super_admin then true else (p.features ->> p_feature)::boolean end
       from profiles p where p.id = auth.uid()),
    p_feature not in ('meeting'));
$$;
revoke all on function public.feature_on(text) from public, anon;
grant execute on function public.feature_on(text) to authenticated;

-- Only a super admin may change features (including their own).
create or replace function public.guard_profiles()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;

  if new.id <> old.id then
    raise exception 'profile id cannot change';
  end if;

  if not public.is_super_admin() then
    if new.is_super_admin is distinct from old.is_super_admin
       or new.status is distinct from old.status
       or new.suspended_reason is distinct from old.suspended_reason
       or new.username is distinct from old.username
       or new.features is distinct from old.features then
      raise exception 'not allowed to change account status, role, username or features';
    end if;
  elsif old.id = auth.uid() then
    if new.is_super_admin is distinct from old.is_super_admin
       or new.status is distinct from old.status then
      raise exception 'super admins cannot suspend or demote themselves';
    end if;
  end if;
  return new;
end;
$$;

-- Enforcement in the database. Restrictive policies are ANDed with the
-- existing ones, so a switched-off feature is refused whatever the app does.
drop policy if exists card_shares_insert_feature on public.card_shares;
create policy card_shares_insert_feature on public.card_shares as restrictive for insert to authenticated
  with check (public.feature_on('share'));

drop policy if exists cardfile_objects_insert_recording_feature on storage.objects;
create policy cardfile_objects_insert_recording_feature on storage.objects as restrictive for insert to authenticated
  with check (bucket_id <> 'recordings' or public.feature_on('meeting'));
drop policy if exists cardfile_objects_update_recording_feature on storage.objects;
create policy cardfile_objects_update_recording_feature on storage.objects as restrictive for update to authenticated
  using (bucket_id <> 'recordings' or public.feature_on('meeting'));
