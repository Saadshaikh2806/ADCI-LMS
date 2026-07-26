insert into public.adci_organizations (id, name, slug)
values (
  'adc10000-0000-4000-8000-000000000001',
  'Anees Defence Career Institute',
  'adci'
)
on conflict (slug) do update set name = excluded.name;

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

  select * into organization_record
  from public.adci_organizations
  where slug = 'adci';

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
