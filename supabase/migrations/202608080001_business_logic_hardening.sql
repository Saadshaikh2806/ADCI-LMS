-- Business-logic hardening found during the end-to-end LMS logic audit.
-- This migration is safe to run more than once.

-- A paid/manual enrolment grants learner access only after the course is
-- published. Academic staff retain draft preview access through membership.
create or replace function public.adci_can_access_course(requested_course uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.adci_enrolments enrolment
    join public.adci_courses course on course.id = enrolment.course_id
    where enrolment.course_id = requested_course
      and enrolment.learner_id = auth.uid()
      and enrolment.status in ('active', 'completed')
      and (enrolment.access_expires_at is null or enrolment.access_expires_at > now())
      and course.status = 'published'
  ) or exists (
    select 1
    from public.adci_courses course
    where course.id = requested_course
      and public.adci_current_user_has_role(
        course.organization_id,
        array['instructor','content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
      )
  );
$$;

revoke all on function public.adci_can_access_course(uuid) from public;
grant execute on function public.adci_can_access_course(uuid) to authenticated;

-- Do not publish a course containing lessons that learners cannot actually use.
create or replace function public.adci_update_course(
  target_course_id uuid,
  course_title text,
  course_description text,
  course_status public.adci_content_status
)
returns public.adci_courses
language plpgsql
security definer
set search_path = ''
as $$
declare
  course_record public.adci_courses;
  empty_module text;
  unready_lesson text;
begin
  select * into course_record
  from public.adci_courses
  where id = target_course_id;

  if course_record.id is null or not public.adci_current_user_has_role(
    course_record.organization_id,
    array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  ) then
    raise exception 'Academic administration permission required';
  end if;

  if nullif(trim(course_title), '') is null then
    raise exception 'Course title is required';
  end if;

  if course_status = 'published' then
    select module.title into empty_module
    from public.adci_modules module
    left join public.adci_lessons lesson on lesson.module_id = module.id
    where module.course_id = target_course_id
    group by module.id, module.title, module.position
    having count(lesson.id) = 0
    order by module.position
    limit 1;

    if empty_module is not null then
      raise exception 'Add at least one lesson to module "%" before publishing', empty_module;
    end if;

    if not exists (
      select 1 from public.adci_modules module
      join public.adci_lessons lesson on lesson.module_id = module.id
      where module.course_id = target_course_id
    ) then
      raise exception 'Add at least one lesson before publishing the course';
    end if;

    select lesson.title into unready_lesson
    from public.adci_modules module
    join public.adci_lessons lesson on lesson.module_id = module.id
    where module.course_id = target_course_id
      and case lesson.lesson_type
        when 'video' then not exists (
          select 1 from public.adci_lesson_assets asset
          where asset.lesson_id = lesson.id and asset.asset_type = 'video'
        ) and not exists (
          select 1 from public.adci_video_assets video where video.lesson_id = lesson.id
        )
        when 'audio' then not exists (
          select 1 from public.adci_lesson_assets asset
          where asset.lesson_id = lesson.id and asset.asset_type = 'audio'
        )
        when 'pdf' then not exists (
          select 1 from public.adci_lesson_assets asset
          where asset.lesson_id = lesson.id and asset.asset_type = 'pdf'
        )
        when 'html' then not exists (
          select 1 from public.adci_article_contents article
          where article.lesson_id = lesson.id and nullif(trim(article.body), '') is not null
        )
        when 'live' then not exists (
          select 1 from public.adci_live_classes live_class where live_class.lesson_id = lesson.id
        )
        when 'quiz' then not exists (
          select 1 from public.adci_assessments assessment
          where assessment.lesson_id = lesson.id
            and assessment.status = 'published'
            and exists (
              select 1 from public.adci_assessment_questions question
              where question.assessment_id = assessment.id
            )
        )
        else true
      end
    order by module.position, lesson.position
    limit 1;

    if unready_lesson is not null then
      raise exception 'Finish the content for lesson "%" before publishing', unready_lesson;
    end if;
  end if;

  update public.adci_courses
  set title = trim(course_title),
      description = coalesce(course_description, ''),
      status = course_status,
      published_at = case
        when course_status = 'published' then coalesce(published_at, now())
        else null
      end,
      updated_at = now()
  where id = target_course_id
  returning * into course_record;

  insert into public.adci_audit_events (
    organization_id, actor_id, action, entity_type, entity_id, new_values
  ) values (
    course_record.organization_id, auth.uid(), 'course.updated', 'course',
    course_record.id,
    jsonb_build_object('title', course_record.title, 'status', course_record.status)
  );

  return course_record;
end;
$$;

revoke all on function public.adci_update_course(uuid,text,text,public.adci_content_status) from public;
grant execute on function public.adci_update_course(uuid,text,text,public.adci_content_status) to authenticated;

-- Structural curriculum edits move a published course back to draft. This is
-- the safe course-level publication boundary used by the learner RPCs.
create or replace function public.adci_add_course_module(
  target_course_id uuid,
  module_title text
)
returns public.adci_modules
language plpgsql
security definer
set search_path = ''
as $$
declare
  course_record public.adci_courses;
  module_record public.adci_modules;
  next_position integer;
begin
  select * into course_record from public.adci_courses where id = target_course_id;
  if course_record.id is null or not public.adci_current_user_has_role(
    course_record.organization_id,
    array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  ) then raise exception 'Academic administration permission required'; end if;
  if nullif(trim(module_title), '') is null then raise exception 'Module title is required'; end if;

  select coalesce(max(position), 0) + 1 into next_position
  from public.adci_modules where course_id = target_course_id;

  insert into public.adci_modules (course_id, title, position)
  values (target_course_id, trim(module_title), next_position)
  returning * into module_record;

  update public.adci_courses
  set status = 'draft', published_at = null, updated_at = now()
  where id = target_course_id and status = 'published';

  return module_record;
end;
$$;

create or replace function public.adci_add_module_lesson(
  target_module_id uuid,
  lesson_title text,
  lesson_kind text,
  lesson_duration_seconds integer default 0
)
returns public.adci_lessons
language plpgsql
security definer
set search_path = ''
as $$
declare
  course_record public.adci_courses;
  lesson_record public.adci_lessons;
  next_position integer;
begin
  select course.* into course_record
  from public.adci_courses course
  join public.adci_modules module on module.course_id = course.id
  where module.id = target_module_id;

  if course_record.id is null or not public.adci_current_user_has_role(
    course_record.organization_id,
    array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  ) then raise exception 'Academic administration permission required'; end if;
  if lesson_kind not in ('video','audio','pdf','html','live','quiz')
  then raise exception 'Unsupported lesson type'; end if;
  if nullif(trim(lesson_title), '') is null then raise exception 'Lesson title is required'; end if;

  select coalesce(max(position), 0) + 1 into next_position
  from public.adci_lessons where module_id = target_module_id;

  insert into public.adci_lessons (
    module_id, title, lesson_type, position, duration_seconds, status
  ) values (
    target_module_id, trim(lesson_title), lesson_kind, next_position,
    greatest(0, lesson_duration_seconds), 'draft'
  ) returning * into lesson_record;

  update public.adci_courses
  set status = 'draft', published_at = null, updated_at = now()
  where id = course_record.id and status = 'published';

  return lesson_record;
end;
$$;

revoke all on function public.adci_add_course_module(uuid,text) from public;
revoke all on function public.adci_add_module_lesson(uuid,text,text,integer) from public;
grant execute on function public.adci_add_course_module(uuid,text) to authenticated;
grant execute on function public.adci_add_module_lesson(uuid,text,text,integer) to authenticated;

-- People visibility matches the admin navigation. Only super admins can change
-- roles; branch admins can manage enrolments; support receives read-only access.
create or replace function public.adci_admin_list_people()
returns table (
  user_id uuid,
  full_name text,
  email text,
  role public.adci_app_role,
  active boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
begin
  select organization.id into target_organization_id
  from public.adci_organizations organization
  where organization.slug = 'adci';

  if not public.adci_current_user_has_role(
    target_organization_id,
    array['support','branch_admin','super_admin']::public.adci_app_role[]
  ) then
    raise exception 'People access permission required';
  end if;

  return query
  select
    profile.id,
    profile.full_name,
    user_record.email::text,
    membership.role,
    coalesce(membership.active, false),
    profile.created_at
  from public.adci_profiles profile
  join auth.users user_record on user_record.id = profile.id
  left join lateral (
    select member.role, member.active
    from public.adci_memberships member
    where member.user_id = profile.id
      and member.organization_id = target_organization_id
    order by member.active desc, member.created_at desc
    limit 1
  ) membership on true
  order by profile.created_at desc;
end;
$$;

revoke all on function public.adci_admin_list_people() from public;
grant execute on function public.adci_admin_list_people() to authenticated;

-- Enforce the configured assignment submission type and ensure referenced
-- files really exist in the learner's protected storage folder.
create or replace function public.adci_save_my_assignment_submission(
  target_assignment_id uuid,
  submission_text text,
  submission_link text,
  submission_file_path text,
  submission_file_name text,
  submission_file_mime_type text,
  submission_file_size_bytes bigint,
  submit_now boolean
)
returns public.adci_assignment_submissions
language plpgsql
security definer
set search_path = ''
as $$
declare
  assignment_record public.adci_assignments;
  submission_record public.adci_assignment_submissions;
  clean_text text := nullif(trim(submission_text), '');
  clean_link text := nullif(trim(submission_link), '');
  clean_file_path text := nullif(trim(submission_file_path), '');
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into assignment_record
  from public.adci_assignments
  where id = target_assignment_id
    and status = 'published'
    and (available_from is null or available_from <= now());

  if assignment_record.id is null or not public.adci_can_access_course(assignment_record.course_id)
  then raise exception 'Assignment is unavailable'; end if;
  if assignment_record.due_at is not null and assignment_record.due_at < now()
  then raise exception 'The assignment deadline has passed'; end if;
  if exists (
    select 1 from public.adci_assignment_submissions
    where assignment_id = target_assignment_id
      and learner_id = auth.uid()
      and status in ('submitted','graded')
  ) then raise exception 'This submission can no longer be edited'; end if;

  if clean_link is not null and clean_link !~* '^https://[^[:space:]]+$'
  then raise exception 'Submission links must use HTTPS'; end if;

  if clean_file_path is not null then
    if clean_file_path not like target_assignment_id::text || '/' || auth.uid()::text || '/%'
    then raise exception 'Invalid submission file path'; end if;
    if submission_file_size_bytes is null or submission_file_size_bytes <= 0
       or submission_file_size_bytes > assignment_record.max_file_bytes
    then raise exception 'Submission file size is invalid'; end if;
    if nullif(trim(submission_file_name), '') is null
       or nullif(trim(submission_file_mime_type), '') is null
       or not (submission_file_mime_type = any(assignment_record.allowed_mime_types))
    then raise exception 'Submission file type is not allowed'; end if;
    if not exists (
      select 1 from storage.objects object
      where object.bucket_id = 'adci-assignment-submissions'
        and object.name = clean_file_path
    ) then raise exception 'Upload the assignment file before saving'; end if;
  elsif nullif(trim(submission_file_name), '') is not null
     or nullif(trim(submission_file_mime_type), '') is not null
     or submission_file_size_bytes is not null
  then raise exception 'Incomplete submission file details'; end if;

  if submit_now then
    if assignment_record.submission_type = 'file' and clean_file_path is null
    then raise exception 'Upload a file before submitting'; end if;
    if assignment_record.submission_type = 'text' and clean_text is null
    then raise exception 'Write your response before submitting'; end if;
    if assignment_record.submission_type = 'link' and clean_link is null
    then raise exception 'Add a secure link before submitting'; end if;
    if assignment_record.submission_type = 'mixed'
       and clean_text is null and clean_link is null and clean_file_path is null
    then raise exception 'Add your work before submitting'; end if;
  end if;

  insert into public.adci_assignment_submissions (
    assignment_id, learner_id, text_response, link_url,
    file_path, file_name, file_mime_type, file_size_bytes,
    status, submitted_at, score, feedback, graded_by, graded_at
  ) values (
    target_assignment_id, auth.uid(), clean_text, clean_link,
    clean_file_path, nullif(trim(submission_file_name), ''),
    nullif(trim(submission_file_mime_type), ''), submission_file_size_bytes,
    case when submit_now then 'submitted' else 'draft' end,
    case when submit_now then now() else null end,
    null, null, null, null
  )
  on conflict (assignment_id, learner_id) do update set
    text_response = excluded.text_response,
    link_url = excluded.link_url,
    file_path = excluded.file_path,
    file_name = excluded.file_name,
    file_mime_type = excluded.file_mime_type,
    file_size_bytes = excluded.file_size_bytes,
    status = excluded.status,
    submitted_at = excluded.submitted_at,
    score = null,
    feedback = null,
    graded_by = null,
    graded_at = null,
    updated_at = now()
  returning * into submission_record;

  return submission_record;
end;
$$;

revoke all on function public.adci_save_my_assignment_submission(uuid,text,text,text,text,text,bigint,boolean) from public;
grant execute on function public.adci_save_my_assignment_submission(uuid,text,text,text,text,text,bigint,boolean) to authenticated;

-- A published quiz must always retain at least one question.
create or replace function public.adci_delete_quiz_question(
  target_assessment_id uuid,
  target_question_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  assessment_status public.adci_content_status;
  question_count integer;
begin
  select course.organization_id, assessment.status
  into target_organization_id, assessment_status
  from public.adci_assessments assessment
  join public.adci_courses course on course.id = assessment.course_id
  where assessment.id = target_assessment_id;

  if target_organization_id is null or not public.adci_current_user_has_role(
    target_organization_id,
    array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  ) then raise exception 'Quiz administration permission required'; end if;

  if not exists (
    select 1 from public.adci_assessment_questions
    where assessment_id = target_assessment_id and question_id = target_question_id
  ) then raise exception 'Quiz question not found'; end if;

  select count(*) into question_count
  from public.adci_assessment_questions
  where assessment_id = target_assessment_id;

  if assessment_status = 'published' and question_count <= 1
  then raise exception 'A published quiz must contain at least one question'; end if;

  delete from public.adci_assessment_questions
  where assessment_id = target_assessment_id and question_id = target_question_id;
end;
$$;

revoke all on function public.adci_delete_quiz_question(uuid,uuid) from public;
grant execute on function public.adci_delete_quiz_question(uuid,uuid) to authenticated;

-- Certificate issuance is intentionally limited to academic leadership and
-- administrators. Instructors can grade work but cannot mint credentials.
create or replace function public.adci_admin_issue_certificate(
  target_learner_id uuid,
  target_course_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  learner_display_name text;
  target_course_title text;
  lesson_total integer;
  lesson_completed integer;
  quiz_total integer;
  quiz_passed integer;
  assignment_total integer;
  assignment_graded integer;
  saved_id uuid;
  generated_number text;
  generated_code text;
begin
  select course.organization_id, course.title
  into target_organization_id, target_course_title
  from public.adci_courses course
  where course.id = target_course_id and course.status = 'published';

  if target_organization_id is null or not public.adci_current_user_has_role(
    target_organization_id,
    array['academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  ) then raise exception 'Certificate administration permission required'; end if;

  if not exists (
    select 1 from public.adci_enrolments enrolment
    where enrolment.learner_id = target_learner_id
      and enrolment.course_id = target_course_id
      and enrolment.status in ('active','completed')
      and (enrolment.access_expires_at is null or enrolment.access_expires_at > now())
  ) then raise exception 'Active course enrolment not found'; end if;

  select coalesce(nullif(trim(profile.full_name), ''), split_part(user_record.email::text, '@', 1))
  into learner_display_name
  from public.adci_profiles profile
  join auth.users user_record on user_record.id = profile.id
  where profile.id = target_learner_id;
  if learner_display_name is null then raise exception 'Learner profile not found'; end if;

  select count(*) into lesson_total
  from public.adci_modules module
  join public.adci_lessons lesson on lesson.module_id = module.id
  where module.course_id = target_course_id;

  select count(*) into lesson_completed
  from public.adci_modules module
  join public.adci_lessons lesson on lesson.module_id = module.id
  join public.adci_lesson_progress progress
    on progress.lesson_id = lesson.id
   and progress.learner_id = target_learner_id
   and progress.completed_at is not null
  where module.course_id = target_course_id;

  select count(*) into quiz_total
  from public.adci_assessments assessment
  where assessment.course_id = target_course_id and assessment.status = 'published';

  select count(*) into quiz_passed
  from public.adci_assessments assessment
  where assessment.course_id = target_course_id
    and assessment.status = 'published'
    and exists (
      select 1 from public.adci_attempts attempt
      where attempt.assessment_id = assessment.id
        and attempt.learner_id = target_learner_id
        and attempt.status = 'scored'
        and attempt.score >= (
          select count(*) * assessment.positive_marks * assessment.pass_percent / 100
          from public.adci_assessment_questions question
          where question.assessment_id = assessment.id
        )
    );

  select count(*) into assignment_total
  from public.adci_assignments assignment
  where assignment.course_id = target_course_id and assignment.status = 'published';

  select count(*) into assignment_graded
  from public.adci_assignments assignment
  where assignment.course_id = target_course_id
    and assignment.status = 'published'
    and exists (
      select 1 from public.adci_assignment_submissions submission
      where submission.assignment_id = assignment.id
        and submission.learner_id = target_learner_id
        and submission.status = 'graded'
    );

  if lesson_total = 0 or lesson_total <> lesson_completed
     or quiz_total <> quiz_passed or assignment_total <> assignment_graded
  then raise exception 'Learner has not completed every course requirement'; end if;

  generated_number := 'ADCI-' || to_char(now(), 'YYYY') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  generated_code := replace(gen_random_uuid()::text, '-', '');

  insert into public.adci_certificates (
    organization_id, course_id, learner_id, certificate_number,
    verification_code, learner_name, course_title, completion_percent,
    issued_by, status, revoked_at, revoked_by, revocation_reason
  ) values (
    target_organization_id, target_course_id, target_learner_id,
    generated_number, generated_code, learner_display_name,
    target_course_title, 100, auth.uid(), 'valid', null, null, null
  )
  on conflict (course_id, learner_id) do update set
    certificate_number = excluded.certificate_number,
    verification_code = excluded.verification_code,
    learner_name = excluded.learner_name,
    course_title = excluded.course_title,
    completion_percent = 100,
    issued_at = now(),
    issued_by = auth.uid(),
    status = 'valid',
    revoked_at = null,
    revoked_by = null,
    revocation_reason = null,
    updated_at = now()
  returning id into saved_id;

  update public.adci_enrolments set status = 'completed'
  where learner_id = target_learner_id and course_id = target_course_id;

  insert into public.adci_audit_events (
    organization_id, actor_id, action, entity_type, entity_id, new_values
  ) values (
    target_organization_id, auth.uid(), 'certificate.issued', 'certificate', saved_id,
    jsonb_build_object(
      'learner_id', target_learner_id,
      'course_id', target_course_id,
      'certificate_number', generated_number
    )
  );

  return saved_id;
end;
$$;

revoke all on function public.adci_admin_issue_certificate(uuid,uuid) from public;
grant execute on function public.adci_admin_issue_certificate(uuid,uuid) to authenticated;

-- Service-only routines must never be callable with an anon or normal user JWT.
revoke execute on function public.adci_attach_provider_order(uuid,text) from anon, authenticated;
revoke execute on function public.adci_fail_payment_order(uuid,text) from anon, authenticated;
revoke execute on function public.adci_fulfil_paid_order(text,text,text,jsonb) from anon, authenticated;
revoke execute on function public.adci_mark_order_refunded(text,text,jsonb) from anon, authenticated;
revoke execute on function public.adci_queue_due_announcement_emails() from anon, authenticated;
revoke execute on function public.adci_claim_email_deliveries(integer) from anon, authenticated;
revoke execute on function public.adci_mark_email_delivery_sent(uuid,text) from anon, authenticated;
revoke execute on function public.adci_mark_email_delivery_failed(uuid,text) from anon, authenticated;
revoke execute on function public.adci_score_quiz_attempt(uuid,boolean) from anon, authenticated;
revoke execute on function public.adci_add_user_notification(uuid,uuid,text,text,text,text,text,uuid,jsonb,text) from anon, authenticated;
revoke execute on function public.adci_queue_my_live_reminders() from anon;

grant execute on function public.adci_attach_provider_order(uuid,text) to service_role;
grant execute on function public.adci_fail_payment_order(uuid,text) to service_role;
grant execute on function public.adci_fulfil_paid_order(text,text,text,jsonb) to service_role;
grant execute on function public.adci_mark_order_refunded(text,text,jsonb) to service_role;
grant execute on function public.adci_queue_due_announcement_emails() to service_role;
grant execute on function public.adci_claim_email_deliveries(integer) to service_role;
grant execute on function public.adci_mark_email_delivery_sent(uuid,text) to service_role;
grant execute on function public.adci_mark_email_delivery_failed(uuid,text) to service_role;

notify pgrst, 'reload schema';
