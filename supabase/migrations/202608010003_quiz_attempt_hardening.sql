-- Make learner quiz attempts resumable, server-timed and safe to submit once.

alter table public.adci_attempts
  add column if not exists timed_out boolean not null default false;

-- Older clients could create more than one running attempt. Keep only the newest
-- one active before enforcing the invariant at database level.
with ranked_attempts as (
  select
    id,
    row_number() over (
      partition by assessment_id, learner_id
      order by server_started_at desc nulls last, created_at desc, id desc
    ) as attempt_rank
  from public.adci_attempts
  where status = 'in_progress'
)
update public.adci_attempts attempt
set
  status = 'void',
  submitted_at = coalesce(attempt.submitted_at, now())
from ranked_attempts ranked
where attempt.id = ranked.id
  and ranked.attempt_rank > 1;

create unique index if not exists adci_attempts_one_running_attempt_idx
  on public.adci_attempts (assessment_id, learner_id)
  where status = 'in_progress';

create or replace function public.adci_get_available_quizzes()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(quiz_data order by quiz_data->>'title'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', assessment.id,
      'title', assessment.title,
      'duration_seconds', assessment.duration_seconds,
      'positive_marks', assessment.positive_marks,
      'negative_marks', assessment.negative_marks,
      'pass_percent', assessment.pass_percent,
      'max_attempts', assessment.max_attempts,
      'questions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', question.id,
          'prompt', question.prompt,
          'options', question.options,
          'position', aq.position
        ) order by aq.position)
        from public.adci_assessment_questions aq
        join public.adci_questions question on question.id = aq.question_id
        where aq.assessment_id = assessment.id
      ), '[]'::jsonb)
    ) as quiz_data
    from public.adci_assessments assessment
    where assessment.status = 'published'
      and (assessment.available_from is null or assessment.available_from <= now())
      and (assessment.available_until is null or assessment.available_until >= now())
      and public.adci_can_access_course(assessment.course_id)
  ) available;
$$;

create or replace function public.adci_score_quiz_attempt(
  target_attempt_id uuid,
  force_timed_out boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt_record public.adci_attempts;
  assessment_record public.adci_assessments;
  total_questions integer;
  answered_count integer;
  correct_count integer;
  final_score numeric;
  max_score numeric;
  did_time_out boolean;
  attempts_used integer;
begin
  select * into attempt_record
  from public.adci_attempts
  where id = target_attempt_id
  for update;

  if attempt_record.id is null or attempt_record.status not in ('in_progress', 'scored') then
    raise exception 'Attempt cannot be scored';
  end if;

  select * into assessment_record
  from public.adci_assessments
  where id = attempt_record.assessment_id;

  select count(*)::integer into total_questions
  from public.adci_assessment_questions aq
  where aq.assessment_id = assessment_record.id;

  select count(*)::integer into answered_count
  from public.adci_assessment_questions aq
  join public.adci_attempt_answers answer
    on answer.attempt_id = attempt_record.id
   and answer.question_id = aq.question_id
  where aq.assessment_id = assessment_record.id
    and answer.answer ? 'index'
    and answer.answer->>'index' is not null;

  select count(*)::integer into correct_count
  from public.adci_assessment_questions aq
  join public.adci_attempt_answers answer
    on answer.attempt_id = attempt_record.id
   and answer.question_id = aq.question_id
  join public.adci_questions question on question.id = aq.question_id
  where aq.assessment_id = assessment_record.id
    and answer.answer ? 'index'
    and answer.answer->>'index' = question.correct_answer->>'index';

  final_score := correct_count * assessment_record.positive_marks
    - (answered_count - correct_count) * assessment_record.negative_marks;
  max_score := total_questions * assessment_record.positive_marks;
  did_time_out := force_timed_out
    or attempt_record.timed_out
    or (
      attempt_record.server_deadline_at is not null
      and now() >= attempt_record.server_deadline_at
    );

  if attempt_record.status = 'in_progress' then
    update public.adci_attempts
    set
      status = 'scored',
      submitted_at = now(),
      score = final_score,
      timed_out = did_time_out
    where id = attempt_record.id
    returning * into attempt_record;
  end if;

  select count(*)::integer into attempts_used
  from public.adci_attempts
  where assessment_id = assessment_record.id
    and learner_id = attempt_record.learner_id
    and status in ('submitted', 'scored');

  return jsonb_build_object(
    'attempt_id', attempt_record.id,
    'score', coalesce(attempt_record.score, final_score),
    'max_score', max_score,
    'correct', correct_count,
    'incorrect', answered_count - correct_count,
    'unanswered', greatest(0, total_questions - answered_count),
    'passed', case
      when max_score = 0 then false
      else (coalesce(attempt_record.score, final_score) / max_score * 100) >= assessment_record.pass_percent
    end,
    'timed_out', attempt_record.timed_out or did_time_out,
    'submitted_at', attempt_record.submitted_at,
    'attempts_used', attempts_used,
    'max_attempts', assessment_record.max_attempts
  );
end;
$$;

create or replace function public.adci_get_quiz_attempt_state(target_assessment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  assessment_record public.adci_assessments;
  active_attempt public.adci_attempts;
  latest_attempt public.adci_attempts;
  expired_result jsonb;
  latest_result jsonb;
  saved_answers jsonb := '[]'::jsonb;
  attempts_used integer;
begin
  select * into assessment_record
  from public.adci_assessments
  where id = target_assessment_id
    and status = 'published'
    and (available_from is null or available_from <= now())
    and (available_until is null or available_until >= now());

  if assessment_record.id is null
     or not public.adci_can_access_course(assessment_record.course_id) then
    raise exception 'Quiz is not available';
  end if;

  select * into active_attempt
  from public.adci_attempts
  where assessment_id = target_assessment_id
    and learner_id = auth.uid()
    and status = 'in_progress'
  order by created_at desc
  limit 1
  for update;

  if active_attempt.id is not null
     and active_attempt.server_deadline_at is not null
     and active_attempt.server_deadline_at <= now() then
    expired_result := public.adci_score_quiz_attempt(active_attempt.id, true);
    active_attempt.id := null;
  end if;

  if active_attempt.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'question_id', aq.question_id,
      'answer_index', case
        when answer.answer ? 'index' then (answer.answer->>'index')::integer
        else null
      end,
      'flagged', coalesce(answer.flagged, false),
      'saved_at', answer.saved_at
    ) order by aq.position), '[]'::jsonb)
    into saved_answers
    from public.adci_assessment_questions aq
    left join public.adci_attempt_answers answer
      on answer.attempt_id = active_attempt.id
     and answer.question_id = aq.question_id
    where aq.assessment_id = target_assessment_id;
  end if;

  select count(*)::integer into attempts_used
  from public.adci_attempts
  where assessment_id = target_assessment_id
    and learner_id = auth.uid()
    and status in ('submitted', 'scored');

  select * into latest_attempt
  from public.adci_attempts
  where assessment_id = target_assessment_id
    and learner_id = auth.uid()
    and status = 'scored'
  order by submitted_at desc nulls last, created_at desc
  limit 1;

  if latest_attempt.id is not null then
    latest_result := public.adci_score_quiz_attempt(latest_attempt.id, latest_attempt.timed_out);
  end if;

  return jsonb_build_object(
    'server_now', now(),
    'attempts_used', attempts_used,
    'max_attempts', assessment_record.max_attempts,
    'can_start', attempts_used < assessment_record.max_attempts,
    'active_attempt', case when active_attempt.id is null then null else jsonb_build_object(
      'id', active_attempt.id,
      'server_started_at', active_attempt.server_started_at,
      'server_deadline_at', active_attempt.server_deadline_at,
      'answers', saved_answers
    ) end,
    'expired_result', expired_result,
    'latest_result', latest_result
  );
end;
$$;

create or replace function public.adci_start_quiz_attempt(target_assessment_id uuid)
returns public.adci_attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  assessment_record public.adci_assessments;
  attempt_record public.adci_attempts;
  completed_attempts integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in to start a quiz';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(auth.uid()::text || ':' || target_assessment_id::text, 0)
  );

  select * into assessment_record
  from public.adci_assessments
  where id = target_assessment_id
    and status = 'published'
    and (available_from is null or available_from <= now())
    and (available_until is null or available_until >= now());

  if assessment_record.id is null
     or not public.adci_can_access_course(assessment_record.course_id) then
    raise exception 'Quiz is not available';
  end if;

  select * into attempt_record
  from public.adci_attempts
  where assessment_id = target_assessment_id
    and learner_id = auth.uid()
    and status = 'in_progress'
  order by created_at desc
  limit 1
  for update;

  if attempt_record.id is not null then
    if attempt_record.server_deadline_at > now() then
      return attempt_record;
    end if;
    perform public.adci_score_quiz_attempt(attempt_record.id, true);
  end if;

  select count(*)::integer into completed_attempts
  from public.adci_attempts
  where assessment_id = target_assessment_id
    and learner_id = auth.uid()
    and status in ('submitted', 'scored');

  if completed_attempts >= assessment_record.max_attempts then
    raise exception 'Maximum attempts reached';
  end if;

  insert into public.adci_attempts (
    assessment_id,
    learner_id,
    status,
    server_started_at,
    server_deadline_at
  ) values (
    target_assessment_id,
    auth.uid(),
    'in_progress',
    now(),
    now() + make_interval(secs => assessment_record.duration_seconds)
  )
  returning * into attempt_record;

  return attempt_record;
end;
$$;

create or replace function public.adci_save_quiz_answer(
  target_attempt_id uuid,
  target_question_id uuid,
  answer_index integer,
  review_flag boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  question_options jsonb;
begin
  select question.options into question_options
  from public.adci_attempts attempt
  join public.adci_assessment_questions aq
    on aq.assessment_id = attempt.assessment_id
   and aq.question_id = target_question_id
  join public.adci_questions question on question.id = aq.question_id
  where attempt.id = target_attempt_id
    and attempt.learner_id = auth.uid()
    and attempt.status = 'in_progress'
    and attempt.server_deadline_at > now();

  if question_options is null then
    raise exception 'Attempt is not active';
  end if;

  if jsonb_typeof(question_options) <> 'array'
     or answer_index < 0
     or answer_index >= jsonb_array_length(question_options) then
    raise exception 'Select a valid answer';
  end if;

  insert into public.adci_attempt_answers (
    attempt_id,
    question_id,
    answer,
    flagged,
    saved_at
  ) values (
    target_attempt_id,
    target_question_id,
    jsonb_build_object('index', answer_index),
    review_flag,
    now()
  )
  on conflict (attempt_id, question_id) do update set
    answer = excluded.answer,
    flagged = excluded.flagged,
    saved_at = now();
end;
$$;

create or replace function public.adci_save_quiz_flag(
  target_attempt_id uuid,
  target_question_id uuid,
  review_flag boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.adci_attempts attempt
    join public.adci_assessment_questions aq
      on aq.assessment_id = attempt.assessment_id
     and aq.question_id = target_question_id
    where attempt.id = target_attempt_id
      and attempt.learner_id = auth.uid()
      and attempt.status = 'in_progress'
      and attempt.server_deadline_at > now()
  ) then
    raise exception 'Attempt is not active';
  end if;

  insert into public.adci_attempt_answers (
    attempt_id,
    question_id,
    answer,
    flagged,
    saved_at
  ) values (
    target_attempt_id,
    target_question_id,
    null,
    review_flag,
    now()
  )
  on conflict (attempt_id, question_id) do update set
    flagged = excluded.flagged,
    saved_at = now();
end;
$$;

create or replace function public.adci_submit_quiz_attempt(target_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt_record public.adci_attempts;
begin
  select * into attempt_record
  from public.adci_attempts
  where id = target_attempt_id
    and learner_id = auth.uid()
    and status in ('in_progress', 'scored')
  for update;

  if attempt_record.id is null then
    raise exception 'Attempt is not available';
  end if;

  return public.adci_score_quiz_attempt(
    attempt_record.id,
    attempt_record.server_deadline_at is not null
      and now() >= attempt_record.server_deadline_at
  );
end;
$$;

revoke all on function public.adci_score_quiz_attempt(uuid, boolean) from public;
revoke all on function public.adci_get_quiz_attempt_state(uuid) from public;
revoke all on function public.adci_start_quiz_attempt(uuid) from public;
revoke all on function public.adci_save_quiz_answer(uuid, uuid, integer, boolean) from public;
revoke all on function public.adci_save_quiz_flag(uuid, uuid, boolean) from public;
revoke all on function public.adci_submit_quiz_attempt(uuid) from public;

grant execute on function public.adci_get_quiz_attempt_state(uuid) to authenticated;
grant execute on function public.adci_start_quiz_attempt(uuid) to authenticated;
grant execute on function public.adci_save_quiz_answer(uuid, uuid, integer, boolean) to authenticated;
grant execute on function public.adci_save_quiz_flag(uuid, uuid, boolean) to authenticated;
grant execute on function public.adci_submit_quiz_attempt(uuid) to authenticated;
