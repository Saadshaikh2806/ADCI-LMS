create extension if not exists pgcrypto;

create type public.app_role as enum (
  'student', 'instructor', 'content_author', 'academic_lead',
  'mentor', 'branch_admin', 'finance', 'super_admin', 'support'
);
create type public.content_status as enum ('draft', 'in_review', 'approved', 'published', 'retired');
create type public.enrolment_status as enum ('pending', 'active', 'frozen', 'completed', 'cancelled');
create type public.attempt_status as enum ('not_started', 'in_progress', 'submitted', 'scored', 'void');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  name text not null,
  code text not null,
  timezone text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text not null default '',
  phone text,
  avatar_path text,
  locale text not null default 'en-IN',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  organization_id uuid not null references public.organizations on delete cascade,
  branch_id uuid references public.branches on delete cascade,
  role public.app_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, organization_id, branch_id, role)
);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  title text not null,
  slug text not null,
  description text not null default '',
  status public.content_status not null default 'draft',
  owner_id uuid references public.profiles,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);

create table public.modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses on delete cascade,
  title text not null,
  position integer not null check (position > 0),
  release_at timestamptz,
  unique (course_id, position)
);

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.modules on delete cascade,
  title text not null,
  lesson_type text not null check (lesson_type in ('video','audio','pdf','html','live','quiz')),
  position integer not null check (position > 0),
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  status public.content_status not null default 'draft',
  prerequisite_lesson_id uuid references public.lessons,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (module_id, position)
);

create table public.video_assets (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null unique references public.lessons on delete cascade,
  storage_provider text not null default 'supabase',
  object_path text not null unique,
  mime_type text not null default 'video/mp4',
  size_bytes bigint check (size_bytes >= 0),
  duration_seconds integer check (duration_seconds >= 0),
  processing_status text not null default 'ready',
  created_at timestamptz not null default now()
);

create table public.enrolments (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references public.profiles on delete cascade,
  course_id uuid not null references public.courses on delete cascade,
  branch_id uuid references public.branches,
  status public.enrolment_status not null default 'pending',
  enrolled_at timestamptz not null default now(),
  access_expires_at timestamptz,
  unique (learner_id, course_id)
);

create table public.lesson_progress (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references public.profiles on delete cascade,
  lesson_id uuid not null references public.lessons on delete cascade,
  progress_percent numeric(5,2) not null default 0 check (progress_percent between 0 and 100),
  position_seconds integer not null default 0 check (position_seconds >= 0),
  completed_at timestamptz,
  last_activity_at timestamptz not null default now(),
  unique (learner_id, lesson_id)
);

create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses on delete cascade,
  title text not null,
  duration_seconds integer not null check (duration_seconds > 0),
  positive_marks numeric(8,2) not null default 1,
  negative_marks numeric(8,2) not null default 0,
  status public.content_status not null default 'draft',
  available_from timestamptz,
  available_until timestamptz,
  created_at timestamptz not null default now()
);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  prompt text not null,
  question_type text not null default 'single_choice',
  options jsonb not null default '[]'::jsonb,
  correct_answer jsonb not null,
  explanation text,
  topic text,
  difficulty text,
  version integer not null default 1,
  created_by uuid references public.profiles,
  created_at timestamptz not null default now()
);

create table public.assessment_questions (
  assessment_id uuid not null references public.assessments on delete cascade,
  question_id uuid not null references public.questions,
  position integer not null,
  marks numeric(8,2),
  primary key (assessment_id, question_id),
  unique (assessment_id, position)
);

create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments,
  learner_id uuid not null references public.profiles,
  status public.attempt_status not null default 'not_started',
  server_started_at timestamptz,
  server_deadline_at timestamptz,
  submitted_at timestamptz,
  score numeric(10,2),
  submission_key uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  unique (submission_key)
);

create table public.attempt_answers (
  attempt_id uuid not null references public.attempts on delete cascade,
  question_id uuid not null references public.questions,
  answer jsonb,
  flagged boolean not null default false,
  saved_at timestamptz not null default now(),
  primary key (attempt_id, question_id)
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations,
  actor_id uuid references public.profiles,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  old_values jsonb,
  new_values jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create or replace function public.current_user_has_role(
  requested_org uuid,
  allowed_roles public.app_role[]
) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.organization_id = requested_org
      and m.active
      and m.role = any(allowed_roles)
  );
$$;

create or replace function public.can_access_course(requested_course uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.enrolments e
    where e.course_id = requested_course
      and e.learner_id = auth.uid()
      and e.status = 'active'
      and (e.access_expires_at is null or e.access_expires_at > now())
  ) or exists (
    select 1 from public.courses c
    where c.id = requested_course
      and public.current_user_has_role(
        c.organization_id,
        array['instructor','content_author','academic_lead','branch_admin','super_admin']::public.app_role[]
      )
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

alter table public.organizations enable row level security;
alter table public.branches enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.courses enable row level security;
alter table public.modules enable row level security;
alter table public.lessons enable row level security;
alter table public.video_assets enable row level security;
alter table public.enrolments enable row level security;
alter table public.lesson_progress enable row level security;
alter table public.assessments enable row level security;
alter table public.questions enable row level security;
alter table public.assessment_questions enable row level security;
alter table public.attempts enable row level security;
alter table public.attempt_answers enable row level security;
alter table public.audit_events enable row level security;

create policy "members read organizations" on public.organizations for select using (
  exists (select 1 from public.memberships m where m.organization_id = id and m.user_id = auth.uid() and m.active)
);
create policy "members read branches" on public.branches for select using (
  exists (select 1 from public.memberships m where m.organization_id = organization_id and m.user_id = auth.uid() and m.active)
);
create policy "profiles self read" on public.profiles for select using (id = auth.uid());
create policy "profiles self update" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy "memberships self read" on public.memberships for select using (user_id = auth.uid());
create policy "learners read own enrolments" on public.enrolments for select using (learner_id = auth.uid());
create policy "course access" on public.courses for select using (public.can_access_course(id));
create policy "module access" on public.modules for select using (public.can_access_course(course_id));
create policy "lesson access" on public.lessons for select using (
  exists (select 1 from public.modules m where m.id = module_id and public.can_access_course(m.course_id))
);
create policy "video metadata access" on public.video_assets for select using (
  exists (
    select 1 from public.lessons l
    join public.modules m on m.id = l.module_id
    where l.id = lesson_id and public.can_access_course(m.course_id)
  )
);
create policy "learner progress read" on public.lesson_progress for select using (learner_id = auth.uid());
create policy "learner progress insert" on public.lesson_progress for insert with check (learner_id = auth.uid());
create policy "learner progress update" on public.lesson_progress for update using (learner_id = auth.uid()) with check (learner_id = auth.uid());
create policy "learner attempts read" on public.attempts for select using (learner_id = auth.uid());
create policy "learner answers read" on public.attempt_answers for select using (
  exists (select 1 from public.attempts a where a.id = attempt_id and a.learner_id = auth.uid())
);
create policy "academic staff create courses" on public.courses for insert with check (
  public.current_user_has_role(organization_id, array['content_author','academic_lead','branch_admin','super_admin']::public.app_role[])
);
create policy "academic staff update courses" on public.courses for update using (
  public.current_user_has_role(organization_id, array['content_author','academic_lead','branch_admin','super_admin']::public.app_role[])
) with check (
  public.current_user_has_role(organization_id, array['content_author','academic_lead','branch_admin','super_admin']::public.app_role[])
);
create policy "academic staff manage questions" on public.questions for all using (
  public.current_user_has_role(organization_id, array['content_author','academic_lead','branch_admin','super_admin']::public.app_role[])
) with check (
  public.current_user_has_role(organization_id, array['content_author','academic_lead','branch_admin','super_admin']::public.app_role[])
);
create policy "admins read audit events" on public.audit_events for select using (
  public.current_user_has_role(organization_id, array['branch_admin','super_admin','support']::public.app_role[])
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('course-videos', 'course-videos', false, 5368709120, array['video/mp4','video/webm'])
on conflict (id) do nothing;

create policy "enrolled learners stream videos"
on storage.objects for select to authenticated
using (
  bucket_id = 'course-videos'
  and exists (
    select 1
    from public.video_assets va
    join public.lessons l on l.id = va.lesson_id
    join public.modules m on m.id = l.module_id
    where va.object_path = name
      and public.can_access_course(m.course_id)
  )
);

create index enrolments_learner_status_idx on public.enrolments (learner_id, status);
create index lesson_progress_learner_activity_idx on public.lesson_progress (learner_id, last_activity_at desc);
create index attempts_learner_assessment_idx on public.attempts (learner_id, assessment_id);
create index audit_events_org_created_idx on public.audit_events (organization_id, created_at desc);
