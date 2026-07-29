-- Role-protected institution, course and learner performance reporting.
-- Safe to run more than once.

create or replace function public.adci_get_admin_learning_report(target_days integer default 30)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  target_organization_id uuid;
  report_window integer;
  report_payload jsonb;
begin
  select o.id into target_organization_id
  from public.adci_organizations o
  where o.slug = 'adci';

  if not public.adci_current_user_has_role(
    target_organization_id,
    array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  ) then
    raise exception 'Reporting permission required';
  end if;

  report_window := greatest(7, least(365, target_days));

  with
  organization_courses as (
    select c.id, c.title, c.slug, c.status
    from public.adci_courses c
    where c.organization_id = target_organization_id
      and c.status <> 'retired'
  ),
  active_enrolments as (
    select e.learner_id, e.course_id, e.status, e.enrolled_at
    from public.adci_enrolments e
    join organization_courses c on c.id = e.course_id
    where e.status in ('active', 'completed')
      and (e.access_expires_at is null or e.access_expires_at > now())
  ),
  course_lessons as (
    select c.id as course_id, count(l.id)::integer as lesson_count
    from organization_courses c
    left join public.adci_modules m on m.course_id = c.id
    left join public.adci_lessons l on l.module_id = m.id
    group by c.id
  ),
  learner_lesson_totals as (
    select
      e.learner_id,
      count(distinct e.course_id)::integer as courses_enrolled,
      count(distinct l.id)::integer as total_lessons,
      count(distinct lp.lesson_id) filter (where lp.completed_at is not null)::integer as lessons_completed,
      max(lp.last_activity_at) as last_lesson_activity,
      coalesce(sum(
        case
          when lp.last_activity_at < now() - make_interval(days => report_window) then 0
          when lp.completed_at is not null then greatest(lp.position_seconds, l.duration_seconds)
          else lp.position_seconds
        end
      ), 0)::bigint as learning_seconds
    from active_enrolments e
    left join public.adci_modules m on m.course_id = e.course_id
    left join public.adci_lessons l on l.module_id = m.id
    left join public.adci_lesson_progress lp
      on lp.lesson_id = l.id and lp.learner_id = e.learner_id
    group by e.learner_id
  ),
  learner_attempt_totals as (
    select
      e.learner_id,
      count(distinct a.id) filter (where a.status = 'scored' and c.id is not null)::integer as tests_completed,
      count(aa.question_id)::integer as answered_questions,
      count(aa.question_id) filter (
        where (aa.answer->>'index')::integer = (q.correct_answer->>'index')::integer
      )::integer as correct_answers,
      max(coalesce(a.submitted_at, a.created_at)) filter (where c.id is not null) as last_attempt_activity
    from (select distinct learner_id from active_enrolments) e
    left join public.adci_attempts a
      on a.learner_id = e.learner_id
      and a.created_at >= now() - make_interval(days => report_window)
    left join public.adci_assessments assessment on assessment.id = a.assessment_id
    left join organization_courses c on c.id = assessment.course_id
    left join public.adci_attempt_answers aa on aa.attempt_id = a.id and c.id is not null
    left join public.adci_questions q on q.id = aa.question_id
    group by e.learner_id
  ),
  learner_rows as (
    select
      p.id as learner_id,
      coalesce(nullif(trim(p.full_name), ''), split_part(u.email::text, '@', 1)) as full_name,
      u.email::text as email,
      totals.courses_enrolled,
      totals.total_lessons,
      totals.lessons_completed,
      case
        when totals.total_lessons = 0 then 0
        else round(totals.lessons_completed::numeric / totals.total_lessons * 100)
      end as progress_percent,
      totals.learning_seconds,
      coalesce(attempts.tests_completed, 0) as tests_completed,
      coalesce(attempts.answered_questions, 0) as answered_questions,
      coalesce(attempts.correct_answers, 0) as correct_answers,
      case
        when coalesce(attempts.answered_questions, 0) = 0 then 0
        else round(attempts.correct_answers::numeric / attempts.answered_questions * 100)
      end as accuracy_percent,
      greatest(totals.last_lesson_activity, attempts.last_attempt_activity) as last_activity,
      case
        when greatest(totals.last_lesson_activity, attempts.last_attempt_activity) is null then 'not_started'
        when greatest(totals.last_lesson_activity, attempts.last_attempt_activity) < now() - interval '7 days' then 'at_risk'
        when totals.total_lessons > 0
          and totals.lessons_completed::numeric / totals.total_lessons >= 0.9 then 'nearly_complete'
        else 'active'
      end as engagement_status
    from learner_lesson_totals totals
    join public.adci_profiles p on p.id = totals.learner_id
    join auth.users u on u.id = p.id
    left join learner_attempt_totals attempts on attempts.learner_id = totals.learner_id
  ),
  course_learner_progress as (
    select
      e.course_id,
      e.learner_id,
      count(distinct l.id)::integer as total_lessons,
      count(distinct lp.lesson_id) filter (where lp.completed_at is not null)::integer as completed_lessons,
      max(lp.last_activity_at) as last_activity
    from active_enrolments e
    left join public.adci_modules m on m.course_id = e.course_id
    left join public.adci_lessons l on l.module_id = m.id
    left join public.adci_lesson_progress lp
      on lp.lesson_id = l.id and lp.learner_id = e.learner_id
    group by e.course_id, e.learner_id
  ),
  course_attempt_totals as (
    select
      a.course_id,
      count(distinct attempt.id) filter (where attempt.status = 'scored')::integer as attempts_completed,
      count(answer.question_id)::integer as answered_questions,
      count(answer.question_id) filter (
        where (answer.answer->>'index')::integer = (q.correct_answer->>'index')::integer
      )::integer as correct_answers
    from public.adci_assessments a
    join organization_courses c on c.id = a.course_id
    left join public.adci_attempts attempt
      on attempt.assessment_id = a.id
      and attempt.created_at >= now() - make_interval(days => report_window)
    left join public.adci_attempt_answers answer on answer.attempt_id = attempt.id
    left join public.adci_questions q on q.id = answer.question_id
    group by a.course_id
  ),
  course_rows as (
    select
      c.id as course_id,
      c.title,
      c.slug,
      c.status,
      lessons.lesson_count,
      count(progress.learner_id)::integer as enrolled_learners,
      count(progress.learner_id) filter (
        where progress.last_activity >= now() - make_interval(days => report_window)
      )::integer as engaged_learners,
      coalesce(round(avg(
        case
          when progress.total_lessons = 0 then 0
          else progress.completed_lessons::numeric / progress.total_lessons * 100
        end
      )), 0) as average_progress,
      coalesce(attempts.attempts_completed, 0) as attempts_completed,
      case
        when coalesce(attempts.answered_questions, 0) = 0 then 0
        else round(attempts.correct_answers::numeric / attempts.answered_questions * 100)
      end as accuracy_percent
    from organization_courses c
    join course_lessons lessons on lessons.course_id = c.id
    left join course_learner_progress progress on progress.course_id = c.id
    left join course_attempt_totals attempts on attempts.course_id = c.id
    group by
      c.id, c.title, c.slug, c.status, lessons.lesson_count,
      attempts.attempts_completed, attempts.answered_questions, attempts.correct_answers
  )
  select jsonb_build_object(
    'range_days', report_window,
    'generated_at', now(),
    'summary', jsonb_build_object(
      'active_learners', (select count(*) from learner_rows),
      'at_risk_learners', (
        select count(*) from learner_rows
        where engagement_status in ('at_risk', 'not_started')
      ),
      'average_completion', coalesce((select round(avg(progress_percent)) from learner_rows), 0),
      'average_accuracy', case
        when coalesce((select sum(answered_questions) from learner_rows), 0) = 0 then 0
        else round(
          (select sum(correct_answers) from learner_rows)::numeric
          / (select sum(answered_questions) from learner_rows) * 100
        )
      end,
      'learning_hours', coalesce(round((select sum(learning_seconds) from learner_rows)::numeric / 3600, 1), 0),
      'tests_completed', coalesce((select sum(tests_completed) from learner_rows), 0),
      'published_courses', (select count(*) from organization_courses where status = 'published')
    ),
    'courses', coalesce((
      select jsonb_agg(to_jsonb(course_rows) order by enrolled_learners desc, title)
      from course_rows
    ), '[]'::jsonb),
    'learners', coalesce((
      select jsonb_agg(to_jsonb(learner_rows) order by
        case engagement_status
          when 'at_risk' then 1
          when 'not_started' then 2
          else 3
        end,
        full_name
      )
      from learner_rows
    ), '[]'::jsonb)
  )
  into report_payload;

  return report_payload;
end;
$$;

revoke all on function public.adci_get_admin_learning_report(integer) from public;
grant execute on function public.adci_get_admin_learning_report(integer) to authenticated;
