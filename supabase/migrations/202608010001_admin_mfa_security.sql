-- Require Supabase Auth Assurance Level 2 for every staff role and record
-- account-security events in the existing administration audit log.
-- Run this complete file once after migration 202607300016.

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
      and (
        membership.role <> all (
          array[
            'instructor',
            'content_author',
            'academic_lead',
            'mentor',
            'branch_admin',
            'finance',
            'super_admin',
            'support'
          ]::public.adci_app_role[]
        )
        or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      )
  );
$$;

create or replace function public.adci_record_security_event(
  event_action text,
  event_details jsonb default '{}'::jsonb
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  target_organization_id uuid;
  security_event_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if event_action not in (
    'mfa_enabled',
    'mfa_disabled',
    'admin_mfa_verified',
    'password_changed',
    'sessions_revoked'
  ) then
    raise exception 'Unsupported security event';
  end if;

  select organization.id into target_organization_id
  from public.adci_organizations organization
  where organization.slug = 'adci';

  if target_organization_id is null then
    raise exception 'ADCI organization not found';
  end if;

  insert into public.adci_audit_events (
    organization_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    old_values,
    new_values,
    reason
  ) values (
    target_organization_id,
    auth.uid(),
    'security.' || event_action,
    'account_security',
    auth.uid(),
    null,
    jsonb_build_object(
      'aal', coalesce(auth.jwt() ->> 'aal', 'aal1'),
      'details', coalesce(event_details, '{}'::jsonb)
    ),
    'Account security action'
  ) returning id into security_event_id;

  return security_event_id;
end;
$$;

revoke all on function public.adci_record_security_event(text,jsonb) from public;
grant execute on function public.adci_record_security_event(text,jsonb) to authenticated;
