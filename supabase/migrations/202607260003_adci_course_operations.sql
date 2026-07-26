create or replace function public.adci_create_course_bundle(
  course_title text,
  course_slug text,
  course_description text,
  module_title text,
  lesson_title text,
  lesson_kind text,
  lesson_duration_seconds integer default 0
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization_record public.adci_organizations;
  course_record public.adci_courses;
  module_record public.adci_modules;
  lesson_record public.adci_lessons;
begin
  select o.* into organization_record
  from public.adci_organizations o
  join public.adci_memberships m on m.organization_id = o.id
  where m.user_id = auth.uid()
    and m.active
    and m.role in ('content_author','academic_lead','branch_admin','super_admin')
  order by case m.role when 'super_admin' then 1 else 2 end
  limit 1;

  if organization_record.id is null then
    raise exception 'Academic administration permission required';
  end if;

  if lesson_kind not in ('video','audio','pdf','html','live','quiz') then
    raise exception 'Unsupported lesson type';
  end if;

  insert into public.adci_courses (
    organization_id, title, slug, description, status, owner_id
  ) values (
    organization_record.id,
    trim(course_title),
    lower(trim(course_slug)),
    coalesce(course_description, ''),
    'draft',
    auth.uid()
  ) returning * into course_record;

  insert into public.adci_modules (course_id, title, position)
  values (course_record.id, trim(module_title), 1)
  returning * into module_record;

  insert into public.adci_lessons (
    module_id, title, lesson_type, position, duration_seconds, status
  ) values (
    module_record.id,
    trim(lesson_title),
    lesson_kind,
    1,
    greatest(0, lesson_duration_seconds),
    'draft'
  ) returning * into lesson_record;

  insert into public.adci_audit_events (
    organization_id, actor_id, action, entity_type, entity_id, new_values
  ) values (
    organization_record.id,
    auth.uid(),
    'course.created',
    'course',
    course_record.id,
    jsonb_build_object('title', course_record.title, 'first_lesson_id', lesson_record.id)
  );

  return jsonb_build_object(
    'course_id', course_record.id,
    'module_id', module_record.id,
    'lesson_id', lesson_record.id
  );
end;
$$;

revoke all on function public.adci_create_course_bundle(text,text,text,text,text,text,integer) from public;
grant execute on function public.adci_create_course_bundle(text,text,text,text,text,text,integer) to authenticated;

create policy "academic staff read modules" on public.adci_modules for select using (
  exists (
    select 1 from public.adci_courses c
    where c.id = course_id
      and public.adci_current_user_has_role(
        c.organization_id,
        array['instructor','content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
      )
  )
);

create policy "academic staff manage modules" on public.adci_modules for all using (
  exists (
    select 1 from public.adci_courses c
    where c.id = course_id
      and public.adci_current_user_has_role(
        c.organization_id,
        array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
      )
  )
) with check (
  exists (
    select 1 from public.adci_courses c
    where c.id = course_id
      and public.adci_current_user_has_role(
        c.organization_id,
        array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
      )
  )
);

create policy "academic staff manage lessons" on public.adci_lessons for all using (
  exists (
    select 1 from public.adci_modules m
    join public.adci_courses c on c.id = m.course_id
    where m.id = module_id
      and public.adci_current_user_has_role(
        c.organization_id,
        array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
      )
  )
) with check (
  exists (
    select 1 from public.adci_modules m
    join public.adci_courses c on c.id = m.course_id
    where m.id = module_id
      and public.adci_current_user_has_role(
        c.organization_id,
        array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
      )
  )
);

create policy "academic staff manage video metadata" on public.adci_video_assets for all using (
  exists (
    select 1 from public.adci_lessons l
    join public.adci_modules m on m.id = l.module_id
    join public.adci_courses c on c.id = m.course_id
    where l.id = lesson_id
      and public.adci_current_user_has_role(
        c.organization_id,
        array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
      )
  )
) with check (
  exists (
    select 1 from public.adci_lessons l
    join public.adci_modules m on m.id = l.module_id
    join public.adci_courses c on c.id = m.course_id
    where l.id = lesson_id
      and public.adci_current_user_has_role(
        c.organization_id,
        array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
      )
  )
);

create policy "academic staff upload course videos"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'adci-course-videos'
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

create policy "academic staff update course videos"
on storage.objects for update to authenticated
using (
  bucket_id = 'adci-course-videos'
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
