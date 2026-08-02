-- Adds authorization RPCs for Cloudflare R2 lesson video storage and
-- exposes storage_provider on the learner course view so the client knows
-- which signing backend (Supabase Storage vs R2) to use for a given asset.

create or replace function public.adci_can_manage_lesson_assets(target_lesson_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.adci_lessons l
    join public.adci_modules m on m.id = l.module_id
    join public.adci_courses c on c.id = m.course_id
    where l.id = target_lesson_id
      and public.adci_current_user_has_role(
        c.organization_id,
        array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
      )
  );
$$;

create or replace function public.adci_can_access_lesson(target_lesson_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.adci_lessons l
    join public.adci_modules m on m.id = l.module_id
    where l.id = target_lesson_id
      and public.adci_can_access_course(m.course_id)
  );
$$;

create or replace function public.adci_can_access_lesson_asset(
  target_lesson_id uuid,
  target_object_path text
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null
    and char_length(coalesce(target_object_path, '')) between 1 and 500
    and exists (
      select 1
      from public.adci_lessons lesson
      join public.adci_modules module on module.id = lesson.module_id
      where lesson.id = target_lesson_id
        and public.adci_can_access_course(module.course_id)
        and (
          exists (
            select 1 from public.adci_lesson_assets asset
            where asset.lesson_id = lesson.id
              and asset.object_path = target_object_path
              and asset.storage_provider = 'r2'
          )
          or exists (
            select 1 from public.adci_video_assets video
            where video.lesson_id = lesson.id
              and video.object_path = target_object_path
              and video.storage_provider = 'r2'
          )
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

revoke all on function public.adci_can_manage_lesson_assets(uuid) from public;
revoke all on function public.adci_can_access_lesson(uuid) from public;
revoke all on function public.adci_can_access_lesson_asset(uuid,text) from public;
grant execute on function public.adci_can_manage_lesson_assets(uuid) to authenticated;
grant execute on function public.adci_can_access_lesson(uuid) to authenticated;
grant execute on function public.adci_can_access_lesson_asset(uuid,text) to authenticated;
