-- Repair databases that installed paid Agora sessions without the earlier
-- daily live-class scheduling migration. Safe to run more than once.
alter table public.adci_live_classes
  add column if not exists series_id uuid,
  add column if not exists series_date date;

create index if not exists adci_live_classes_series_idx
on public.adci_live_classes (series_id, series_date)
where series_id is not null;
