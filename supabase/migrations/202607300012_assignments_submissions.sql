-- Course assignments, protected learner submissions, grading and teacher feedback.
-- Run this complete file once in the Supabase SQL editor.

create table if not exists public.adci_assignments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.adci_courses on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 180),
  instructions text not null default '' check (char_length(instructions) <= 10000),
  submission_type text not null default 'mixed'
    check (submission_type in ('file','text','link','mixed')),
  max_score numeric(8,2) not null default 100 check (max_score > 0),
  available_from timestamptz,
  due_at timestamptz,
  status public.adci_content_status not null default 'draft',
  allowed_mime_types text[] not null default array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png'
  ],
  max_file_bytes bigint not null default 26214400 check (max_file_bytes between 1 and 52428800),
  created_by uuid references public.adci_profiles,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_at is null or available_from is null or due_at > available_from)
);

create table if not exists public.adci_assignment_submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.adci_assignments on delete cascade,
  learner_id uuid not null references public.adci_profiles on delete cascade,
  text_response text check (char_length(text_response) <= 20000),
  link_url text check (char_length(link_url) <= 2000),
  file_path text,
  file_name text,
  file_mime_type text,
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes >= 0),
  status text not null default 'draft'
    check (status in ('draft','submitted','graded','returned')),
  submitted_at timestamptz,
  score numeric(8,2),
  feedback text check (char_length(feedback) <= 10000),
  graded_by uuid references public.adci_profiles,
  graded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, learner_id)
);

alter table public.adci_assignments enable row level security;
alter table public.adci_assignment_submissions enable row level security;

drop policy if exists "learners read available course assignments" on public.adci_assignments;
create policy "learners read available course assignments"
on public.adci_assignments for select to authenticated
using (
  status = 'published'
  and (available_from is null or available_from <= now())
  and public.adci_can_access_course(course_id)
);

drop policy if exists "academic staff manage assignments" on public.adci_assignments;
create policy "academic staff manage assignments"
on public.adci_assignments for all to authenticated
using (
  public.adci_current_user_has_role(
    (select course.organization_id from public.adci_courses course where course.id = course_id),
    array['instructor','content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  )
)
with check (
  public.adci_current_user_has_role(
    (select course.organization_id from public.adci_courses course where course.id = course_id),
    array['instructor','content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  )
);

drop policy if exists "learners read own assignment submissions" on public.adci_assignment_submissions;
create policy "learners read own assignment submissions"
on public.adci_assignment_submissions for select to authenticated
using (learner_id = auth.uid());

drop policy if exists "academic staff read assignment submissions" on public.adci_assignment_submissions;
create policy "academic staff read assignment submissions"
on public.adci_assignment_submissions for select to authenticated
using (
  exists (
    select 1
    from public.adci_assignments assignment
    join public.adci_courses course on course.id = assignment.course_id
    where assignment.id = assignment_id
      and public.adci_current_user_has_role(
        course.organization_id,
        array['instructor','content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
      )
  )
);

create index if not exists adci_assignments_course_due_idx
on public.adci_assignments (course_id, status, due_at);
create index if not exists adci_assignment_submissions_assignment_status_idx
on public.adci_assignment_submissions (assignment_id, status, submitted_at desc);
create index if not exists adci_assignment_submissions_learner_idx
on public.adci_assignment_submissions (learner_id, updated_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'adci-assignment-submissions',
  'adci-assignment-submissions',
  false,
  52428800,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png'
  ]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "learners upload own assignment files" on storage.objects;
create policy "learners upload own assignment files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'adci-assignment-submissions'
  and (storage.foldername(name))[2] = auth.uid()::text
  and exists (
    select 1 from public.adci_assignments assignment
    where assignment.id::text = (storage.foldername(name))[1]
      and assignment.status = 'published'
      and (assignment.available_from is null or assignment.available_from <= now())
      and (assignment.due_at is null or assignment.due_at >= now())
      and public.adci_can_access_course(assignment.course_id)
  )
);

drop policy if exists "learners update own assignment files" on storage.objects;
create policy "learners update own assignment files"
on storage.objects for update to authenticated
using (
  bucket_id = 'adci-assignment-submissions'
  and (storage.foldername(name))[2] = auth.uid()::text
)
with check (
  bucket_id = 'adci-assignment-submissions'
  and (storage.foldername(name))[2] = auth.uid()::text
);

drop policy if exists "learners delete own assignment files" on storage.objects;
create policy "learners delete own assignment files"
on storage.objects for delete to authenticated
using (
  bucket_id = 'adci-assignment-submissions'
  and (storage.foldername(name))[2] = auth.uid()::text
  and not exists (
    select 1 from public.adci_assignment_submissions submission
    where submission.file_path = name and submission.status in ('submitted','graded')
  )
);

drop policy if exists "learners read own assignment files" on storage.objects;
create policy "learners read own assignment files"
on storage.objects for select to authenticated
using (
  bucket_id = 'adci-assignment-submissions'
  and (storage.foldername(name))[2] = auth.uid()::text
);

drop policy if exists "academic staff read assignment files" on storage.objects;
create policy "academic staff read assignment files"
on storage.objects for select to authenticated
using (
  bucket_id = 'adci-assignment-submissions'
  and exists (
    select 1
    from public.adci_assignments assignment
    join public.adci_courses course on course.id = assignment.course_id
    where assignment.id::text = (storage.foldername(name))[1]
      and public.adci_current_user_has_role(
        course.organization_id,
        array['instructor','content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
      )
  )
);

create or replace function public.adci_admin_get_assignments()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare target_organization_id uuid;
begin
  select id into target_organization_id from public.adci_organizations where slug = 'adci';
  if not public.adci_current_user_has_role(
    target_organization_id,
    array['instructor','content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  ) then raise exception 'Assignment administration permission required'; end if;

  return jsonb_build_object(
    'summary', jsonb_build_object(
      'total', (
        select count(*) from public.adci_assignments assignment
        join public.adci_courses course on course.id = assignment.course_id
        where course.organization_id = target_organization_id and assignment.status <> 'retired'
      ),
      'published', (
        select count(*) from public.adci_assignments assignment
        join public.adci_courses course on course.id = assignment.course_id
        where course.organization_id = target_organization_id and assignment.status = 'published'
      ),
      'awaiting_review', (
        select count(*) from public.adci_assignment_submissions submission
        join public.adci_assignments assignment on assignment.id = submission.assignment_id
        join public.adci_courses course on course.id = assignment.course_id
        where course.organization_id = target_organization_id and submission.status = 'submitted'
      ),
      'graded', (
        select count(*) from public.adci_assignment_submissions submission
        join public.adci_assignments assignment on assignment.id = submission.assignment_id
        join public.adci_courses course on course.id = assignment.course_id
        where course.organization_id = target_organization_id and submission.status = 'graded'
      )
    ),
    'courses', coalesce((
      select jsonb_agg(jsonb_build_object('id', course.id, 'title', course.title, 'status', course.status) order by course.title)
      from public.adci_courses course
      where course.organization_id = target_organization_id and course.status <> 'retired'
    ), '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', assignment.id,
        'course_id', assignment.course_id,
        'course_title', course.title,
        'title', assignment.title,
        'instructions', assignment.instructions,
        'submission_type', assignment.submission_type,
        'max_score', assignment.max_score,
        'available_from', assignment.available_from,
        'due_at', assignment.due_at,
        'status', assignment.status,
        'allowed_mime_types', assignment.allowed_mime_types,
        'max_file_bytes', assignment.max_file_bytes,
        'created_at', assignment.created_at,
        'submission_count', (
          select count(*) from public.adci_assignment_submissions submission
          where submission.assignment_id = assignment.id and submission.status in ('submitted','graded','returned')
        ),
        'awaiting_review_count', (
          select count(*) from public.adci_assignment_submissions submission
          where submission.assignment_id = assignment.id and submission.status = 'submitted'
        ),
        'graded_count', (
          select count(*) from public.adci_assignment_submissions submission
          where submission.assignment_id = assignment.id and submission.status = 'graded'
        ),
        'learner_count', (
          select count(*) from public.adci_enrolments enrolment
          where enrolment.course_id = assignment.course_id
            and enrolment.status in ('active','completed')
            and (enrolment.access_expires_at is null or enrolment.access_expires_at > now())
        )
      ) order by assignment.created_at desc)
      from public.adci_assignments assignment
      join public.adci_courses course on course.id = assignment.course_id
      where course.organization_id = target_organization_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.adci_admin_save_assignment(
  target_assignment_id uuid,
  target_course_id uuid,
  assignment_title text,
  assignment_instructions text,
  assignment_submission_type text,
  assignment_max_score numeric,
  assignment_available_from timestamptz,
  assignment_due_at timestamptz,
  assignment_status public.adci_content_status
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare target_organization_id uuid; saved_id uuid;
begin
  select organization_id into target_organization_id
  from public.adci_courses where id = target_course_id;
  if target_organization_id is null or not public.adci_current_user_has_role(
    target_organization_id,
    array['instructor','content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  ) then raise exception 'Assignment administration permission required'; end if;
  if trim(assignment_title) = '' then raise exception 'Assignment title is required'; end if;
  if assignment_submission_type not in ('file','text','link','mixed')
  then raise exception 'Invalid submission type'; end if;
  if assignment_max_score <= 0 then raise exception 'Maximum score must be greater than zero'; end if;
  if assignment_due_at is not null and assignment_available_from is not null
     and assignment_due_at <= assignment_available_from
  then raise exception 'Due date must be later than the available date'; end if;

  if target_assignment_id is null then
    insert into public.adci_assignments (
      course_id, title, instructions, submission_type, max_score,
      available_from, due_at, status, created_by
    ) values (
      target_course_id, trim(assignment_title), coalesce(assignment_instructions, ''),
      assignment_submission_type, assignment_max_score,
      assignment_available_from, assignment_due_at, assignment_status, auth.uid()
    ) returning id into saved_id;
  else
    update public.adci_assignments
    set course_id = target_course_id,
        title = trim(assignment_title),
        instructions = coalesce(assignment_instructions, ''),
        submission_type = assignment_submission_type,
        max_score = assignment_max_score,
        available_from = assignment_available_from,
        due_at = assignment_due_at,
        status = assignment_status,
        updated_at = now()
    where id = target_assignment_id
      and exists (
        select 1 from public.adci_courses course
        where course.id = adci_assignments.course_id
          and course.organization_id = target_organization_id
      )
    returning id into saved_id;
    if saved_id is null then raise exception 'Assignment not found'; end if;
  end if;

  insert into public.adci_audit_events (
    organization_id, actor_id, action, entity_type, entity_id, new_values
  ) values (
    target_organization_id, auth.uid(), 'assignment.saved', 'assignment', saved_id,
    jsonb_build_object('title', trim(assignment_title), 'course_id', target_course_id, 'status', assignment_status)
  );
  return saved_id;
end;
$$;

create or replace function public.adci_admin_archive_assignment(target_assignment_id uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare target_organization_id uuid; submission_total integer;
begin
  select course.organization_id into target_organization_id
  from public.adci_assignments assignment
  join public.adci_courses course on course.id = assignment.course_id
  where assignment.id = target_assignment_id;
  if target_organization_id is null or not public.adci_current_user_has_role(
    target_organization_id,
    array['instructor','content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  ) then raise exception 'Assignment administration permission required'; end if;

  select count(*) into submission_total
  from public.adci_assignment_submissions where assignment_id = target_assignment_id;
  if submission_total = 0 then
    delete from public.adci_assignments where id = target_assignment_id;
    return 'deleted';
  end if;
  update public.adci_assignments set status = 'retired', updated_at = now()
  where id = target_assignment_id;
  return 'archived';
end;
$$;

create or replace function public.adci_get_my_assignments()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', assignment.id,
    'course_id', course.id,
    'course_title', course.title,
    'title', assignment.title,
    'instructions', assignment.instructions,
    'submission_type', assignment.submission_type,
    'max_score', assignment.max_score,
    'available_from', assignment.available_from,
    'due_at', assignment.due_at,
    'allowed_mime_types', assignment.allowed_mime_types,
    'max_file_bytes', assignment.max_file_bytes,
    'state', case
      when submission.status = 'graded' then 'graded'
      when submission.status = 'returned' then 'returned'
      when submission.status = 'submitted' then 'submitted'
      when assignment.due_at is not null and assignment.due_at < now() then 'overdue'
      else 'pending'
    end,
    'submission', case when submission.id is null then null else jsonb_build_object(
      'id', submission.id,
      'text_response', submission.text_response,
      'link_url', submission.link_url,
      'file_path', submission.file_path,
      'file_name', submission.file_name,
      'file_mime_type', submission.file_mime_type,
      'file_size_bytes', submission.file_size_bytes,
      'status', submission.status,
      'submitted_at', submission.submitted_at,
      'score', submission.score,
      'feedback', submission.feedback,
      'graded_at', submission.graded_at,
      'updated_at', submission.updated_at
    ) end
  ) order by
    case when assignment.due_at is null then 1 else 0 end,
    assignment.due_at,
    assignment.created_at desc), '[]'::jsonb)
  from public.adci_enrolments enrolment
  join public.adci_courses course on course.id = enrolment.course_id
  join public.adci_assignments assignment on assignment.course_id = course.id
  left join public.adci_assignment_submissions submission
    on submission.assignment_id = assignment.id and submission.learner_id = auth.uid()
  where enrolment.learner_id = auth.uid()
    and enrolment.status in ('active','completed')
    and (enrolment.access_expires_at is null or enrolment.access_expires_at > now())
    and course.status = 'published'
    and assignment.status = 'published'
    and (assignment.available_from is null or assignment.available_from <= now());
$$;

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
language plpgsql security definer set search_path = ''
as $$
declare assignment_record public.adci_assignments; submission_record public.adci_assignment_submissions;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into assignment_record from public.adci_assignments
  where id = target_assignment_id
    and status = 'published'
    and (available_from is null or available_from <= now());
  if assignment_record.id is null or not public.adci_can_access_course(assignment_record.course_id)
  then raise exception 'Assignment is unavailable'; end if;
  if assignment_record.due_at is not null and assignment_record.due_at < now()
  then raise exception 'The assignment deadline has passed'; end if;
  if exists (
    select 1 from public.adci_assignment_submissions
    where assignment_id = target_assignment_id and learner_id = auth.uid() and status in ('submitted','graded')
  ) then raise exception 'This submission can no longer be edited'; end if;
  if submission_file_path is not null and submission_file_path <> ''
     and submission_file_path not like target_assignment_id::text || '/' || auth.uid()::text || '/%'
  then raise exception 'Invalid submission file path'; end if;
  if submission_file_size_bytes is not null and submission_file_size_bytes > assignment_record.max_file_bytes
  then raise exception 'Submission file is too large'; end if;
  if submission_file_mime_type is not null
     and not (submission_file_mime_type = any(assignment_record.allowed_mime_types))
  then raise exception 'Submission file type is not allowed'; end if;
  if submit_now and coalesce(trim(submission_text), '') = ''
     and coalesce(trim(submission_link), '') = ''
     and coalesce(submission_file_path, '') = ''
  then raise exception 'Add your work before submitting'; end if;

  insert into public.adci_assignment_submissions (
    assignment_id, learner_id, text_response, link_url,
    file_path, file_name, file_mime_type, file_size_bytes,
    status, submitted_at, score, feedback, graded_by, graded_at
  ) values (
    target_assignment_id, auth.uid(), nullif(trim(submission_text), ''), nullif(trim(submission_link), ''),
    nullif(submission_file_path, ''), nullif(submission_file_name, ''),
    nullif(submission_file_mime_type, ''), submission_file_size_bytes,
    case when submit_now then 'submitted' else 'draft' end,
    case when submit_now then now() else null end, null, null, null, null
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

create or replace function public.adci_admin_get_assignment_submissions(target_assignment_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare target_organization_id uuid; assignment_record public.adci_assignments;
begin
  select * into assignment_record
  from public.adci_assignments
  where id = target_assignment_id;
  select organization_id into target_organization_id
  from public.adci_courses
  where id = assignment_record.course_id;
  if assignment_record.id is null or not public.adci_current_user_has_role(
    target_organization_id,
    array['instructor','content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  ) then raise exception 'Assignment administration permission required'; end if;

  return jsonb_build_object(
    'assignment', jsonb_build_object(
      'id', assignment_record.id,
      'title', assignment_record.title,
      'max_score', assignment_record.max_score,
      'due_at', assignment_record.due_at
    ),
    'submissions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'learner_id', enrolment.learner_id,
        'learner_name', coalesce(nullif(trim(profile.full_name), ''), split_part(user_record.email::text, '@', 1)),
        'learner_email', user_record.email::text,
        'submission_id', submission.id,
        'text_response', submission.text_response,
        'link_url', submission.link_url,
        'file_path', submission.file_path,
        'file_name', submission.file_name,
        'file_mime_type', submission.file_mime_type,
        'file_size_bytes', submission.file_size_bytes,
        'status', coalesce(submission.status, 'not_submitted'),
        'submitted_at', submission.submitted_at,
        'score', submission.score,
        'feedback', submission.feedback,
        'graded_at', submission.graded_at
      ) order by
        case coalesce(submission.status, 'not_submitted')
          when 'submitted' then 0 when 'returned' then 1 when 'graded' then 2 else 3 end,
        coalesce(submission.submitted_at, enrolment.enrolled_at) desc)
      from public.adci_enrolments enrolment
      join public.adci_profiles profile on profile.id = enrolment.learner_id
      join auth.users user_record on user_record.id = enrolment.learner_id
      left join public.adci_assignment_submissions submission
        on submission.assignment_id = target_assignment_id and submission.learner_id = enrolment.learner_id
      where enrolment.course_id = assignment_record.course_id
        and enrolment.status in ('active','completed')
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.adci_admin_grade_assignment_submission(
  target_submission_id uuid,
  awarded_score numeric,
  teacher_feedback text,
  grading_decision text
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare target_organization_id uuid; assignment_max_score numeric; target_assignment_id uuid;
begin
  select course.organization_id, assignment.max_score, assignment.id
  into target_organization_id, assignment_max_score, target_assignment_id
  from public.adci_assignment_submissions submission
  join public.adci_assignments assignment on assignment.id = submission.assignment_id
  join public.adci_courses course on course.id = assignment.course_id
  where submission.id = target_submission_id;
  if target_organization_id is null or not public.adci_current_user_has_role(
    target_organization_id,
    array['instructor','content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  ) then raise exception 'Grading permission required'; end if;
  if grading_decision not in ('graded','returned')
  then raise exception 'Invalid grading decision'; end if;
  if grading_decision = 'graded' and (awarded_score is null or awarded_score < 0 or awarded_score > assignment_max_score)
  then raise exception 'Score must be between zero and the maximum score'; end if;
  if grading_decision = 'returned' and coalesce(trim(teacher_feedback), '') = ''
  then raise exception 'Feedback is required when returning work'; end if;

  update public.adci_assignment_submissions
  set status = grading_decision,
      score = case when grading_decision = 'graded' then awarded_score else null end,
      feedback = nullif(trim(teacher_feedback), ''),
      graded_by = auth.uid(),
      graded_at = now(),
      updated_at = now()
  where id = target_submission_id and status in ('submitted','graded','returned');
  if not found then raise exception 'Submitted work not found'; end if;

  insert into public.adci_audit_events (
    organization_id, actor_id, action, entity_type, entity_id, new_values
  ) values (
    target_organization_id, auth.uid(),
    case when grading_decision = 'graded' then 'submission.graded' else 'submission.returned' end,
    'assignment_submission', target_submission_id,
    jsonb_build_object('assignment_id', target_assignment_id, 'score', awarded_score, 'decision', grading_decision)
  );
end;
$$;

revoke all on function public.adci_admin_get_assignments() from public;
revoke all on function public.adci_admin_save_assignment(uuid,uuid,text,text,text,numeric,timestamptz,timestamptz,public.adci_content_status) from public;
revoke all on function public.adci_admin_archive_assignment(uuid) from public;
revoke all on function public.adci_get_my_assignments() from public;
revoke all on function public.adci_save_my_assignment_submission(uuid,text,text,text,text,text,bigint,boolean) from public;
revoke all on function public.adci_admin_get_assignment_submissions(uuid) from public;
revoke all on function public.adci_admin_grade_assignment_submission(uuid,numeric,text,text) from public;
grant execute on function public.adci_admin_get_assignments() to authenticated;
grant execute on function public.adci_admin_save_assignment(uuid,uuid,text,text,text,numeric,timestamptz,timestamptz,public.adci_content_status) to authenticated;
grant execute on function public.adci_admin_archive_assignment(uuid) to authenticated;
grant execute on function public.adci_get_my_assignments() to authenticated;
grant execute on function public.adci_save_my_assignment_submission(uuid,text,text,text,text,text,bigint,boolean) to authenticated;
grant execute on function public.adci_admin_get_assignment_submissions(uuid) to authenticated;
grant execute on function public.adci_admin_grade_assignment_submission(uuid,numeric,text,text) to authenticated;
