-- Every card is visible only to the member who saved it. Workspace admins and
-- super admins cannot read other members' cards; the only way a card reaches
-- another member is Share (0003), which gives them their own copy.

-- Existing workspace-shared cards become private to whoever saved them.
update public.contacts set is_private = true where not is_private;
alter table public.contacts alter column is_private set default true;
alter table public.contacts add constraint contacts_owner_only check (is_private);

create or replace function public.can_read_contact(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from contacts c
    where c.id = cid and c.created_by = auth.uid() and public.can_read_ws(c.workspace_id)
  );
$$;

create or replace function public.can_write_contact(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from contacts c
    where c.id = cid and c.created_by = auth.uid() and public.can_write_ws(c.workspace_id)
  );
$$;

drop policy contacts_select on public.contacts;
drop policy contacts_update on public.contacts;
drop policy contacts_delete on public.contacts;
create policy contacts_select on public.contacts for select to authenticated
  using (created_by = auth.uid() and public.can_read_ws(workspace_id));
create policy contacts_update on public.contacts for update to authenticated
  using (created_by = auth.uid() and public.can_write_ws(workspace_id))
  with check (created_by = auth.uid() and public.can_write_ws(workspace_id));
create policy contacts_delete on public.contacts for delete to authenticated
  using (created_by = auth.uid() and public.can_write_ws(workspace_id));

-- Notes and meetings belong to the card's owner too.
drop policy interactions_update on public.interactions;
drop policy interactions_delete on public.interactions;
create policy interactions_update on public.interactions for update to authenticated
  using (public.can_write_contact(contact_id)) with check (public.can_write_contact(contact_id));
create policy interactions_delete on public.interactions for delete to authenticated
  using (public.can_write_contact(contact_id));

-- A card never changes owner or workspace (admins can no longer take cards over).
create or replace function public.guard_contacts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if new.workspace_id <> old.workspace_id then
    raise exception 'a card cannot move between workspaces';
  end if;
  if new.created_by <> old.created_by then
    raise exception 'a card cannot change owner';
  end if;
  return new;
end;
$$;
