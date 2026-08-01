-- Full learner schedule for the dedicated Live Classes workspace.

create or replace function public.adci_get_my_live_class_workspace(
  past_days integer default 180,
  future_days integer default 365
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'lesson_id', lesson.id,
    'lesson_title', lesson.title,
    'course_id', course.id,
    'course_title', course.title,
    'module_title', module.title,
    'provider', live_class.provider,
    'instructor_name', live_class.instructor_name,
    'starts_at', live_class.starts_at,
    'ends_at', live_class.ends_at,
    'can_join', now() between live_class.starts_at - interval '15 minutes' and live_class.ends_at,
    'has_attended', attendance.id is not null,
    'joined_at', attendance.joined_at,
    'last_joined_at', attendance.last_joined_at,
    'join_count', coalesce(attendance.join_count, 0)
  ) order by live_class.starts_at), '[]'::jsonb)
  from public.adci_live_classes live_class
  join public.adci_lessons lesson on lesson.id = live_class.lesson_id
  join public.adci_modules module on module.id = lesson.module_id
  join public.adci_courses course on course.id = module.course_id
  left join public.adci_live_attendance attendance
    on attendance.lesson_id = lesson.id
   and attendance.learner_id = auth.uid()
  where auth.uid() is not null
    and lesson.status = 'published'
    and course.status = 'published'
    and live_class.starts_at >= now() - make_interval(days => greatest(1, least(730, coalesce(past_days, 180))))
    and live_class.starts_at <= now() + make_interval(days => greatest(1, least(730, coalesce(future_days, 365))))
    and public.adci_can_access_course(course.id);
$$;

revoke all on function public.adci_get_my_live_class_workspace(integer, integer) from public;
grant execute on function public.adci_get_my_live_class_workspace(integer, integer) to authenticated;
