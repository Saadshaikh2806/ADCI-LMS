-- Preserve the existing extension ceiling, but never expire before the scheduled end.
create or replace function public.adci_live_class_phase(
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_live_started_at timestamptz,
  p_live_ended_at timestamptz
) returns text
language sql stable
set search_path = ''
as $$
  select case
    when p_live_ended_at is not null then 'ended'
    when now() >= greatest(p_ends_at, p_starts_at + interval '6 hours') then 'ended'
    when now() < p_starts_at - interval '15 minutes' then 'scheduled'
    when now() <= p_ends_at then 'live'
    when p_live_started_at is not null then 'extended'
    else 'ended'
  end;
$$;
