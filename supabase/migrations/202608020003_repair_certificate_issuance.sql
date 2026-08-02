-- Repair certificate issuance when the original certificate migration was only
-- partially applied. This migration is safe to run more than once.

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
  where course.id = target_course_id
    and course.status = 'published';

  if target_organization_id is null or not public.adci_current_user_has_role(
    target_organization_id,
    array['instructor','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  ) then
    raise exception 'Certificate administration permission required';
  end if;

  if not exists (
    select 1
    from public.adci_enrolments enrolment
    where enrolment.learner_id = target_learner_id
      and enrolment.course_id = target_course_id
      and enrolment.status in ('active','completed')
      and (enrolment.access_expires_at is null or enrolment.access_expires_at > now())
  ) then
    raise exception 'Active course enrolment not found';
  end if;

  select coalesce(
    nullif(trim(profile.full_name), ''),
    split_part(user_record.email::text, '@', 1)
  )
  into learner_display_name
  from public.adci_profiles profile
  join auth.users user_record on user_record.id = profile.id
  where profile.id = target_learner_id;

  if learner_display_name is null then
    raise exception 'Learner profile not found';
  end if;

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
  where assessment.course_id = target_course_id
    and assessment.status = 'published';

  select count(*) into quiz_passed
  from public.adci_assessments assessment
  where assessment.course_id = target_course_id
    and assessment.status = 'published'
    and exists (
      select 1
      from public.adci_attempts attempt
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
  where assignment.course_id = target_course_id
    and assignment.status = 'published';

  select count(*) into assignment_graded
  from public.adci_assignments assignment
  where assignment.course_id = target_course_id
    and assignment.status = 'published'
    and exists (
      select 1
      from public.adci_assignment_submissions submission
      where submission.assignment_id = assignment.id
        and submission.learner_id = target_learner_id
        and submission.status = 'graded'
    );

  if lesson_total = 0
     or lesson_total <> lesson_completed
     or quiz_total <> quiz_passed
     or assignment_total <> assignment_graded
  then
    raise exception 'Learner has not completed every course requirement';
  end if;

  generated_number := 'ADCI-' || to_char(now(), 'YYYY') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  generated_code := replace(gen_random_uuid()::text, '-', '');

  insert into public.adci_certificates (
    organization_id,
    course_id,
    learner_id,
    certificate_number,
    verification_code,
    learner_name,
    course_title,
    completion_percent,
    issued_by,
    status,
    revoked_at,
    revoked_by,
    revocation_reason
  ) values (
    target_organization_id,
    target_course_id,
    target_learner_id,
    generated_number,
    generated_code,
    learner_display_name,
    target_course_title,
    100,
    auth.uid(),
    'valid',
    null,
    null,
    null
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

  update public.adci_enrolments
  set status = 'completed'
  where learner_id = target_learner_id
    and course_id = target_course_id;

  insert into public.adci_audit_events (
    organization_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    new_values
  ) values (
    target_organization_id,
    auth.uid(),
    'certificate.issued',
    'certificate',
    saved_id,
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

-- Make the newly created RPC visible to PostgREST immediately.
notify pgrst, 'reload schema';
