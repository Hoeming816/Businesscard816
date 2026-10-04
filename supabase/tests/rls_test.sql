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
  ('00000000-0000-0000-0000-00000000000e', 'hoeming816@u', '{"username":"hoeming816","full_name":"Sam Super"}');
update public.profiles set is_super_admin = true where username = 'hoeming816';
select pg_temp.fails($$update public.profiles set is_super_admin = true where username = 'alice'$$, 'only hoeming816 can ever be super admin, even from the SQL editor');
update public.profiles set features = '{"meeting": true}' where not is_super_admin; -- meeting is off by default (tested below)

select pg_temp.ok((select count(*) from public.profiles) = 5, 'profiles created by trigger');
select pg_temp.ok((select count(*) from public.workspaces) = 5, 'personal workspace per user');
select pg_temp.ok((select count(*) from public.workspace_members where role = 'admin') = 5, 'owner added as admin');

select id as ws from public.workspaces where owner_id = '00000000-0000-0000-0000-00000000000a' \gset
select id as ws_dave from public.workspaces where owner_id = '00000000-0000-0000-0000-00000000000d' \gset

-- ---------------------------------------------------------------- alice (admin)
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
update public.profiles set private_account = true where id = auth.uid();
select pg_temp.ok((select private_account from public.profiles where id = auth.uid()), 'user can turn on stay private');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
update public.profiles set private_account = false where id = '00000000-0000-0000-0000-00000000000d';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select pg_temp.fails($$select public.add_member('$$ || :'ws' || $$', 'dave', 'viewer')$$, 'private user cannot be found or invited, and others cannot switch it off');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
update public.profiles set private_account = false where id = auth.uid();
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);

select pg_temp.ok((select role from public.add_member(:'ws', 'bob', 'editor')) = 'editor', 'admin adds editor by username');
select pg_temp.ok((select role from public.add_member(:'ws', 'carol', 'viewer')) = 'viewer', 'admin adds viewer');
select pg_temp.fails($$select public.add_member('$$ || :'ws' || $$', 'nobody', 'viewer')$$, 'unknown username rejected');
select pg_temp.ok((select count(*) from public.workspace_members where workspace_id = :'ws' and status = 'invited') = 2, 'adding a member sends an invitation');
select pg_temp.fails($$update public.workspace_members set status = 'active' where user_id = '00000000-0000-0000-0000-00000000000b'$$, 'admin cannot accept for the invitee');

-- ---------------------------------------------------------------- invitations
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.ok(public.ws_role(:'ws') is null, 'invitee has no access before accepting');
select pg_temp.ok((select inviter_name is not null and role = 'editor' from public.my_invites() where workspace_id = :'ws'), 'invitee sees the invitation and who sent it');
update public.workspace_members set status = 'active' where user_id = auth.uid() and workspace_id = :'ws';
select pg_temp.ok(public.ws_role(:'ws') is null, 'invitee cannot skip the accept step');
select public.respond_invite(:'ws', true);
select pg_temp.ok(public.ws_role(:'ws') = 'editor', 'accepting the invitation joins the workspace');
select pg_temp.ok(not exists (select 1 from public.my_invites()), 'accepted invitation is gone');
select pg_temp.fails($$select public.respond_invite('$$ || :'ws' || $$', true)$$, 'cannot answer an invitation twice');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
select pg_temp.ok(not exists (select 1 from public.my_invites()), 'others do not see the invitation');
select pg_temp.fails($$select public.respond_invite('$$ || :'ws' || $$', true)$$, 'cannot accept someone else''s invitation');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
select public.respond_invite(:'ws', true);
select pg_temp.ok(public.ws_role(:'ws') = 'viewer', 'second invitee accepts');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);

insert into public.contacts (id, workspace_id, full_name, company)
values ('10000000-0000-0000-0000-000000000001', :'ws', 'Alice Card', 'Acme');
insert into public.contacts (id, workspace_id, full_name, is_private)
values ('10000000-0000-0000-0000-000000000002', :'ws', 'Alice Private', true);
select pg_temp.ok((select bool_and(is_private) from public.contacts), 'new cards are always the owner''s own');
select pg_temp.fails($$insert into public.contacts (workspace_id, full_name, is_private) values ('$$ || :'ws' || $$', 'open', false)$$, 'a card cannot be opened to the workspace');

-- ---------------------------------------------------------------- bob (editor)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.ok((select count(*) from public.contacts) = 0, 'editor cannot see other members'' cards');
insert into public.contacts (id, workspace_id, full_name)
values ('10000000-0000-0000-0000-000000000003', :'ws', 'Bob Card');
insert into public.contacts (id, workspace_id, full_name, is_private)
values ('10000000-0000-0000-0000-000000000004', :'ws', 'Bob Private', true);
select pg_temp.ok((select count(*) from public.contacts) = 2, 'editor sees own cards');
update public.contacts set notes = 'edited by bob' where id = '10000000-0000-0000-0000-000000000003';
select pg_temp.ok((select notes from public.contacts where id = '10000000-0000-0000-0000-000000000003') = 'edited by bob', 'editor edits own card');
select pg_temp.fails($$update public.contacts set notes = 'x' where id = '10000000-0000-0000-0000-000000000001'$$, 'editor cannot edit another member''s card');
select pg_temp.fails($$delete from public.contacts where id = '10000000-0000-0000-0000-000000000001'$$, 'editor cannot delete another member''s card');
select pg_temp.fails($$update public.contacts set created_by = '00000000-0000-0000-0000-00000000000a' where id = '10000000-0000-0000-0000-000000000003'$$, 'a card cannot be handed to another owner');
select pg_temp.fails($$update public.contacts set is_private = false where id = '10000000-0000-0000-0000-000000000003'$$, 'owner cannot open a card to the workspace');
select pg_temp.fails($$update public.workspace_members set role = 'admin' where user_id = auth.uid() and workspace_id = '$$ || :'ws' || $$'$$, 'editor cannot self-promote');
select pg_temp.fails($$update public.profiles set is_super_admin = true where id = auth.uid()$$, 'cannot make self super admin');
select pg_temp.fails($$update public.profiles set username = 'bobby' where id = auth.uid()$$, 'cannot change own username');
update public.profiles set full_name = 'Bob E.' where id = auth.uid();
select pg_temp.ok((select full_name from public.profiles where id = auth.uid()) = 'Bob E.', 'can change own full name');

insert into public.interactions (id, contact_id, workspace_id, kind, occurred_on, title)
values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', :'ws_dave', 'Meeting', '2026-09-01', 'Kickoff');
select pg_temp.ok((select workspace_id from public.interactions where id = '20000000-0000-0000-0000-000000000001') = :'ws', 'interaction workspace synced from contact');
select pg_temp.ok((select last_contacted_on from public.contacts where id = '10000000-0000-0000-0000-000000000003') = '2026-09-01', 'meeting bumps last contacted');
insert into public.interactions (contact_id, workspace_id, kind, occurred_on, title)
values ('10000000-0000-0000-0000-000000000003', :'ws', 'Note', '2026-09-20', 'Just a note');
select pg_temp.ok((select last_contacted_on from public.contacts where id = '10000000-0000-0000-0000-000000000003') = '2026-09-01', 'note does not bump last contacted');
insert into public.interactions (contact_id, workspace_id, kind, occurred_on, title)
values ('10000000-0000-0000-0000-000000000003', :'ws', 'Call', '2026-08-01', 'Older call');
select pg_temp.ok((select last_contacted_on from public.contacts where id = '10000000-0000-0000-0000-000000000003') = '2026-09-01', 'older entry does not move last contacted back');
insert into public.interactions (contact_id, workspace_id, kind, title)
values ('10000000-0000-0000-0000-000000000004', :'ws', 'Call', 'Private call');
select pg_temp.fails($$insert into public.interactions (contact_id, workspace_id, title) values ('10000000-0000-0000-0000-000000000001', '$$ || :'ws' || $$', 'sneaky')$$, 'cannot log on another member''s card');

insert into storage.objects (bucket_id, name) values ('cards', :'ws' || '/10000000-0000-0000-0000-000000000003/front-1.jpg');
select pg_temp.fails($$insert into storage.objects (bucket_id, name) values ('cards', '$$ || :'ws' || $$/10000000-0000-0000-0000-000000000001/front-1.jpg')$$, 'cannot upload to another member''s card');
select pg_temp.fails($$insert into storage.objects (bucket_id, name) values ('cards', '$$ || :'ws_dave' || $$/10000000-0000-0000-0000-000000000003/front-1.jpg')$$, 'path workspace must match card workspace');
insert into storage.objects (bucket_id, name) values ('recordings', :'ws' || '/10000000-0000-0000-0000-000000000004/rec.webm');
select pg_temp.ok((select count(*) from storage.objects) = 2, 'owner sees own files');

-- ---------------------------------------------------------------- carol (viewer)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
select pg_temp.ok((select count(*) from public.contacts) = 0, 'viewer sees no one else''s cards');
select pg_temp.ok((select count(*) from public.interactions) = 0, 'viewer sees no one else''s entries');
select pg_temp.ok((select count(*) from storage.objects) = 0, 'viewer sees no one else''s files');
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

-- ---------------------------------------------------------------- admins
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select pg_temp.ok((select count(*) from public.contacts) = 2, 'workspace owner sees only own cards');
select pg_temp.ok((select count(*) from public.interactions) = 0, 'workspace owner cannot read members'' notes');
select pg_temp.ok((select count(*) from storage.objects) = 0, 'workspace owner cannot read members'' files');
select pg_temp.fails($$delete from public.contacts where id = '10000000-0000-0000-0000-000000000003'$$, 'admin cannot delete a member''s card');
select pg_temp.fails($$update public.contacts set created_by = auth.uid() where id = '10000000-0000-0000-0000-000000000003'$$, 'admin cannot take over a member''s card');
select pg_temp.ok((select count(*) from public.workspace_members where workspace_id = :'ws') = 3, 'admin still manages the team');
select public.add_member(:'ws', 'bob', 'admin');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.ok((select count(*) from public.contacts) = 2, 'second admin still sees only own cards');
select pg_temp.fails($$update public.workspace_members set role = 'viewer' where user_id = '00000000-0000-0000-0000-00000000000a'$$, 'other admin cannot demote owner');
select pg_temp.fails($$delete from public.workspace_members where user_id = '00000000-0000-0000-0000-00000000000a' and workspace_id = '$$ || :'ws' || $$'$$, 'other admin cannot remove owner');
select pg_temp.fails($$update public.workspaces set owner_id = auth.uid() where id = '$$ || :'ws' || $$'$$, 'admin cannot take workspace ownership');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
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
update public.profiles set status = 'deleted', deleted_at = now() where username = 'bob';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.ok((select count(*) from public.contacts) = 0, 'deleted account loses all data access');
select pg_temp.ok(public.suspension_notice('bob') = '', 'deleted account gets the blocked notice');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', false);
update public.profiles set status = 'active', deleted_at = null where username = 'bob';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.ok((select count(*) from public.contacts) > 0, 'reinstated account sees its cards again');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', false);
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
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
select public.respond_invite(:'ws', false);
select pg_temp.ok(not exists (select 1 from public.workspace_members where user_id = auth.uid() and workspace_id = :'ws'), 'declining removes the invitation');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select public.add_member(:'ws', 'carol', 'viewer');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
select public.respond_invite(:'ws', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
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
select pg_temp.fails($$insert into public.card_shares (workspace_id, contact_id, recipient_id) values ('$$ || :'ws' || $$', '10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000b')$$, 'cannot share a card you cannot see');
insert into public.contacts (id, workspace_id, full_name, company)
values ('10000000-0000-0000-0000-000000000009', :'ws', 'Team Card', 'Acme');
insert into public.card_shares (id, workspace_id, contact_id, recipient_id)
values ('30000000-0000-0000-0000-000000000002', :'ws', '10000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-00000000000b'),
       ('30000000-0000-0000-0000-000000000003', :'ws', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b');
select pg_temp.ok(public.close_card_share('30000000-0000-0000-0000-000000000003') = 'cancelled', 'sender can withdraw an open offer');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.ok(public.close_card_share('30000000-0000-0000-0000-000000000002') = 'declined', 'recipient can decline');
select pg_temp.fails($$select public.accept_card_share('30000000-0000-0000-0000-000000000003')$$, 'withdrawn offer cannot be accepted');

-- ---------------------------------------------------------------- feature switches
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', false);
update public.profiles set features = '{}' where username = 'alice';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select pg_temp.ok(public.feature_on('share') and public.feature_on('scan_ai'), 'business card features are on by default');
select pg_temp.ok(not public.feature_on('meeting'), 'meeting is off by default');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', false);
select pg_temp.ok(public.feature_on('meeting'), 'super admins have meeting');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select pg_temp.fails($$insert into storage.objects (bucket_id, name) values ('recordings', '$$ || :'ws' || $$/10000000-0000-0000-0000-000000000002/r-0.webm')$$, 'recording upload refused while meeting is off');
select pg_temp.fails($$update public.profiles set features = '{"share": true}' where id = auth.uid()$$, 'users cannot change their own features');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', false);
update public.profiles set features = '{"share": false}' where username = 'alice';
select pg_temp.ok((select features ->> 'share' from public.profiles where username = 'alice') = 'false', 'super admin switches features off');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select pg_temp.ok(not public.feature_on('share') and public.feature_on('scan_ai'), 'switched-off feature reads as off, others stay on');
select pg_temp.fails($$insert into public.card_shares (workspace_id, contact_id, recipient_id) values ('$$ || :'ws' || $$', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b')$$, 'share refused when switched off');
select pg_temp.fails($$insert into storage.objects (bucket_id, name) values ('recordings', '$$ || :'ws' || $$/10000000-0000-0000-0000-000000000002/r-1.webm')$$, 'recording upload still refused');
insert into storage.objects (bucket_id, name) values ('cards', :'ws' || '/10000000-0000-0000-0000-000000000002/front-2.jpg');
select pg_temp.ok(true, 'card photos still upload with recording off');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', false);
update public.profiles set features = '{"meeting": true}' where username = 'alice';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into storage.objects (bucket_id, name) values ('recordings', :'ws' || '/10000000-0000-0000-0000-000000000002/r-2.webm');
select pg_temp.ok(true, 'recording upload works again once switched back on');

-- ---------------------------------------------------------------- meetings without a card
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into public.interactions (id, workspace_id, kind, title)
values ('40000000-0000-0000-0000-000000000001', :'ws', 'Meeting', 'Board meeting');
select pg_temp.ok((select contact_id is null and created_by = auth.uid() from public.interactions where id = '40000000-0000-0000-0000-000000000001'), 'meeting without a card is saved as the author''s');
insert into storage.objects (bucket_id, name) values ('recordings', :'ws' || '/m-00000000-0000-0000-0000-00000000000a/40000000-1.webm');
select pg_temp.ok(true, 'author uploads the meeting recording to their own folder');
update public.interactions set summary = 'ok' where id = '40000000-0000-0000-0000-000000000001';
select pg_temp.ok((select summary from public.interactions where id = '40000000-0000-0000-0000-000000000001') = 'ok', 'author can update their meeting');
select pg_temp.fails($$insert into public.interactions (workspace_id, title) values ('$$ || :'ws_dave' || $$', 'x')$$, 'cannot add a meeting to a workspace you are not in');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.ok(not exists (select 1 from public.interactions where id = '40000000-0000-0000-0000-000000000001'), 'other members cannot see someone''s meeting');
select pg_temp.ok(not exists (select 1 from storage.objects where name like '%/m-00000000-0000-0000-0000-00000000000a/%'), 'other members cannot see someone''s meeting recording');
select pg_temp.fails($$insert into storage.objects (bucket_id, name) values ('recordings', '$$ || :'ws' || $$/m-00000000-0000-0000-0000-00000000000a/evil.webm')$$, 'cannot upload into someone else''s meeting folder');
delete from public.interactions where id = '40000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select pg_temp.ok(exists (select 1 from public.interactions where id = '40000000-0000-0000-0000-000000000001'), 'other members cannot delete someone''s meeting');
delete from public.interactions where id = '40000000-0000-0000-0000-000000000001';
select pg_temp.ok(not exists (select 1 from public.interactions where id = '40000000-0000-0000-0000-000000000001'), 'author can delete their meeting');

-- ---------------------------------------------------------------- to do list
reset role;
select set_config('request.jwt.claim.sub', '', false);
update public.profiles set status = 'active' where username in ('alice', 'bob', 'carol', 'dave');
update public.workspaces set status = 'active' where id = :'ws';
update public.workspace_members set status = 'active' where workspace_id = :'ws' and user_id in ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c');
update public.profiles set features = '{}' where username in ('alice', 'bob', 'carol', 'dave');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select pg_temp.ok(not public.feature_on('todo'), 'to do list is off by default');
select pg_temp.fails($$insert into public.tasks (title) values ('x')$$, 'tasks refused while to do list is off');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', false);
select pg_temp.ok(public.feature_on('todo'), 'super admin has the to do list');
update public.profiles set features = '{"todo": true}' where username in ('alice', 'bob');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into public.tasks (id, title, priority, due_on, due_time, reminders, created_by)
values ('50000000-0000-0000-0000-000000000001', 'Call Peter', 'High', '2026-10-05', '10:00', '{15,0}', '00000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select created_by = auth.uid() from public.tasks where id = '50000000-0000-0000-0000-000000000001'), 'a new task is always the caller''s own');
insert into public.tasks (id, title) values ('50000000-0000-0000-0000-000000000002', 'Private errand');
select pg_temp.fails($$insert into public.tasks (title, due_time) values ('x', '10:00')$$, 'a time needs a date');
select pg_temp.fails($$insert into public.tasks (title, priority) values ('x', 'Whenever')$$, 'priority must be a known one');
select pg_temp.fails($$insert into public.tasks (title, assignee_id) values ('x', '00000000-0000-0000-0000-00000000000d')$$, 'cannot assign to someone outside the team');
select pg_temp.fails($$insert into public.tasks (title, assignee_id) values ('x', '00000000-0000-0000-0000-00000000000c')$$, 'cannot assign to a teammate without the to do list');
update public.tasks set status = 'done' where id = '50000000-0000-0000-0000-000000000002';
select pg_temp.ok((select completed_at is not null from public.tasks where id = '50000000-0000-0000-0000-000000000002'), 'done stamps completed_at');
update public.tasks set status = 'todo' where id = '50000000-0000-0000-0000-000000000002';
select pg_temp.ok((select completed_at is null from public.tasks where id = '50000000-0000-0000-0000-000000000002'), 'reopening clears completed_at');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.ok(not exists (select 1 from public.tasks), 'teammates cannot see each other''s tasks');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
update public.tasks set assignee_id = '00000000-0000-0000-0000-00000000000b' where id = '50000000-0000-0000-0000-000000000001';
select pg_temp.ok((select assignee_name = 'Bob E.' and assigned_by_name = 'Alice Admin' and assigned_at is not null from public.tasks where id = '50000000-0000-0000-0000-000000000001'), 'assigning copies both names');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.ok((select count(*) from public.tasks) = 1, 'assignee sees only the task given to them');
update public.tasks set status = 'in_progress', subtasks = '[{"id":"s1","text":"Dial","done":true}]' where id = '50000000-0000-0000-0000-000000000001';
select pg_temp.ok((select status = 'in_progress' from public.tasks where id = '50000000-0000-0000-0000-000000000001'), 'assignee moves the status and ticks the checklist');
select pg_temp.fails($$update public.tasks set title = 'Ignore it' where id = '50000000-0000-0000-0000-000000000001'$$, 'assignee cannot rename the task');
select pg_temp.fails($$update public.tasks set due_on = '2027-01-01' where id = '50000000-0000-0000-0000-000000000001'$$, 'assignee cannot move the deadline');
select pg_temp.fails($$update public.tasks set assignee_id = null where id = '50000000-0000-0000-0000-000000000001'$$, 'assignee cannot hand the task back by unassigning');
update public.tasks set assignee_name = 'Someone' where id = '50000000-0000-0000-0000-000000000001';
select pg_temp.ok((select assignee_name = 'Bob E.' from public.tasks where id = '50000000-0000-0000-0000-000000000001'), 'assignee cannot change the copied names');
delete from public.tasks where id = '50000000-0000-0000-0000-000000000001';
select pg_temp.ok(exists (select 1 from public.tasks where id = '50000000-0000-0000-0000-000000000001'), 'assignee cannot delete the task');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into public.tasks (id, title, due_on, repeat, assignee_id)
values ('50000000-0000-0000-0000-000000000003', 'Weekly report', '2026-10-05', '{"freq": "weekly", "interval": 1}', '00000000-0000-0000-0000-00000000000b');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
update public.tasks set due_on = '2026-10-12', done_count = done_count + 1 where id = '50000000-0000-0000-0000-000000000003';
select pg_temp.ok((select due_on = '2026-10-12' and done_count = 1 and completed_at is not null from public.tasks where id = '50000000-0000-0000-0000-000000000003'), 'assignee can tick off a repeating task, which moves it to the next date');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
delete from public.tasks where id = '50000000-0000-0000-0000-000000000003';

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
select pg_temp.ok(not exists (select 1 from public.tasks), 'outsiders see no tasks');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', false);
select pg_temp.ok(not exists (select 1 from public.tasks), 'super admin cannot read anyone''s tasks');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
update public.workspace_members set status = 'revoked' where user_id = '00000000-0000-0000-0000-00000000000b' and workspace_id = :'ws';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.ok(not exists (select 1 from public.tasks), 'assignee loses the task when they leave the team');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select pg_temp.ok((select count(*) from public.tasks) = 2, 'owner keeps their tasks');
delete from public.tasks where id = '50000000-0000-0000-0000-000000000002';
select pg_temp.ok((select count(*) from public.tasks) = 1, 'owner deletes their task');

-- ---------------------------------------------------------------- quick notes
reset role;
select set_config('request.jwt.claim.sub', '', false);
update public.profiles set features = '{}' where username in ('alice', 'bob', 'carol', 'dave');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select pg_temp.ok(not public.feature_on('notes'), 'quick notes is off by default');
select pg_temp.fails($$insert into public.notes (body) values ('x')$$, 'notes refused while quick notes is off');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', false);
select pg_temp.ok(public.feature_on('notes'), 'super admin has quick notes');
update public.profiles set features = '{"notes": true}' where username in ('alice', 'bob');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into public.notes (id, title, body, created_by)
values ('60000000-0000-0000-0000-000000000001', 'Gate code', '4471#', '00000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select created_by = auth.uid() from public.notes where id = '60000000-0000-0000-0000-000000000001'), 'a new note is always the caller''s own');
select pg_temp.fails($$insert into public.notes (body, color) values ('x', 'orange')$$, 'colour must be a known one');
insert into public.note_topics (id, name) values ('61000000-0000-0000-0000-000000000001', 'Cebu trip');
select pg_temp.fails($$insert into public.note_topics (name) values (' cebu TRIP')$$, 'topic names are unique per person');
update public.notes set topic_id = '61000000-0000-0000-0000-000000000001' where id = '60000000-0000-0000-0000-000000000001';
select pg_temp.ok((select topic_id is not null from public.notes where id = '60000000-0000-0000-0000-000000000001'), 'a note goes in a topic');
insert into storage.objects (bucket_id, name) values ('note-files', '00000000-0000-0000-0000-00000000000a/60000000-0000-0000-0000-000000000001/photo.jpg');
select pg_temp.fails($$insert into storage.objects (bucket_id, name) values ('note-files', '00000000-0000-0000-0000-00000000000b/x/evil.jpg')$$, 'cannot upload into someone else''s notes folder');
select pg_temp.fails($$update public.notes set created_by = '00000000-0000-0000-0000-00000000000b' where id = '60000000-0000-0000-0000-000000000001'$$, 'a note cannot be given away');
update public.notes set body = '4471# then left' where id = '60000000-0000-0000-0000-000000000001';
select pg_temp.ok((select body = '4471# then left' from public.notes where id = '60000000-0000-0000-0000-000000000001'), 'owner edits their note');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.ok(not exists (select 1 from public.notes), 'teammates cannot see each other''s notes');
select pg_temp.ok(not exists (select 1 from storage.objects where bucket_id = 'note-files'), 'teammates cannot see each other''s note files');
select pg_temp.ok(not exists (select 1 from public.note_topics), 'teammates cannot see each other''s topics');
insert into public.note_topics (id, name) values ('61000000-0000-0000-0000-000000000002', 'Bob stuff');
select pg_temp.fails($$insert into public.notes (body, topic_id) values ('x', '61000000-0000-0000-0000-000000000001')$$, 'cannot put a note in someone else''s topic');
update public.notes set body = 'hacked' where id = '60000000-0000-0000-0000-000000000001';
delete from public.notes where id = '60000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', false);
select pg_temp.ok(not exists (select 1 from public.notes), 'super admin cannot read anyone''s notes');
select pg_temp.ok(not exists (select 1 from public.note_topics), 'super admin cannot read anyone''s topics');
select pg_temp.ok(not exists (select 1 from storage.objects where bucket_id = 'note-files'), 'super admin cannot read anyone''s note files');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select pg_temp.ok((select body = '4471# then left' from public.notes where id = '60000000-0000-0000-0000-000000000001'), 'others cannot change or delete a note');
select pg_temp.ok(exists (select 1 from storage.objects where bucket_id = 'note-files'), 'owner sees their note files');
delete from storage.objects where bucket_id = 'note-files';
delete from public.notes where id = '60000000-0000-0000-0000-000000000001';
select pg_temp.ok(not exists (select 1 from public.notes), 'owner deletes their note');
delete from public.note_topics where id = '61000000-0000-0000-0000-000000000001';
select pg_temp.ok(not exists (select 1 from public.note_topics), 'owner deletes their topic');

-- ---------------------------------------------------------------- anon
reset role;
set role anon;
select pg_temp.ok(public.username_available('newperson') and not public.username_available('alice') and not public.username_available('No!'), 'username availability check');
select pg_temp.fails($$select count(*) from public.contacts$$, 'anon cannot read contacts');
select pg_temp.fails($$select public.ws_role('$$ || :'ws' || $$')$$, 'anon cannot call helper predicates');
select pg_temp.fails($$select public.super_admin_workspaces()$$, 'anon cannot call dashboard RPC');
select pg_temp.fails($$select count(*) from public.card_shares$$, 'anon cannot read shares');
select pg_temp.fails($$select count(*) from public.tasks$$, 'anon cannot read tasks');
select pg_temp.fails($$select count(*) from public.notes$$, 'anon cannot read notes');
select pg_temp.fails($$select public.accept_card_share('30000000-0000-0000-0000-000000000002')$$, 'anon cannot accept shares');
reset role;
\echo 'ALL RLS TESTS PASSED'
