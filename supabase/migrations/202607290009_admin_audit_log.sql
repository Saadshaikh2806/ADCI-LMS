-- Searchable, paginated administration audit log.
-- Safe to run more than once.

create or replace function public.adci_admin_get_audit_log(
  target_limit integer default 25,
  target_offset integer default 0,
  target_action text default null,
  target_entity_type text default null,
  target_from timestamptz default null,
  target_to timestamptz default null,
  target_search text default null
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare target_organization_id uuid; page_size integer; report_payload jsonb;
begin
  select id into target_organization_id
  from public.adci_organizations where slug = 'adci';
  if not public.adci_current_user_has_role(
    target_organization_id,
    array['content_author','academic_lead','branch_admin','super_admin','support']::public.adci_app_role[]
  ) then raise exception 'Audit log permission required'; end if;

  page_size := greatest(10, least(200, target_limit));

  with filtered_events as (
    select
      event.id,
      event.actor_id,
      coalesce(nullif(trim(profile.full_name), ''), auth_user.email::text, 'System') as actor_name,
      auth_user.email::text as actor_email,
      event.action,
      event.entity_type,
      event.entity_id,
      event.old_values,
      event.new_values,
      event.reason,
      event.created_at,
      coalesce(
        case event.entity_type
          when 'course' then (select c.title from public.adci_courses c where c.id = event.entity_id)
          when 'module' then (select m.title from public.adci_modules m where m.id = event.entity_id)
          when 'lesson' then (select l.title from public.adci_lessons l where l.id = event.entity_id)
          when 'enrolment' then (
            select c.title from public.adci_courses c
            where c.id = nullif(event.new_values->>'course_id', '')::uuid
          )
          when 'membership' then (
            select coalesce(nullif(trim(p.full_name), ''), 'User account')
            from public.adci_profiles p
            where p.id = nullif(event.new_values->>'user_id', '')::uuid
          )
          else null
        end,
        event.new_values->>'title',
        initcap(replace(event.entity_type, '_', ' '))
      ) as entity_label
    from public.adci_audit_events event
    left join public.adci_profiles profile on profile.id = event.actor_id
    left join auth.users auth_user on auth_user.id = event.actor_id
    where event.organization_id = target_organization_id
      and (nullif(trim(target_action), '') is null or event.action = target_action)
      and (nullif(trim(target_entity_type), '') is null or event.entity_type = target_entity_type)
      and (target_from is null or event.created_at >= target_from)
      and (target_to is null or event.created_at < target_to)
      and (
        nullif(trim(target_search), '') is null
        or event.action ilike '%' || trim(target_search) || '%'
        or event.entity_type ilike '%' || trim(target_search) || '%'
        or coalesce(profile.full_name, '') ilike '%' || trim(target_search) || '%'
        or coalesce(auth_user.email::text, '') ilike '%' || trim(target_search) || '%'
        or coalesce(event.new_values::text, '') ilike '%' || trim(target_search) || '%'
      )
  ),
  page_events as (
    select * from filtered_events
    order by created_at desc, id desc
    limit page_size offset greatest(0, target_offset)
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered_events),
    'limit', page_size,
    'offset', greatest(0, target_offset),
    'summary', jsonb_build_object(
      'today', (
        select count(*) from public.adci_audit_events
        where organization_id = target_organization_id
          and created_at >= (current_date::timestamp at time zone 'Asia/Kolkata')
      ),
      'actors', (
        select count(distinct actor_id) from public.adci_audit_events
        where organization_id = target_organization_id
          and created_at >= now() - interval '30 days'
      ),
      'access_changes', (
        select count(*) from public.adci_audit_events
        where organization_id = target_organization_id
          and entity_type in ('membership','enrolment')
          and created_at >= now() - interval '30 days'
      ),
      'content_changes', (
        select count(*) from public.adci_audit_events
        where organization_id = target_organization_id
          and entity_type in ('course','module','lesson')
          and created_at >= now() - interval '30 days'
      )
    ),
    'actions', coalesce((
      select jsonb_agg(action order by action)
      from (
        select distinct action from public.adci_audit_events
        where organization_id = target_organization_id
      ) action_values
    ), '[]'::jsonb),
    'entity_types', coalesce((
      select jsonb_agg(entity_type order by entity_type)
      from (
        select distinct entity_type from public.adci_audit_events
        where organization_id = target_organization_id
      ) entity_values
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(to_jsonb(page_events) order by created_at desc, id desc)
      from page_events
    ), '[]'::jsonb)
  )
  into report_payload;

  return report_payload;
end;
$$;

revoke all on function public.adci_admin_get_audit_log(integer,integer,text,text,timestamptz,timestamptz,text) from public;
grant execute on function public.adci_admin_get_audit_log(integer,integer,text,text,timestamptz,timestamptz,text) to authenticated;
