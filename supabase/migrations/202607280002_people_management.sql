create or replace function public.adci_admin_list_people()
returns table (
  user_id uuid,
  full_name text,
  email text,
  role public.adci_app_role,
  active boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
begin
  select o.id into target_organization_id
  from public.adci_organizations o
  where o.slug = 'adci';

  if not public.adci_current_user_has_role(
    target_organization_id,
    array['super_admin']::public.adci_app_role[]
  ) then
    raise exception 'Super administrator permission required';
  end if;

  return query
  select
    p.id,
    p.full_name,
    u.email::text,
    membership.role,
    coalesce(membership.active, false),
    p.created_at
  from public.adci_profiles p
  join auth.users u on u.id = p.id
  left join lateral (
    select m.role, m.active
    from public.adci_memberships m
    where m.user_id = p.id
      and m.organization_id = target_organization_id
    order by m.active desc, m.created_at desc
    limit 1
  ) membership on true
  order by p.created_at desc;
end;
$$;

create or replace function public.adci_admin_set_user_role(
  target_user_id uuid,
  new_role public.adci_app_role,
  membership_active boolean default true
)
returns public.adci_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  membership_record public.adci_memberships;
  target_was_super_admin boolean;
  active_super_admins integer;
begin
  select o.id into target_organization_id
  from public.adci_organizations o
  where o.slug = 'adci';

  if not public.adci_current_user_has_role(
    target_organization_id,
    array['super_admin']::public.adci_app_role[]
  ) then
    raise exception 'Super administrator permission required';
  end if;

  if not exists (select 1 from public.adci_profiles p where p.id = target_user_id) then
    raise exception 'User profile not found';
  end if;

  select exists (
    select 1
    from public.adci_memberships m
    where m.user_id = target_user_id
      and m.organization_id = target_organization_id
      and m.role = 'super_admin'
      and m.active
  ) into target_was_super_admin;

  if target_was_super_admin and (new_role <> 'super_admin' or not membership_active) then
    select count(*) into active_super_admins
    from public.adci_memberships m
    where m.organization_id = target_organization_id
      and m.role = 'super_admin'
      and m.active;

    if active_super_admins <= 1 then
      raise exception 'Assign another active super administrator before changing this account';
    end if;
  end if;

  delete from public.adci_memberships m
  where m.user_id = target_user_id
    and m.organization_id = target_organization_id;

  insert into public.adci_memberships (user_id, organization_id, role, active)
  values (target_user_id, target_organization_id, new_role, membership_active)
  returning * into membership_record;

  insert into public.adci_audit_events (
    organization_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    new_values
  ) values (
    target_organization_id,
    auth.uid(),
    'membership.role_updated',
    'membership',
    membership_record.id,
    jsonb_build_object(
      'user_id', target_user_id,
      'role', new_role,
      'active', membership_active
    )
  );

  return membership_record;
end;
$$;

revoke all on function public.adci_admin_list_people() from public;
revoke all on function public.adci_admin_set_user_role(uuid, public.adci_app_role, boolean) from public;
grant execute on function public.adci_admin_list_people() to authenticated;
grant execute on function public.adci_admin_set_user_role(uuid, public.adci_app_role, boolean) to authenticated;
