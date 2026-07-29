-- Learner-owned study plan with live-class and assessment calendar events.
-- Safe to run more than once.

create table if not exists public.adci_study_tasks (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references public.adci_profiles on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 160),
  notes text not null default '',
  scheduled_for timestamptz not null,
  duration_minutes integer not null default 30 check (duration_minutes between 5 and 720),
  status text not null default 'pending' check (status in ('pending', 'completed')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.adci_study_tasks enable row level security;

drop policy if exists "learners read own study tasks" on public.adci_study_tasks;
create policy "learners read own study tasks"
on public.adci_study_tasks for select
using (learner_id = auth.uid());

drop policy if exists "learners create own study tasks" on public.adci_study_tasks;
create policy "learners create own study tasks"
on public.adci_study_tasks for insert
with check (learner_id = auth.uid());

drop policy if exists "learners update own study tasks" on public.adci_study_tasks;
create policy "learners update own study tasks"
on public.adci_study_tasks for update
using (learner_id = auth.uid())
with check (learner_id = auth.uid());

drop policy if exists "learners delete own study tasks" on public.adci_study_tasks;
create policy "learners delete own study tasks"
on public.adci_study_tasks for delete
using (learner_id = auth.uid());

create index if not exists adci_study_tasks_learner_schedule_idx
on public.adci_study_tasks (learner_id, scheduled_for);

create or replace function public.adci_get_my_study_plan(
  target_start date,
  target_end date
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare calendar_events jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if target_end < target_start or target_end > target_start + 62 then
    raise exception 'Calendar range must be between 1 and 63 days';
  end if;

  select coalesce(jsonb_agg(event_data order by event_data->>'starts_at'), '[]'::jsonb)
  into calendar_events
  from (
    select jsonb_build_object(
      'id', task.id,
      'event_type', 'personal',
      'title', task.title,
      'subtitle', task.notes,
      'starts_at', task.scheduled_for,
      'ends_at', task.scheduled_for + make_interval(mins => task.duration_minutes),
      'duration_minutes', task.duration_minutes,
      'status', task.status,
      'lesson_id', null,
      'course_id', null
    ) as event_data
    from public.adci_study_tasks task
    where task.learner_id = auth.uid()
      and task.scheduled_for >= (target_start::timestamp at time zone 'Asia/Kolkata')
      and task.scheduled_for < ((target_end + 1)::timestamp at time zone 'Asia/Kolkata')

    union all

    select jsonb_build_object(
      'id', lc.lesson_id,
      'event_type', 'live',
      'title', l.title,
      'subtitle', c.title || ' · ' || lc.instructor_name,
      'starts_at', lc.starts_at,
      'ends_at', lc.ends_at,
      'duration_minutes', greatest(5, extract(epoch from (lc.ends_at - lc.starts_at))::integer / 60),
      'status', case
        when now() between lc.starts_at - interval '15 minutes' and lc.ends_at then 'live'
        when lc.ends_at < now() then 'ended'
        else 'scheduled'
      end,
      'lesson_id', l.id,
      'course_id', c.id,
      'provider', lc.provider
    ) as event_data
    from public.adci_live_classes lc
    join public.adci_lessons l on l.id = lc.lesson_id
    join public.adci_modules m on m.id = l.module_id
    join public.adci_courses c on c.id = m.course_id
    where lc.starts_at >= (target_start::timestamp at time zone 'Asia/Kolkata')
      and lc.starts_at < ((target_end + 1)::timestamp at time zone 'Asia/Kolkata')
      and public.adci_can_access_course(c.id)

    union all

    select jsonb_build_object(
      'id', a.id,
      'event_type', 'assessment',
      'title', a.title,
      'subtitle', c.title,
      'starts_at', coalesce(a.available_until, a.available_from),
      'ends_at', coalesce(a.available_until, a.available_from),
      'duration_minutes', greatest(1, a.duration_seconds / 60),
      'status', case
        when exists (
          select 1 from public.adci_attempts attempt
          where attempt.assessment_id = a.id
            and attempt.learner_id = auth.uid()
            and attempt.status = 'scored'
        ) then 'completed'
        else 'available'
      end,
      'lesson_id', a.lesson_id,
      'course_id', a.course_id
    ) as event_data
    from public.adci_assessments a
    join public.adci_courses c on c.id = a.course_id
    where a.status = 'published'
      and coalesce(a.available_until, a.available_from) >= (target_start::timestamp at time zone 'Asia/Kolkata')
      and coalesce(a.available_until, a.available_from) < ((target_end + 1)::timestamp at time zone 'Asia/Kolkata')
      and public.adci_can_access_course(a.course_id)
  ) combined_events;

  return jsonb_build_object(
    'events', calendar_events,
    'pending_tasks', (
      select count(*) from public.adci_study_tasks task
      where task.learner_id = auth.uid() and task.status = 'pending'
    ),
    'completed_tasks', (
      select count(*) from public.adci_study_tasks task
      where task.learner_id = auth.uid() and task.status = 'completed'
    )
  );
end;
$$;

create or replace function public.adci_create_study_task(
  task_title text,
  task_notes text,
  task_scheduled_for timestamptz,
  task_duration_minutes integer default 30
)
returns public.adci_study_tasks
language plpgsql security definer set search_path = ''
as $$
declare task_record public.adci_study_tasks;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if trim(task_title) = '' then raise exception 'Task title is required'; end if;

  insert into public.adci_study_tasks (
    learner_id, title, notes, scheduled_for, duration_minutes
  ) values (
    auth.uid(),
    trim(task_title),
    coalesce(trim(task_notes), ''),
    task_scheduled_for,
    greatest(5, least(720, task_duration_minutes))
  )
  returning * into task_record;

  return task_record;
end;
$$;

create or replace function public.adci_set_study_task_completed(
  target_task_id uuid,
  target_completed boolean
)
returns public.adci_study_tasks
language plpgsql security definer set search_path = ''
as $$
declare task_record public.adci_study_tasks;
begin
  update public.adci_study_tasks
  set
    status = case when target_completed then 'completed' else 'pending' end,
    completed_at = case when target_completed then now() else null end,
    updated_at = now()
  where id = target_task_id and learner_id = auth.uid()
  returning * into task_record;

  if task_record.id is null then raise exception 'Study task not found'; end if;
  return task_record;
end;
$$;

create or replace function public.adci_delete_study_task(target_task_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.adci_study_tasks
  where id = target_task_id and learner_id = auth.uid();
  if not found then raise exception 'Study task not found'; end if;
end;
$$;

revoke all on function public.adci_get_my_study_plan(date,date) from public;
revoke all on function public.adci_create_study_task(text,text,timestamptz,integer) from public;
revoke all on function public.adci_set_study_task_completed(uuid,boolean) from public;
revoke all on function public.adci_delete_study_task(uuid) from public;
grant execute on function public.adci_get_my_study_plan(date,date) to authenticated;
grant execute on function public.adci_create_study_task(text,text,timestamptz,integer) to authenticated;
grant execute on function public.adci_set_study_task_completed(uuid,boolean) to authenticated;
grant execute on function public.adci_delete_study_task(uuid) to authenticated;
