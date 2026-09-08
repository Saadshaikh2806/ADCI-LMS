-- A bookable live-lecture course can end up with no lessons at all (its live
-- lesson was removed separately, or a partial cleanup left only the course
-- row). 202609080003 / 202609090002 both required the course to still hold a
-- live lesson, so those empty shells stayed visible in People > Manage and in
-- the bulk-grant picker, and the nightly sweep never archived them.
--
-- Treat a course as a spent live lecture when it carries the bookable-series
-- slug ("<title>-YYYY-MM-DD-<8 hex>", only ever produced by
-- adci_create_bookable_live_series) OR still holds a live lesson, AND has
-- nothing left worth granting: no non-live lesson, and no live lesson whose
-- class is still scheduled or running.
begin;

create or replace function public.adci_retire_ended_live_courses()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  org_id uuid := public.adci_admin_org();
  retired_ids uuid[];
begin
  with spent_live_courses as (
    select c.id
    from public.adci_courses c
    where c.organization_id = org_id
      and c.status <> 'retired'
      -- adci_create_bookable_live_series slug shape: "<title>-YYYY-MM-DD-<8 hex>"
      and c.slug ~ '-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9a-f]{8}$'
      -- no non-live content
      and not exists (
        select 1 from public.adci_lessons l
        join public.adci_modules m on m.id = l.module_id
        where m.course_id = c.id and l.status <> 'retired' and l.lesson_type <> 'live'
      )
      -- nothing still scheduled or running
      and not exists (
        select 1 from public.adci_lessons l
        join public.adci_modules m on m.id = l.module_id
        join public.adci_live_classes lc on lc.lesson_id = l.id
        where m.course_id = c.id and l.status <> 'retired' and l.lesson_type = 'live'
          and public.adci_live_class_phase(lc.starts_at, lc.ends_at, lc.live_started_at, lc.live_ended_at) <> 'ended'
      )
  )
  select coalesce(array_agg(id), '{}') into retired_ids from spent_live_courses;

  if array_length(retired_ids, 1) is null then
    return jsonb_build_object('retired', 0);
  end if;

  update public.adci_course_offers set active = false
    where course_id = any(retired_ids) and active;

  update public.adci_lessons l set status = 'retired'
    from public.adci_modules m
    where m.id = l.module_id and m.course_id = any(retired_ids)
      and l.lesson_type = 'live' and l.status <> 'retired';

  update public.adci_courses set status = 'retired', updated_at = now()
    where id = any(retired_ids);

  insert into public.adci_audit_events(organization_id, actor_id, action, entity_type, entity_id, new_values)
  values (org_id, auth.uid(), 'live_course.auto_retired', 'course', null,
    jsonb_build_object('course_ids', to_jsonb(retired_ids), 'count', array_length(retired_ids, 1)));

  return jsonb_build_object('retired', array_length(retired_ids, 1));
end;
$$;

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
        (
          c.slug ~ '-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9a-f]{8}$'
          or exists (
            select 1 from public.adci_lessons l
            join public.adci_modules m on m.id = l.module_id
            where m.course_id = c.id and l.lesson_type = 'live' and l.status <> 'retired'
          )
        )
        and not exists (
          select 1 from public.adci_lessons l
          join public.adci_modules m on m.id = l.module_id
          left join public.adci_live_classes lc on lc.lesson_id = l.id
          where m.course_id = c.id and l.status <> 'retired'
            and (
              l.lesson_type <> 'live'
              or (lc.lesson_id is not null
                  and public.adci_live_class_phase(lc.starts_at, lc.ends_at, lc.live_started_at, lc.live_ended_at) <> 'ended')
            )
        )
      )
  );
end;
$$;

create or replace function public.adci_admin_list_grantable_courses()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare org_id uuid := public.adci_admin_org();
begin
  if not public.adci_current_user_has_role(org_id,
    array['branch_admin','super_admin']::public.adci_app_role[])
  then raise exception 'Administration permission required'; end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'course_id', c.id, 'title', c.title, 'status', c.status,
      'kind', case when exists (
          select 1 from public.adci_lessons l
          join public.adci_modules m on m.id = l.module_id
          where m.course_id = c.id and l.lesson_type = 'live'
        ) then 'live' else 'course' end,
      'starts_at', (
        select min(lc.starts_at) from public.adci_live_classes lc
        join public.adci_lessons l on l.id = lc.lesson_id
        join public.adci_modules m on m.id = l.module_id
        where m.course_id = c.id
      )
    ) order by c.title), '[]'::jsonb)
    from public.adci_courses c
    where c.organization_id = org_id and c.status <> 'retired'
      and not (
        (
          c.slug ~ '-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9a-f]{8}$'
          or exists (
            select 1 from public.adci_lessons l
            join public.adci_modules m on m.id = l.module_id
            where m.course_id = c.id and l.lesson_type = 'live' and l.status <> 'retired'
          )
        )
        and not exists (
          select 1 from public.adci_lessons l
          join public.adci_modules m on m.id = l.module_id
          left join public.adci_live_classes lc on lc.lesson_id = l.id
          where m.course_id = c.id and l.status <> 'retired'
            and (
              l.lesson_type <> 'live'
              or (lc.lesson_id is not null
                  and public.adci_live_class_phase(lc.starts_at, lc.ends_at, lc.live_started_at, lc.live_ended_at) <> 'ended')
            )
        )
      )
  );
end;
$$;

revoke all on function public.adci_retire_ended_live_courses() from public, anon, authenticated;
grant execute on function public.adci_retire_ended_live_courses() to service_role;
revoke all on function public.adci_admin_get_user_enrolments(uuid) from public, anon;
revoke all on function public.adci_admin_list_grantable_courses() from public, anon;
grant execute on function public.adci_admin_get_user_enrolments(uuid) to authenticated;
grant execute on function public.adci_admin_list_grantable_courses() to authenticated;

notify pgrst, 'reload schema';
commit;
