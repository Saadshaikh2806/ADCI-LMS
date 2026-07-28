create table if not exists public.adci_article_contents (
  lesson_id uuid primary key references public.adci_lessons on delete cascade,
  body text not null default '',
  updated_by uuid references public.adci_profiles,
  updated_at timestamptz not null default now()
);

create table if not exists public.adci_live_classes (
  lesson_id uuid primary key references public.adci_lessons on delete cascade,
  provider text not null check (provider in ('zoom','google_meet','youtube_live')),
  meeting_url text not null,
  instructor_name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  updated_by uuid references public.adci_profiles,
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

alter table public.adci_article_contents enable row level security;
alter table public.adci_live_classes enable row level security;

create policy "course members read articles" on public.adci_article_contents for select using (
  exists (
    select 1 from public.adci_lessons l join public.adci_modules m on m.id = l.module_id
    where l.id = lesson_id and public.adci_can_access_course(m.course_id)
  )
);
create policy "academic staff manage articles" on public.adci_article_contents for all using (
  exists (
    select 1 from public.adci_lessons l join public.adci_modules m on m.id = l.module_id
    join public.adci_courses c on c.id = m.course_id where l.id = lesson_id
      and public.adci_current_user_has_role(c.organization_id,
        array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[])
  )
) with check (
  exists (
    select 1 from public.adci_lessons l join public.adci_modules m on m.id = l.module_id
    join public.adci_courses c on c.id = m.course_id where l.id = lesson_id
      and public.adci_current_user_has_role(c.organization_id,
        array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[])
  )
);

create policy "course members read live classes" on public.adci_live_classes for select using (
  exists (
    select 1 from public.adci_lessons l join public.adci_modules m on m.id = l.module_id
    where l.id = lesson_id and public.adci_can_access_course(m.course_id)
  )
);
create policy "academic staff manage live classes" on public.adci_live_classes for all using (
  exists (
    select 1 from public.adci_lessons l join public.adci_modules m on m.id = l.module_id
    join public.adci_courses c on c.id = m.course_id where l.id = lesson_id
      and public.adci_current_user_has_role(c.organization_id,
        array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[])
  )
) with check (
  exists (
    select 1 from public.adci_lessons l join public.adci_modules m on m.id = l.module_id
    join public.adci_courses c on c.id = m.course_id where l.id = lesson_id
      and public.adci_current_user_has_role(c.organization_id,
        array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[])
  )
);

create or replace function public.adci_save_article(target_lesson_id uuid, article_body text)
returns public.adci_article_contents
language plpgsql security definer set search_path = ''
as $$
declare target_organization_id uuid; article_record public.adci_article_contents;
begin
  select c.organization_id into target_organization_id from public.adci_lessons l
  join public.adci_modules m on m.id = l.module_id join public.adci_courses c on c.id = m.course_id
  where l.id = target_lesson_id and l.lesson_type = 'html';
  if not public.adci_current_user_has_role(target_organization_id,
    array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[])
  then raise exception 'Article administration permission required'; end if;
  insert into public.adci_article_contents (lesson_id, body, updated_by, updated_at)
  values (target_lesson_id, article_body, auth.uid(), now())
  on conflict (lesson_id) do update set body = excluded.body, updated_by = auth.uid(), updated_at = now()
  returning * into article_record;
  return article_record;
end;
$$;

create or replace function public.adci_save_live_class(
  target_lesson_id uuid, class_provider text, class_url text, class_instructor text,
  class_starts_at timestamptz, class_ends_at timestamptz
)
returns public.adci_live_classes
language plpgsql security definer set search_path = ''
as $$
declare target_organization_id uuid; class_record public.adci_live_classes;
begin
  select c.organization_id into target_organization_id from public.adci_lessons l
  join public.adci_modules m on m.id = l.module_id join public.adci_courses c on c.id = m.course_id
  where l.id = target_lesson_id and l.lesson_type = 'live';
  if not public.adci_current_user_has_role(target_organization_id,
    array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[])
  then raise exception 'Live class administration permission required'; end if;
  if class_provider not in ('zoom','google_meet','youtube_live') then raise exception 'Unsupported live provider'; end if;
  if class_url !~ '^https://.+' then raise exception 'A valid HTTPS meeting URL is required'; end if;
  insert into public.adci_live_classes (
    lesson_id, provider, meeting_url, instructor_name, starts_at, ends_at, updated_by, updated_at
  ) values (
    target_lesson_id, class_provider, class_url, trim(class_instructor),
    class_starts_at, class_ends_at, auth.uid(), now()
  ) on conflict (lesson_id) do update set
    provider = excluded.provider, meeting_url = excluded.meeting_url,
    instructor_name = excluded.instructor_name, starts_at = excluded.starts_at,
    ends_at = excluded.ends_at, updated_by = auth.uid(), updated_at = now()
  returning * into class_record;
  return class_record;
end;
$$;

revoke all on function public.adci_save_article(uuid,text) from public;
revoke all on function public.adci_save_live_class(uuid,text,text,text,timestamptz,timestamptz) from public;
grant execute on function public.adci_save_article(uuid,text) to authenticated;
grant execute on function public.adci_save_live_class(uuid,text,text,text,timestamptz,timestamptz) to authenticated;
