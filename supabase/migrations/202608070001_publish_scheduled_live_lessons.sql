-- A saved live schedule is the publication boundary for a live lesson.
-- This keeps the learner Live Classes workspace consistent with Course Material.

create or replace function public.adci_save_live_class(
  target_lesson_id uuid,
  class_provider text,
  class_url text,
  class_instructor text,
  class_starts_at timestamptz,
  class_ends_at timestamptz
)
returns public.adci_live_classes
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  class_record public.adci_live_classes;
begin
  select course.organization_id
  into target_organization_id
  from public.adci_lessons lesson
  join public.adci_modules module on module.id = lesson.module_id
  join public.adci_courses course on course.id = module.course_id
  where lesson.id = target_lesson_id
    and lesson.lesson_type = 'live';

  if target_organization_id is null or not public.adci_current_user_has_role(
    target_organization_id,
    array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  ) then
    raise exception 'Live class administration permission required';
  end if;

  if class_provider not in ('zoom','google_meet','youtube_live') then
    raise exception 'Unsupported live provider';
  end if;
  if class_url is null or class_url !~ '^https://.+' then
    raise exception 'A valid HTTPS meeting URL is required';
  end if;
  if nullif(trim(class_instructor), '') is null then
    raise exception 'Instructor name is required';
  end if;
  if class_starts_at is null or class_ends_at is null or class_ends_at <= class_starts_at then
    raise exception 'The live class must end after it starts';
  end if;

  insert into public.adci_live_classes (
    lesson_id,
    provider,
    meeting_url,
    instructor_name,
    starts_at,
    ends_at,
    updated_by,
    updated_at
  ) values (
    target_lesson_id,
    class_provider,
    trim(class_url),
    trim(class_instructor),
    class_starts_at,
    class_ends_at,
    auth.uid(),
    now()
  )
  on conflict (lesson_id) do update set
    provider = excluded.provider,
    meeting_url = excluded.meeting_url,
    instructor_name = excluded.instructor_name,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    updated_by = auth.uid(),
    updated_at = now()
  returning * into class_record;

  update public.adci_lessons
  set status = 'published',
      updated_at = now()
  where id = target_lesson_id
    and status <> 'published';

  return class_record;
end;
$$;

-- Repair schedules created before saving a schedule published its lesson.
update public.adci_lessons lesson
set status = 'published',
    updated_at = now()
where lesson.lesson_type = 'live'
  and lesson.status <> 'published'
  and exists (
    select 1
    from public.adci_live_classes live_class
    where live_class.lesson_id = lesson.id
  );

revoke all on function public.adci_save_live_class(uuid,text,text,text,timestamptz,timestamptz) from public;
grant execute on function public.adci_save_live_class(uuid,text,text,text,timestamptz,timestamptz) to authenticated;
