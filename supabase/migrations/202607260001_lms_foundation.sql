create extension if not exists pgcrypto;

create type public.adci_app_role as enum (
  'student', 'instructor', 'content_author', 'academic_lead',
  'mentor', 'branch_admin', 'finance', 'super_admin', 'support'
);
create type public.adci_content_status as enum ('draft', 'in_review', 'approved', 'published', 'retired');
create type public.adci_enrolment_status as enum ('pending', 'active', 'frozen', 'completed', 'cancelled');
create type public.adci_attempt_status as enum ('not_started', 'in_progress', 'submitted', 'scored', 'void');

create table public.adci_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table public.adci_branches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.adci_organizations on delete cascade,
  name text not null,
  code text not null,
  timezone text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table public.adci_profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text not null default '',
  phone text,
  avatar_path text,
  locale text not null default 'en-IN',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.adci_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.adci_profiles on delete cascade,
  organization_id uuid not null references public.adci_organizations on delete cascade,
  branch_id uuid references public.adci_branches on delete cascade,
  role public.adci_app_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, organization_id, branch_id, role)
);

create table public.adci_courses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.adci_organizations on delete cascade,
  title text not null,
  slug text not null,
  description text not null default '',
  status public.adci_content_status not null default 'draft',
  owner_id uuid references public.adci_profiles,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);

create table public.adci_modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.adci_courses on delete cascade,
  title text not null,
  position integer not null check (position > 0),
  release_at timestamptz,
  unique (course_id, position)
);

create table public.adci_lessons (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.adci_modules on delete cascade,
  title text not null,
  lesson_type text not null check (lesson_type in ('video','audio','pdf','html','live','quiz')),
  position integer not null check (position > 0),
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  status public.adci_content_status not null default 'draft',
  prerequisite_lesson_id uuid references public.adci_lessons,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (module_id, position)
);

create table public.adci_video_assets (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null unique references public.adci_lessons on delete cascade,
  storage_provider text not null default 'supabase',
  object_path text not null unique,
  mime_type text not null default 'video/mp4',
  size_bytes bigint check (size_bytes >= 0),
  duration_seconds integer check (duration_seconds >= 0),
  processing_status text not null default 'ready',
  created_at timestamptz not null default now()
);

create table public.adci_enrolments (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references public.adci_profiles on delete cascade,
  course_id uuid not null references public.adci_courses on delete cascade,
  branch_id uuid references public.adci_branches,
  status public.adci_enrolment_status not null default 'pending',
  enrolled_at timestamptz not null default now(),
  access_expires_at timestamptz,
  unique (learner_id, course_id)
);

create table public.adci_lesson_progress (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references public.adci_profiles on delete cascade,
  lesson_id uuid not null references public.adci_lessons on delete cascade,
  progress_percent numeric(5,2) not null default 0 check (progress_percent between 0 and 100),
  position_seconds integer not null default 0 check (position_seconds >= 0),
  completed_at timestamptz,
  last_activity_at timestamptz not null default now(),
  unique (learner_id, lesson_id)
);

create table public.adci_assessments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.adci_courses on delete cascade,
  title text not null,
  duration_seconds integer not null check (duration_seconds > 0),
  positive_marks numeric(8,2) not null default 1,
  negative_marks numeric(8,2) not null default 0,
  status public.adci_content_status not null default 'draft',
  available_from timestamptz,
  available_until timestamptz,
  created_at timestamptz not null default now()
);

create table public.adci_questions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.adci_organizations on delete cascade,
  prompt text not null,
  question_type text not null default 'single_choice',
  options jsonb not null default '[]'::jsonb,
  correct_answer jsonb not null,
  explanation text,
  topic text,
  difficulty text,
  version integer not null default 1,
  created_by uuid references public.adci_profiles,
  created_at timestamptz not null default now()
);

create table public.adci_assessment_questions (
  assessment_id uuid not null references public.adci_assessments on delete cascade,
  question_id uuid not null references public.adci_questions,
  position integer not null,
  marks numeric(8,2),
  primary key (assessment_id, question_id),
  unique (assessment_id, position)
);

create table public.adci_attempts (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.adci_assessments,
  learner_id uuid not null references public.adci_profiles,
  status public.adci_attempt_status not null default 'not_started',
  server_started_at timestamptz,
  server_deadline_at timestamptz,
  submitted_at timestamptz,
  score numeric(10,2),
  submission_key uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  unique (submission_key)
);

create table public.adci_attempt_answers (
  attempt_id uuid not null references public.adci_attempts on delete cascade,
  question_id uuid not null references public.adci_questions,
  answer jsonb,
  flagged boolean not null default false,
  saved_at timestamptz not null default now(),
  primary key (attempt_id, question_id)
);

create table public.adci_audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.adci_organizations,
  actor_id uuid references public.adci_profiles,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  old_values jsonb,
  new_values jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create or replace function public.adci_current_user_has_role(
  requested_org uuid,
  allowed_roles public.adci_app_role[]
) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.adci_memberships m
    where m.user_id = auth.uid()
      and m.organization_id = requested_org
      and m.active
      and m.role = any(allowed_roles)
  );
$$;

create or replace function public.adci_can_access_course(requested_course uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.adci_enrolments e
    where e.course_id = requested_course
      and e.learner_id = auth.uid()
      and e.status = 'active'
      and (e.access_expires_at is null or e.access_expires_at > now())
  ) or exists (
    select 1 from public.adci_courses c
    where c.id = requested_course
      and public.adci_current_user_has_role(
        c.organization_id,
        array['instructor','content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
      )
  );
$$;

create or replace function public.adci_handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.adci_profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger adci_on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.adci_handle_new_user();

alter table public.adci_organizations enable row level security;
alter table public.adci_branches enable row level security;
alter table public.adci_profiles enable row level security;
alter table public.adci_memberships enable row level security;
alter table public.adci_courses enable row level security;
alter table public.adci_modules enable row level security;
alter table public.adci_lessons enable row level security;
alter table public.adci_video_assets enable row level security;
alter table public.adci_enrolments enable row level security;
alter table public.adci_lesson_progress enable row level security;
alter table public.adci_assessments enable row level security;
alter table public.adci_questions enable row level security;
alter table public.adci_assessment_questions enable row level security;
alter table public.adci_attempts enable row level security;
alter table public.adci_attempt_answers enable row level security;
alter table public.adci_audit_events enable row level security;

create policy "members read adci_organizations" on public.adci_organizations for select using (
  exists (select 1 from public.adci_memberships m where m.organization_id = id and m.user_id = auth.uid() and m.active)
);
create policy "members read adci_branches" on public.adci_branches for select using (
  exists (select 1 from public.adci_memberships m where m.organization_id = organization_id and m.user_id = auth.uid() and m.active)
);
create policy "adci_profiles self read" on public.adci_profiles for select using (id = auth.uid());
create policy "adci_profiles self update" on public.adci_profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy "adci_memberships self read" on public.adci_memberships for select using (user_id = auth.uid());
create policy "learners read own adci_enrolments" on public.adci_enrolments for select using (learner_id = auth.uid());
create policy "course access" on public.adci_courses for select using (public.adci_can_access_course(id));
create policy "module access" on public.adci_modules for select using (public.adci_can_access_course(course_id));
create policy "lesson access" on public.adci_lessons for select using (
  exists (select 1 from public.adci_modules m where m.id = module_id and public.adci_can_access_course(m.course_id))
);
create policy "video metadata access" on public.adci_video_assets for select using (
  exists (
    select 1 from public.adci_lessons l
    join public.adci_modules m on m.id = l.module_id
    where l.id = lesson_id and public.adci_can_access_course(m.course_id)
  )
);
create policy "learner progress read" on public.adci_lesson_progress for select using (learner_id = auth.uid());
create policy "learner progress insert" on public.adci_lesson_progress for insert with check (learner_id = auth.uid());
create policy "learner progress update" on public.adci_lesson_progress for update using (learner_id = auth.uid()) with check (learner_id = auth.uid());
create policy "learner adci_attempts read" on public.adci_attempts for select using (learner_id = auth.uid());
create policy "learner answers read" on public.adci_attempt_answers for select using (
  exists (select 1 from public.adci_attempts a where a.id = attempt_id and a.learner_id = auth.uid())
);
create policy "academic staff create adci_courses" on public.adci_courses for insert with check (
  public.adci_current_user_has_role(organization_id, array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[])
);
create policy "academic staff update adci_courses" on public.adci_courses for update using (
  public.adci_current_user_has_role(organization_id, array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[])
) with check (
  public.adci_current_user_has_role(organization_id, array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[])
);
create policy "academic staff manage adci_questions" on public.adci_questions for all using (
  public.adci_current_user_has_role(organization_id, array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[])
) with check (
  public.adci_current_user_has_role(organization_id, array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[])
);
create policy "admins read audit events" on public.adci_audit_events for select using (
  public.adci_current_user_has_role(organization_id, array['branch_admin','super_admin','support']::public.adci_app_role[])
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('adci-course-videos', 'adci-course-videos', false, 5368709120, array['video/mp4','video/webm'])
on conflict (id) do nothing;

create policy "enrolled learners stream videos"
on storage.objects for select to authenticated
using (
  bucket_id = 'adci-course-videos'
  and exists (
    select 1
    from public.adci_video_assets va
    join public.adci_lessons l on l.id = va.lesson_id
    join public.adci_modules m on m.id = l.module_id
    where va.object_path = name
      and public.adci_can_access_course(m.course_id)
  )
);

create index adci_enrolments_learner_status_idx on public.adci_enrolments (learner_id, status);
create index adci_lesson_progress_learner_activity_idx on public.adci_lesson_progress (learner_id, last_activity_at desc);
create index adci_attempts_learner_assessment_idx on public.adci_attempts (learner_id, assessment_id);
create index adci_audit_events_org_created_idx on public.adci_audit_events (organization_id, created_at desc);

