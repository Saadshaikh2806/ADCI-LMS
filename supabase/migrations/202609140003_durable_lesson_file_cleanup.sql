begin;

-- The queue survives curriculum cascades, but rolls back if deletion is refused.
create table public.adci_lesson_file_cleanup (
  id uuid primary key default gen_random_uuid(),
  storage_provider text not null check (storage_provider in ('r2', 'supabase')),
  bucket text not null check (bucket in ('adci-lesson-assets', 'adci-course-videos')),
  object_path text not null,
  last_error text,
  last_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (storage_provider, bucket, object_path)
);
alter table public.adci_lesson_file_cleanup enable row level security;
revoke all on public.adci_lesson_file_cleanup from public, anon, authenticated;
grant all on public.adci_lesson_file_cleanup to service_role;

create function public.adci_queue_deleted_lesson_file()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.storage_provider in ('r2', 'supabase') then
    insert into public.adci_lesson_file_cleanup(storage_provider, bucket, object_path)
    values (old.storage_provider,
      case tg_table_name when 'adci_video_assets' then 'adci-course-videos' else 'adci-lesson-assets' end,
      old.object_path)
    on conflict (storage_provider, bucket, object_path) do nothing;
  end if;
  return old;
end;
$$;
revoke all on function public.adci_queue_deleted_lesson_file() from public, anon, authenticated;
create trigger adci_capture_lesson_file_cleanup before delete on public.adci_lesson_assets
for each row execute function public.adci_queue_deleted_lesson_file();
create trigger adci_capture_video_file_cleanup before delete on public.adci_video_assets
for each row execute function public.adci_queue_deleted_lesson_file();

notify pgrst, 'reload schema';
commit;
