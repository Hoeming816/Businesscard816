-- Meetings recorded from the Meeting Minutes tab don't have to belong to a
-- business card. Such an entry (contact_id is null) belongs only to the person
-- who recorded it, inside one of their workspaces. Its recording is stored at
-- recordings/<workspace>/m-<user id>/<file>.

alter table public.interactions alter column contact_id drop not null;
create index if not exists interactions_ws_idx on public.interactions (workspace_id, occurred_on desc);

-- Workspace follows the contact when there is one; otherwise it is the
-- caller's choice on insert and fixed afterwards.
create or replace function public.prepare_interaction()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.contact_id := old.contact_id;
    new.workspace_id := old.workspace_id;
  elsif new.contact_id is not null then
    select workspace_id into new.workspace_id from contacts where id = new.contact_id;
  end if;
  if tg_op = 'INSERT' and auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

-- Can the caller read / change this entry? Card entries follow the card;
-- entries without a card are the author's own.
create or replace function public.can_read_interaction(p_contact uuid, p_ws uuid, p_author uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case when p_contact is null
    then p_author = auth.uid() and public.can_read_ws(p_ws)
    else public.can_read_contact(p_contact) end;
$$;
create or replace function public.can_write_interaction(p_contact uuid, p_ws uuid, p_author uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case when p_contact is null
    then p_author = auth.uid() and public.can_read_ws(p_ws)
    else public.can_write_contact(p_contact) end;
$$;
revoke all on function public.can_read_interaction(uuid, uuid, uuid) from public, anon;
revoke all on function public.can_write_interaction(uuid, uuid, uuid) from public, anon;
grant execute on function public.can_read_interaction(uuid, uuid, uuid) to authenticated;
grant execute on function public.can_write_interaction(uuid, uuid, uuid) to authenticated;

drop policy interactions_select on public.interactions;
drop policy interactions_insert on public.interactions;
drop policy interactions_update on public.interactions;
drop policy interactions_delete on public.interactions;
create policy interactions_select on public.interactions for select to authenticated
  using (public.can_read_interaction(contact_id, workspace_id, created_by));
create policy interactions_insert on public.interactions for insert to authenticated
  with check (created_by = auth.uid() and public.can_write_interaction(contact_id, workspace_id, created_by));
create policy interactions_update on public.interactions for update to authenticated
  using (public.can_write_interaction(contact_id, workspace_id, created_by))
  with check (public.can_write_interaction(contact_id, workspace_id, created_by));
create policy interactions_delete on public.interactions for delete to authenticated
  using (public.can_write_interaction(contact_id, workspace_id, created_by));

-- Recordings of meetings without a card: <workspace>/m-<user id>/<file>, own only.
create or replace function public.own_meeting_folder(object_name text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  parts text[] := string_to_array(object_name, '/');
begin
  if array_length(parts, 1) < 3 or parts[2] <> 'm-' || auth.uid()::text then return false; end if;
  return public.can_read_ws(parts[1]::uuid);
exception when invalid_text_representation then
  return false;
end;
$$;
revoke all on function public.own_meeting_folder(text) from public, anon;
grant execute on function public.own_meeting_folder(text) to authenticated;

create policy meeting_recordings_select on storage.objects for select to authenticated
  using (bucket_id = 'recordings' and public.own_meeting_folder(name));
create policy meeting_recordings_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'recordings' and public.own_meeting_folder(name));
create policy meeting_recordings_update on storage.objects for update to authenticated
  using (bucket_id = 'recordings' and public.own_meeting_folder(name));
create policy meeting_recordings_delete on storage.objects for delete to authenticated
  using (bucket_id = 'recordings' and public.own_meeting_folder(name));
