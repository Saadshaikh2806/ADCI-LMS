-- Real learner dashboard metrics and continue-learning data.
-- Safe to run more than once.

create or replace function public.adci_get_learner_dashboard()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  course_payload jsonb;
  continue_payload jsonb;
  upcoming_class_count integer;
  completed_test_count integer;
  due_assessment_count integer;
  correct_answer_count integer;
  answered_question_count integer;
  total_learning_seconds bigint;
  weekly_learning_seconds bigint;
  current_streak integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select coalesce(jsonb_agg(course_data order by enrolled_at desc), '[]'::jsonb)
  into course_payload
  from (
    select
      e.enrolled_at,
      jsonb_build_object(
        'id', c.id,
        'title', c.title,
        'slug', c.slug,
        'description', c.description,
        'lesson_count', (
          select count(*)
          from public.adci_modules m
          join public.adci_lessons l on l.module_id = m.id
          where m.course_id = c.id
        ),
        'completed_count', (
          select count(*)
          from public.adci_lesson_progress lp
          join public.adci_lessons l on l.id = lp.lesson_id
          join public.adci_modules m on m.id = l.module_id
          where m.course_id = c.id
            and lp.learner_id = auth.uid()
            and lp.completed_at is not null
        ),
        'next_lesson', (
          select jsonb_build_object(
            'id', l.id,
            'title', l.title,
            'lesson_type', l.lesson_type,
            'module_title', m.title,
            'duration_seconds', l.duration_seconds,
            'progress_percent', coalesce(lp.progress_percent, 0),
            'position_seconds', coalesce(lp.position_seconds, 0)
          )
          from public.adci_modules m
          join public.adci_lessons l on l.module_id = m.id
          left join public.adci_lesson_progress lp
            on lp.lesson_id = l.id and lp.learner_id = auth.uid()
          where m.course_id = c.id
            and lp.completed_at is null
          order by
            (lp.last_activity_at is not null) desc,
            lp.last_activity_at desc nulls last,
            m.position,
            l.position
          limit 1
        )
      ) as course_data
    from public.adci_enrolments e
    join public.adci_courses c on c.id = e.course_id
    where e.learner_id = auth.uid()
      and e.status in ('active', 'completed')
      and (e.access_expires_at is null or e.access_expires_at > now())
      and c.status = 'published'
  ) learner_courses;

  select jsonb_build_object(
    'course_id', c.id,
    'course_title', c.title,
    'course_slug', c.slug,
    'lesson_id', next_lesson.id,
    'lesson_title', next_lesson.title,
    'lesson_type', next_lesson.lesson_type,
    'module_title', next_lesson.module_title,
    'duration_seconds', next_lesson.duration_seconds,
    'progress_percent', next_lesson.progress_percent,
    'position_seconds', next_lesson.position_seconds
  )
  into continue_payload
  from public.adci_enrolments e
  join public.adci_courses c on c.id = e.course_id
  join lateral (
    select
      l.id,
      l.title,
      l.lesson_type,
      m.title as module_title,
      l.duration_seconds,
      coalesce(lp.progress_percent, 0) as progress_percent,
      coalesce(lp.position_seconds, 0) as position_seconds,
      lp.last_activity_at
    from public.adci_modules m
    join public.adci_lessons l on l.module_id = m.id
    left join public.adci_lesson_progress lp
      on lp.lesson_id = l.id and lp.learner_id = auth.uid()
    where m.course_id = c.id
      and lp.completed_at is null
    order by
      (lp.last_activity_at is not null) desc,
      lp.last_activity_at desc nulls last,
      m.position,
      l.position
    limit 1
  ) next_lesson on true
  where e.learner_id = auth.uid()
    and e.status in ('active', 'completed')
    and (e.access_expires_at is null or e.access_expires_at > now())
    and c.status = 'published'
  order by next_lesson.last_activity_at desc nulls last, e.enrolled_at desc
  limit 1;

  select count(*) into upcoming_class_count
  from public.adci_live_classes lc
  join public.adci_lessons l on l.id = lc.lesson_id
  join public.adci_modules m on m.id = l.module_id
  where lc.ends_at >= now()
    and lc.starts_at <= now() + interval '30 days'
    and public.adci_can_access_course(m.course_id);

  select count(*) into completed_test_count
  from public.adci_attempts a
  where a.learner_id = auth.uid()
    and a.status = 'scored';

  select count(*) into due_assessment_count
  from public.adci_assessments a
  where a.status = 'published'
    and public.adci_can_access_course(a.course_id)
    and (a.available_from is null or a.available_from <= now())
    and (a.available_until is null or a.available_until >= now())
    and not exists (
      select 1 from public.adci_attempts attempt
      where attempt.assessment_id = a.id
        and attempt.learner_id = auth.uid()
        and attempt.status = 'scored'
    );

  select
    count(*) filter (
      where (aa.answer->>'index')::integer = (q.correct_answer->>'index')::integer
    ),
    count(*)
  into correct_answer_count, answered_question_count
  from public.adci_attempt_answers aa
  join public.adci_attempts a on a.id = aa.attempt_id
  join public.adci_questions q on q.id = aa.question_id
  where a.learner_id = auth.uid()
    and a.status = 'scored';

  select
    coalesce(sum(
      case
        when lp.completed_at is not null
          then greatest(lp.position_seconds, l.duration_seconds)
        else lp.position_seconds
      end
    ), 0),
    coalesce(sum(
      case
        when lp.last_activity_at >= now() - interval '7 days' then
          case
            when lp.completed_at is not null
              then greatest(lp.position_seconds, l.duration_seconds)
            else lp.position_seconds
          end
        else 0
      end
    ), 0)
  into total_learning_seconds, weekly_learning_seconds
  from public.adci_lesson_progress lp
  join public.adci_lessons l on l.id = lp.lesson_id
  where lp.learner_id = auth.uid();

  with activity_days as (
    select distinct activity_day
    from (
      select lp.last_activity_at::date as activity_day
      from public.adci_lesson_progress lp
      where lp.learner_id = auth.uid()
      union
      select coalesce(a.submitted_at, a.created_at)::date
      from public.adci_attempts a
      where a.learner_id = auth.uid()
    ) learner_activity
  ),
  ordered_days as (
    select
      activity_day,
      row_number() over (order by activity_day desc) as sequence_number,
      max(activity_day) over () as latest_day
    from activity_days
  )
  select case
    when max(latest_day) < current_date - 1 then 0
    else count(*) filter (
      where activity_day = latest_day - (sequence_number - 1)::integer
    )
  end
  into current_streak
  from ordered_days;

  return jsonb_build_object(
    'courses', course_payload,
    'continue_lesson', continue_payload,
    'upcoming_live_count', coalesce(upcoming_class_count, 0),
    'tests_completed', coalesce(completed_test_count, 0),
    'assessments_due', coalesce(due_assessment_count, 0),
    'correct_answers', coalesce(correct_answer_count, 0),
    'answered_questions', coalesce(answered_question_count, 0),
    'accuracy_percent', case
      when coalesce(answered_question_count, 0) = 0 then 0
      else round(correct_answer_count::numeric / answered_question_count * 100)
    end,
    'learning_seconds', coalesce(total_learning_seconds, 0),
    'weekly_learning_seconds', coalesce(weekly_learning_seconds, 0),
    'streak_days', coalesce(current_streak, 0)
  );
end;
$$;

revoke all on function public.adci_get_learner_dashboard() from public;
grant execute on function public.adci_get_learner_dashboard() to authenticated;
