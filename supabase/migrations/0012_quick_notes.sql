-- Quick Notes: fast personal notes, loose or inside a Topic. Things to do that
-- are found in a note can be added to the To Do List with one tap. Typed, spoken or a photo; with an optional
-- title, a checklist, tags, a colour, photos and files. Notes can be pinned to
-- the top, archived, or moved to Trash and restored from there.
--
-- A note belongs to whoever wrote it and nobody else can see it, nor its
-- files: super admins cannot read anyone's notes either. Sharing a note sends
-- a copy of its text out of the app (WhatsApp, email…); nothing is shared here.
--
-- Quick Notes is a per-user feature switch, off until a super admin turns it
-- on (src/features.js, requireFeature in the edge functions).
-- Only adds a table, a storage bucket and policies, and replaces two
-- functions: existing data and policies are unchanged.

-- Unset features use their default; meeting, todo and notes are off by default.
create or replace function public.feature_on(p_feature text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select case when p.is_super_admin then true else (p.features ->> p_feature)::boolean end
       from profiles p where p.id = auth.uid()),
    p_feature not in ('meeting', 'todo', 'notes'));
$$;

create or replace function public.user_feature_on(p_user uuid, p_feature text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select case when p.is_super_admin then true else (p.features ->> p_feature)::boolean end
       from profiles p where p.id = p_user),
    p_feature not in ('meeting', 'todo', 'notes'));
$$;
revoke all on function public.user_feature_on(uuid, text) from public, anon, authenticated;

-- A Topic groups notes (a project, a customer, a trip). Names are unique per person.
create table if not exists public.note_topics (
  id          uuid primary key default gen_random_uuid(),
  created_by  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 80),
  color       text check (color is null or color in ('yellow', 'green', 'blue', 'pink', 'purple', 'grey')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists note_topics_name_idx on public.note_topics (created_by, lower(trim(name)));

drop trigger if exists note_topics_touch on public.note_topics;
create trigger note_topics_touch before update on public.note_topics
  for each row execute function public.touch_updated_at();

create table if not exists public.notes (
  id          uuid primary key default gen_random_uuid(),
  created_by  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  -- deleting a Topic leaves its notes loose (the app moves them to Trash first)
  topic_id    uuid references public.note_topics (id) on delete set null,
  title       text check (title is null or length(title) <= 200),
  body        text not null default '' check (length(body) <= 20000),
  -- [{"id": "...", "text": "...", "done": false}]
  checklist   jsonb not null default '[]'::jsonb check (jsonb_typeof(checklist) = 'array'),
  tags        text[] not null default '{}' check (coalesce(array_length(tags, 1), 0) <= 20),
  color       text check (color is null or color in ('yellow', 'green', 'blue', 'pink', 'purple', 'grey')),
  -- photos, voice recordings and files in the note-files bucket:
  -- [{"path": "<owner>/<note>/<file>", "name": "...", "type": "image/jpeg", "size": 123}]
  files       jsonb not null default '[]'::jsonb check (jsonb_typeof(files) = 'array'),
  -- to-dos found in the note, offered as "Add to To-Do":
  -- [{"id": "...", "title": "...", "due_on": "YYYY-MM-DD" | null, "due_time": "HH:MM" | null, "task_id": null, "dismissed": false}]
  actions     jsonb not null default '[]'::jsonb check (jsonb_typeof(actions) = 'array'),
  pinned      boolean not null default false,
  archived_at timestamptz,
  deleted_at  timestamptz,   -- in Trash since then
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists notes_created_by_idx on public.notes (created_by, updated_at desc);

drop trigger if exists notes_touch on public.notes;
create trigger notes_touch before update on public.notes
  for each row execute function public.touch_updated_at();

-- Notes and Topics are always the writer's own and never change owner, and a
-- note can only go in one of its owner's own Topics.
create or replace function public.prepare_note()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
  elsif new.created_by <> old.created_by then
    raise exception 'a note cannot change owner';
  end if;
  if tg_table_name = 'notes' then
    if new.topic_id is not null
       and not exists (select 1 from note_topics t where t.id = new.topic_id and t.created_by = new.created_by) then
      raise exception 'That topic is not there any more.';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.prepare_note() from public, anon, authenticated;
drop trigger if exists notes_prepare on public.notes;
create trigger notes_prepare before insert or update on public.notes
  for each row execute function public.prepare_note();
drop trigger if exists note_topics_prepare on public.note_topics;
create trigger note_topics_prepare before insert or update on public.note_topics
  for each row execute function public.prepare_note();

alter table public.note_topics enable row level security;
grant select, insert, update, delete on public.note_topics to authenticated;
create policy note_topics_select on public.note_topics for select to authenticated
  using (created_by = auth.uid() and public.me_active());
create policy note_topics_insert on public.note_topics for insert to authenticated
  with check (created_by = auth.uid() and public.me_active() and public.feature_on('notes'));
create policy note_topics_update on public.note_topics for update to authenticated
  using (created_by = auth.uid() and public.me_active())
  with check (created_by = auth.uid() and public.me_active());
create policy note_topics_delete on public.note_topics for delete to authenticated
  using (created_by = auth.uid() and public.me_active());

alter table public.notes enable row level security;
grant select, insert, update, delete on public.notes to authenticated;

-- No super admin clause: nobody reads another person's notes.
create policy notes_select on public.notes for select to authenticated
  using (created_by = auth.uid() and public.me_active());
create policy notes_insert on public.notes for insert to authenticated
  with check (created_by = auth.uid() and public.me_active() and public.feature_on('notes'));
create policy notes_update on public.notes for update to authenticated
  using (created_by = auth.uid() and public.me_active())
  with check (created_by = auth.uid() and public.me_active());
create policy notes_delete on public.notes for delete to authenticated
  using (created_by = auth.uid() and public.me_active());

-- Files live under <owner id>/<note id>/ in a private bucket; only the owner
-- can read or change them, and adding needs Quick Notes on.
insert into storage.buckets (id, name, public)
values ('note-files', 'note-files', false)
on conflict (id) do nothing;

create policy note_files_select on storage.objects for select to authenticated
  using (bucket_id = 'note-files' and split_part(name, '/', 1) = auth.uid()::text and public.me_active());
create policy note_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'note-files' and split_part(name, '/', 1) = auth.uid()::text and public.me_active()
              and public.feature_on('notes'));
create policy note_files_update on storage.objects for update to authenticated
  using (bucket_id = 'note-files' and split_part(name, '/', 1) = auth.uid()::text and public.me_active());
create policy note_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'note-files' and split_part(name, '/', 1) = auth.uid()::text and public.me_active());
