-- Real operational overview for the administration dashboard.
-- Safe to run more than once.

create or replace function public.adci_get_admin_dashboard()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare target_organization_id uuid; dashboard_payload jsonb;
begin
  select id into target_organization_id
  from public.adci_organizations where slug = 'adci';
  if not public.adci_current_user_has_role(
    target_organization_id,
    array['content_author','academic_lead','branch_admin','super_admin','support']::public.adci_app_role[]
  ) then raise exception 'Administration dashboard permission required'; end if;

  with
  organization_courses as (
    select c.id, c.title, c.status
    from public.adci_courses c
    where c.organization_id = target_organization_id and c.status <> 'retired'
  ),
  active_enrolments as (
    select e.learner_id, e.course_id, e.enrolled_at
    from public.adci_enrolments e
    join organization_courses c on c.id = e.course_id
    where e.status in ('active','completed')
      and (e.access_expires_at is null or e.access_expires_at > now())
  ),
  course_lessons as (
    select c.id as course_id, count(l.id)::integer as lesson_count
    from organization_courses c
    left join public.adci_modules m on m.course_id = c.id
    left join public.adci_lessons l on l.module_id = m.id
    group by c.id
  ),
  learner_course_progress as (
    select
      e.learner_id,
      e.course_id,
      lessons.lesson_count,
      count(distinct lp.lesson_id) filter (where lp.completed_at is not null)::integer as completed_lessons,
      max(lp.last_activity_at) as last_lesson_activity
    from active_enrolments e
    join course_lessons lessons on lessons.course_id = e.course_id
    left join public.adci_modules m on m.course_id = e.course_id
    left join public.adci_lessons l on l.module_id = m.id
    left join public.adci_lesson_progress lp
      on lp.lesson_id = l.id and lp.learner_id = e.learner_id
    group by e.learner_id, e.course_id, lessons.lesson_count
  ),
  learner_rows as (
    select
      progress.learner_id,
      sum(progress.lesson_count)::integer as total_lessons,
      sum(progress.completed_lessons)::integer as completed_lessons,
      max(progress.last_lesson_activity) as last_lesson_activity,
      (
        select max(coalesce(attempt.submitted_at, attempt.created_at))
        from public.adci_attempts attempt
        join public.adci_assessments assessment on assessment.id = attempt.assessment_id
        join organization_courses course_scope on course_scope.id = assessment.course_id
        where attempt.learner_id = progress.learner_id
      ) as last_attempt_activity
    from learner_course_progress progress
    group by progress.learner_id
  ),
  course_rows as (
    select
      c.id as course_id,
      c.title,
      c.status,
      lessons.lesson_count,
      count(progress.learner_id)::integer as enrolled_learners,
      coalesce(round(avg(
        case when progress.lesson_count = 0 then 0
        else progress.completed_lessons::numeric / progress.lesson_count * 100 end
      )), 0) as completion_percent,
      count(progress.learner_id) filter (
        where progress.last_lesson_activity >= now() - interval '7 days'
      )::integer as engaged_learners
    from organization_courses c
    join course_lessons lessons on lessons.course_id = c.id
    left join learner_course_progress progress on progress.course_id = c.id
    group by c.id, c.title, c.status, lessons.lesson_count
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'active_learners', (select count(*) from learner_rows),
      'live_attendance_today', (
        select count(distinct la.learner_id)
        from public.adci_live_attendance la
        join public.adci_lessons l on l.id = la.lesson_id
        join public.adci_modules m on m.id = l.module_id
        join organization_courses c on c.id = m.course_id
        where la.last_joined_at >= (current_date::timestamp at time zone 'Asia/Kolkata')
      ),
      'course_completion', coalesce((
        select round(avg(
          case when total_lessons = 0 then 0
          else completed_lessons::numeric / total_lessons * 100 end
        )) from learner_rows
      ), 0),
      'at_risk_learners', (
        select count(*) from learner_rows
        where greatest(last_lesson_activity, last_attempt_activity) is null
          or greatest(last_lesson_activity, last_attempt_activity) < now() - interval '7 days'
      ),
      'published_courses', (select count(*) from organization_courses where status = 'published')
    ),
    'engagement', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', activity_day,
        'label', upper(to_char(activity_day, 'Dy')),
        'enrolments', (
          select count(*) from active_enrolments e
          where e.enrolled_at >= (activity_day::timestamp at time zone 'Asia/Kolkata')
            and e.enrolled_at < ((activity_day + 1)::timestamp at time zone 'Asia/Kolkata')
        ),
        'activity', (
          select count(*) from public.adci_lesson_progress lp
          join public.adci_lessons l on l.id = lp.lesson_id
          join public.adci_modules m on m.id = l.module_id
          join organization_courses c on c.id = m.course_id
          where lp.last_activity_at >= (activity_day::timestamp at time zone 'Asia/Kolkata')
            and lp.last_activity_at < ((activity_day + 1)::timestamp at time zone 'Asia/Kolkata')
        ) + (
          select count(*) from public.adci_attempts attempt
          join public.adci_assessments assessment on assessment.id = attempt.assessment_id
          join organization_courses c on c.id = assessment.course_id
          where attempt.created_at >= (activity_day::timestamp at time zone 'Asia/Kolkata')
            and attempt.created_at < ((activity_day + 1)::timestamp at time zone 'Asia/Kolkata')
        )
      ) order by activity_day)
      from (
        select current_date - (6 - day_offset) as activity_day
        from generate_series(0, 6) as offsets(day_offset)
      ) activity
    ), '[]'::jsonb),
    'engagement_summary', jsonb_build_object(
      'new_enrolments', (
        select count(*) from active_enrolments where enrolled_at >= now() - interval '7 days'
      ),
      'learning_sessions', (
        select count(*) from public.adci_lesson_progress lp
        join public.adci_lessons l on l.id = lp.lesson_id
        join public.adci_modules m on m.id = l.module_id
        join organization_courses c on c.id = m.course_id
        where lp.last_activity_at >= now() - interval '7 days'
      ) + (
        select count(*) from public.adci_attempts attempt
        join public.adci_assessments assessment on assessment.id = attempt.assessment_id
        join organization_courses c on c.id = assessment.course_id
        where attempt.created_at >= now() - interval '7 days'
      ),
      'average_study_minutes', coalesce((
        select round(avg(
          case when lp.completed_at is not null
            then greatest(lp.position_seconds, l.duration_seconds)
            else lp.position_seconds end
        ) / 60)
        from public.adci_lesson_progress lp
        join public.adci_lessons l on l.id = lp.lesson_id
        join public.adci_modules m on m.id = l.module_id
        join organization_courses c on c.id = m.course_id
        where lp.last_activity_at >= now() - interval '7 days'
      ), 0)
    ),
    'attention', jsonb_build_object(
      'at_risk_learners', (
        select count(*) from learner_rows
        where greatest(last_lesson_activity, last_attempt_activity) is null
          or greatest(last_lesson_activity, last_attempt_activity) < now() - interval '7 days'
      ),
      'courses_in_review', (select count(*) from organization_courses where status = 'in_review'),
      'unscheduled_live_lessons', (
        select count(*) from public.adci_lessons l
        join public.adci_modules m on m.id = l.module_id
        join organization_courses c on c.id = m.course_id
        left join public.adci_live_classes lc on lc.lesson_id = l.id
        where l.lesson_type = 'live' and lc.lesson_id is null
      ),
      'empty_quizzes', (
        select count(*) from public.adci_assessments a
        join organization_courses c on c.id = a.course_id
        where a.status <> 'retired'
          and not exists (
            select 1 from public.adci_assessment_questions aq where aq.assessment_id = a.id
          )
      )
    ),
    'course_health', coalesce((
      select jsonb_agg(to_jsonb(course_rows) order by enrolled_learners desc, title)
      from course_rows
    ), '[]'::jsonb),
    'upcoming_classes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'lesson_id', l.id,
        'title', l.title,
        'course_title', c.title,
        'instructor_name', lc.instructor_name,
        'provider', lc.provider,
        'starts_at', lc.starts_at,
        'attendance_count', (
          select count(*) from public.adci_live_attendance la where la.lesson_id = l.id
        )
      ) order by lc.starts_at)
      from public.adci_live_classes lc
      join public.adci_lessons l on l.id = lc.lesson_id
      join public.adci_modules m on m.id = l.module_id
      join organization_courses c on c.id = m.course_id
      where lc.ends_at >= now()
        and lc.starts_at <= now() + interval '14 days'
      limit 5
    ), '[]'::jsonb),
    'recent_activity', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', audit.id,
        'action', audit.action,
        'entity_type', audit.entity_type,
        'actor_name', coalesce(nullif(trim(profile.full_name), ''), auth_user.email::text, 'System'),
        'created_at', audit.created_at
      ) order by audit.created_at desc)
      from (
        select * from public.adci_audit_events
        where organization_id = target_organization_id
        order by created_at desc limit 6
      ) audit
      left join public.adci_profiles profile on profile.id = audit.actor_id
      left join auth.users auth_user on auth_user.id = audit.actor_id
    ), '[]'::jsonb)
  )
  into dashboard_payload;

  return dashboard_payload;
end;
$$;

revoke all on function public.adci_get_admin_dashboard() from public;
grant execute on function public.adci_get_admin_dashboard() to authenticated;
