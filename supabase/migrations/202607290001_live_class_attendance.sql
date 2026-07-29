create table if not exists public.adci_live_attendance (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.adci_lessons on delete cascade,
  learner_id uuid not null references public.adci_profiles on delete cascade,
  joined_at timestamptz not null default now(),
  last_joined_at timestamptz not null default now(),
  join_count integer not null default 1,
  unique (lesson_id, learner_id)
);

alter table public.adci_live_attendance enable row level security;

drop policy if exists "learners read own live attendance" on public.adci_live_attendance;
create policy "learners read own live attendance"
on public.adci_live_attendance for select
using (learner_id = auth.uid());

drop policy if exists "academic staff read live attendance" on public.adci_live_attendance;
create policy "academic staff read live attendance"
on public.adci_live_attendance for select
using (
  exists (
    select 1 from public.adci_lessons l
    join public.adci_modules m on m.id = l.module_id
    join public.adci_courses c on c.id = m.course_id
    where l.id = lesson_id
      and public.adci_current_user_has_role(
        c.organization_id,
        array['instructor','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
      )
  )
);

create or replace function public.adci_get_my_live_classes()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'lesson_id', l.id,
    'lesson_title', l.title,
    'course_title', c.title,
    'module_title', m.title,
    'provider', lc.provider,
    'instructor_name', lc.instructor_name,
    'starts_at', lc.starts_at,
    'ends_at', lc.ends_at,
    'can_join', now() between lc.starts_at - interval '15 minutes' and lc.ends_at,
    'has_attended', exists (
      select 1 from public.adci_live_attendance la
      where la.lesson_id = l.id and la.learner_id = auth.uid()
    )
  ) order by lc.starts_at), '[]'::jsonb)
  from public.adci_live_classes lc
  join public.adci_lessons l on l.id = lc.lesson_id
  join public.adci_modules m on m.id = l.module_id
  join public.adci_courses c on c.id = m.course_id
  where lc.ends_at >= now() - interval '24 hours'
    and public.adci_can_access_course(c.id);
$$;

create or replace function public.adci_join_live_class(target_lesson_id uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare class_record public.adci_live_classes; target_course_id uuid;
begin
  select lc.* into class_record
  from public.adci_live_classes lc
  where lc.lesson_id = target_lesson_id;

  select m.course_id into target_course_id
  from public.adci_live_classes lc
  join public.adci_lessons l on l.id = lc.lesson_id
  join public.adci_modules m on m.id = l.module_id
  where lc.lesson_id = target_lesson_id;

  if class_record.lesson_id is null or not public.adci_can_access_course(target_course_id)
  then raise exception 'Live class is not available to this account'; end if;

  if now() not between class_record.starts_at - interval '15 minutes' and class_record.ends_at
  then raise exception 'The Join button opens 15 minutes before class'; end if;

  insert into public.adci_live_attendance (lesson_id, learner_id)
  values (target_lesson_id, auth.uid())
  on conflict (lesson_id, learner_id) do update set
    last_joined_at = now(),
    join_count = public.adci_live_attendance.join_count + 1;

  return class_record.meeting_url;
end;
$$;

revoke all on function public.adci_get_my_live_classes() from public;
revoke all on function public.adci_join_live_class(uuid) from public;
grant execute on function public.adci_get_my_live_classes() to authenticated;
grant execute on function public.adci_join_live_class(uuid) to authenticated;
