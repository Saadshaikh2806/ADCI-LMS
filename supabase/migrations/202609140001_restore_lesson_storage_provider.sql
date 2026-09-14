-- Restore storage routing lost in the live runtime view update, preserving live status.
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
                      'asset_type', la.asset_type,
                      'storage_provider', la.storage_provider
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
                      'asset_type', 'video',
                      'storage_provider', va.storage_provider
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
                    'status', public.adci_live_class_phase(lc.starts_at, lc.ends_at, lc.live_started_at, lc.live_ended_at),
                    'can_join', public.adci_live_class_can_join(lc.starts_at, lc.ends_at, lc.live_started_at, lc.live_ended_at),
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
