create or replace function public.adci_update_course(
  target_course_id uuid,
  course_title text,
  course_description text,
  course_status public.adci_content_status
)
returns public.adci_courses
language plpgsql
security definer
set search_path = ''
as $$
declare
  course_record public.adci_courses;
begin
  select * into course_record
  from public.adci_courses
  where id = target_course_id;

  if course_record.id is null or not public.adci_current_user_has_role(
    course_record.organization_id,
    array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  ) then
    raise exception 'Academic administration permission required';
  end if;

  if trim(course_title) = '' then
    raise exception 'Course title is required';
  end if;

  update public.adci_courses
  set title = trim(course_title),
      description = coalesce(course_description, ''),
      status = course_status,
      published_at = case
        when course_status = 'published' then coalesce(published_at, now())
        else null
      end,
      updated_at = now()
  where id = target_course_id
  returning * into course_record;

  insert into public.adci_audit_events (
    organization_id, actor_id, action, entity_type, entity_id, new_values
  ) values (
    course_record.organization_id,
    auth.uid(),
    'course.updated',
    'course',
    course_record.id,
    jsonb_build_object('title', course_record.title, 'status', course_record.status)
  );

  return course_record;
end;
$$;

create or replace function public.adci_add_course_module(
  target_course_id uuid,
  module_title text
)
returns public.adci_modules
language plpgsql
security definer
set search_path = ''
as $$
declare
  course_record public.adci_courses;
  module_record public.adci_modules;
  next_position integer;
begin
  select * into course_record from public.adci_courses where id = target_course_id;

  if course_record.id is null or not public.adci_current_user_has_role(
    course_record.organization_id,
    array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  ) then
    raise exception 'Academic administration permission required';
  end if;

  if trim(module_title) = '' then
    raise exception 'Module title is required';
  end if;

  select coalesce(max(position), 0) + 1 into next_position
  from public.adci_modules where course_id = target_course_id;

  insert into public.adci_modules (course_id, title, position)
  values (target_course_id, trim(module_title), next_position)
  returning * into module_record;

  return module_record;
end;
$$;

create or replace function public.adci_add_module_lesson(
  target_module_id uuid,
  lesson_title text,
  lesson_kind text,
  lesson_duration_seconds integer default 0
)
returns public.adci_lessons
language plpgsql
security definer
set search_path = ''
as $$
declare
  course_record public.adci_courses;
  lesson_record public.adci_lessons;
  next_position integer;
begin
  select c.* into course_record
  from public.adci_courses c
  join public.adci_modules m on m.course_id = c.id
  where m.id = target_module_id;

  if course_record.id is null or not public.adci_current_user_has_role(
    course_record.organization_id,
    array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  ) then
    raise exception 'Academic administration permission required';
  end if;

  if lesson_kind not in ('video','audio','pdf','html','live','quiz') then
    raise exception 'Unsupported lesson type';
  end if;

  if trim(lesson_title) = '' then
    raise exception 'Lesson title is required';
  end if;

  select coalesce(max(position), 0) + 1 into next_position
  from public.adci_lessons where module_id = target_module_id;

  insert into public.adci_lessons (
    module_id, title, lesson_type, position, duration_seconds, status
  ) values (
    target_module_id,
    trim(lesson_title),
    lesson_kind,
    next_position,
    greatest(0, lesson_duration_seconds),
    'draft'
  ) returning * into lesson_record;

  return lesson_record;
end;
$$;

revoke all on function public.adci_update_course(uuid,text,text,public.adci_content_status) from public;
revoke all on function public.adci_add_course_module(uuid,text) from public;
revoke all on function public.adci_add_module_lesson(uuid,text,text,integer) from public;
grant execute on function public.adci_update_course(uuid,text,text,public.adci_content_status) to authenticated;
grant execute on function public.adci_add_course_module(uuid,text) to authenticated;
grant execute on function public.adci_add_module_lesson(uuid,text,text,integer) to authenticated;
