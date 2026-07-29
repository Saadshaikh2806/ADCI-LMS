-- Protected learner curriculum, lesson content and progress.
-- This migration is safe to run more than once.

create or replace function public.adci_can_access_course(requested_course uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.adci_enrolments e
    where e.course_id = requested_course
      and e.learner_id = auth.uid()
      and e.status in ('active', 'completed')
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

create or replace function public.adci_get_course_learning_view(target_course_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare course_payload jsonb;
begin
  if auth.uid() is null or not public.adci_can_access_course(target_course_id) then
    raise exception 'This course is not available to your account';
  end if;

  select jsonb_build_object(
    'id', c.id,
    'title', c.title,
    'slug', c.slug,
    'description', c.description,
    'modules', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'title', m.title,
          'position', m.position,
          'lessons', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', l.id,
                'title', l.title,
                'lesson_type', l.lesson_type,
                'position', l.position,
                'duration_seconds', l.duration_seconds,
                'status', l.status,
                'progress_percent', coalesce(lp.progress_percent, 0),
                'position_seconds', coalesce(lp.position_seconds, 0),
                'completed', lp.completed_at is not null,
                'asset', coalesce(
                  (
                    select jsonb_build_object(
                      'bucket', 'adci-lesson-assets',
                      'object_path', la.object_path,
                      'mime_type', la.mime_type,
                      'original_name', la.original_name,
                      'asset_type', la.asset_type
                    )
                    from public.adci_lesson_assets la
                    where la.lesson_id = l.id
                    order by la.created_at desc
                    limit 1
                  ),
                  (
                    select jsonb_build_object(
                      'bucket', 'adci-course-videos',
                      'object_path', va.object_path,
                      'mime_type', va.mime_type,
                      'original_name', l.title,
                      'asset_type', 'video'
                    )
                    from public.adci_video_assets va
                    where va.lesson_id = l.id
                    limit 1
                  ),
                  'null'::jsonb
                ),
                'article_body', (
                  select ac.body from public.adci_article_contents ac
                  where ac.lesson_id = l.id
                ),
                'live_class', (
                  select jsonb_build_object(
                    'provider', lc.provider,
                    'instructor_name', lc.instructor_name,
                    'starts_at', lc.starts_at,
                    'ends_at', lc.ends_at,
                    'can_join', now() between lc.starts_at - interval '15 minutes' and lc.ends_at,
                    'has_attended', exists (
                      select 1 from public.adci_live_attendance lat
                      where lat.lesson_id = l.id and lat.learner_id = auth.uid()
                    )
                  )
                  from public.adci_live_classes lc
                  where lc.lesson_id = l.id
                ),
                'quiz', (
                  select jsonb_build_object('assessment_id', a.id, 'title', a.title)
                  from public.adci_assessments a
                  where a.lesson_id = l.id and a.status = 'published'
                  limit 1
                )
              )
              order by l.position
            )
            from public.adci_lessons l
            left join public.adci_lesson_progress lp
              on lp.lesson_id = l.id and lp.learner_id = auth.uid()
            where l.module_id = m.id
          ), '[]'::jsonb)
        )
        order by m.position
      )
      from public.adci_modules m
      where m.course_id = c.id
    ), '[]'::jsonb)
  )
  into course_payload
  from public.adci_courses c
  where c.id = target_course_id;

  if course_payload is null then
    raise exception 'Course not found';
  end if;

  return course_payload;
end;
$$;

create or replace function public.adci_mark_lesson_progress(
  target_lesson_id uuid,
  target_progress numeric,
  target_position_seconds integer default 0,
  mark_complete boolean default false
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare target_course_id uuid; progress_record public.adci_lesson_progress;
begin
  select m.course_id into target_course_id
  from public.adci_lessons l
  join public.adci_modules m on m.id = l.module_id
  where l.id = target_lesson_id;

  if auth.uid() is null or target_course_id is null
     or not public.adci_can_access_course(target_course_id) then
    raise exception 'This lesson is not available to your account';
  end if;

  insert into public.adci_lesson_progress (
    learner_id, lesson_id, progress_percent, position_seconds,
    completed_at, last_activity_at
  ) values (
    auth.uid(),
    target_lesson_id,
    case when mark_complete then 100 else least(100, greatest(0, target_progress)) end,
    greatest(0, target_position_seconds),
    case when mark_complete or target_progress >= 100 then now() else null end,
    now()
  )
  on conflict (learner_id, lesson_id) do update set
    progress_percent = greatest(
      public.adci_lesson_progress.progress_percent,
      excluded.progress_percent
    ),
    position_seconds = greatest(
      public.adci_lesson_progress.position_seconds,
      excluded.position_seconds
    ),
    completed_at = coalesce(
      public.adci_lesson_progress.completed_at,
      excluded.completed_at
    ),
    last_activity_at = now()
  returning * into progress_record;

  return jsonb_build_object(
    'lesson_id', progress_record.lesson_id,
    'progress_percent', progress_record.progress_percent,
    'position_seconds', progress_record.position_seconds,
    'completed', progress_record.completed_at is not null
  );
end;
$$;

drop policy if exists "enrolled learners read protected lesson files" on storage.objects;
create policy "enrolled learners read protected lesson files"
on storage.objects for select to authenticated
using (
  bucket_id = 'adci-lesson-assets'
  and exists (
    select 1
    from public.adci_lesson_assets la
    join public.adci_lessons l on l.id = la.lesson_id
    join public.adci_modules m on m.id = l.module_id
    where la.object_path = name
      and public.adci_can_access_course(m.course_id)
  )
);

revoke all on function public.adci_get_course_learning_view(uuid) from public;
revoke all on function public.adci_mark_lesson_progress(uuid,numeric,integer,boolean) from public;
grant execute on function public.adci_get_course_learning_view(uuid) to authenticated;
grant execute on function public.adci_mark_lesson_progress(uuid,numeric,integer,boolean) to authenticated;
