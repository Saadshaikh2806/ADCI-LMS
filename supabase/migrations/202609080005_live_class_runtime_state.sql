-- Track a Zoom Live class's real runtime, separate from its scheduled window.
--
--   * live_started_at  - Zoom reported the meeting actually started
--   * live_ended_at    - Zoom reported the meeting ended for all
--
-- Scheduled end (ends_at) is now only a schedule. While a meeting runs past it
-- the class is "extended" and still joinable; once Zoom reports the end (webhook,
-- the End control, or a join-time probe) the class is "ended" and joins stop.
-- A hard ceiling of starts_at + 6h (the max session length the LMS allows)
-- expires a class whose end was never reported.
begin;

alter table public.adci_live_classes
  add column if not exists live_started_at timestamptz,
  add column if not exists live_ended_at timestamptz;

-- Single source of truth for a live class's phase.
create or replace function public.adci_live_class_phase(
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_live_started_at timestamptz,
  p_live_ended_at timestamptz
) returns text
language sql stable
set search_path = ''
as $$
  select case
    when p_live_ended_at is not null then 'ended'
    when now() >= p_starts_at + interval '6 hours' then 'ended'
    when now() < p_starts_at - interval '15 minutes' then 'scheduled'
    when now() <= p_ends_at then 'live'
    when p_live_started_at is not null then 'extended'
    else 'ended'
  end;
$$;

create or replace function public.adci_live_class_can_join(
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_live_started_at timestamptz,
  p_live_ended_at timestamptz
) returns boolean
language sql stable
set search_path = ''
as $$
  select public.adci_live_class_phase(
    p_starts_at, p_ends_at, p_live_started_at, p_live_ended_at
  ) in ('live', 'extended');
$$;

-- Service-role only: called by the Zoom webhook and by join-time / End-control
-- reconciliation. mark_started also clears a stale end so a restarted meeting
-- re-opens.
create or replace function public.adci_set_live_runtime_state(
  target_meeting_number text,
  mark_started boolean default false,
  mark_ended boolean default false
) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.adci_live_classes
  set
    live_started_at = case when mark_started then coalesce(live_started_at, now()) else live_started_at end,
    live_ended_at = case
      when mark_started then null
      when mark_ended then coalesce(live_ended_at, now())
      else live_ended_at
    end
  where zoom_meeting_number = target_meeting_number
    and provider = 'zoom';
end;
$$;

revoke all on function public.adci_set_live_runtime_state(text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.adci_set_live_runtime_state(text, boolean, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- Re-point every consumer at the phase helpers. Bodies are otherwise unchanged.
-- ---------------------------------------------------------------------------

-- Zoom join gate (202609050001 version, with runtime columns).
create or replace function public.adci_get_zoom_access(
  target_lesson_id uuid, target_user_id uuid
)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  class_record record;
  participant_name text;
  participant_email text;
  is_staff boolean := false;
begin
  select course.organization_id, course.id as course_id,
    live_class.zoom_meeting_number, live_class.zoom_meeting_passcode,
    live_class.starts_at, live_class.ends_at,
    live_class.live_started_at, live_class.live_ended_at
  into class_record
  from public.adci_live_classes live_class
  join public.adci_lessons lesson on lesson.id = live_class.lesson_id
  join public.adci_modules module on module.id = lesson.module_id
  join public.adci_courses course on course.id = module.course_id
  where live_class.lesson_id = target_lesson_id and live_class.provider = 'zoom';
  if class_record.zoom_meeting_number is null then raise exception 'Zoom Live is unavailable'; end if;

  select profile.full_name, account.email into participant_name, participant_email
  from auth.users account
  left join public.adci_profiles profile on profile.id = account.id
  where account.id = target_user_id;
  if participant_email is null then raise exception 'Participant account was not found'; end if;

  select exists (
    select 1 from public.adci_memberships membership
    where membership.user_id = target_user_id
      and membership.organization_id = class_record.organization_id
      and membership.active
      and membership.role::text in ('instructor','content_author','academic_lead','branch_admin','super_admin')
  ) into is_staff;

  if not is_staff and not public.adci_has_verified_zoom_enrolment(class_record.course_id, target_user_id)
  then raise exception 'Purchase this Zoom Live session or ask a super administrator to grant access'; end if;

  return jsonb_build_object(
    'meeting_number', class_record.zoom_meeting_number,
    'meeting_passcode', class_record.zoom_meeting_passcode,
    'participant_name', coalesce(nullif(trim(participant_name), ''), split_part(participant_email, '@', 1)),
    'participant_email', participant_email,
    'is_staff', is_staff,
    'organization_id', class_record.organization_id,
    'starts_at', class_record.starts_at,
    'ends_at', class_record.ends_at,
    'live_started_at', class_record.live_started_at,
    'live_ended_at', class_record.live_ended_at,
    'phase', public.adci_live_class_phase(class_record.starts_at, class_record.ends_at, class_record.live_started_at, class_record.live_ended_at),
    'can_join', public.adci_live_class_can_join(class_record.starts_at, class_record.ends_at, class_record.live_started_at, class_record.live_ended_at)
  );
end;
$$;

-- Learner dashboard widget (202607290001).
create or replace function public.adci_get_my_live_classes()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'lesson_id', l.id,
    'lesson_title', l.title,
    'course_title', c.title,
    'module_title', m.title,
    'provider', lc.provider,
    'instructor_name', lc.instructor_name,
    'starts_at', lc.starts_at,
    'ends_at', lc.ends_at,
    'status', public.adci_live_class_phase(lc.starts_at, lc.ends_at, lc.live_started_at, lc.live_ended_at),
    'can_join', public.adci_live_class_can_join(lc.starts_at, lc.ends_at, lc.live_started_at, lc.live_ended_at),
    'has_attended', exists (
      select 1 from public.adci_live_attendance la
      where la.lesson_id = l.id and la.learner_id = auth.uid()
    )
  ) order by lc.starts_at), '[]'::jsonb)
  from public.adci_live_classes lc
  join public.adci_lessons l on l.id = lc.lesson_id
  join public.adci_modules m on m.id = l.module_id
  join public.adci_courses c on c.id = m.course_id
  where lc.ends_at >= now() - interval '24 hours'
    and public.adci_can_access_course(c.id);
$$;

-- Learner Live Classes workspace (202608010005).
create or replace function public.adci_get_my_live_class_workspace(
  past_days integer default 180,
  future_days integer default 365
)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'lesson_id', lesson.id,
    'lesson_title', lesson.title,
    'course_id', course.id,
    'course_title', course.title,
    'module_title', module.title,
    'provider', live_class.provider,
    'instructor_name', live_class.instructor_name,
    'starts_at', live_class.starts_at,
    'ends_at', live_class.ends_at,
    'status', public.adci_live_class_phase(live_class.starts_at, live_class.ends_at, live_class.live_started_at, live_class.live_ended_at),
    'can_join', public.adci_live_class_can_join(live_class.starts_at, live_class.ends_at, live_class.live_started_at, live_class.live_ended_at),
    'has_attended', attendance.id is not null,
    'joined_at', attendance.joined_at,
    'last_joined_at', attendance.last_joined_at,
    'join_count', coalesce(attendance.join_count, 0)
  ) order by live_class.starts_at), '[]'::jsonb)
  from public.adci_live_classes live_class
  join public.adci_lessons lesson on lesson.id = live_class.lesson_id
  join public.adci_modules module on module.id = lesson.module_id
  join public.adci_courses course on course.id = module.course_id
  left join public.adci_live_attendance attendance
    on attendance.lesson_id = lesson.id
   and attendance.learner_id = auth.uid()
  where auth.uid() is not null
    and lesson.status = 'published'
    and course.status = 'published'
    and live_class.starts_at >= now() - make_interval(days => greatest(1, least(730, coalesce(past_days, 180))))
    and live_class.starts_at <= now() + make_interval(days => greatest(1, least(730, coalesce(future_days, 365))))
    and public.adci_can_access_course(course.id);
$$;

-- Course player (202607290003).
create or replace function public.adci_get_course_learning_view(target_course_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare course_payload jsonb;
begin
  if auth.uid() is null or not public.adci_can_access_course(target_course_id) then
    raise exception 'This course is not available to your account';
  end if;

  select jsonb_build_object(
    'id', c.id,
    'title', c.title,
    'slug', c.slug,
    'description', c.description,
    'modules', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'title', m.title,
          'position', m.position,
          'lessons', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', l.id,
                'title', l.title,
                'lesson_type', l.lesson_type,
                'position', l.position,
                'duration_seconds', l.duration_seconds,
                'status', l.status,
                'progress_percent', coalesce(lp.progress_percent, 0),
                'position_seconds', coalesce(lp.position_seconds, 0),
                'completed', lp.completed_at is not null,
                'asset', coalesce(
                  (
                    select jsonb_build_object(
                      'bucket', 'adci-lesson-assets',
                      'object_path', la.object_path,
                      'mime_type', la.mime_type,
                      'original_name', la.original_name,
                      'asset_type', la.asset_type
                    )
                    from public.adci_lesson_assets la
                    where la.lesson_id = l.id
                    order by la.created_at desc
                    limit 1
                  ),
                  (
                    select jsonb_build_object(
                      'bucket', 'adci-course-videos',
                      'object_path', va.object_path,
                      'mime_type', va.mime_type,
                      'original_name', l.title,
                      'asset_type', 'video'
                    )
                    from public.adci_video_assets va
                    where va.lesson_id = l.id
                    limit 1
                  ),
                  'null'::jsonb
                ),
                'article_body', (
                  select ac.body from public.adci_article_contents ac
                  where ac.lesson_id = l.id
                ),
                'live_class', (
                  select jsonb_build_object(
                    'provider', lc.provider,
                    'instructor_name', lc.instructor_name,
                    'starts_at', lc.starts_at,
                    'ends_at', lc.ends_at,
                    'status', public.adci_live_class_phase(lc.starts_at, lc.ends_at, lc.live_started_at, lc.live_ended_at),
                    'can_join', public.adci_live_class_can_join(lc.starts_at, lc.ends_at, lc.live_started_at, lc.live_ended_at),
                    'has_attended', exists (
                      select 1 from public.adci_live_attendance lat
                      where lat.lesson_id = l.id and lat.learner_id = auth.uid()
                    )
                  )
                  from public.adci_live_classes lc
                  where lc.lesson_id = l.id
                ),
                'quiz', (
                  select jsonb_build_object('assessment_id', a.id, 'title', a.title)
                  from public.adci_assessments a
                  where a.lesson_id = l.id and a.status = 'published'
                  limit 1
                )
              )
              order by l.position
            )
            from public.adci_lessons l
            left join public.adci_lesson_progress lp
              on lp.lesson_id = l.id and lp.learner_id = auth.uid()
            where l.module_id = m.id
          ), '[]'::jsonb)
        )
        order by m.position
      )
      from public.adci_modules m
      where m.course_id = c.id
    ), '[]'::jsonb)
  )
  into course_payload
  from public.adci_courses c
  where c.id = target_course_id;

  if course_payload is null then
    raise exception 'Course not found';
  end if;

  return course_payload;
end;
$$;

-- Study-plan calendar (202607290005): live event status via the phase helper.
create or replace function public.adci_get_my_study_plan(
  target_start date,
  target_end date
)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare calendar_events jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if target_end < target_start or target_end > target_start + 62 then
    raise exception 'Calendar range must be between 1 and 63 days';
  end if;

  select coalesce(jsonb_agg(event_data order by event_data->>'starts_at'), '[]'::jsonb)
  into calendar_events
  from (
    select jsonb_build_object(
      'id', task.id,
      'event_type', 'personal',
      'title', task.title,
      'subtitle', task.notes,
      'starts_at', task.scheduled_for,
      'ends_at', task.scheduled_for + make_interval(mins => task.duration_minutes),
      'duration_minutes', task.duration_minutes,
      'status', task.status,
      'lesson_id', null,
      'course_id', null
    ) as event_data
    from public.adci_study_tasks task
    where task.learner_id = auth.uid()
      and task.scheduled_for >= (target_start::timestamp at time zone 'Asia/Kolkata')
      and task.scheduled_for < ((target_end + 1)::timestamp at time zone 'Asia/Kolkata')

    union all

    select jsonb_build_object(
      'id', lc.lesson_id,
      'event_type', 'live',
      'title', l.title,
      'subtitle', c.title || ' · ' || lc.instructor_name,
      'starts_at', lc.starts_at,
      'ends_at', lc.ends_at,
      'duration_minutes', greatest(5, extract(epoch from (lc.ends_at - lc.starts_at))::integer / 60),
      'status', public.adci_live_class_phase(lc.starts_at, lc.ends_at, lc.live_started_at, lc.live_ended_at),
      'lesson_id', l.id,
      'course_id', c.id,
      'provider', lc.provider
    ) as event_data
    from public.adci_live_classes lc
    join public.adci_lessons l on l.id = lc.lesson_id
    join public.adci_modules m on m.id = l.module_id
    join public.adci_courses c on c.id = m.course_id
    where lc.starts_at >= (target_start::timestamp at time zone 'Asia/Kolkata')
      and lc.starts_at < ((target_end + 1)::timestamp at time zone 'Asia/Kolkata')
      and public.adci_can_access_course(c.id)

    union all

    select jsonb_build_object(
      'id', a.id,
      'event_type', 'assessment',
      'title', a.title,
      'subtitle', c.title,
      'starts_at', coalesce(a.available_until, a.available_from),
      'ends_at', coalesce(a.available_until, a.available_from),
      'duration_minutes', greatest(1, a.duration_seconds / 60),
      'status', case
        when exists (
          select 1 from public.adci_attempts attempt
          where attempt.assessment_id = a.id
            and attempt.learner_id = auth.uid()
            and attempt.status = 'scored'
        ) then 'completed'
        else 'available'
      end,
      'lesson_id', a.lesson_id,
      'course_id', a.course_id
    ) as event_data
    from public.adci_assessments a
    join public.adci_courses c on c.id = a.course_id
    where a.status = 'published'
      and coalesce(a.available_until, a.available_from) >= (target_start::timestamp at time zone 'Asia/Kolkata')
      and coalesce(a.available_until, a.available_from) < ((target_end + 1)::timestamp at time zone 'Asia/Kolkata')
      and public.adci_can_access_course(a.course_id)
  ) combined_events;

  return jsonb_build_object(
    'events', calendar_events,
    'pending_tasks', (
      select count(*) from public.adci_study_tasks task
      where task.learner_id = auth.uid() and task.status = 'pending'
    ),
    'completed_tasks', (
      select count(*) from public.adci_study_tasks task
      where task.learner_id = auth.uid() and task.status = 'completed'
    )
  );
end;
$$;

-- Admin live schedule (202608120001): add the "extended" phase and expose the
-- runtime timestamps.
create or replace function public.adci_admin_get_live_schedule(target_days integer default 30)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare target_organization_id uuid; schedule_window integer;
begin
  select id into target_organization_id
  from public.adci_organizations where slug = 'adci';
  if not public.adci_current_user_has_role(
    target_organization_id,
    array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  ) then raise exception 'Live schedule administration permission required'; end if;

  schedule_window := greatest(7, least(180, target_days));
  return jsonb_build_object(
    'summary', jsonb_build_object(
      'scheduled', (
        select count(*) from public.adci_live_classes live_class
        join public.adci_lessons lesson on lesson.id = live_class.lesson_id
        join public.adci_modules module on module.id = lesson.module_id
        join public.adci_courses course on course.id = module.course_id
        where course.organization_id = target_organization_id
          and live_class.starts_at between now() and now() + make_interval(days => schedule_window)
      ),
      'live_now', (
        select count(*) from public.adci_live_classes live_class
        join public.adci_lessons lesson on lesson.id = live_class.lesson_id
        join public.adci_modules module on module.id = lesson.module_id
        join public.adci_courses course on course.id = module.course_id
        where course.organization_id = target_organization_id
          and public.adci_live_class_phase(live_class.starts_at, live_class.ends_at, live_class.live_started_at, live_class.live_ended_at) in ('live','extended')
      ),
      'attendance', (
        select count(*) from public.adci_live_attendance attendance
        join public.adci_lessons lesson on lesson.id = attendance.lesson_id
        join public.adci_modules module on module.id = lesson.module_id
        join public.adci_courses course on course.id = module.course_id
        where course.organization_id = target_organization_id
          and attendance.joined_at >= now() - make_interval(days => schedule_window)
      ),
      'unscheduled', (
        select count(*) from public.adci_lessons lesson
        join public.adci_modules module on module.id = lesson.module_id
        join public.adci_courses course on course.id = module.course_id
        left join public.adci_live_classes live_class on live_class.lesson_id = lesson.id
        where course.organization_id = target_organization_id
          and lesson.lesson_type = 'live' and live_class.lesson_id is null
      )
    ),
    'classes', coalesce((
      select jsonb_agg(to_jsonb(class_row) order by class_row.starts_at)
      from (
        select
          lesson.id as lesson_id,
          lesson.title as lesson_title,
          module.title as module_title,
          course.id as course_id,
          course.title as course_title,
          course.status as course_status,
          offer.id as offer_id,
          live_class.provider,
          live_class.meeting_url,
          live_class.instructor_name,
          live_class.starts_at,
          live_class.ends_at,
          live_class.live_started_at,
          live_class.live_ended_at,
          public.adci_live_class_phase(live_class.starts_at, live_class.ends_at, live_class.live_started_at, live_class.live_ended_at) as status,
          count(distinct attendance.learner_id)::integer as attendance_count,
          coalesce(sum(attendance.join_count), 0)::integer as total_joins
        from public.adci_live_classes live_class
        join public.adci_lessons lesson on lesson.id = live_class.lesson_id
        join public.adci_modules module on module.id = lesson.module_id
        join public.adci_courses course on course.id = module.course_id
        left join public.adci_course_offers offer on offer.course_id = course.id
        left join public.adci_live_attendance attendance on attendance.lesson_id = lesson.id
        where course.organization_id = target_organization_id
          and live_class.starts_at >= now() - interval '30 days'
          and live_class.starts_at <= now() + make_interval(days => schedule_window)
        group by lesson.id, lesson.title, module.title, course.id, course.title,
          course.status, offer.id, live_class.provider, live_class.meeting_url,
          live_class.instructor_name, live_class.starts_at, live_class.ends_at,
          live_class.live_started_at, live_class.live_ended_at
      ) class_row
    ), '[]'::jsonb),
    'unscheduled_lessons', coalesce((
      select jsonb_agg(jsonb_build_object(
        'lesson_id', lesson.id,
        'lesson_title', lesson.title,
        'module_title', module.title,
        'course_id', course.id,
        'course_title', course.title,
        'course_status', course.status
      ) order by course.title, module.position, lesson.position)
      from public.adci_lessons lesson
      join public.adci_modules module on module.id = lesson.module_id
      join public.adci_courses course on course.id = module.course_id
      left join public.adci_live_classes live_class on live_class.lesson_id = lesson.id
      where course.organization_id = target_organization_id
        and lesson.lesson_type = 'live' and live_class.lesson_id is null
    ), '[]'::jsonb)
  );
end;
$$;

notify pgrst, 'reload schema';
commit;
