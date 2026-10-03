-- Cardfile v1: schema, row level security, storage
-- Run once on a fresh Supabase project (SQL editor or `supabase db push`).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  username         text not null unique check (username ~ '^[a-z0-9._-]{3,30}$'),
  full_name        text not null default '',
  is_super_admin   boolean not null default false,
  status           text not null default 'active' check (status in ('active', 'suspended')),
  suspended_reason text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.workspaces (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) between 1 and 80),
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  status     text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  role         text not null default 'viewer' check (role in ('admin', 'editor', 'viewer')),
  status       text not null default 'active' check (status in ('active', 'revoked')),
  added_by     uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members (user_id);

create table public.contacts (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  created_by        uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  is_private        boolean not null default false,

  -- from the card
  full_name         text not null default '',
  job_title         text,
  company           text,
  department        text,
  emails            text[] not null default '{}',
  phones            jsonb not null default '[]'::jsonb,   -- [{label, number}]
  website           text,
  address           text,
  city              text,
  region            text,
  country           text,
  card_text         text,

  -- classification
  contact_type      text,
  industry          text,
  business_category text,
  job_function      text,
  seniority         text,
  opportunities     text[] not null default '{}',
  tags              text[] not null default '{}',

  -- relationship
  relationship      text,
  lead_status       text,
  lead_source       text,
  priority          text,
  last_contacted_on date,
  next_follow_up_on date,
  notes             text,

  -- photos
  front_path        text,
  back_path         text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index contacts_workspace_idx on public.contacts (workspace_id, created_at desc);
create index contacts_created_by_idx on public.contacts (created_by);

create table public.interactions (
  id           uuid primary key default gen_random_uuid(),
  contact_id   uuid not null references public.contacts (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  kind         text not null default 'Meeting'
               check (kind in ('Meeting', 'Call', 'Site visit', 'Email', 'Message', 'Note')),
  occurred_on  date not null default current_date,
  title        text,
  notes        text,
  transcript   text,
  summary      text,
  action_items text[] not null default '{}',
  audio_path   text,
  duration_sec integer,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index interactions_contact_idx on public.interactions (contact_id, occurred_on desc);

-- ---------------------------------------------------------------------------
-- Helper predicates (security definer so policies can call them without
-- recursing through RLS)
-- ---------------------------------------------------------------------------

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and is_super_admin and status = 'active'
  );
$$;

-- Caller's role in a workspace, or null. Requires an active membership,
-- an active workspace and an active profile.
create or replace function public.ws_role(ws uuid)
returns text language sql stable security definer set search_path = public as $$
  select m.role
  from workspace_members m
  join workspaces w on w.id = m.workspace_id
  join profiles p on p.id = m.user_id
  where m.workspace_id = ws
    and m.user_id = auth.uid()
    and m.status = 'active'
    and w.status = 'active'
    and p.status = 'active';
$$;

create or replace function public.can_read_ws(ws uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.ws_role(ws) is not null;
$$;

create or replace function public.can_write_ws(ws uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.ws_role(ws) in ('admin', 'editor'), false);
$$;

create or replace function public.is_ws_admin(ws uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.ws_role(ws) = 'admin', false);
$$;

create or replace function public.can_read_contact(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from contacts c
    where c.id = cid
      and public.can_read_ws(c.workspace_id)
      and (not c.is_private or c.created_by = auth.uid())
  );
$$;

create or replace function public.can_write_contact(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from contacts c
    where c.id = cid
      and public.can_write_ws(c.workspace_id)
      and (not c.is_private or c.created_by = auth.uid())
  );
$$;

create or replace function public.shares_workspace(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from workspace_members a
    join workspace_members b on b.workspace_id = a.workspace_id
    where a.user_id = auth.uid() and b.user_id = other
      and public.can_read_ws(a.workspace_id)
  );
$$;

-- Storage paths are <workspace_id>/<contact_id>/<file>. The workspace segment
-- must match the contact's workspace.
create or replace function public.storage_contact(object_name text)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  parts text[] := string_to_array(object_name, '/');
  cid uuid;
begin
  if array_length(parts, 1) < 3 then return null; end if;
  select c.id into cid from contacts c
  where c.id = parts[2]::uuid and c.workspace_id = parts[1]::uuid;
  return cid;
exception when invalid_text_representation then
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers: bootstrap
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger contacts_touch before update on public.contacts
  for each row execute function public.touch_updated_at();
create trigger interactions_touch before update on public.interactions
  for each row execute function public.touch_updated_at();

-- New auth user -> profile + personal workspace.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uname text := lower(coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)));
  fname text := coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), uname);
begin
  insert into profiles (id, username, full_name) values (new.id, uname, fname);
  insert into workspaces (name, owner_id) values (fname || '''s cards', new.id);
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- New workspace -> owner added as admin.
create or replace function public.handle_new_workspace()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into workspace_members (workspace_id, user_id, role, status, added_by)
  values (new.id, new.owner_id, 'admin', 'active', new.owner_id)
  on conflict (workspace_id, user_id) do update set role = 'admin', status = 'active';
  return new;
end;
$$;

create trigger on_workspace_created after insert on public.workspaces
  for each row execute function public.handle_new_workspace();

-- ---------------------------------------------------------------------------
-- Triggers: guards against privilege escalation
-- auth.uid() is null for the service role / SQL editor, which bypasses guards.
-- ---------------------------------------------------------------------------

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
       or new.username is distinct from old.username then
      raise exception 'not allowed to change account status, role or username';
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

create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profiles();

create or replace function public.guard_workspaces()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'active' then
      raise exception 'new workspaces must be active';
    end if;
    return new;
  end if;
  if not public.is_super_admin() then
    if new.status is distinct from old.status or new.owner_id is distinct from old.owner_id then
      raise exception 'only a super admin can change workspace status or owner';
    end if;
  end if;
  return new;
end;
$$;

create trigger workspaces_guard before insert or update on public.workspaces
  for each row execute function public.guard_workspaces();

create or replace function public.guard_members()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  owner uuid;
  rec workspace_members;
begin
  if tg_op = 'DELETE' then rec := old; else rec := new; end if;
  if auth.uid() is null then
    return rec;
  end if;
  select owner_id into owner from workspaces where id = rec.workspace_id;

  if tg_op = 'UPDATE' then
    if new.workspace_id <> old.workspace_id or new.user_id <> old.user_id then
      raise exception 'membership keys cannot change';
    end if;
  end if;

  if public.is_super_admin() then
    return rec;
  end if;

  if rec.user_id = owner then
    if tg_op = 'DELETE' then
      raise exception 'the workspace owner cannot be removed';
    elsif tg_op = 'UPDATE' and (new.role <> 'admin' or new.status <> 'active') then
      raise exception 'the workspace owner cannot be demoted or revoked';
    end if;
  end if;

  if tg_op = 'UPDATE' and old.user_id = auth.uid() and new.role is distinct from old.role then
    raise exception 'you cannot change your own role';
  end if;

  return rec;
end;
$$;

create trigger members_guard before update or delete on public.workspace_members
  for each row execute function public.guard_members();

-- Contacts: workspace never changes; ownership changes only when a workspace
-- admin takes someone else's shared card private.
create or replace function public.guard_contacts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if new.workspace_id <> old.workspace_id then
    raise exception 'a card cannot move between workspaces';
  end if;
  if new.created_by <> old.created_by then
    if not (public.is_ws_admin(old.workspace_id)
            and not old.is_private
            and new.is_private
            and new.created_by = auth.uid()) then
      raise exception 'card ownership can only change when an admin takes a shared card private';
    end if;
  end if;
  return new;
end;
$$;

create trigger contacts_guard before update on public.contacts
  for each row execute function public.guard_contacts();

-- Interactions: workspace follows the contact; author is the caller.
create or replace function public.prepare_interaction()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select workspace_id into new.workspace_id from contacts where id = new.contact_id;
  if tg_op = 'INSERT' and auth.uid() is not null then
    new.created_by := auth.uid();
  elsif tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.contact_id := old.contact_id;
  end if;
  return new;
end;
$$;

create trigger interactions_prepare before insert or update on public.interactions
  for each row execute function public.prepare_interaction();

-- Saving a non-Note entry bumps the contact's last_contacted_on if newer.
create or replace function public.bump_last_contacted()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind <> 'Note' then
    update contacts
       set last_contacted_on = new.occurred_on
     where id = new.contact_id
       and (last_contacted_on is null or last_contacted_on < new.occurred_on);
  end if;
  return null;
end;
$$;

create trigger interactions_bump after insert or update of occurred_on, kind on public.interactions
  for each row execute function public.bump_last_contacted();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.profiles          enable row level security;
alter table public.workspaces        enable row level security;
alter table public.workspace_members enable row level security;
alter table public.contacts          enable row level security;
alter table public.interactions      enable row level security;

-- profiles
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_super_admin() or public.shares_workspace(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_super_admin())
  with check (id = auth.uid() or public.is_super_admin());

-- workspaces
create policy workspaces_select on public.workspaces for select to authenticated
  using (public.can_read_ws(id) or public.is_super_admin());
create policy workspaces_insert on public.workspaces for insert to authenticated
  with check (
    owner_id = auth.uid()
    and exists (select 1 from public.profiles where id = auth.uid() and status = 'active')
  );
create policy workspaces_update on public.workspaces for update to authenticated
  using (public.is_ws_admin(id) or public.is_super_admin())
  with check (public.is_ws_admin(id) or public.is_super_admin());

-- workspace_members (inserts go through add_member / the workspace trigger)
create policy members_select on public.workspace_members for select to authenticated
  using (user_id = auth.uid() or public.can_read_ws(workspace_id) or public.is_super_admin());
create policy members_update on public.workspace_members for update to authenticated
  using (public.is_ws_admin(workspace_id) or public.is_super_admin())
  with check (public.is_ws_admin(workspace_id) or public.is_super_admin());
create policy members_delete on public.workspace_members for delete to authenticated
  using (user_id = auth.uid() or public.is_ws_admin(workspace_id) or public.is_super_admin());

-- contacts (no super admin clause: super admins cannot read cards)
create policy contacts_select on public.contacts for select to authenticated
  using (public.can_read_ws(workspace_id) and (not is_private or created_by = auth.uid()));
create policy contacts_insert on public.contacts for insert to authenticated
  with check (public.can_write_ws(workspace_id) and created_by = auth.uid());
create policy contacts_update on public.contacts for update to authenticated
  using (public.can_write_ws(workspace_id) and (not is_private or created_by = auth.uid()))
  with check (public.can_write_ws(workspace_id) and (not is_private or created_by = auth.uid()));
create policy contacts_delete on public.contacts for delete to authenticated
  using (
    public.can_write_ws(workspace_id)
    and (not is_private or created_by = auth.uid())
    and (created_by = auth.uid() or public.is_ws_admin(workspace_id))
  );

-- interactions inherit the card's visibility
create policy interactions_select on public.interactions for select to authenticated
  using (public.can_read_contact(contact_id));
create policy interactions_insert on public.interactions for insert to authenticated
  with check (public.can_write_contact(contact_id) and created_by = auth.uid());
create policy interactions_update on public.interactions for update to authenticated
  using (public.can_write_contact(contact_id)
         and (created_by = auth.uid() or public.is_ws_admin(workspace_id)))
  with check (public.can_write_contact(contact_id));
create policy interactions_delete on public.interactions for delete to authenticated
  using (public.can_write_contact(contact_id)
         and (created_by = auth.uid() or public.is_ws_admin(workspace_id)));

grant select, insert, update, delete on
  public.profiles, public.workspaces, public.workspace_members, public.contacts, public.interactions
  to authenticated;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

create or replace function public.username_available(p_username text)
returns boolean language sql stable security definer set search_path = public as $$
  select lower(p_username) ~ '^[a-z0-9._-]{3,30}$'
     and not exists (select 1 from profiles where username = lower(p_username));
$$;

-- Shown on the sign-in screen when Auth reports the account as banned.
create or replace function public.suspension_notice(p_username text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(suspended_reason, '')
  from profiles where username = lower(p_username) and status = 'suspended';
$$;

create or replace function public.add_member(p_workspace uuid, p_username text, p_role text)
returns public.workspace_members
language plpgsql security definer set search_path = public as $$
declare
  target uuid;
  result workspace_members;
begin
  if not public.is_ws_admin(p_workspace) then
    raise exception 'only workspace admins can add members';
  end if;
  if p_role not in ('admin', 'editor', 'viewer') then
    raise exception 'invalid role %', p_role;
  end if;
  select id into target from profiles where username = lower(trim(p_username));
  if target is null then
    raise exception 'no account with username "%" — they need to sign up first', p_username;
  end if;
  if target = (select owner_id from workspaces where id = p_workspace) then
    raise exception 'that person owns this workspace';
  end if;

  insert into workspace_members (workspace_id, user_id, role, status, added_by)
  values (p_workspace, target, p_role, 'active', auth.uid())
  on conflict (workspace_id, user_id)
    do update set role = excluded.role, status = 'active', added_by = excluded.added_by
  returning * into result;
  return result;
end;
$$;

-- Super admin dashboard: workspace list with counts only, never card contents.
create or replace function public.super_admin_workspaces()
returns table (
  id uuid, name text, status text, created_at timestamptz,
  owner_id uuid, owner_username text, owner_name text,
  active_members bigint, card_count bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_super_admin() then
    raise exception 'super admin only';
  end if;
  return query
    select w.id, w.name, w.status, w.created_at,
           w.owner_id, p.username, p.full_name,
           (select count(*) from workspace_members m
              join profiles mp on mp.id = m.user_id
             where m.workspace_id = w.id and m.status = 'active' and mp.status = 'active'),
           (select count(*) from contacts c where c.workspace_id = w.id)
      from workspaces w
      join profiles p on p.id = w.owner_id
     order by w.created_at desc;
end;
$$;

revoke execute on function public.username_available(text) from public;
revoke execute on function public.suspension_notice(text) from public;
revoke execute on function public.add_member(uuid, text, text) from public;
revoke execute on function public.super_admin_workspaces() from public;
grant execute on function public.username_available(text) to anon, authenticated;
grant execute on function public.suspension_notice(text) to anon, authenticated;
grant execute on function public.add_member(uuid, text, text) to authenticated;
grant execute on function public.super_admin_workspaces() to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: private buckets for card photos and recordings
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('cards', 'cards', false), ('recordings', 'recordings', false)
on conflict (id) do nothing;

create policy cardfile_objects_select on storage.objects for select to authenticated
  using (
    bucket_id in ('cards', 'recordings')
    and public.can_read_contact(public.storage_contact(name))
  );
create policy cardfile_objects_insert on storage.objects for insert to authenticated
  with check (
    bucket_id in ('cards', 'recordings')
    and public.can_write_contact(public.storage_contact(name))
  );
create policy cardfile_objects_update on storage.objects for update to authenticated
  using (
    bucket_id in ('cards', 'recordings')
    and public.can_write_contact(public.storage_contact(name))
  );
create policy cardfile_objects_delete on storage.objects for delete to authenticated
  using (
    bucket_id in ('cards', 'recordings')
    and public.can_write_contact(public.storage_contact(name))
  );
