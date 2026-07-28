create or replace function public.adci_claim_initial_admin()
returns public.adci_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization_record public.adci_organizations;
  membership_record public.adci_memberships;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  -- Prevent two simultaneous first sign-ins from both becoming super admins.
  perform pg_advisory_xact_lock(hashtextextended('adci_initial_admin', 0));

  select * into organization_record
  from public.adci_organizations
  where slug = 'adci';

  if organization_record.id is null then
    raise exception 'ADCI organization not found';
  end if;

  select * into membership_record
  from public.adci_memberships
  where user_id = auth.uid()
    and organization_id = organization_record.id
    and role = 'super_admin'
    and active
  limit 1;

  if membership_record.id is not null then
    return membership_record;
  end if;

  if exists (
    select 1 from public.adci_memberships
    where organization_id = organization_record.id
      and role = 'super_admin'
      and active
  ) then
    raise exception 'The initial administrator has already been claimed';
  end if;

  insert into public.adci_memberships (user_id, organization_id, role)
  values (auth.uid(), organization_record.id, 'super_admin')
  returning * into membership_record;

  return membership_record;
end;
$$;

revoke all on function public.adci_claim_initial_admin() from public;
grant execute on function public.adci_claim_initial_admin() to authenticated;
