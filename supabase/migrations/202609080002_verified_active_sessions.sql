begin;

-- Keep a high-water mark so an old login cannot reclaim access after a newer
-- session signs out. Browser clients cannot edit or delete this record.
-- 202609060002 was also used by the reverted whiteboard; repair installations
-- that recorded that version before the device-token table was introduced.
create table if not exists public.adci_active_sessions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  session_token text not null,
  device_label text,
  updated_at timestamptz not null default now()
);
alter table public.adci_active_sessions add column if not exists auth_session_started_at timestamptz;
alter table public.adci_active_sessions enable row level security;
revoke all on public.adci_active_sessions from public, anon, authenticated;
grant all on public.adci_active_sessions to service_role;
drop policy if exists "own active session" on public.adci_active_sessions;

create function public.adci_session_is_active()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.adci_active_sessions active
    join auth.sessions session on session.id = (auth.jwt()->>'session_id')::uuid and session.user_id = active.user_id
    where active.user_id = auth.uid()
      and active.session_token = auth.jwt()->>'session_id'
      and (session.not_after is null or session.not_after > now())
      and (auth.jwt()->>'aal' = 'aal2' or not exists (
        select 1 from auth.mfa_factors factor where factor.user_id = auth.uid() and factor.status = 'verified'
      ))
  );
$$;

create function public.adci_claim_active_session()
returns void language plpgsql security definer set search_path = '' as $$
declare
  current_session auth.sessions;
  claimed integer;
begin
  select * into current_session from auth.sessions
  where id = (auth.jwt()->>'session_id')::uuid and user_id = auth.uid()
    and (not_after is null or not_after > now());
  if not found then raise sqlstate 'PT401' using message = 'Your session has expired. Please sign in again.'; end if;
  if coalesce(auth.jwt()->>'aal', '') <> 'aal2' and exists (
    select 1 from auth.mfa_factors where user_id = auth.uid() and status = 'verified'
  ) then raise sqlstate 'PT401' using message = 'Complete your authenticator verification before continuing.'; end if;

  insert into public.adci_active_sessions as active(user_id, session_token, auth_session_started_at)
  values (auth.uid(), current_session.id::text, current_session.created_at)
  on conflict (user_id) do update set
    session_token = excluded.session_token,
    auth_session_started_at = excluded.auth_session_started_at,
    updated_at = now()
  where active.auth_session_started_at is null
    or active.session_token = excluded.session_token
    or (excluded.auth_session_started_at, excluded.session_token) > (active.auth_session_started_at, active.session_token);
  get diagnostics claimed = row_count;
  if claimed = 0 then raise sqlstate 'PT401' using message = 'This account was opened on another device. Please sign in again.'; end if;
end;
$$;

create function public.adci_check_active_session()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.adci_session_is_active() then
    raise sqlstate 'PT401' using message = 'Your session is no longer active. Please sign in again.';
  end if;
end;
$$;

-- PostgREST calls this even for security-definer RPCs, which bypass table RLS.
-- Claim is the sole exception and validates the signed JWT against auth.sessions.
create function public.adci_check_request_session()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.jwt()->>'role' = 'authenticated' and not (
    coalesce(current_setting('request.path', true), '') = '/rpc/adci_claim_active_session'
    and coalesce(current_setting('request.method', true), '') = 'POST'
  ) then perform public.adci_check_active_session(); end if;
end;
$$;

revoke all on function public.adci_session_is_active() from public, anon;
revoke all on function public.adci_claim_active_session() from public, anon;
revoke all on function public.adci_check_active_session() from public, anon;
revoke all on function public.adci_check_request_session() from public;
grant execute on function public.adci_session_is_active(), public.adci_claim_active_session(), public.adci_check_active_session() to authenticated;
grant execute on function public.adci_check_request_session() to anon, authenticated, service_role;

-- Realtime and Storage do not run PostgREST hooks. Restrictive policies add the
-- session requirement to existing permissions without granting any new access.
do $$
declare target record;
begin
  for target in select schemaname, tablename from pg_tables
    where (schemaname = 'public' and tablename like 'adci\_%' escape '\')
       or (schemaname = 'storage' and tablename = 'objects')
  loop
    execute format('create policy adci_require_active_session on %I.%I as restrictive for all to authenticated using ((select public.adci_session_is_active())) with check ((select public.adci_session_is_active()))', target.schemaname, target.tablename);
  end loop;
end;
$$;

alter role authenticator set pgrst.db_pre_request = 'public.adci_check_request_session';
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
commit;
