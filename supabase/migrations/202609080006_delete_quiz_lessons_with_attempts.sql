-- Deleting a quiz lesson cascaded into adci_assessments but adci_attempts holds a
-- restricting reference, so any quiz a learner had already opened could never be
-- removed. Clear the dependent attempt history (and stale prerequisite pointers)
-- inside the same transaction as the delete, and record what was removed.

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
  doomed_lesson_ids uuid[];
  doomed_assessment_ids uuid[];
  removed_attempts integer := 0;
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

  select coalesce(array_agg(l.id), '{}')
  into doomed_lesson_ids
  from public.adci_lessons l
  join public.adci_modules m on m.id = l.module_id
  where case entity_kind
    when 'lesson' then l.id = target_id
    when 'module' then m.id = target_id
    else m.course_id = target_id
  end;

  select coalesce(array_agg(a.id), '{}')
  into doomed_assessment_ids
  from public.adci_assessments a
  where a.lesson_id = any (doomed_lesson_ids)
     or (entity_kind = 'course' and a.course_id = target_id);

  delete from public.adci_attempts
  where assessment_id = any (doomed_assessment_ids);
  get diagnostics removed_attempts = row_count;

  update public.adci_lessons
  set prerequisite_lesson_id = null
  where prerequisite_lesson_id = any (doomed_lesson_ids)
    and not (id = any (doomed_lesson_ids));

  insert into public.adci_audit_events (
    organization_id, actor_id, action, entity_type, entity_id, new_values
  ) values (
    target_organization_id,
    auth.uid(),
    entity_kind || '.deleted',
    entity_kind,
    target_id,
    jsonb_build_object(
      'lessons_removed', coalesce(array_length(doomed_lesson_ids, 1), 0),
      'assessments_removed', coalesce(array_length(doomed_assessment_ids, 1), 0),
      'attempts_removed', removed_attempts
    )
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
