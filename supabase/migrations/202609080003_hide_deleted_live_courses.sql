begin;

-- The People > Manage course-access dialog listed every non-retired course,
-- including live-session courses whose class had been deleted. Older deletions
-- (before 202609050002) only removed the adci_live_classes row and left the
-- course "published", so those stranded courses kept showing here.
--
-- Hide a course from this dialog when it still holds non-retired live lessons
-- but none of its remaining lessons are usable (a non-live lesson, or a live
-- lesson that is still scheduled). Regular academic courses and empty drafts
-- are unaffected.
create or replace function public.adci_admin_get_user_enrolments(target_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare target_organization_id uuid;
begin
  select id into target_organization_id from public.adci_organizations where slug = 'adci';
  if not public.adci_current_user_has_role(target_organization_id,
    array['branch_admin','super_admin']::public.adci_app_role[])
  then raise exception 'Administration permission required'; end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'course_id', c.id, 'title', c.title, 'status', c.status,
      'enrolment_status', e.status, 'access_expires_at', e.access_expires_at,
      'enrolled_at', e.enrolled_at
    ) order by c.title), '[]'::jsonb)
    from public.adci_courses c
    left join public.adci_enrolments e on e.course_id = c.id and e.learner_id = target_user_id
    where c.organization_id = target_organization_id and c.status <> 'retired'
      and not (
        exists (
          select 1 from public.adci_lessons l
          join public.adci_modules m on m.id = l.module_id
          where m.course_id = c.id and l.lesson_type = 'live' and l.status <> 'retired'
        )
        and not exists (
          select 1 from public.adci_lessons l
          join public.adci_modules m on m.id = l.module_id
          left join public.adci_live_classes lc on lc.lesson_id = l.id
          where m.course_id = c.id and l.status <> 'retired'
            and (l.lesson_type <> 'live' or lc.lesson_id is not null)
        )
      )
  );
end;
$$;

revoke all on function public.adci_admin_get_user_enrolments(uuid) from public, anon;
grant execute on function public.adci_admin_get_user_enrolments(uuid) to authenticated;

commit;
