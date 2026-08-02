-- Make authenticator enrollment optional for administrators while retaining
-- active organization membership and role checks for every protected action.

create or replace function public.adci_current_user_has_role(
  requested_org uuid,
  allowed_roles public.adci_app_role[]
) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.adci_memberships membership
    where membership.user_id = auth.uid()
      and membership.organization_id = requested_org
      and membership.active
      and membership.role = any(allowed_roles)
  );
$$;

revoke all on function public.adci_current_user_has_role(uuid, public.adci_app_role[]) from public;
grant execute on function public.adci_current_user_has_role(uuid, public.adci_app_role[]) to authenticated;

notify pgrst, 'reload schema';
