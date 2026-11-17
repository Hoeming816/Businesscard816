-- Usage stats for the super admin.
--
-- The super admin sees, per account, how many cards (contacts) they have and
-- how often they use Nomiqo. Only counts and dates leave the database: no card,
-- meeting, task or note content.
--
-- "How often" needs a record of the days someone opened the app, because a
-- kept-signed-in user rarely signs in again. user_activity_days holds one row
-- per account per day (UTC) the app was opened, written by record_activity()
-- which the app calls once on load. Nobody can read the table directly: it
-- has row level security on and no policies; only super_admin_usage() reads it.
--
-- Earlier days are filled in once from what people already created (cards,
-- meetings, tasks, notes) and their last sign-in, so the history isn't empty.
-- Nothing is dropped or updated.

create table if not exists public.user_activity_days (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day     date not null,
  primary key (user_id, day)
);
alter table public.user_activity_days enable row level security;
revoke all on public.user_activity_days from anon, authenticated;

-- Called by the app when it opens. Counts only active accounts.
create or replace function public.record_activity()
returns void language sql volatile security definer set search_path = public as $$
  insert into user_activity_days (user_id, day)
  select p.id, (now() at time zone 'utc')::date
    from profiles p
   where p.id = auth.uid() and p.status = 'active'
  on conflict do nothing;
$$;

-- One row per account: counts and dates only. Super admin only.
create or replace function public.super_admin_usage()
returns table (
  user_id uuid, username text, full_name text, status text, is_super_admin boolean,
  created_at timestamptz, last_sign_in_at timestamptz, last_active_on date,
  active_days_7 bigint, active_days_30 bigint,
  cards_total bigint, cards_7 bigint, cards_30 bigint,
  meetings_total bigint, tasks_total bigint, notes_total bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_super_admin() then
    raise exception 'super admin only';
  end if;
  return query
    select p.id, p.username, p.full_name, p.status, p.is_super_admin,
           p.created_at, u.last_sign_in_at,
           (select max(a.day) from user_activity_days a where a.user_id = p.id),
           (select count(*) from user_activity_days a where a.user_id = p.id and a.day > current_date - 7),
           (select count(*) from user_activity_days a where a.user_id = p.id and a.day > current_date - 30),
           (select count(*) from contacts c where c.created_by = p.id),
           (select count(*) from contacts c where c.created_by = p.id and c.created_at > now() - interval '7 days'),
           (select count(*) from contacts c where c.created_by = p.id and c.created_at > now() - interval '30 days'),
           (select count(*) from interactions i where i.created_by = p.id and i.kind = 'Meeting'),
           (select count(*) from tasks t where t.created_by = p.id),
           (select count(*) from notes n where n.created_by = p.id)
      from profiles p
      left join auth.users u on u.id = p.id
     where p.status <> 'pending'
     order by p.username;
end;
$$;

revoke execute on function public.record_activity() from public, anon;
revoke execute on function public.super_admin_usage() from public, anon;
grant execute on function public.record_activity() to authenticated;
grant execute on function public.super_admin_usage() to authenticated;

-- One-off backfill of past active days from existing records.
insert into public.user_activity_days (user_id, day)
select distinct user_id, day from (
  select created_by as user_id, (created_at at time zone 'utc')::date as day from public.contacts
  union all select created_by, (created_at at time zone 'utc')::date from public.interactions
  union all select created_by, (created_at at time zone 'utc')::date from public.tasks
  union all select created_by, (created_at at time zone 'utc')::date from public.notes
  union all select id, (last_sign_in_at at time zone 'utc')::date from auth.users where last_sign_in_at is not null
) x
where exists (select 1 from public.profiles p where p.id = x.user_id)
on conflict do nothing;
