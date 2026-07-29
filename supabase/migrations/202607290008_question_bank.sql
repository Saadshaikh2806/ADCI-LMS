-- Reusable question bank and quiz assignment operations.
-- Safe to run more than once.

create or replace function public.adci_admin_get_question_bank()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare target_organization_id uuid;
begin
  select id into target_organization_id
  from public.adci_organizations where slug = 'adci';
  if not public.adci_current_user_has_role(
    target_organization_id,
    array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  ) then raise exception 'Question bank permission required'; end if;

  return jsonb_build_object(
    'summary', jsonb_build_object(
      'total', (select count(*) from public.adci_questions where organization_id = target_organization_id),
      'used', (
        select count(*) from public.adci_questions q where q.organization_id = target_organization_id
          and exists (select 1 from public.adci_assessment_questions aq where aq.question_id = q.id)
      ),
      'unused', (
        select count(*) from public.adci_questions q where q.organization_id = target_organization_id
          and not exists (select 1 from public.adci_assessment_questions aq where aq.question_id = q.id)
      ),
      'topics', (
        select count(distinct nullif(trim(topic), ''))
        from public.adci_questions where organization_id = target_organization_id
      )
    ),
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id,
        'prompt', q.prompt,
        'options', q.options,
        'correct_option', (q.correct_answer->>'index')::integer,
        'explanation', coalesce(q.explanation, ''),
        'topic', coalesce(q.topic, ''),
        'difficulty', coalesce(q.difficulty, 'medium'),
        'version', q.version,
        'created_at', q.created_at,
        'usage_count', (select count(*) from public.adci_assessment_questions aq where aq.question_id = q.id),
        'locked', exists (select 1 from public.adci_attempt_answers aa where aa.question_id = q.id),
        'assessments', coalesce((
          select jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title) order by a.title)
          from public.adci_assessment_questions aq
          join public.adci_assessments a on a.id = aq.assessment_id
          where aq.question_id = q.id
        ), '[]'::jsonb)
      ) order by q.created_at desc)
      from public.adci_questions q
      where q.organization_id = target_organization_id
    ), '[]'::jsonb),
    'assessments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'title', a.title,
        'status', a.status,
        'course_title', c.title,
        'question_count', (select count(*) from public.adci_assessment_questions aq where aq.assessment_id = a.id)
      ) order by c.title, a.title)
      from public.adci_assessments a
      join public.adci_courses c on c.id = a.course_id
      where c.organization_id = target_organization_id
        and a.status <> 'retired'
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.adci_admin_save_bank_question(
  target_question_id uuid,
  question_prompt text,
  question_options jsonb,
  correct_option integer,
  question_explanation text default '',
  question_topic text default '',
  question_difficulty text default 'medium'
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare target_organization_id uuid; saved_question_id uuid; clean_difficulty text;
begin
  select id into target_organization_id
  from public.adci_organizations where slug = 'adci';
  if not public.adci_current_user_has_role(
    target_organization_id,
    array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  ) then raise exception 'Question bank permission required'; end if;

  if trim(question_prompt) = '' then raise exception 'Question prompt is required'; end if;
  if question_options is null
     or jsonb_typeof(question_options) <> 'array'
     or jsonb_array_length(question_options) < 2
     or jsonb_array_length(question_options) > 6
     or correct_option is null
     or correct_option < 0
     or correct_option >= jsonb_array_length(question_options)
  then raise exception 'Provide 2 to 6 options and a valid correct answer'; end if;
  if exists (
    select 1 from jsonb_array_elements_text(question_options) as option_values(option_value)
    where trim(option_value) = ''
  ) then raise exception 'Question options cannot be empty'; end if;

  clean_difficulty := lower(coalesce(nullif(trim(question_difficulty), ''), 'medium'));
  if clean_difficulty not in ('easy','medium','hard')
  then raise exception 'Difficulty must be easy, medium or hard'; end if;

  if target_question_id is null then
    insert into public.adci_questions (
      organization_id, prompt, options, correct_answer, explanation,
      topic, difficulty, created_by
    ) values (
      target_organization_id, trim(question_prompt), question_options,
      jsonb_build_object('index', correct_option), nullif(trim(question_explanation), ''),
      nullif(trim(question_topic), ''), clean_difficulty, auth.uid()
    ) returning id into saved_question_id;
  else
    if exists (select 1 from public.adci_attempt_answers where question_id = target_question_id)
    then raise exception 'Answered questions are locked. Create a new question instead'; end if;

    update public.adci_questions
    set prompt = trim(question_prompt),
        options = question_options,
        correct_answer = jsonb_build_object('index', correct_option),
        explanation = nullif(trim(question_explanation), ''),
        topic = nullif(trim(question_topic), ''),
        difficulty = clean_difficulty,
        version = version + 1
    where id = target_question_id and organization_id = target_organization_id
    returning id into saved_question_id;
    if saved_question_id is null then raise exception 'Question not found'; end if;
  end if;

  return saved_question_id;
end;
$$;

create or replace function public.adci_admin_attach_bank_question(
  target_question_id uuid,
  target_assessment_id uuid
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare target_organization_id uuid; next_position integer;
begin
  select c.organization_id into target_organization_id
  from public.adci_assessments a join public.adci_courses c on c.id = a.course_id
  where a.id = target_assessment_id;
  if not public.adci_current_user_has_role(
    target_organization_id,
    array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  ) or not exists (
    select 1 from public.adci_questions q
    where q.id = target_question_id and q.organization_id = target_organization_id
  ) then raise exception 'Quiz assignment permission required'; end if;

  if exists (
    select 1 from public.adci_assessment_questions
    where assessment_id = target_assessment_id and question_id = target_question_id
  ) then raise exception 'This question is already assigned to the quiz'; end if;

  select coalesce(max(position), 0) + 1 into next_position
  from public.adci_assessment_questions where assessment_id = target_assessment_id;
  insert into public.adci_assessment_questions (assessment_id, question_id, position)
  values (target_assessment_id, target_question_id, next_position);
end;
$$;

create or replace function public.adci_admin_delete_bank_question(target_question_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare target_organization_id uuid;
begin
  select organization_id into target_organization_id
  from public.adci_questions where id = target_question_id;
  if not public.adci_current_user_has_role(
    target_organization_id,
    array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  ) then raise exception 'Question bank permission required'; end if;
  if exists (select 1 from public.adci_assessment_questions where question_id = target_question_id)
     or exists (select 1 from public.adci_attempt_answers where question_id = target_question_id)
  then raise exception 'Remove this question from every quiz before deleting it'; end if;
  delete from public.adci_questions where id = target_question_id;
end;
$$;

create or replace function public.adci_delete_quiz_question(
  target_assessment_id uuid,
  target_question_id uuid
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare target_organization_id uuid;
begin
  select c.organization_id into target_organization_id
  from public.adci_assessments a
  join public.adci_courses c on c.id = a.course_id
  where a.id = target_assessment_id;
  if not public.adci_current_user_has_role(
    target_organization_id,
    array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  ) then raise exception 'Quiz administration permission required'; end if;

  delete from public.adci_assessment_questions
  where assessment_id = target_assessment_id and question_id = target_question_id;
end;
$$;

revoke all on function public.adci_admin_get_question_bank() from public;
revoke all on function public.adci_admin_save_bank_question(uuid,text,jsonb,integer,text,text,text) from public;
revoke all on function public.adci_admin_attach_bank_question(uuid,uuid) from public;
revoke all on function public.adci_admin_delete_bank_question(uuid) from public;
revoke all on function public.adci_delete_quiz_question(uuid,uuid) from public;
grant execute on function public.adci_admin_get_question_bank() to authenticated;
grant execute on function public.adci_admin_save_bank_question(uuid,text,jsonb,integer,text,text,text) to authenticated;
grant execute on function public.adci_admin_attach_bank_question(uuid,uuid) to authenticated;
grant execute on function public.adci_admin_delete_bank_question(uuid) to authenticated;
grant execute on function public.adci_delete_quiz_question(uuid,uuid) to authenticated;
