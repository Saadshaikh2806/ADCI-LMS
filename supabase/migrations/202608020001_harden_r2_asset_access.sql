-- Applies the R2 authorization fix safely to projects where migration 009 was already run.

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
        and lesson.status = 'published'
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

revoke all on function public.adci_can_manage_lesson_assets(uuid) from public;
revoke all on function public.adci_can_access_lesson(uuid) from public;
revoke all on function public.adci_can_access_lesson_asset(uuid,text) from public;
grant execute on function public.adci_can_manage_lesson_assets(uuid) to authenticated;
grant execute on function public.adci_can_access_lesson(uuid) to authenticated;
grant execute on function public.adci_can_access_lesson_asset(uuid,text) to authenticated;
