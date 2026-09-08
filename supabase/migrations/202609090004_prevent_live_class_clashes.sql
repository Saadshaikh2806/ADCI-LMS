-- Every live class runs through one shared Zoom host user (ZOOM_HOST_USER_ID),
-- and that account can only host a single meeting at a time. Nothing stopped an
-- admin scheduling two classes over the same slot, so the second one could
-- never actually start -- and learners had already paid for it by then.
--
-- Refuse overlapping schedules at the source: a trigger on adci_live_classes
-- covers every write path (adci_create_bookable_live_series, the legacy
-- adci_save_live_class / adci_schedule_daily_live_classes, and any manual
-- insert), and adci_live_class_clashes lets the admin UI and the create-series
-- API warn before a Zoom meeting is ever created.
begin;

-- Overlapping classes for a candidate slot, soonest first. Retired lessons,
-- retired courses and finished sessions no longer occupy the host, so they
-- never count as a clash. exclude_lesson_id keeps a class from clashing with
-- itself when its own time is edited.
create or replace function public.adci_live_class_overlaps(
  check_starts_at timestamptz,
  check_ends_at timestamptz,
  exclude_lesson_id uuid default null
)
returns table (
  lesson_id uuid,
  lesson_title text,
  course_title text,
  instructor_name text,
  starts_at timestamptz,
  ends_at timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select lc.lesson_id, l.title, c.title, lc.instructor_name, lc.starts_at, lc.ends_at
  from public.adci_live_classes lc
  join public.adci_lessons l on l.id = lc.lesson_id
  join public.adci_modules m on m.id = l.module_id
  join public.adci_courses c on c.id = m.course_id
  where (exclude_lesson_id is null or lc.lesson_id <> exclude_lesson_id)
    -- Half-open intervals: back-to-back classes (10:00-11:00, 11:00-12:00) are fine.
    and lc.starts_at < check_ends_at
    and lc.ends_at > check_starts_at
    and l.status <> 'retired'
    and c.status <> 'retired'
    and public.adci_live_class_phase(lc.starts_at, lc.ends_at, lc.live_started_at, lc.live_ended_at) <> 'ended'
  order by lc.starts_at;
$$;

create or replace function public.adci_guard_live_class_clash()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare clash record;
begin
  -- A retired lesson's class is parked, not scheduled; let it be rewritten.
  if not exists (
    select 1 from public.adci_lessons l
    join public.adci_modules m on m.id = l.module_id
    join public.adci_courses c on c.id = m.course_id
    where l.id = new.lesson_id and l.status <> 'retired' and c.status <> 'retired'
  ) then
    return new;
  end if;

  select * into clash
  from public.adci_live_class_overlaps(new.starts_at, new.ends_at, new.lesson_id)
  limit 1;

  if clash.lesson_id is not null then
    raise exception 'Live class clash: "%" (%) already runs % to % IST. Only one live class can run at a time, so choose a slot that does not overlap it.',
      clash.lesson_title,
      clash.course_title,
      to_char(clash.starts_at at time zone 'Asia/Kolkata', 'FMDD Mon YYYY, FMHH12:MI AM'),
      to_char(clash.ends_at at time zone 'Asia/Kolkata', 'FMHH12:MI AM')
      using errcode = 'exclusion_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists adci_live_classes_no_clash on public.adci_live_classes;
create trigger adci_live_classes_no_clash
  before insert or update of starts_at, ends_at on public.adci_live_classes
  for each row execute function public.adci_guard_live_class_clash();

-- Pre-flight check for a whole proposed series. Reports clashes against the
-- existing timetable *and* between the proposed occurrences themselves, so a
-- series that doubles back on itself is caught before any Zoom meeting is
-- created.
create or replace function public.adci_live_class_clashes(
  check_occurrences jsonb,
  exclude_lesson_id uuid default null
)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  org_id uuid := public.adci_admin_org();
  occurrence jsonb;
  other jsonb;
  candidate_start timestamptz;
  candidate_end timestamptz;
  clash record;
  found jsonb := '[]'::jsonb;
begin
  if not public.adci_current_user_has_role(org_id,
    array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[])
  then raise exception 'Live class administration permission required'; end if;

  if jsonb_typeof(check_occurrences) <> 'array' then
    raise exception 'Provide the proposed occurrences as an array';
  end if;
  if jsonb_array_length(check_occurrences) > 10 then
    raise exception 'Check at most 10 sessions at a time';
  end if;

  for occurrence in select value from jsonb_array_elements(check_occurrences) loop
    candidate_start := (occurrence->>'starts_at')::timestamptz;
    candidate_end := (occurrence->>'ends_at')::timestamptz;
    if candidate_start is null or candidate_end is null or candidate_end <= candidate_start then
      continue;
    end if;

    for clash in
      select * from public.adci_live_class_overlaps(candidate_start, candidate_end, exclude_lesson_id)
    loop
      found := found || jsonb_build_array(jsonb_build_object(
        'proposed_starts_at', candidate_start,
        'proposed_ends_at', candidate_end,
        'lesson_id', clash.lesson_id,
        'lesson_title', clash.lesson_title,
        'course_title', clash.course_title,
        'instructor_name', clash.instructor_name,
        'starts_at', clash.starts_at,
        'ends_at', clash.ends_at
      ));
    end loop;

    -- Overlaps inside the proposed set itself; only report the later half of
    -- each pair so one collision is not listed twice.
    for other in select value from jsonb_array_elements(check_occurrences) loop
      if (other->>'starts_at')::timestamptz < candidate_end
        and (other->>'ends_at')::timestamptz > candidate_start
        and (other->>'starts_at')::timestamptz > candidate_start
      then
        found := found || jsonb_build_array(jsonb_build_object(
          'proposed_starts_at', candidate_start,
          'proposed_ends_at', candidate_end,
          'lesson_id', null,
          'lesson_title', 'Another session in this same series',
          'course_title', 'Not created yet',
          'instructor_name', null,
          'starts_at', (other->>'starts_at')::timestamptz,
          'ends_at', (other->>'ends_at')::timestamptz
        ));
      end if;
    end loop;
  end loop;

  return found;
end;
$$;

revoke all on function public.adci_live_class_overlaps(timestamptz,timestamptz,uuid) from public, anon, authenticated;
revoke all on function public.adci_guard_live_class_clash() from public, anon, authenticated;
revoke all on function public.adci_live_class_clashes(jsonb,uuid) from public, anon;
grant execute on function public.adci_live_class_clashes(jsonb,uuid) to authenticated;

commit;
