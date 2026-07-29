-- Dedicated administration schedule and attendance operations for live classes.
-- Safe to run more than once.

create or replace function public.adci_admin_get_live_schedule(target_days integer default 30)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare target_organization_id uuid; schedule_window integer;
begin
  select id into target_organization_id
  from public.adci_organizations where slug = 'adci';

  if not public.adci_current_user_has_role(
    target_organization_id,
    array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  ) then raise exception 'Live schedule administration permission required'; end if;

  schedule_window := greatest(7, least(180, target_days));

  return jsonb_build_object(
    'summary', jsonb_build_object(
      'scheduled', (
        select count(*) from public.adci_live_classes lc
        join public.adci_lessons l on l.id = lc.lesson_id
        join public.adci_modules m on m.id = l.module_id
        join public.adci_courses c on c.id = m.course_id
        where c.organization_id = target_organization_id
          and lc.starts_at between now() and now() + make_interval(days => schedule_window)
      ),
      'live_now', (
        select count(*) from public.adci_live_classes lc
        join public.adci_lessons l on l.id = lc.lesson_id
        join public.adci_modules m on m.id = l.module_id
        join public.adci_courses c on c.id = m.course_id
        where c.organization_id = target_organization_id
          and now() between lc.starts_at - interval '15 minutes' and lc.ends_at
      ),
      'attendance', (
        select count(*) from public.adci_live_attendance la
        join public.adci_lessons l on l.id = la.lesson_id
        join public.adci_modules m on m.id = l.module_id
        join public.adci_courses c on c.id = m.course_id
        where c.organization_id = target_organization_id
          and la.joined_at >= now() - make_interval(days => schedule_window)
      ),
      'unscheduled', (
        select count(*) from public.adci_lessons l
        join public.adci_modules m on m.id = l.module_id
        join public.adci_courses c on c.id = m.course_id
        left join public.adci_live_classes lc on lc.lesson_id = l.id
        where c.organization_id = target_organization_id
          and l.lesson_type = 'live' and lc.lesson_id is null
      )
    ),
    'classes', coalesce((
      select jsonb_agg(to_jsonb(class_row) order by class_row.starts_at)
      from (
        select
          l.id as lesson_id,
          l.title as lesson_title,
          m.title as module_title,
          c.id as course_id,
          c.title as course_title,
          c.status as course_status,
          lc.provider,
          lc.meeting_url,
          lc.instructor_name,
          lc.starts_at,
          lc.ends_at,
          case
            when now() between lc.starts_at - interval '15 minutes' and lc.ends_at then 'live'
            when lc.ends_at < now() then 'ended'
            else 'scheduled'
          end as status,
          count(distinct la.learner_id)::integer as attendance_count,
          coalesce(sum(la.join_count), 0)::integer as total_joins
        from public.adci_live_classes lc
        join public.adci_lessons l on l.id = lc.lesson_id
        join public.adci_modules m on m.id = l.module_id
        join public.adci_courses c on c.id = m.course_id
        left join public.adci_live_attendance la on la.lesson_id = l.id
        where c.organization_id = target_organization_id
          and lc.starts_at >= now() - interval '30 days'
          and lc.starts_at <= now() + make_interval(days => schedule_window)
        group by l.id, l.title, m.title, c.id, c.title, c.status,
          lc.provider, lc.meeting_url, lc.instructor_name, lc.starts_at, lc.ends_at
      ) class_row
    ), '[]'::jsonb),
    'unscheduled_lessons', coalesce((
      select jsonb_agg(jsonb_build_object(
        'lesson_id', l.id,
        'lesson_title', l.title,
        'module_title', m.title,
        'course_id', c.id,
        'course_title', c.title,
        'course_status', c.status
      ) order by c.title, m.position, l.position)
      from public.adci_lessons l
      join public.adci_modules m on m.id = l.module_id
      join public.adci_courses c on c.id = m.course_id
      left join public.adci_live_classes lc on lc.lesson_id = l.id
      where c.organization_id = target_organization_id
        and l.lesson_type = 'live' and lc.lesson_id is null
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.adci_admin_get_live_attendance(target_lesson_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare target_organization_id uuid;
begin
  select c.organization_id into target_organization_id
  from public.adci_lessons l
  join public.adci_modules m on m.id = l.module_id
  join public.adci_courses c on c.id = m.course_id
  where l.id = target_lesson_id;

  if not public.adci_current_user_has_role(
    target_organization_id,
    array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  ) then raise exception 'Live attendance permission required'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'learner_id', p.id,
      'full_name', coalesce(nullif(trim(p.full_name), ''), split_part(u.email::text, '@', 1)),
      'email', u.email,
      'joined_at', la.joined_at,
      'last_joined_at', la.last_joined_at,
      'join_count', la.join_count
    ) order by la.joined_at)
    from public.adci_live_attendance la
    join public.adci_profiles p on p.id = la.learner_id
    join auth.users u on u.id = p.id
    where la.lesson_id = target_lesson_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.adci_admin_delete_live_schedule(target_lesson_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare target_organization_id uuid;
begin
  select c.organization_id into target_organization_id
  from public.adci_lessons l
  join public.adci_modules m on m.id = l.module_id
  join public.adci_courses c on c.id = m.course_id
  where l.id = target_lesson_id and l.lesson_type = 'live';

  if not public.adci_current_user_has_role(
    target_organization_id,
    array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  ) then raise exception 'Live schedule administration permission required'; end if;

  delete from public.adci_live_classes where lesson_id = target_lesson_id;
  insert into public.adci_audit_events (
    organization_id, actor_id, action, entity_type, entity_id
  ) values (
    target_organization_id, auth.uid(), 'live_schedule.deleted', 'lesson', target_lesson_id
  );
end;
$$;

revoke all on function public.adci_admin_get_live_schedule(integer) from public;
revoke all on function public.adci_admin_get_live_attendance(uuid) from public;
revoke all on function public.adci_admin_delete_live_schedule(uuid) from public;
grant execute on function public.adci_admin_get_live_schedule(integer) to authenticated;
grant execute on function public.adci_admin_get_live_attendance(uuid) to authenticated;
grant execute on function public.adci_admin_delete_live_schedule(uuid) to authenticated;
