-- Course completion, certificate issuance, revocation and public verification.
-- Run this complete file once after migration 202607300012.

create table if not exists public.adci_certificates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.adci_organizations on delete cascade,
  course_id uuid not null references public.adci_courses on delete restrict,
  learner_id uuid not null references public.adci_profiles on delete restrict,
  certificate_number text not null unique,
  verification_code text not null unique,
  learner_name text not null,
  course_title text not null,
  completion_percent numeric(5,2) not null default 100 check (completion_percent between 0 and 100),
  issued_at timestamptz not null default now(),
  issued_by uuid references public.adci_profiles,
  status text not null default 'valid' check (status in ('valid','revoked')),
  revoked_at timestamptz,
  revoked_by uuid references public.adci_profiles,
  revocation_reason text check (char_length(revocation_reason) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, learner_id)
);

alter table public.adci_certificates enable row level security;

drop policy if exists "learners read own certificates" on public.adci_certificates;
create policy "learners read own certificates"
on public.adci_certificates for select to authenticated
using (learner_id = auth.uid());

drop policy if exists "academic staff manage certificates" on public.adci_certificates;
create policy "academic staff manage certificates"
on public.adci_certificates for all to authenticated
using (
  public.adci_current_user_has_role(
    organization_id,
    array['instructor','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  )
)
with check (
  public.adci_current_user_has_role(
    organization_id,
    array['instructor','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  )
);

create index if not exists adci_certificates_learner_issued_idx
on public.adci_certificates (learner_id, issued_at desc);
create index if not exists adci_certificates_org_status_idx
on public.adci_certificates (organization_id, status, issued_at desc);

create or replace function public.adci_admin_get_certificates()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare target_organization_id uuid;
begin
  select id into target_organization_id from public.adci_organizations where slug = 'adci';
  if not public.adci_current_user_has_role(
    target_organization_id,
    array['instructor','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  ) then raise exception 'Certificate administration permission required'; end if;

  return jsonb_build_object(
    'summary', jsonb_build_object(
      'issued', (
        select count(*) from public.adci_certificates
        where organization_id = target_organization_id and status = 'valid'
      ),
      'eligible', (
        select count(*)
        from public.adci_enrolments enrolment
        join public.adci_courses course on course.id = enrolment.course_id
        where course.organization_id = target_organization_id
          and course.status = 'published'
          and enrolment.status in ('active','completed')
          and (
            select count(*) from public.adci_modules module
            join public.adci_lessons lesson on lesson.module_id = module.id
            where module.course_id = course.id
          ) > 0
          and (
            select count(*) from public.adci_modules module
            join public.adci_lessons lesson on lesson.module_id = module.id
            where module.course_id = course.id
          ) = (
            select count(*) from public.adci_modules module
            join public.adci_lessons lesson on lesson.module_id = module.id
            join public.adci_lesson_progress progress
              on progress.lesson_id = lesson.id
             and progress.learner_id = enrolment.learner_id
             and progress.completed_at is not null
            where module.course_id = course.id
          )
          and (
            select count(*) from public.adci_assignments assignment
            where assignment.course_id = course.id and assignment.status = 'published'
          ) = (
            select count(*) from public.adci_assignments assignment
            where assignment.course_id = course.id and assignment.status = 'published'
              and exists (
                select 1 from public.adci_assignment_submissions submission
                where submission.assignment_id = assignment.id
                  and submission.learner_id = enrolment.learner_id
                  and submission.status = 'graded'
              )
          )
          and (
            select count(*) from public.adci_assessments assessment
            where assessment.course_id = course.id and assessment.status = 'published'
          ) = (
            select count(*) from public.adci_assessments assessment
            where assessment.course_id = course.id and assessment.status = 'published'
              and exists (
                select 1 from public.adci_attempts attempt
                where attempt.assessment_id = assessment.id
                  and attempt.learner_id = enrolment.learner_id
                  and attempt.status = 'scored'
                  and attempt.score >= (
                    select count(*) * assessment.positive_marks * assessment.pass_percent / 100
                    from public.adci_assessment_questions question
                    where question.assessment_id = assessment.id
                  )
              )
          )
          and not exists (
            select 1 from public.adci_certificates certificate
            where certificate.course_id = course.id
              and certificate.learner_id = enrolment.learner_id
              and certificate.status = 'valid'
          )
      ),
      'revoked', (
        select count(*) from public.adci_certificates
        where organization_id = target_organization_id and status = 'revoked'
      ),
      'courses', (
        select count(*) from public.adci_courses
        where organization_id = target_organization_id and status = 'published'
      )
    ),
    'courses', coalesce((
      select jsonb_agg(jsonb_build_object('id', course.id, 'title', course.title) order by course.title)
      from public.adci_courses course
      where course.organization_id = target_organization_id and course.status = 'published'
    ), '[]'::jsonb),
    'learners', coalesce((
      select jsonb_agg(candidate order by candidate->>'learner_name', candidate->>'course_title')
      from (
        select jsonb_build_object(
          'learner_id', enrolment.learner_id,
          'learner_name', coalesce(nullif(trim(profile.full_name), ''), split_part(user_record.email::text, '@', 1)),
          'learner_email', user_record.email::text,
          'course_id', course.id,
          'course_title', course.title,
          'enrolment_status', enrolment.status,
          'lesson_total', progress_data.lesson_total,
          'lesson_completed', progress_data.lesson_completed,
          'quiz_total', progress_data.quiz_total,
          'quiz_passed', progress_data.quiz_passed,
          'assignment_total', progress_data.assignment_total,
          'assignment_graded', progress_data.assignment_graded,
          'completion_percent', case
            when progress_data.required_total = 0 then 0
            else round(progress_data.completed_total::numeric / progress_data.required_total * 100)
          end,
          'eligible', (
            progress_data.lesson_total > 0
            and progress_data.lesson_total = progress_data.lesson_completed
            and progress_data.quiz_total = progress_data.quiz_passed
            and progress_data.assignment_total = progress_data.assignment_graded
          ),
          'certificate', case when certificate.id is null then null else jsonb_build_object(
            'id', certificate.id,
            'certificate_number', certificate.certificate_number,
            'verification_code', certificate.verification_code,
            'issued_at', certificate.issued_at,
            'status', certificate.status,
            'revoked_at', certificate.revoked_at,
            'revocation_reason', certificate.revocation_reason
          ) end
        ) candidate
        from public.adci_enrolments enrolment
        join public.adci_courses course on course.id = enrolment.course_id
        join public.adci_profiles profile on profile.id = enrolment.learner_id
        join auth.users user_record on user_record.id = enrolment.learner_id
        left join public.adci_certificates certificate
          on certificate.course_id = course.id and certificate.learner_id = enrolment.learner_id
        cross join lateral (
          select
            (
              select count(*) from public.adci_modules module
              join public.adci_lessons lesson on lesson.module_id = module.id
              where module.course_id = course.id
            )::integer as lesson_total,
            (
              select count(*) from public.adci_modules module
              join public.adci_lessons lesson on lesson.module_id = module.id
              join public.adci_lesson_progress progress
                on progress.lesson_id = lesson.id
               and progress.learner_id = enrolment.learner_id
               and progress.completed_at is not null
              where module.course_id = course.id
            )::integer as lesson_completed,
            (
              select count(*) from public.adci_assessments assessment
              where assessment.course_id = course.id and assessment.status = 'published'
            )::integer as quiz_total,
            (
              select count(*) from public.adci_assessments assessment
              where assessment.course_id = course.id and assessment.status = 'published'
                and exists (
                  select 1 from public.adci_attempts attempt
                  where attempt.assessment_id = assessment.id
                    and attempt.learner_id = enrolment.learner_id
                    and attempt.status = 'scored'
                    and attempt.score >= (
                      select count(*) * assessment.positive_marks * assessment.pass_percent / 100
                      from public.adci_assessment_questions question
                      where question.assessment_id = assessment.id
                    )
                )
            )::integer as quiz_passed,
            (
              select count(*) from public.adci_assignments assignment
              where assignment.course_id = course.id and assignment.status = 'published'
            )::integer as assignment_total,
            (
              select count(*) from public.adci_assignments assignment
              where assignment.course_id = course.id and assignment.status = 'published'
                and exists (
                  select 1 from public.adci_assignment_submissions submission
                  where submission.assignment_id = assignment.id
                    and submission.learner_id = enrolment.learner_id
                    and submission.status = 'graded'
                )
            )::integer as assignment_graded,
            (
              (select count(*) from public.adci_modules module
                join public.adci_lessons lesson on lesson.module_id = module.id
                where module.course_id = course.id)
              + (select count(*) from public.adci_assessments assessment
                where assessment.course_id = course.id and assessment.status = 'published')
              + (select count(*) from public.adci_assignments assignment
                where assignment.course_id = course.id and assignment.status = 'published')
            )::integer as required_total,
            (
              (select count(*) from public.adci_modules module
                join public.adci_lessons lesson on lesson.module_id = module.id
                join public.adci_lesson_progress progress
                  on progress.lesson_id = lesson.id
                 and progress.learner_id = enrolment.learner_id
                 and progress.completed_at is not null
                where module.course_id = course.id)
              + (select count(*) from public.adci_assessments assessment
                where assessment.course_id = course.id and assessment.status = 'published'
                  and exists (
                    select 1 from public.adci_attempts attempt
                    where attempt.assessment_id = assessment.id
                      and attempt.learner_id = enrolment.learner_id
                      and attempt.status = 'scored'
                      and attempt.score >= (
                        select count(*) * assessment.positive_marks * assessment.pass_percent / 100
                        from public.adci_assessment_questions question
                        where question.assessment_id = assessment.id
                      )
                  ))
              + (select count(*) from public.adci_assignments assignment
                where assignment.course_id = course.id and assignment.status = 'published'
                  and exists (
                    select 1 from public.adci_assignment_submissions submission
                    where submission.assignment_id = assignment.id
                      and submission.learner_id = enrolment.learner_id
                      and submission.status = 'graded'
                  ))
            )::integer as completed_total
        ) progress_data
        where course.organization_id = target_organization_id
          and course.status = 'published'
          and enrolment.status in ('active','completed')
          and (enrolment.access_expires_at is null or enrolment.access_expires_at > now())
      ) candidate_rows
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.adci_admin_issue_certificate(
  target_learner_id uuid,
  target_course_id uuid
)
returns uuid
language plpgsql security definer set search_path = ''
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
  select organization_id, title into target_organization_id, target_course_title
  from public.adci_courses where id = target_course_id and status = 'published';
  if target_organization_id is null or not public.adci_current_user_has_role(
    target_organization_id,
    array['instructor','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  ) then raise exception 'Certificate administration permission required'; end if;
  if not exists (
    select 1 from public.adci_enrolments
    where learner_id = target_learner_id and course_id = target_course_id
      and status in ('active','completed')
  ) then raise exception 'Active course enrolment not found'; end if;

  select coalesce(nullif(trim(profile.full_name), ''), split_part(user_record.email::text, '@', 1))
  into learner_display_name
  from public.adci_profiles profile
  join auth.users user_record on user_record.id = profile.id
  where profile.id = target_learner_id;

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
  where assessment.course_id = target_course_id and assessment.status = 'published'
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
  where assignment.course_id = target_course_id and assignment.status = 'published'
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
  generated_code := encode(gen_random_bytes(16), 'hex');

  insert into public.adci_certificates (
    organization_id, course_id, learner_id, certificate_number,
    verification_code, learner_name, course_title, completion_percent,
    issued_by, status, revoked_at, revoked_by, revocation_reason
  ) values (
    target_organization_id, target_course_id, target_learner_id, generated_number,
    generated_code, learner_display_name, target_course_title, 100,
    auth.uid(), 'valid', null, null, null
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
    jsonb_build_object('learner_id', target_learner_id, 'course_id', target_course_id, 'certificate_number', generated_number)
  );
  return saved_id;
end;
$$;

create or replace function public.adci_admin_revoke_certificate(
  target_certificate_id uuid,
  revoke_reason text
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare target_organization_id uuid;
begin
  select organization_id into target_organization_id
  from public.adci_certificates where id = target_certificate_id;
  if target_organization_id is null or not public.adci_current_user_has_role(
    target_organization_id,
    array['academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  ) then raise exception 'Certificate revocation permission required'; end if;
  if coalesce(trim(revoke_reason), '') = ''
  then raise exception 'A revocation reason is required'; end if;

  update public.adci_certificates
  set status = 'revoked', revoked_at = now(), revoked_by = auth.uid(),
      revocation_reason = trim(revoke_reason), updated_at = now()
  where id = target_certificate_id and status = 'valid';
  if not found then raise exception 'Valid certificate not found'; end if;

  insert into public.adci_audit_events (
    organization_id, actor_id, action, entity_type, entity_id, new_values
  ) values (
    target_organization_id, auth.uid(), 'certificate.revoked', 'certificate',
    target_certificate_id, jsonb_build_object('reason', trim(revoke_reason))
  );
end;
$$;

create or replace function public.adci_get_my_certificates()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', certificate.id,
    'certificate_number', certificate.certificate_number,
    'verification_code', certificate.verification_code,
    'learner_name', certificate.learner_name,
    'course_title', certificate.course_title,
    'completion_percent', certificate.completion_percent,
    'issued_at', certificate.issued_at,
    'status', certificate.status,
    'revoked_at', certificate.revoked_at,
    'revocation_reason', certificate.revocation_reason
  ) order by certificate.issued_at desc), '[]'::jsonb)
  from public.adci_certificates certificate
  where certificate.learner_id = auth.uid();
$$;

create or replace function public.adci_verify_certificate(target_code text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare certificate_record public.adci_certificates;
begin
  select * into certificate_record
  from public.adci_certificates certificate
  where lower(certificate.verification_code) = lower(trim(target_code))
     or lower(certificate.certificate_number) = lower(trim(target_code))
  limit 1;
  if certificate_record.id is null then
    return jsonb_build_object('found', false, 'valid', false);
  end if;
  return jsonb_build_object(
    'found', true,
    'valid', certificate_record.status = 'valid',
    'status', certificate_record.status,
    'certificate_number', certificate_record.certificate_number,
    'learner_name', certificate_record.learner_name,
    'course_title', certificate_record.course_title,
    'completion_percent', certificate_record.completion_percent,
    'issued_at', certificate_record.issued_at,
    'organization_name', 'Anees Defence Career Institute',
    'revoked_at', certificate_record.revoked_at,
    'revocation_reason', certificate_record.revocation_reason
  );
end;
$$;

revoke all on function public.adci_admin_get_certificates() from public;
revoke all on function public.adci_admin_issue_certificate(uuid,uuid) from public;
revoke all on function public.adci_admin_revoke_certificate(uuid,text) from public;
revoke all on function public.adci_get_my_certificates() from public;
revoke all on function public.adci_verify_certificate(text) from public;
grant execute on function public.adci_admin_get_certificates() to authenticated;
grant execute on function public.adci_admin_issue_certificate(uuid,uuid) to authenticated;
grant execute on function public.adci_admin_revoke_certificate(uuid,text) to authenticated;
grant execute on function public.adci_get_my_certificates() to authenticated;
grant execute on function public.adci_verify_certificate(text) to anon, authenticated;
