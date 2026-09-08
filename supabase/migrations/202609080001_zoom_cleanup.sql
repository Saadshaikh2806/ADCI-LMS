begin;

-- Capture provider ownership in the same transaction that approves LMS deletion.
-- No foreign key to the deleted class: this record must survive it.
create table public.adci_zoom_cleanup (
  lesson_id uuid primary key,
  organization_id uuid not null references public.adci_organizations(id),
  meeting_number text not null,
  title text not null,
  last_error text,
  created_at timestamptz not null default now()
);
alter table public.adci_zoom_cleanup enable row level security;
revoke all on public.adci_zoom_cleanup from public, anon, authenticated;
grant select on public.adci_zoom_cleanup to authenticated;
grant all on public.adci_zoom_cleanup to service_role;
create policy "schedule admins can see pending Zoom cleanup" on public.adci_zoom_cleanup
for select to authenticated using (public.adci_current_user_has_role(
  organization_id, array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
));

create function public.adci_queue_deleted_zoom_meeting()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.provider = 'zoom' and old.zoom_meeting_number is not null then
    insert into public.adci_zoom_cleanup(lesson_id, organization_id, meeting_number, title)
    select old.lesson_id, c.organization_id, old.zoom_meeting_number, l.title
    from public.adci_lessons l join public.adci_modules m on m.id = l.module_id
    join public.adci_courses c on c.id = m.course_id where l.id = old.lesson_id
    on conflict (lesson_id) do nothing;
  end if;
  return old;
end;
$$;
revoke all on function public.adci_queue_deleted_zoom_meeting() from public, anon, authenticated;
create trigger adci_capture_zoom_cleanup before delete on public.adci_live_classes
for each row execute function public.adci_queue_deleted_zoom_meeting();

notify pgrst, 'reload schema';
commit;
