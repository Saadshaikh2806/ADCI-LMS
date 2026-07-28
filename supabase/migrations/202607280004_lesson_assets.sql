create table if not exists public.adci_lesson_assets (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.adci_lessons on delete cascade,
  asset_type text not null check (asset_type in ('video','audio','pdf')),
  storage_provider text not null default 'supabase',
  object_path text not null unique,
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  created_at timestamptz not null default now()
);

alter table public.adci_lesson_assets enable row level security;

create policy "course members read lesson assets"
on public.adci_lesson_assets for select
using (
  exists (
    select 1
    from public.adci_lessons l
    join public.adci_modules m on m.id = l.module_id
    where l.id = lesson_id
      and public.adci_can_access_course(m.course_id)
  )
);

create policy "academic staff manage lesson assets"
on public.adci_lesson_assets for all
using (
  exists (
    select 1
    from public.adci_lessons l
    join public.adci_modules m on m.id = l.module_id
    join public.adci_courses c on c.id = m.course_id
    where l.id = lesson_id
      and public.adci_current_user_has_role(
        c.organization_id,
        array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
      )
  )
)
with check (
  exists (
    select 1
    from public.adci_lessons l
    join public.adci_modules m on m.id = l.module_id
    join public.adci_courses c on c.id = m.course_id
    where l.id = lesson_id
      and public.adci_current_user_has_role(
        c.organization_id,
        array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
      )
  )
);

insert into storage.buckets (id, name, public)
values ('adci-lesson-assets', 'adci-lesson-assets', false)
on conflict (id) do update set public = false;

create policy "academic staff upload lesson assets"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'adci-lesson-assets'
  and exists (
    select 1
    from public.adci_lessons l
    join public.adci_modules m on m.id = l.module_id
    join public.adci_courses c on c.id = m.course_id
    where l.id::text = (storage.foldername(name))[1]
      and public.adci_current_user_has_role(
        c.organization_id,
        array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
      )
  )
);

create policy "academic staff update lesson assets"
on storage.objects for update to authenticated
using (
  bucket_id = 'adci-lesson-assets'
  and exists (
    select 1
    from public.adci_lessons l
    join public.adci_modules m on m.id = l.module_id
    join public.adci_courses c on c.id = m.course_id
    where l.id::text = (storage.foldername(name))[1]
      and public.adci_current_user_has_role(
        c.organization_id,
        array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
      )
  )
);
