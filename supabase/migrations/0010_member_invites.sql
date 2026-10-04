-- Member invitations: adding someone to a workspace now invites them. They
-- join only when they accept; until then the membership row is 'invited',
-- which every access check already treats as no access (ws_role requires
-- status = 'active'). Existing members are unchanged.

alter table public.workspace_members drop constraint if exists workspace_members_status_check;
alter table public.workspace_members add constraint workspace_members_status_check
  check (status in ('active', 'revoked', 'invited'));

-- "Stay private": nobody can add or invite this person. Their own switch.
alter table public.profiles add column if not exists private_account boolean not null default false;

-- Adding a member: invite them, or just change the role of an active member.
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
  select id into target from profiles where username = lower(trim(p_username)) and status = 'active';
  if target is null then
    raise exception 'no account with username "%" — they need to sign up first', p_username;
  end if;
  if target = (select owner_id from workspaces where id = p_workspace) then
    raise exception 'that person owns this workspace';
  end if;
  if (select private_account from profiles where id = target)
     and not exists (select 1 from workspace_members where workspace_id = p_workspace and user_id = target and status = 'active') then
    raise exception 'This person isn''t accepting invitations.';
  end if;

  insert into workspace_members (workspace_id, user_id, role, status, added_by)
  values (p_workspace, target, p_role, 'invited', auth.uid())
  on conflict (workspace_id, user_id)
    do update set role = excluded.role,
                  status = case when workspace_members.status = 'active' then 'active' else 'invited' end,
                  added_by = excluded.added_by,
                  created_at = case when workspace_members.status = 'active' then workspace_members.created_at else now() end
  returning * into result;
  return result;
end;
$$;

-- Only the invited person can turn an invitation into a membership.
create or replace function public.guard_member_invite()
returns trigger language plpgsql as $$
begin
  if old.status = 'invited' and new.status = 'active'
     and coalesce(current_setting('app.accepting_invite', true), '') <> 'on' then
    raise exception 'They join when they accept the invitation.';
  end if;
  return new;
end;
$$;
drop trigger if exists workspace_members_invite_guard on public.workspace_members;
create trigger workspace_members_invite_guard
  before update on public.workspace_members
  for each row execute function public.guard_member_invite();

-- The caller's open invitations, with who sent them.
create or replace function public.my_invites()
returns table (workspace_id uuid, workspace_name text, inviter_name text, role text, invited_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.workspace_id, w.name, coalesce(nullif(ip.full_name, ''), ip.username, op.full_name, op.username),
         m.role, m.created_at
    from workspace_members m
    join workspaces w on w.id = m.workspace_id and w.status = 'active'
    join profiles op on op.id = w.owner_id
    left join profiles ip on ip.id = m.added_by
   where m.user_id = auth.uid() and m.status = 'invited'
     and exists (select 1 from profiles me where me.id = auth.uid() and me.status = 'active')
   order by m.created_at;
$$;

-- Accept (join) or decline (the invitation is removed).
create or replace function public.respond_invite(p_workspace uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from workspace_members
                  where workspace_id = p_workspace and user_id = auth.uid() and status = 'invited') then
    raise exception 'This invitation is no longer open.';
  end if;
  if p_accept then
    perform set_config('app.accepting_invite', 'on', true);
    update workspace_members set status = 'active'
     where workspace_id = p_workspace and user_id = auth.uid();
    perform set_config('app.accepting_invite', '', true);
  else
    delete from workspace_members where workspace_id = p_workspace and user_id = auth.uid();
  end if;
end;
$$;

revoke all on function public.my_invites() from public;
revoke all on function public.respond_invite(uuid, boolean) from public;
grant execute on function public.my_invites() to authenticated;
grant execute on function public.respond_invite(uuid, boolean) to authenticated;
