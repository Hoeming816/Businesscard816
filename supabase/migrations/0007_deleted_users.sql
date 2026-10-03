-- Deleted users: deleting an account from the Super admin page now only moves
-- it to "Deleted users". The login is blocked (Auth ban, set by the admin-users
-- function) and, like a suspended account, the profile fails every RLS check,
-- but its cards, photos, notes and recordings stay untouched. Reinstate brings
-- everything back; "Delete permanently" (admin-users purge) erases it.
-- No rows are updated and no policies are dropped.

alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles add constraint profiles_status_check
  check (status in ('active', 'suspended', 'deleted'));
alter table public.profiles add column if not exists deleted_at timestamptz;

-- The sign-in screen explains a blocked login for deleted accounts too.
create or replace function public.suspension_notice(p_username text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(suspended_reason, '')
  from profiles where username = lower(p_username) and status in ('suspended', 'deleted');
$$;
