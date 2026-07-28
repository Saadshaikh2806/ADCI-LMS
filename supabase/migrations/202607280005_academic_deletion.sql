create or replace function public.adci_delete_academic_entity(
  entity_kind text,
  target_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  target_course_status public.adci_content_status;
begin
  if entity_kind = 'course' then
    select c.organization_id, c.status
    into target_organization_id, target_course_status
    from public.adci_courses c
    where c.id = target_id;
  elsif entity_kind = 'module' then
    select c.organization_id
    into target_organization_id
    from public.adci_modules m
    join public.adci_courses c on c.id = m.course_id
    where m.id = target_id;
  elsif entity_kind = 'lesson' then
    select c.organization_id
    into target_organization_id
    from public.adci_lessons l
    join public.adci_modules m on m.id = l.module_id
    join public.adci_courses c on c.id = m.course_id
    where l.id = target_id;
  else
    raise exception 'Unsupported academic entity';
  end if;

  if target_organization_id is null then
    raise exception 'Academic entity not found';
  end if;

  if not public.adci_current_user_has_role(
    target_organization_id,
    array['academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  ) then
    raise exception 'Academic lead permission required';
  end if;

  if entity_kind = 'course' and target_course_status <> 'draft' then
    raise exception 'Only draft courses can be deleted. Retire this course instead.';
  end if;

  insert into public.adci_audit_events (
    organization_id, actor_id, action, entity_type, entity_id
  ) values (
    target_organization_id,
    auth.uid(),
    entity_kind || '.deleted',
    entity_kind,
    target_id
  );

  if entity_kind = 'lesson' then
    delete from public.adci_lessons where id = target_id;
  elsif entity_kind = 'module' then
    delete from public.adci_modules where id = target_id;
  else
    delete from public.adci_courses where id = target_id;
  end if;
end;
$$;

revoke all on function public.adci_delete_academic_entity(text,uuid) from public;
grant execute on function public.adci_delete_academic_entity(text,uuid) to authenticated;

create policy "academic staff read managed lesson files"
on storage.objects for select to authenticated
using (
  bucket_id in ('adci-lesson-assets', 'adci-course-videos')
  and exists (
    select 1
    from public.adci_lessons l
    join public.adci_modules m on m.id = l.module_id
    join public.adci_courses c on c.id = m.course_id
    where l.id::text = (storage.foldername(name))[1]
      and public.adci_current_user_has_role(
        c.organization_id,
        array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
      )
  )
);

create policy "academic leads delete managed lesson files"
on storage.objects for delete to authenticated
using (
  bucket_id in ('adci-lesson-assets', 'adci-course-videos')
  and exists (
    select 1
    from public.adci_lessons l
    join public.adci_modules m on m.id = l.module_id
    join public.adci_courses c on c.id = m.course_id
    where l.id::text = (storage.foldername(name))[1]
      and public.adci_current_user_has_role(
        c.organization_id,
        array['academic_lead','branch_admin','super_admin']::public.adci_app_role[]
      )
  )
);
