alter table public.adci_assessments
  add column if not exists lesson_id uuid unique references public.adci_lessons on delete cascade,
  add column if not exists pass_percent numeric(5,2) not null default 40 check (pass_percent between 0 and 100),
  add column if not exists max_attempts integer not null default 1 check (max_attempts > 0);

create policy "course members read published assessments"
on public.adci_assessments for select
using (status = 'published' and public.adci_can_access_course(course_id));

create policy "academic staff manage assessments"
on public.adci_assessments for all
using (
  public.adci_current_user_has_role(
    (select c.organization_id from public.adci_courses c where c.id = course_id),
    array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  )
)
with check (
  public.adci_current_user_has_role(
    (select c.organization_id from public.adci_courses c where c.id = course_id),
    array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  )
);

create policy "course members read published assessment questions"
on public.adci_assessment_questions for select
using (
  exists (
    select 1 from public.adci_assessments a
    where a.id = assessment_id
      and a.status = 'published'
      and public.adci_can_access_course(a.course_id)
  )
);

create policy "academic staff manage assessment questions"
on public.adci_assessment_questions for all
using (
  exists (
    select 1 from public.adci_assessments a
    join public.adci_courses c on c.id = a.course_id
    where a.id = assessment_id
      and public.adci_current_user_has_role(
        c.organization_id,
        array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
      )
  )
)
with check (
  exists (
    select 1 from public.adci_assessments a
    join public.adci_courses c on c.id = a.course_id
    where a.id = assessment_id
      and public.adci_current_user_has_role(
        c.organization_id,
        array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
      )
  )
);

create or replace function public.adci_save_quiz(
  target_lesson_id uuid,
  quiz_title text,
  quiz_duration_seconds integer,
  quiz_positive_marks numeric,
  quiz_negative_marks numeric,
  quiz_pass_percent numeric,
  quiz_status public.adci_content_status
)
returns public.adci_assessments
language plpgsql security definer set search_path = ''
as $$
declare
  course_record public.adci_courses;
  assessment_record public.adci_assessments;
begin
  select c.* into course_record
  from public.adci_lessons l
  join public.adci_modules m on m.id = l.module_id
  join public.adci_courses c on c.id = m.course_id
  where l.id = target_lesson_id and l.lesson_type = 'quiz';

  if course_record.id is null or not public.adci_current_user_has_role(
    course_record.organization_id,
    array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  ) then raise exception 'Quiz administration permission required'; end if;

  insert into public.adci_assessments (
    course_id, lesson_id, title, duration_seconds, positive_marks,
    negative_marks, pass_percent, status
  ) values (
    course_record.id, target_lesson_id, trim(quiz_title),
    greatest(60, quiz_duration_seconds), greatest(0, quiz_positive_marks),
    greatest(0, quiz_negative_marks), quiz_pass_percent, quiz_status
  )
  on conflict (lesson_id) do update set
    title = excluded.title,
    duration_seconds = excluded.duration_seconds,
    positive_marks = excluded.positive_marks,
    negative_marks = excluded.negative_marks,
    pass_percent = excluded.pass_percent,
    status = excluded.status
  returning * into assessment_record;

  if quiz_status = 'published' and not exists (
    select 1 from public.adci_assessment_questions aq
    where aq.assessment_id = assessment_record.id
  ) then
    raise exception 'Add at least one question before publishing the quiz';
  end if;

  return assessment_record;
end;
$$;

create or replace function public.adci_add_quiz_question(
  target_assessment_id uuid,
  question_prompt text,
  question_options jsonb,
  correct_option integer,
  question_explanation text default ''
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  target_organization_id uuid;
  question_id uuid;
  next_position integer;
begin
  select c.organization_id into target_organization_id
  from public.adci_assessments a join public.adci_courses c on c.id = a.course_id
  where a.id = target_assessment_id;

  if not public.adci_current_user_has_role(
    target_organization_id,
    array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  ) then raise exception 'Quiz administration permission required'; end if;

  if jsonb_array_length(question_options) < 2 or correct_option < 0
     or correct_option >= jsonb_array_length(question_options) then
    raise exception 'Provide at least two options and a valid correct answer';
  end if;
  if trim(question_prompt) = '' then raise exception 'Question prompt is required'; end if;

  insert into public.adci_questions (
    organization_id, prompt, options, correct_answer, explanation, created_by
  ) values (
    target_organization_id, trim(question_prompt), question_options,
    jsonb_build_object('index', correct_option), question_explanation, auth.uid()
  ) returning id into question_id;

  select coalesce(max(position), 0) + 1 into next_position
  from public.adci_assessment_questions where assessment_id = target_assessment_id;

  insert into public.adci_assessment_questions (assessment_id, question_id, position)
  values (target_assessment_id, question_id, next_position);
  return question_id;
end;
$$;

create or replace function public.adci_delete_quiz_question(target_assessment_id uuid, target_question_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare target_organization_id uuid;
begin
  select c.organization_id into target_organization_id
  from public.adci_assessments a join public.adci_courses c on c.id = a.course_id
  where a.id = target_assessment_id;
  if not public.adci_current_user_has_role(
    target_organization_id,
    array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  ) then raise exception 'Quiz administration permission required'; end if;
  delete from public.adci_assessment_questions
  where assessment_id = target_assessment_id and question_id = target_question_id;
  delete from public.adci_questions q where q.id = target_question_id
    and not exists (select 1 from public.adci_assessment_questions aq where aq.question_id = q.id);
end;
$$;

create or replace function public.adci_get_available_quizzes()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(quiz_data order by quiz_data->>'title'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', a.id,
      'title', a.title,
      'duration_seconds', a.duration_seconds,
      'positive_marks', a.positive_marks,
      'negative_marks', a.negative_marks,
      'pass_percent', a.pass_percent,
      'questions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', q.id,
          'prompt', q.prompt,
          'options', q.options,
          'position', aq.position
        ) order by aq.position)
        from public.adci_assessment_questions aq
        join public.adci_questions q on q.id = aq.question_id
        where aq.assessment_id = a.id
      ), '[]'::jsonb)
    ) quiz_data
    from public.adci_assessments a
    where a.status = 'published'
      and public.adci_can_access_course(a.course_id)
  ) available;
$$;

create or replace function public.adci_start_quiz_attempt(target_assessment_id uuid)
returns public.adci_attempts
language plpgsql security definer set search_path = ''
as $$
declare assessment_record public.adci_assessments; attempt_record public.adci_attempts;
begin
  select * into assessment_record from public.adci_assessments
  where id = target_assessment_id and status = 'published';
  if assessment_record.id is null or not public.adci_can_access_course(assessment_record.course_id)
  then raise exception 'Quiz is not available'; end if;
  if (select count(*) from public.adci_attempts where assessment_id = target_assessment_id
      and learner_id = auth.uid() and status in ('submitted','scored')) >= assessment_record.max_attempts
  then raise exception 'Maximum attempts reached'; end if;
  insert into public.adci_attempts (
    assessment_id, learner_id, status, server_started_at, server_deadline_at
  ) values (
    target_assessment_id, auth.uid(), 'in_progress', now(),
    now() + make_interval(secs => assessment_record.duration_seconds)
  ) returning * into attempt_record;
  return attempt_record;
end;
$$;

create or replace function public.adci_save_quiz_answer(
  target_attempt_id uuid, target_question_id uuid, answer_index integer, review_flag boolean default false
)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.adci_attempts a
    join public.adci_assessment_questions aq on aq.assessment_id = a.assessment_id
    where a.id = target_attempt_id and a.learner_id = auth.uid()
      and a.status = 'in_progress' and a.server_deadline_at > now()
      and aq.question_id = target_question_id
  ) then raise exception 'Attempt is not active'; end if;
  insert into public.adci_attempt_answers (attempt_id, question_id, answer, flagged, saved_at)
  values (target_attempt_id, target_question_id, jsonb_build_object('index', answer_index), review_flag, now())
  on conflict (attempt_id, question_id) do update set
    answer = excluded.answer, flagged = excluded.flagged, saved_at = now();
end;
$$;

create or replace function public.adci_submit_quiz_attempt(target_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  attempt_record public.adci_attempts;
  assessment_record public.adci_assessments;
  total_questions integer;
  correct_count integer;
  answered_count integer;
  final_score numeric;
  max_score numeric;
begin
  select * into attempt_record from public.adci_attempts
  where id = target_attempt_id and learner_id = auth.uid() and status = 'in_progress';
  if attempt_record.id is null then raise exception 'Attempt is not active'; end if;
  select * into assessment_record from public.adci_assessments where id = attempt_record.assessment_id;
  select count(*) into total_questions from public.adci_assessment_questions
  where assessment_id = assessment_record.id;
  select count(*) into answered_count from public.adci_attempt_answers where attempt_id = target_attempt_id;
  select count(*) into correct_count
  from public.adci_attempt_answers aa
  join public.adci_questions q on q.id = aa.question_id
  where aa.attempt_id = target_attempt_id
    and (aa.answer->>'index')::integer = (q.correct_answer->>'index')::integer;
  final_score := correct_count * assessment_record.positive_marks
    - (answered_count - correct_count) * assessment_record.negative_marks;
  max_score := total_questions * assessment_record.positive_marks;
  update public.adci_attempts set status = 'scored', submitted_at = now(), score = final_score
  where id = target_attempt_id;
  return jsonb_build_object(
    'score', final_score, 'max_score', max_score, 'correct', correct_count,
    'incorrect', answered_count - correct_count, 'unanswered', total_questions - answered_count,
    'passed', case when max_score = 0 then false else (final_score / max_score * 100) >= assessment_record.pass_percent end
  );
end;
$$;

revoke all on function public.adci_save_quiz(uuid,text,integer,numeric,numeric,numeric,public.adci_content_status) from public;
revoke all on function public.adci_add_quiz_question(uuid,text,jsonb,integer,text) from public;
revoke all on function public.adci_delete_quiz_question(uuid,uuid) from public;
revoke all on function public.adci_get_available_quizzes() from public;
revoke all on function public.adci_start_quiz_attempt(uuid) from public;
revoke all on function public.adci_save_quiz_answer(uuid,uuid,integer,boolean) from public;
revoke all on function public.adci_submit_quiz_attempt(uuid) from public;
grant execute on function public.adci_save_quiz(uuid,text,integer,numeric,numeric,numeric,public.adci_content_status) to authenticated;
grant execute on function public.adci_add_quiz_question(uuid,text,jsonb,integer,text) to authenticated;
grant execute on function public.adci_delete_quiz_question(uuid,uuid) to authenticated;
grant execute on function public.adci_get_available_quizzes() to authenticated;
grant execute on function public.adci_start_quiz_attempt(uuid) to authenticated;
grant execute on function public.adci_save_quiz_answer(uuid,uuid,integer,boolean) to authenticated;
grant execute on function public.adci_submit_quiz_attempt(uuid) to authenticated;
