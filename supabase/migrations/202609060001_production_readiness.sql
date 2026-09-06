begin;

create table if not exists public.adci_api_rate_limits (
  request_key text primary key,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 1 check (request_count > 0),
  updated_at timestamptz not null default now(),
  constraint adci_api_rate_limits_key_length check (length(request_key) between 3 and 160)
);

alter table public.adci_api_rate_limits enable row level security;
revoke all on table public.adci_api_rate_limits from anon, authenticated;
grant select, insert, update, delete on table public.adci_api_rate_limits to service_role;

create or replace function public.adci_take_api_rate_limit(
  p_request_key text,
  p_maximum_requests integer,
  p_interval_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  current_count integer;
begin
  if length(trim(coalesce(p_request_key, ''))) not between 3 and 160
    or p_maximum_requests not between 1 and 10000
    or p_interval_seconds not between 1 and 86400 then
    raise exception 'Invalid API rate-limit parameters';
  end if;

  insert into public.adci_api_rate_limits as limits (
    request_key,
    window_started_at,
    request_count,
    updated_at
  ) values (
    trim(p_request_key),
    now(),
    1,
    now()
  )
  on conflict (request_key) do update set
    window_started_at = case
      when limits.window_started_at <= now() - make_interval(secs => p_interval_seconds) then now()
      else limits.window_started_at
    end,
    request_count = case
      when limits.window_started_at <= now() - make_interval(secs => p_interval_seconds) then 1
      else limits.request_count + 1
    end,
    updated_at = now()
  returning request_count into current_count;

  return current_count <= p_maximum_requests;
end;
$$;

revoke all on function public.adci_take_api_rate_limit(text,integer,integer) from public, anon, authenticated;
grant execute on function public.adci_take_api_rate_limit(text,integer,integer) to service_role;

comment on table public.adci_api_rate_limits is
  'Server-only fixed-window counters used to protect costly LMS API operations across serverless instances.';

commit;
