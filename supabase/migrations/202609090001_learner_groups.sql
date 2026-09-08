-- Learner groups: named segments of people for one-shot bulk course / live-
-- lecture access grants. A group is NOT a live binding - assigning a course
-- grants every current member once; later membership changes never auto-grant
-- or auto-revoke.
--
--   * Group CRUD and membership : branch_admin + super_admin
--   * Bulk course access grant  : super_admin only (same as the per-person tool)
begin;

create table if not exists public.adci_learner_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.adci_organizations(id) on delete cascade,
  name text not null,
  description text not null default '',
  created_by uuid references public.adci_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create unique index if not exists adci_learner_groups_name_idx
  on public.adci_learner_groups (organization_id, lower(name)) where archived_at is null;

create table if not exists public.adci_learner_group_members (
  group_id uuid not null references public.adci_learner_groups(id) on delete cascade,
  learner_id uuid not null references public.adci_profiles(id) on delete cascade,
  added_by uuid references public.adci_profiles(id),
  added_at timestamptz not null default now(),
  primary key (group_id, learner_id)
);
create index if not exists adci_learner_group_members_learner_idx
  on public.adci_learner_group_members (learner_id);

alter table public.adci_learner_groups enable row level security;
alter table public.adci_learner_group_members enable row level security;
revoke all on public.adci_learner_groups from public, anon, authenticated;
revoke all on public.adci_learner_group_members from public, anon, authenticated;
grant all on public.adci_learner_groups to service_role;
grant all on public.adci_learner_group_members to service_role;

create or replace function public.adci_admin_org()
returns uuid language sql stable set search_path = '' as $$
  select id from public.adci_organizations where slug = 'adci';
$$;

-- ---------------------------------------------------------------------------
-- Group listing / detail
-- ---------------------------------------------------------------------------
create or replace function public.adci_admin_list_learner_groups()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare org_id uuid := public.adci_admin_org();
begin
  if not public.adci_current_user_has_role(org_id,
    array['branch_admin','super_admin']::public.adci_app_role[])
  then raise exception 'Group administration permission required'; end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', g.id, 'name', g.name, 'description', g.description,
      'member_count', (select count(*) from public.adci_learner_group_members m where m.group_id = g.id),
      'created_at', g.created_at, 'updated_at', g.updated_at
    ) order by lower(g.name)), '[]'::jsonb)
    from public.adci_learner_groups g
    where g.organization_id = org_id and g.archived_at is null
  );
end;
$$;

create or replace function public.adci_admin_get_learner_group(target_group_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare org_id uuid := public.adci_admin_org(); result jsonb;
begin
  if not public.adci_current_user_has_role(org_id,
    array['branch_admin','super_admin']::public.adci_app_role[])
  then raise exception 'Group administration permission required'; end if;

  select jsonb_build_object(
    'id', g.id, 'name', g.name, 'description', g.description,
    'created_at', g.created_at, 'updated_at', g.updated_at,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'learner_id', p.id,
        'full_name', coalesce(nullif(trim(p.full_name), ''), split_part(u.email::text, '@', 1)),
        'email', u.email,
        'added_at', m.added_at
      ) order by lower(coalesce(p.full_name, u.email::text)))
      from public.adci_learner_group_members m
      join public.adci_profiles p on p.id = m.learner_id
      join auth.users u on u.id = p.id
      where m.group_id = g.id
    ), '[]'::jsonb)
  ) into result
  from public.adci_learner_groups g
  where g.id = target_group_id and g.organization_id = org_id and g.archived_at is null;

  if result is null then raise exception 'Group not found'; end if;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Group CRUD + membership
-- ---------------------------------------------------------------------------
create or replace function public.adci_admin_create_learner_group(
  group_name text, group_description text default ''
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare org_id uuid := public.adci_admin_org(); new_id uuid;
begin
  if not public.adci_current_user_has_role(org_id,
    array['branch_admin','super_admin']::public.adci_app_role[])
  then raise exception 'Group administration permission required'; end if;
  if nullif(trim(group_name), '') is null then raise exception 'Enter a group name'; end if;

  insert into public.adci_learner_groups (organization_id, name, description, created_by)
  values (org_id, trim(group_name), coalesce(trim(group_description), ''), auth.uid())
  returning id into new_id;

  insert into public.adci_audit_events(organization_id, actor_id, action, entity_type, entity_id, new_values)
  values (org_id, auth.uid(), 'learner_group.created', 'learner_group', new_id,
    jsonb_build_object('name', trim(group_name)));
  return new_id;
end;
$$;

create or replace function public.adci_admin_update_learner_group(
  target_group_id uuid, group_name text, group_description text default ''
)
returns void language plpgsql security definer set search_path = ''
as $$
declare org_id uuid := public.adci_admin_org();
begin
  if not public.adci_current_user_has_role(org_id,
    array['branch_admin','super_admin']::public.adci_app_role[])
  then raise exception 'Group administration permission required'; end if;
  if nullif(trim(group_name), '') is null then raise exception 'Enter a group name'; end if;

  update public.adci_learner_groups
  set name = trim(group_name), description = coalesce(trim(group_description), ''), updated_at = now()
  where id = target_group_id and organization_id = org_id and archived_at is null;
  if not found then raise exception 'Group not found'; end if;

  insert into public.adci_audit_events(organization_id, actor_id, action, entity_type, entity_id, new_values)
  values (org_id, auth.uid(), 'learner_group.updated', 'learner_group', target_group_id,
    jsonb_build_object('name', trim(group_name)));
end;
$$;

create or replace function public.adci_admin_archive_learner_group(target_group_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare org_id uuid := public.adci_admin_org();
begin
  if not public.adci_current_user_has_role(org_id,
    array['branch_admin','super_admin']::public.adci_app_role[])
  then raise exception 'Group administration permission required'; end if;

  update public.adci_learner_groups set archived_at = now(), updated_at = now()
  where id = target_group_id and organization_id = org_id and archived_at is null;
  if not found then raise exception 'Group not found'; end if;

  insert into public.adci_audit_events(organization_id, actor_id, action, entity_type, entity_id, new_values)
  values (org_id, auth.uid(), 'learner_group.archived', 'learner_group', target_group_id, '{}'::jsonb);
end;
$$;

-- Replace the whole membership set. Returns the add/remove counts.
create or replace function public.adci_admin_set_learner_group_members(
  target_group_id uuid, member_ids uuid[]
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  org_id uuid := public.adci_admin_org();
  clean_ids uuid[];
  added_count integer;
  removed_count integer;
begin
  if not public.adci_current_user_has_role(org_id,
    array['branch_admin','super_admin']::public.adci_app_role[])
  then raise exception 'Group administration permission required'; end if;
  if not exists (
    select 1 from public.adci_learner_groups
    where id = target_group_id and organization_id = org_id and archived_at is null
  ) then raise exception 'Group not found'; end if;

  select coalesce(array_agg(distinct p.id), '{}')
  into clean_ids
  from public.adci_profiles p
  where p.id = any(coalesce(member_ids, '{}'::uuid[]));

  with removed as (
    delete from public.adci_learner_group_members
    where group_id = target_group_id and not (learner_id = any(clean_ids))
    returning 1
  )
  select count(*) into removed_count from removed;

  with added as (
    insert into public.adci_learner_group_members (group_id, learner_id, added_by)
    select target_group_id, unnest(clean_ids), auth.uid()
    on conflict (group_id, learner_id) do nothing
    returning 1
  )
  select count(*) into added_count from added;

  update public.adci_learner_groups set updated_at = now() where id = target_group_id;

  insert into public.adci_audit_events(organization_id, actor_id, action, entity_type, entity_id, new_values)
  values (org_id, auth.uid(), 'learner_group.members_set', 'learner_group', target_group_id,
    jsonb_build_object('added', added_count, 'removed', removed_count, 'total', array_length(clean_ids, 1)));

  return jsonb_build_object('added', added_count, 'removed', removed_count,
    'total', coalesce(array_length(clean_ids, 1), 0));
end;
$$;

-- ---------------------------------------------------------------------------
-- Grantable course / live-session catalogue (mirrors the per-person dialog's
-- visible set: non-retired, deleted live classes hidden).
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Bulk complimentary access grant - super_admin only, same upsert semantics as
-- adci_admin_set_course_enrolment. Applies status to every (learner x course).
-- ---------------------------------------------------------------------------
create or replace function public.adci_admin_bulk_set_course_enrolment(
  learner_ids uuid[],
  target_course_ids uuid[],
  target_status public.adci_enrolment_status,
  target_access_expires_at timestamptz default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  org_id uuid := public.adci_admin_org();
  clean_learners uuid[];
  clean_courses uuid[];
  applied integer := 0;
  l_id uuid;
  c_id uuid;
begin
  if not public.adci_current_user_has_role(org_id,
    array['super_admin']::public.adci_app_role[])
  then raise exception 'Only a super administrator can grant or change course access'; end if;

  select coalesce(array_agg(id), '{}') into clean_learners
  from public.adci_profiles where id = any(coalesce(learner_ids, '{}'::uuid[]));
  select coalesce(array_agg(id), '{}') into clean_courses
  from public.adci_courses
  where id = any(coalesce(target_course_ids, '{}'::uuid[]))
    and organization_id = org_id and status <> 'retired';

  if array_length(clean_learners, 1) is null or array_length(clean_courses, 1) is null then
    raise exception 'Choose at least one learner and one course';
  end if;

  foreach c_id in array clean_courses loop
    foreach l_id in array clean_learners loop
      insert into public.adci_enrolments (
        learner_id, course_id, status, access_expires_at,
        entitlement_source, complimentary_granted_by, complimentary_granted_at
      ) values (
        l_id, c_id, target_status, target_access_expires_at,
        'admin',
        case when target_status in ('active','completed') then auth.uid() end,
        case when target_status in ('active','completed') then now() end
      ) on conflict (learner_id, course_id) do update set
        status = excluded.status,
        access_expires_at = excluded.access_expires_at,
        entitlement_source = case when excluded.status in ('active','completed')
          then 'admin' else public.adci_enrolments.entitlement_source end,
        complimentary_granted_by = excluded.complimentary_granted_by,
        complimentary_granted_at = excluded.complimentary_granted_at;
      applied := applied + 1;
    end loop;
  end loop;

  insert into public.adci_audit_events(organization_id, actor_id, action, entity_type, entity_id, new_values)
  values (org_id, auth.uid(), 'enrolment.bulk_updated', 'enrolment', null,
    jsonb_build_object(
      'learners', array_length(clean_learners, 1),
      'course_ids', to_jsonb(clean_courses),
      'status', target_status,
      'access_expires_at', target_access_expires_at,
      'applied', applied
    ));

  return jsonb_build_object(
    'learners', array_length(clean_learners, 1),
    'courses', array_length(clean_courses, 1),
    'applied', applied
  );
end;
$$;

-- Convenience: snapshot a group's current members and grant them courses.
create or replace function public.adci_admin_assign_courses_to_learner_group(
  target_group_id uuid,
  target_course_ids uuid[],
  target_status public.adci_enrolment_status,
  target_access_expires_at timestamptz default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  org_id uuid := public.adci_admin_org();
  member_ids uuid[];
begin
  if not public.adci_current_user_has_role(org_id,
    array['super_admin']::public.adci_app_role[])
  then raise exception 'Only a super administrator can grant or change course access'; end if;
  if not exists (
    select 1 from public.adci_learner_groups
    where id = target_group_id and organization_id = org_id and archived_at is null
  ) then raise exception 'Group not found'; end if;

  select coalesce(array_agg(learner_id), '{}') into member_ids
  from public.adci_learner_group_members where group_id = target_group_id;
  if array_length(member_ids, 1) is null then raise exception 'This group has no members yet'; end if;

  return public.adci_admin_bulk_set_course_enrolment(
    member_ids, target_course_ids, target_status, target_access_expires_at
  );
end;
$$;

revoke all on function public.adci_admin_org() from public, anon;
grant execute on function public.adci_admin_org() to authenticated;
revoke all on function public.adci_admin_list_learner_groups() from public, anon;
revoke all on function public.adci_admin_get_learner_group(uuid) from public, anon;
revoke all on function public.adci_admin_create_learner_group(text, text) from public, anon;
revoke all on function public.adci_admin_update_learner_group(uuid, text, text) from public, anon;
revoke all on function public.adci_admin_archive_learner_group(uuid) from public, anon;
revoke all on function public.adci_admin_set_learner_group_members(uuid, uuid[]) from public, anon;
revoke all on function public.adci_admin_list_grantable_courses() from public, anon;
revoke all on function public.adci_admin_bulk_set_course_enrolment(uuid[], uuid[], public.adci_enrolment_status, timestamptz) from public, anon;
revoke all on function public.adci_admin_assign_courses_to_learner_group(uuid, uuid[], public.adci_enrolment_status, timestamptz) from public, anon;
grant execute on function public.adci_admin_list_learner_groups() to authenticated;
grant execute on function public.adci_admin_get_learner_group(uuid) to authenticated;
grant execute on function public.adci_admin_create_learner_group(text, text) to authenticated;
grant execute on function public.adci_admin_update_learner_group(uuid, text, text) to authenticated;
grant execute on function public.adci_admin_archive_learner_group(uuid) to authenticated;
grant execute on function public.adci_admin_set_learner_group_members(uuid, uuid[]) to authenticated;
grant execute on function public.adci_admin_list_grantable_courses() to authenticated;
grant execute on function public.adci_admin_bulk_set_course_enrolment(uuid[], uuid[], public.adci_enrolment_status, timestamptz) to authenticated;
grant execute on function public.adci_admin_assign_courses_to_learner_group(uuid, uuid[], public.adci_enrolment_status, timestamptz) to authenticated;

notify pgrst, 'reload schema';
commit;
