-- Meetings with a type and AI minutes (quick summary, formal minutes, action
-- items, decisions), plus the timestamped transcript the recording jumps from.
-- Only adds nullable columns: existing entries and policies are unchanged.

alter table public.interactions
  add column if not exists meeting_type text,
  add column if not exists minutes jsonb,
  add column if not exists segments jsonb;

alter table public.interactions drop constraint if exists interactions_meeting_type_check;
alter table public.interactions add constraint interactions_meeting_type_check check (
  meeting_type is null or meeting_type in (
    'General Meeting', 'Management Meeting', 'Project Meeting', 'Sales Meeting',
    'Technical Meeting', 'Site Meeting', 'Client Meeting', 'Brainstorming', 'Interview'
  )
);
