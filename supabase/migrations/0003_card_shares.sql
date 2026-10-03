-- Sharing a card with another member of the same workspace.
-- The sender offers a card; the recipient accepts (a private copy is made for
-- them) or declines. Only the sender and the recipient can see a request.

create table public.card_shares (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  contact_id      uuid references public.contacts (id) on delete set null,
  sender_id       uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  recipient_id    uuid not null references public.profiles (id) on delete cascade,
  status          text not null default 'pending'
                  check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  -- what the recipient sees in the prompt, copied from the card when it is offered
  contact_name    text not null default '',
  contact_title   text,
  contact_company text,
  new_contact_id  uuid references public.contacts (id) on delete set null,
  created_at      timestamptz not null default now(),
  responded_at    timestamptz,
  check (sender_id <> recipient_id)
);
create index card_shares_recipient_idx on public.card_shares (recipient_id, status);
create index card_shares_contact_idx on public.card_shares (contact_id);
-- one open offer per card and person
create unique index card_shares_one_pending on public.card_shares (contact_id, recipient_id) where status = 'pending';

-- Recipients must be active members who can add cards (admin or editor).
create or replace function public.can_receive_cards(ws uuid, member uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from workspace_members m
    join workspaces w on w.id = m.workspace_id
    join profiles p on p.id = m.user_id
    where m.workspace_id = ws and m.user_id = member
      and m.status = 'active' and m.role in ('admin', 'editor')
      and w.status = 'active' and p.status = 'active'
  );
$$;

-- True when the caller has an open or accepted offer for this card, which lets
-- them read its photos to copy them.
create or replace function public.card_offered_to_me(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from card_shares s
    where s.contact_id = cid and s.recipient_id = auth.uid()
      and s.status in ('pending', 'accepted')
      and public.can_read_ws(s.workspace_id)
  );
$$;

-- Fill in the snapshot and pin sender and status on insert.
create or replace function public.prepare_card_share()
returns trigger language plpgsql security definer set search_path = public as $$
declare c contacts;
begin
  select * into c from contacts where id = new.contact_id;
  if c.id is null or c.workspace_id <> new.workspace_id then
    raise exception 'That card is not in this workspace.';
  end if;
  new.sender_id := auth.uid();
  new.status := 'pending';
  new.new_contact_id := null;
  new.responded_at := null;
  new.created_at := now();
  new.contact_name := coalesce(c.full_name, '');
  new.contact_title := c.job_title;
  new.contact_company := c.company;
  return new;
end;
$$;
create trigger card_shares_prepare before insert on public.card_shares
  for each row execute function public.prepare_card_share();

alter table public.card_shares enable row level security;

create policy card_shares_select on public.card_shares for select to authenticated
  using ((sender_id = auth.uid() or recipient_id = auth.uid()) and public.can_read_ws(workspace_id));
create policy card_shares_insert on public.card_shares for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.can_read_contact(contact_id)
    and public.can_receive_cards(workspace_id, recipient_id)
  );
-- Changes go through the functions below; no direct update or delete.

grant select, insert on public.card_shares to authenticated;

-- Recipient accepts: copy the card into their own private cards and return the
-- new card's id with the original photo paths (the app copies the photos).
create or replace function public.accept_card_share(p_share uuid)
returns table (new_contact_id uuid, front_path text, back_path text)
language plpgsql security definer set search_path = public as $$
declare
  s card_shares;
  nid uuid;
begin
  select * into s from card_shares where id = p_share for update;
  if s.id is null or s.recipient_id <> auth.uid() then raise exception 'Share not found.'; end if;
  if s.status <> 'pending' then raise exception 'This share was already answered.'; end if;
  if not public.can_receive_cards(s.workspace_id, auth.uid()) then
    raise exception 'You need editor access to this workspace to accept cards.';
  end if;
  if s.contact_id is null or not exists (select 1 from contacts where id = s.contact_id) then
    raise exception 'The card is no longer available.';
  end if;

  -- The card itself and its classification; not the sender's notes, dates or pipeline.
  insert into contacts (
    workspace_id, created_by, is_private,
    full_name, job_title, company, department, emails, phones, website,
    address, city, region, country, card_text,
    contact_type, industry, business_category, job_function, seniority, opportunities, tags
  )
  select
    c.workspace_id, auth.uid(), true,
    c.full_name, c.job_title, c.company, c.department, c.emails, c.phones, c.website,
    c.address, c.city, c.region, c.country, c.card_text,
    c.contact_type, c.industry, c.business_category, c.job_function, c.seniority, c.opportunities, c.tags
  from contacts c where c.id = s.contact_id
  returning id into nid;

  update card_shares
     set status = 'accepted', new_contact_id = nid, responded_at = now()
   where id = p_share;

  return query select nid, c.front_path, c.back_path from contacts c where c.id = s.contact_id;
end;
$$;

-- Recipient declines, or sender withdraws an open offer.
create or replace function public.close_card_share(p_share uuid)
returns text language plpgsql security definer set search_path = public as $$
declare s card_shares; next_status text;
begin
  select * into s from card_shares where id = p_share for update;
  if s.id is null or auth.uid() not in (s.sender_id, s.recipient_id) then raise exception 'Share not found.'; end if;
  if s.status <> 'pending' then raise exception 'This share was already answered.'; end if;
  next_status := case when auth.uid() = s.recipient_id then 'declined' else 'cancelled' end;
  update card_shares set status = next_status, responded_at = now() where id = p_share;
  return next_status;
end;
$$;

-- Recipients may read the photos of a card offered to them.
create policy cardfile_objects_select_offered on storage.objects for select to authenticated
  using (bucket_id = 'cards' and public.card_offered_to_me(public.storage_contact(name)));

revoke execute on function
  public.can_receive_cards(uuid, uuid), public.card_offered_to_me(uuid),
  public.accept_card_share(uuid), public.close_card_share(uuid)
  from anon, public;
revoke execute on function public.prepare_card_share() from anon, authenticated, public;
grant execute on function
  public.can_receive_cards(uuid, uuid), public.card_offered_to_me(uuid),
  public.accept_card_share(uuid), public.close_card_share(uuid)
  to authenticated;
