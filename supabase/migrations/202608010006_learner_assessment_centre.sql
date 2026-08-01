-- Learner assessment catalogue with attempt, score and resume state.

create or replace function public.adci_get_my_assessment_centre()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  expired_attempt record;
  assessment_payload jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in to view assessments';
  end if;

  -- A learner returning after the deadline should see a completed timed-out
  -- attempt rather than a permanently running quiz.
  for expired_attempt in
    select attempt.id
    from public.adci_attempts attempt
    join public.adci_assessments assessment on assessment.id = attempt.assessment_id
    where attempt.learner_id = auth.uid()
      and attempt.status = 'in_progress'
      and attempt.server_deadline_at <= now()
      and public.adci_can_access_course(assessment.course_id)
    for update of attempt
  loop
    perform public.adci_score_quiz_attempt(expired_attempt.id, true);
  end loop;

  with accessible_assessments as (
    select
      assessment.*,
      course.title as course_title,
      lesson.title as lesson_title,
      module.title as module_title,
      (assessment.available_from is null or assessment.available_from <= now())
        and (assessment.available_until is null or assessment.available_until >= now()) as is_open
    from public.adci_assessments assessment
    join public.adci_courses course on course.id = assessment.course_id
    left join public.adci_lessons lesson on lesson.id = assessment.lesson_id
    left join public.adci_modules module on module.id = lesson.module_id
    where assessment.status = 'published'
      and course.status = 'published'
      and public.adci_can_access_course(assessment.course_id)
      and (
        (
          (assessment.available_from is null or assessment.available_from <= now())
          and (assessment.available_until is null or assessment.available_until >= now())
        )
        or exists (
          select 1 from public.adci_attempts previous_attempt
          where previous_attempt.assessment_id = assessment.id
            and previous_attempt.learner_id = auth.uid()
        )
      )
  ),
  question_counts as (
    select aq.assessment_id, count(*)::integer as question_count
    from public.adci_assessment_questions aq
    join accessible_assessments assessment on assessment.id = aq.assessment_id
    group by aq.assessment_id
  ),
  attempt_counts as (
    select
      attempt.assessment_id,
      count(*) filter (where attempt.status in ('submitted', 'scored'))::integer as attempts_used
    from public.adci_attempts attempt
    join accessible_assessments assessment on assessment.id = attempt.assessment_id
    where attempt.learner_id = auth.uid()
    group by attempt.assessment_id
  ),
  active_attempts as (
    select distinct on (attempt.assessment_id)
      attempt.assessment_id,
      attempt.id,
      attempt.server_started_at,
      attempt.server_deadline_at
    from public.adci_attempts attempt
    join accessible_assessments assessment on assessment.id = attempt.assessment_id
    where attempt.learner_id = auth.uid()
      and attempt.status = 'in_progress'
      and attempt.server_deadline_at > now()
    order by attempt.assessment_id, attempt.created_at desc
  ),
  latest_attempts as (
    select distinct on (attempt.assessment_id)
      attempt.assessment_id,
      attempt.id,
      attempt.score,
      attempt.timed_out,
      attempt.submitted_at
    from public.adci_attempts attempt
    join accessible_assessments assessment on assessment.id = attempt.assessment_id
    where attempt.learner_id = auth.uid()
      and attempt.status = 'scored'
    order by attempt.assessment_id, attempt.submitted_at desc nulls last, attempt.created_at desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', assessment.id,
    'title', assessment.title,
    'course_id', assessment.course_id,
    'course_title', assessment.course_title,
    'lesson_id', assessment.lesson_id,
    'lesson_title', assessment.lesson_title,
    'module_title', assessment.module_title,
    'duration_seconds', assessment.duration_seconds,
    'positive_marks', assessment.positive_marks,
    'negative_marks', assessment.negative_marks,
    'pass_percent', assessment.pass_percent,
    'max_attempts', assessment.max_attempts,
    'attempts_used', coalesce(attempt_count.attempts_used, 0),
    'attempts_remaining', greatest(0, assessment.max_attempts - coalesce(attempt_count.attempts_used, 0)),
    'question_count', coalesce(question_count.question_count, 0),
    'max_score', coalesce(question_count.question_count, 0) * assessment.positive_marks,
    'available_until', assessment.available_until,
    'state', case
      when active_attempt.id is not null then 'in_progress'
      when latest_attempt.id is not null then 'completed'
      else 'available'
    end,
    'can_start', assessment.is_open
      and active_attempt.id is null
      and coalesce(attempt_count.attempts_used, 0) < assessment.max_attempts,
    'active_attempt_id', active_attempt.id,
    'server_deadline_at', active_attempt.server_deadline_at,
    'latest_attempt_id', latest_attempt.id,
    'latest_score', latest_attempt.score,
    'latest_submitted_at', latest_attempt.submitted_at,
    'latest_timed_out', coalesce(latest_attempt.timed_out, false),
    'passed', case
      when latest_attempt.id is null
        or coalesce(question_count.question_count, 0) * assessment.positive_marks = 0 then false
      else latest_attempt.score / (question_count.question_count * assessment.positive_marks) * 100 >= assessment.pass_percent
    end
  ) order by
    case when active_attempt.id is not null then 0 when latest_attempt.id is null then 1 else 2 end,
    assessment.available_until nulls last,
    lower(assessment.title)
  ), '[]'::jsonb)
  into assessment_payload
  from accessible_assessments assessment
  left join question_counts question_count on question_count.assessment_id = assessment.id
  left join attempt_counts attempt_count on attempt_count.assessment_id = assessment.id
  left join active_attempts active_attempt on active_attempt.assessment_id = assessment.id
  left join latest_attempts latest_attempt on latest_attempt.assessment_id = assessment.id;

  return assessment_payload;
end;
$$;

revoke all on function public.adci_get_my_assessment_centre() from public;
grant execute on function public.adci_get_my_assessment_centre() to authenticated;
