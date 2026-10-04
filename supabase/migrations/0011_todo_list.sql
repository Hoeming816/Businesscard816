-- To Do List: personal tasks with priority, status, due date and time,
-- reminders, repeats, subtasks, notes, category and tags.
--
-- A task belongs to whoever made it and nobody else can see it, with one
-- exception: delegating. The owner can assign a task to someone who is an
-- active member of a team they are both in (they accepted the invitation),
-- and that person then sees that one task. They can move its status and tick
-- its subtasks, nothing else. Super admins cannot read anyone's tasks.
--
-- A repeating task is one row: marking it done moves it on to the next date.
--
-- The To Do List is a per-user feature switch, off until a super admin turns
-- it on (src/features.js, requireFeature in the edge functions).
-- Only adds a table and functions: existing data and policies are unchanged.

-- Unset features use their default; meeting and todo are off by default.
create or replace function public.feature_on(p_feature text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select case when p.is_super_admin then true else (p.features ->> p_feature)::boolean end
       from profiles p where p.id = auth.uid()),
    p_feature not in ('meeting', 'todo'));
$$;

-- The same, for another account (used when assigning a task to them).
create or replace function public.user_feature_on(p_user uuid, p_feature text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select case when p.is_super_admin then true else (p.features ->> p_feature)::boolean end
       from profiles p where p.id = p_user),
    p_feature not in ('meeting', 'todo'));
$$;
revoke all on function public.user_feature_on(uuid, text) from public, anon, authenticated;

-- True when the caller and `other` are both active members of an active team,
-- and both accounts are active. An open invitation does not count.
create or replace function public.task_teammate(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from workspace_members a
    join workspace_members b on b.workspace_id = a.workspace_id
    join workspaces w on w.id = a.workspace_id
    join profiles pa on pa.id = a.user_id
    join profiles pb on pb.id = b.user_id
    where a.user_id = auth.uid() and b.user_id = other and other <> auth.uid()
      and a.status = 'active' and b.status = 'active' and w.status = 'active'
      and pa.status = 'active' and pb.status = 'active'
  );
$$;
revoke all on function public.task_teammate(uuid) from public, anon;
grant execute on function public.task_teammate(uuid) to authenticated;

create or replace function public.me_active()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and status = 'active');
$$;
revoke all on function public.me_active() from public, anon;
grant execute on function public.me_active() to authenticated;

create table if not exists public.tasks (
  id               uuid primary key default gen_random_uuid(),
  created_by       uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title            text not null check (length(trim(title)) between 1 and 300),
  notes            text,
  priority         text not null default 'Normal' check (priority in ('Urgent', 'High', 'Normal', 'Low')),
  status           text not null default 'todo' check (status in ('todo', 'in_progress', 'waiting', 'done')),
  due_on           date,
  due_time         time,
  -- minutes before the deadline; a task without a time is due at 09:00 for reminders
  reminders        integer[] not null default '{}' check (0 <= all (reminders) and coalesce(array_length(reminders, 1), 0) <= 10),
  -- {"freq": "daily|weekly|monthly|yearly", "interval": 1, "days": [0-6]} or null
  repeat           jsonb check (repeat is null or (jsonb_typeof(repeat) = 'object' and repeat ->> 'freq' in ('daily', 'weekly', 'monthly', 'yearly'))),
  -- [{"id": "...", "text": "...", "done": false}]
  subtasks         jsonb not null default '[]'::jsonb check (jsonb_typeof(subtasks) = 'array'),
  category         text check (category is null or length(category) <= 40),
  tags             text[] not null default '{}',
  my_day_on        date,          -- added to My Day for that date
  -- delegation; the names are copied when the task is assigned
  assignee_id      uuid references public.profiles (id) on delete set null,
  assignee_name    text,
  assigned_by_name text,
  assigned_at      timestamptz,
  completed_at     timestamptz,
  done_count       integer not null default 0,  -- times a repeating task was done
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (due_time is null or due_on is not null),
  check (repeat is null or due_on is not null),
  check (assignee_id is null or assignee_id <> created_by)
);
create index if not exists tasks_created_by_idx on public.tasks (created_by, due_on);
create index if not exists tasks_assignee_idx on public.tasks (assignee_id) where assignee_id is not null;

drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch before update on public.tasks
  for each row execute function public.touch_updated_at();

-- Owner and assignment rules, completion time, and what an assignee may change.
create or replace function public.prepare_task()
returns trigger language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    if me is not null then new.created_by := me; end if;
    new.done_count := 0;
  else
    if new.created_by <> old.created_by then
      raise exception 'a task cannot change owner';
    end if;
    -- The person a task was given to can only work on it.
    if me is not null and me <> old.created_by then
      if new.title is distinct from old.title or new.notes is distinct from old.notes
         or new.priority is distinct from old.priority or new.reminders is distinct from old.reminders
         or new.repeat is distinct from old.repeat or new.category is distinct from old.category
         or new.tags is distinct from old.tags or new.my_day_on is distinct from old.my_day_on
         or new.assignee_id is distinct from old.assignee_id
         or ((new.due_on is distinct from old.due_on or new.due_time is distinct from old.due_time) and old.repeat is null) then
        raise exception 'Only the person who gave you this task can change it. You can update its status and checklist.';
      end if;
      new.assignee_name := old.assignee_name;
      new.assigned_by_name := old.assigned_by_name;
      new.assigned_at := old.assigned_at;
    end if;
  end if;

  if tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id then
    if new.assignee_id is null then
      new.assignee_name := null;
      new.assigned_by_name := null;
      new.assigned_at := null;
    else
      if me is not null and not public.task_teammate(new.assignee_id) then
        raise exception 'You can only give tasks to people in your team.';
      end if;
      if not public.user_feature_on(new.assignee_id, 'todo') then
        raise exception 'They do not have the To Do List yet. Ask your super admin to turn it on for them.';
      end if;
      select coalesce(nullif(full_name, ''), username) into new.assignee_name from profiles where id = new.assignee_id;
      select coalesce(nullif(full_name, ''), username) into new.assigned_by_name from profiles where id = new.created_by;
      new.assigned_at := now();
    end if;
  end if;

  -- completed_at: when it was done (for a repeating task, when it was last done).
  if tg_op = 'INSERT' then
    new.completed_at := case when new.status = 'done' then now() end;
  elsif new.done_count > old.done_count or (new.status = 'done' and old.status <> 'done') then
    new.completed_at := now();
  elsif new.status <> 'done' and old.status = 'done' then
    new.completed_at := null;
  else
    new.completed_at := old.completed_at;
  end if;
  return new;
end;
$$;
revoke all on function public.prepare_task() from public, anon, authenticated;
drop trigger if exists tasks_prepare on public.tasks;
create trigger tasks_prepare before insert or update on public.tasks
  for each row execute function public.prepare_task();

alter table public.tasks enable row level security;
grant select, insert, update, delete on public.tasks to authenticated;

-- No super admin clause: nobody reads another person's tasks.
create policy tasks_select on public.tasks for select to authenticated
  using ((created_by = auth.uid() and public.me_active())
         or (assignee_id = auth.uid() and public.task_teammate(created_by)));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (created_by = auth.uid() and public.me_active() and public.feature_on('todo'));
create policy tasks_update on public.tasks for update to authenticated
  using ((created_by = auth.uid() and public.me_active())
         or (assignee_id = auth.uid() and public.task_teammate(created_by)))
  with check ((created_by = auth.uid() and public.me_active())
              or (assignee_id = auth.uid() and public.task_teammate(created_by)));
create policy tasks_delete on public.tasks for delete to authenticated
  using (created_by = auth.uid() and public.me_active());
