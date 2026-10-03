-- RLS and trigger tests. Each check raises on failure.
\set ON_ERROR_STOP 1
\pset tuples_only on
\o /dev/null

create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'ok - %', label;
end $$;

-- Expect a statement to fail (RLS denial or guard exception).
create function pg_temp.fails(stmt text, label text) returns void language plpgsql as $$
declare n bigint;
begin
  begin
    execute stmt;
    get diagnostics n = row_count;
  exception when others then
    raise notice 'ok - % (%)', label, sqlerrm;
    return;
  end;
  if n = 0 then
    raise notice 'ok - % (0 rows affected)', label;
    return;
  end if;
  raise exception 'FAIL: % (statement succeeded)', label;
end $$;
grant execute on all functions in schema pg_temp to public;

-- Users
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@u', '{"username":"alice","full_name":"Alice Admin"}'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@u',   '{"username":"bob","full_name":"Bob Editor"}'),
  ('00000000-0000-0000-0000-00000000000c', 'carol@u', '{"username":"carol","full_name":"Carol Viewer"}'),
  ('00000000-0000-0000-0000-00000000000d', 'dave@u',  '{"username":"dave","full_name":"Dave Outsider"}'),
  ('00000000-0000-0000-0000-00000000000e', 'sam@u',   '{"username":"sam","full_name":"Sam Super"}');
update public.profiles set is_super_admin = true where username = 'sam';

select pg_temp.ok((select count(*) from public.profiles) = 5, 'profiles created by trigger');
select pg_temp.ok((select count(*) from public.workspaces) = 5, 'personal workspace per user');
select pg_temp.ok((select count(*) from public.workspace_members where role = 'admin') = 5, 'owner added as admin');

select id as ws from public.workspaces where owner_id = '00000000-0000-0000-0000-00000000000a' \gset
select id as ws_dave from public.workspaces where owner_id = '00000000-0000-0000-0000-00000000000d' \gset

-- ---------------------------------------------------------------- alice (admin)
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);

select pg_temp.ok((select role from public.add_member(:'ws', 'bob', 'editor')) = 'editor', 'admin adds editor by username');
select pg_temp.ok((select role from public.add_member(:'ws', 'carol', 'viewer')) = 'viewer', 'admin adds viewer');
select pg_temp.fails($$select public.add_member('$$ || :'ws' || $$', 'nobody', 'viewer')$$, 'unknown username rejected');

insert into public.contacts (id, workspace_id, full_name, company)
values ('10000000-0000-0000-0000-000000000001', :'ws', 'Shared By Alice', 'Acme');
insert into public.contacts (id, workspace_id, full_name, is_private)
values ('10000000-0000-0000-0000-000000000002', :'ws', 'Alice Private', true);

-- ---------------------------------------------------------------- bob (editor)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.ok((select count(*) from public.contacts) = 1, 'editor sees shared card, not alice''s private card');
insert into public.contacts (id, workspace_id, full_name)
values ('10000000-0000-0000-0000-000000000003', :'ws', 'Shared By Bob');
insert into public.contacts (id, workspace_id, full_name, is_private)
values ('10000000-0000-0000-0000-000000000004', :'ws', 'Bob Private', true);
update public.contacts set notes = 'edited by bob' where id = '10000000-0000-0000-0000-000000000001';
select pg_temp.ok((select notes from public.contacts where id = '10000000-0000-0000-0000-000000000001') = 'edited by bob', 'editor edits shared card');
select pg_temp.fails($$delete from public.contacts where id = '10000000-0000-0000-0000-000000000001'$$, 'editor cannot delete another person''s card');
select pg_temp.fails($$update public.contacts set notes = 'x' where id = '10000000-0000-0000-0000-000000000002'$$, 'editor cannot touch alice''s private card');
select pg_temp.fails($$update public.workspace_members set role = 'admin' where user_id = auth.uid() and workspace_id = '$$ || :'ws' || $$'$$, 'editor cannot self-promote');
select pg_temp.fails($$update public.profiles set is_super_admin = true where id = auth.uid()$$, 'cannot make self super admin');
select pg_temp.fails($$update public.profiles set username = 'bobby' where id = auth.uid()$$, 'cannot change own username');
update public.profiles set full_name = 'Bob E.' where id = auth.uid();
select pg_temp.ok((select full_name from public.profiles where id = auth.uid()) = 'Bob E.', 'can change own full name');
select pg_temp.fails($$update public.contacts set is_private = true, created_by = auth.uid() where id = '10000000-0000-0000-0000-000000000001'$$, 'editor cannot take another person''s card private');

insert into public.interactions (id, contact_id, workspace_id, kind, occurred_on, title)
values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', :'ws_dave', 'Meeting', '2026-09-01', 'Kickoff');
select pg_temp.ok((select workspace_id from public.interactions where id = '20000000-0000-0000-0000-000000000001') = :'ws', 'interaction workspace synced from contact');
select pg_temp.ok((select last_contacted_on from public.contacts where id = '10000000-0000-0000-0000-000000000001') = '2026-09-01', 'meeting bumps last contacted');
insert into public.interactions (contact_id, workspace_id, kind, occurred_on, title)
values ('10000000-0000-0000-0000-000000000001', :'ws', 'Note', '2026-09-20', 'Just a note');
select pg_temp.ok((select last_contacted_on from public.contacts where id = '10000000-0000-0000-0000-000000000001') = '2026-09-01', 'note does not bump last contacted');
insert into public.interactions (contact_id, workspace_id, kind, occurred_on, title)
values ('10000000-0000-0000-0000-000000000001', :'ws', 'Call', '2026-08-01', 'Older call');
select pg_temp.ok((select last_contacted_on from public.contacts where id = '10000000-0000-0000-0000-000000000001') = '2026-09-01', 'older entry does not move last contacted back');
insert into public.interactions (contact_id, workspace_id, kind, title)
values ('10000000-0000-0000-0000-000000000004', :'ws', 'Call', 'Private call');
select pg_temp.fails($$insert into public.interactions (contact_id, workspace_id, title) values ('10000000-0000-0000-0000-000000000002', '$$ || :'ws' || $$', 'sneaky')$$, 'cannot log on someone else''s private card');

insert into storage.objects (bucket_id, name) values ('cards', :'ws' || '/10000000-0000-0000-0000-000000000003/front-1.jpg');
select pg_temp.fails($$insert into storage.objects (bucket_id, name) values ('cards', '$$ || :'ws' || $$/10000000-0000-0000-0000-000000000002/front-1.jpg')$$, 'cannot upload to someone else''s private card');
select pg_temp.fails($$insert into storage.objects (bucket_id, name) values ('cards', '$$ || :'ws_dave' || $$/10000000-0000-0000-0000-000000000003/front-1.jpg')$$, 'path workspace must match card workspace');
insert into storage.objects (bucket_id, name) values ('recordings', :'ws' || '/10000000-0000-0000-0000-000000000004/rec.webm');

-- ---------------------------------------------------------------- carol (viewer)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
select pg_temp.ok((select count(*) from public.contacts) = 2, 'viewer sees both shared cards only');
select pg_temp.ok((select count(*) from public.interactions) = 3, 'viewer sees entries on shared cards only');
select pg_temp.ok((select count(*) from storage.objects) = 1, 'viewer sees shared photo, not private recording');
select pg_temp.fails($$insert into public.contacts (workspace_id, full_name) values ('$$ || :'ws' || $$', 'nope')$$, 'viewer cannot add cards');
select pg_temp.fails($$update public.contacts set notes = 'viewer' where id = '10000000-0000-0000-0000-000000000001'$$, 'viewer cannot edit cards');
select pg_temp.fails($$delete from public.contacts where id = '10000000-0000-0000-0000-000000000003'$$, 'viewer cannot delete cards');
select pg_temp.fails($$insert into public.interactions (contact_id, workspace_id, title) values ('10000000-0000-0000-0000-000000000001', '$$ || :'ws' || $$', 'nope')$$, 'viewer cannot log meetings');
select pg_temp.ok((select count(*) from public.profiles) = 3, 'viewer sees profiles of workspace mates only');

-- ---------------------------------------------------------------- dave (outsider)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
select pg_temp.ok((select count(*) from public.contacts) = 0, 'outsider sees no cards');
select pg_temp.ok((select count(*) from public.interactions) = 0, 'outsider sees no entries');
select pg_temp.ok((select count(*) from public.workspaces) = 1, 'outsider sees only own workspace');
select pg_temp.ok((select count(*) from storage.objects) = 0, 'outsider sees no files');
select pg_temp.fails($$insert into public.contacts (workspace_id, full_name) values ('$$ || :'ws' || $$', 'nope')$$, 'outsider cannot add to another workspace');
select pg_temp.fails($$select public.add_member('$$ || :'ws' || $$', 'dave', 'admin')$$, 'outsider cannot add self');
select pg_temp.fails($$update public.workspaces set status = 'suspended' where id = '$$ || :'ws_dave' || $$'$$, 'owner cannot change own workspace status');
insert into public.workspaces (name, owner_id) values ('Dave Second', auth.uid());
select pg_temp.ok((select count(*) from public.workspaces) = 2, 'user creates additional workspace and is admin of it');

-- ---------------------------------------------------------------- owner protection
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select public.add_member(:'ws', 'bob', 'admin');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.fails($$update public.workspace_members set role = 'viewer' where user_id = '00000000-0000-0000-0000-00000000000a'$$, 'other admin cannot demote owner');
select pg_temp.fails($$delete from public.workspace_members where user_id = '00000000-0000-0000-0000-00000000000a' and workspace_id = '$$ || :'ws' || $$'$$, 'other admin cannot remove owner');
select pg_temp.fails($$update public.workspaces set owner_id = auth.uid() where id = '$$ || :'ws' || $$'$$, 'admin cannot take workspace ownership');
-- admin takes alice's shared card private
update public.contacts set is_private = true, created_by = auth.uid() where id = '10000000-0000-0000-0000-000000000001';
select pg_temp.ok((select created_by from public.contacts where id = '10000000-0000-0000-0000-000000000001') = auth.uid(), 'admin takes shared card private and owns it');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select pg_temp.ok(not exists (select 1 from public.contacts where id = '10000000-0000-0000-0000-000000000001'), 'original creator loses access after take-private');
select pg_temp.ok(not exists (select 1 from public.interactions where contact_id = '10000000-0000-0000-0000-000000000001'), 'entries follow the card into private');
select pg_temp.fails($$delete from public.workspace_members where user_id = auth.uid() and workspace_id = '$$ || :'ws' || $$'$$, 'owner cannot leave own workspace');
update public.workspace_members set role = 'editor' where user_id = '00000000-0000-0000-0000-00000000000b' and workspace_id = :'ws';

-- ---------------------------------------------------------------- revoke
update public.workspace_members set status = 'revoked' where user_id = '00000000-0000-0000-0000-00000000000c' and workspace_id = :'ws';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
select pg_temp.ok((select count(*) from public.contacts) = 0, 'revoked member loses access immediately');
select pg_temp.ok((select count(*) from public.workspace_members where workspace_id = :'ws') = 1, 'revoked member sees only own membership row');
-- leave
delete from public.workspace_members where user_id = auth.uid() and workspace_id = :'ws';
select pg_temp.ok(not exists (select 1 from public.workspace_members where user_id = auth.uid() and workspace_id = :'ws'), 'member can leave a workspace');

-- ---------------------------------------------------------------- super admin
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', false);
select pg_temp.ok((select count(*) from public.contacts) = 0, 'super admin cannot read cards');
select pg_temp.ok((select count(*) from public.interactions) = 0, 'super admin cannot read entries');
select pg_temp.ok((select count(*) from storage.objects) = 0, 'super admin cannot read files');
select pg_temp.ok((select count(*) from public.profiles) = 5, 'super admin lists all accounts');
select pg_temp.ok((select card_count from public.super_admin_workspaces() where id = :'ws') = 4, 'dashboard returns card counts');
select pg_temp.fails($$update public.profiles set status = 'suspended' where id = auth.uid()$$, 'super admin cannot suspend self');
select pg_temp.fails($$update public.profiles set is_super_admin = false where id = auth.uid()$$, 'super admin cannot demote self');
update public.profiles set status = 'suspended', suspended_reason = 'Left the company' where username = 'bob';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.ok((select count(*) from public.contacts) = 0, 'suspended account loses all data access');
select pg_temp.ok(public.suspension_notice('bob') = 'Left the company', 'suspension reason available to sign-in screen');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', false);
update public.profiles set status = 'active', suspended_reason = null where username = 'bob';
update public.workspaces set status = 'suspended' where id = :'ws';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select pg_temp.ok((select count(*) from public.contacts) = 0, 'suspended workspace blocks its owner');
select pg_temp.fails($$select public.super_admin_workspaces()$$, 'non super admin cannot call dashboard RPC');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', false);
update public.workspaces set status = 'active' where id = :'ws';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select pg_temp.ok((select count(*) from public.contacts) = 2, 'reactivated workspace restores access');

-- ---------------------------------------------------------------- card sharing
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
update public.workspace_members set role = 'editor', status = 'active'
 where workspace_id = :'ws' and user_id = '00000000-0000-0000-0000-00000000000b';
select public.add_member(:'ws', 'carol', 'viewer');
insert into storage.objects (bucket_id, name) values ('cards', :'ws' || '/10000000-0000-0000-0000-000000000002/front-9.jpg');
update public.contacts
   set front_path = :'ws' || '/10000000-0000-0000-0000-000000000002/front-9.jpg',
       notes = 'secret note', lead_status = 'Won', job_title = 'CTO'
 where id = '10000000-0000-0000-0000-000000000002';

insert into public.card_shares (id, workspace_id, contact_id, recipient_id, sender_id, status, contact_name)
values ('30000000-0000-0000-0000-000000000001', :'ws', '10000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'accepted', 'forged');
select pg_temp.ok((select sender_id = auth.uid() and status = 'pending' and contact_name = 'Alice Private' and contact_title = 'CTO'
                   from public.card_shares where id = '30000000-0000-0000-0000-000000000001'),
                  'share pins sender, pending status and the card snapshot');
select pg_temp.fails($$insert into public.card_shares (workspace_id, contact_id, recipient_id) values ('$$ || :'ws' || $$', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b')$$, 'only one open offer per card and person');
select pg_temp.fails($$insert into public.card_shares (workspace_id, contact_id, recipient_id) values ('$$ || :'ws' || $$', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000c')$$, 'cannot share with a viewer');
select pg_temp.fails($$insert into public.card_shares (workspace_id, contact_id, recipient_id) values ('$$ || :'ws' || $$', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000d')$$, 'cannot share with a non-member');
select pg_temp.fails($$insert into public.card_shares (workspace_id, contact_id, recipient_id) values ('$$ || :'ws' || $$', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a')$$, 'cannot share with yourself');
select pg_temp.fails($$insert into public.card_shares (workspace_id, contact_id, recipient_id) values ('$$ || :'ws_dave' || $$', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b')$$, 'share must be in the card''s workspace');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
select pg_temp.ok((select count(*) from public.card_shares) = 0, 'outsider sees no shares');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
select pg_temp.ok((select count(*) from public.card_shares) = 0, 'other members do not see the offer');
select pg_temp.fails($$select public.accept_card_share('30000000-0000-0000-0000-000000000001')$$, 'only the recipient can accept');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.ok((select count(*) from public.card_shares where recipient_id = auth.uid() and status = 'pending') = 1, 'recipient sees the offer');
select pg_temp.ok(not exists (select 1 from public.contacts where id = '10000000-0000-0000-0000-000000000002'), 'offer does not reveal the private card itself');
select pg_temp.ok(exists (select 1 from storage.objects where name like '%/10000000-0000-0000-0000-000000000002/front-9.jpg'), 'recipient can read the offered card''s photo');
select pg_temp.fails($$update public.card_shares set status = 'accepted'$$, 'no direct status changes');
select pg_temp.fails($$delete from public.card_shares$$, 'no direct deletes');
select new_contact_id as copy, front_path as copy_front from public.accept_card_share('30000000-0000-0000-0000-000000000001') \gset
select pg_temp.ok((select is_private and created_by = auth.uid() and full_name = 'Alice Private' and job_title = 'CTO'
                          and notes is null and lead_status is null and front_path is null
                   from public.contacts where id = :'copy'), 'accept makes a private copy without the sender''s notes or pipeline');
select pg_temp.ok(:'copy_front' like '%/front-9.jpg', 'accept returns the original photo path to copy');
insert into storage.objects (bucket_id, name) values ('cards', :'ws' || '/' || :'copy' || '/front-1.jpg');
select pg_temp.ok(true, 'recipient can upload photos to the copy');
select pg_temp.fails($$select public.accept_card_share('30000000-0000-0000-0000-000000000001')$$, 'an offer can be accepted only once');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select pg_temp.ok((select status from public.card_shares where id = '30000000-0000-0000-0000-000000000001') = 'accepted', 'sender sees it was accepted');
select pg_temp.ok(not exists (select 1 from public.contacts where id = :'copy'), 'sender cannot see the recipient''s private copy');
select pg_temp.fails($$insert into public.card_shares (workspace_id, contact_id, recipient_id) values ('$$ || :'ws' || $$', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b')$$, 'cannot share a card you cannot see');
insert into public.contacts (id, workspace_id, full_name, company)
values ('10000000-0000-0000-0000-000000000009', :'ws', 'Team Card', 'Acme');
insert into public.card_shares (id, workspace_id, contact_id, recipient_id)
values ('30000000-0000-0000-0000-000000000002', :'ws', '10000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-00000000000b'),
       ('30000000-0000-0000-0000-000000000003', :'ws', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b');
select pg_temp.ok(public.close_card_share('30000000-0000-0000-0000-000000000003') = 'cancelled', 'sender can withdraw an open offer');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.ok(public.close_card_share('30000000-0000-0000-0000-000000000002') = 'declined', 'recipient can decline');
select pg_temp.fails($$select public.accept_card_share('30000000-0000-0000-0000-000000000003')$$, 'withdrawn offer cannot be accepted');

-- ---------------------------------------------------------------- anon
reset role;
set role anon;
select pg_temp.ok(public.username_available('newperson') and not public.username_available('alice') and not public.username_available('No!'), 'username availability check');
select pg_temp.fails($$select count(*) from public.contacts$$, 'anon cannot read contacts');
select pg_temp.fails($$select public.ws_role('$$ || :'ws' || $$')$$, 'anon cannot call helper predicates');
select pg_temp.fails($$select public.super_admin_workspaces()$$, 'anon cannot call dashboard RPC');
select pg_temp.fails($$select count(*) from public.card_shares$$, 'anon cannot read shares');
select pg_temp.fails($$select public.accept_card_share('30000000-0000-0000-0000-000000000002')$$, 'anon cannot accept shares');
reset role;
\echo 'ALL RLS TESTS PASSED'
