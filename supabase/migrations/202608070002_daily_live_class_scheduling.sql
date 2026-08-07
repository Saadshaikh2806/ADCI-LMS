-- Daily live-class scheduling. Each occurrence is a separate live lesson so
-- join windows and attendance remain accurate for every day.

alter table public.adci_live_classes
  add column if not exists series_id uuid,
  add column if not exists series_date date;

create index if not exists adci_live_classes_series_idx
on public.adci_live_classes (series_id, series_date)
where series_id is not null;

create or replace function public.adci_schedule_daily_live_classes(
  target_lesson_id uuid,
  class_provider text,
  class_url text,
  class_instructor text,
  class_starts_at timestamptz,
  class_ends_at timestamptz,
  repeat_until date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  target_module_id uuid;
  base_title text;
  first_date date;
  occurrence_count integer;
  day_offset integer;
  next_position integer;
  occurrence_lesson_id uuid;
  occurrence_start timestamptz;
  occurrence_end timestamptz;
  target_series_id uuid := gen_random_uuid();
begin
  select course.organization_id, lesson.module_id, lesson.title
  into target_organization_id, target_module_id, base_title
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

  if exists (
    select 1 from public.adci_live_classes where lesson_id = target_lesson_id
  ) then
    raise exception 'Daily scheduling is available only for an unscheduled live lesson';
  end if;

  if class_starts_at is null or class_ends_at is null or class_ends_at <= class_starts_at then
    raise exception 'The live class must end after it starts';
  end if;

  first_date := (class_starts_at at time zone 'Asia/Kolkata')::date;
  if repeat_until is null or repeat_until < first_date then
    raise exception 'Repeat-until date must be on or after the first class';
  end if;

  occurrence_count := repeat_until - first_date + 1;
  if occurrence_count > 90 then
    raise exception 'A daily series can contain at most 90 classes';
  end if;

  for day_offset in 0..(occurrence_count - 1) loop
    occurrence_start := class_starts_at + make_interval(days => day_offset);
    occurrence_end := class_ends_at + make_interval(days => day_offset);

    if day_offset = 0 then
      occurrence_lesson_id := target_lesson_id;
    else
      select coalesce(max(position), 0) + 1
      into next_position
      from public.adci_lessons
      where module_id = target_module_id;

      insert into public.adci_lessons (
        module_id,
        title,
        lesson_type,
        position,
        duration_seconds,
        status
      ) values (
        target_module_id,
        base_title || ' - ' || to_char(occurrence_start at time zone 'Asia/Kolkata', 'DD Mon'),
        'live',
        next_position,
        0,
        'published'
      )
      returning id into occurrence_lesson_id;
    end if;

    perform public.adci_save_live_class(
      occurrence_lesson_id,
      class_provider,
      class_url,
      class_instructor,
      occurrence_start,
      occurrence_end
    );

    update public.adci_lessons
    set status = 'published',
        updated_at = now()
    where id = occurrence_lesson_id
      and status <> 'published';

    update public.adci_live_classes
    set series_id = target_series_id,
        series_date = (occurrence_start at time zone 'Asia/Kolkata')::date
    where lesson_id = occurrence_lesson_id;
  end loop;

  return jsonb_build_object(
    'series_id', target_series_id,
    'classes_created', occurrence_count
  );
end;
$$;

revoke all on function public.adci_schedule_daily_live_classes(uuid,text,text,text,timestamptz,timestamptz,date) from public;
grant execute on function public.adci_schedule_daily_live_classes(uuid,text,text,text,timestamptz,timestamptz,date) to authenticated;
