create or replace function public.adci_admin_get_user_enrolments(target_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare target_organization_id uuid;
begin
  select id into target_organization_id from public.adci_organizations where slug = 'adci';
  if not public.adci_current_user_has_role(target_organization_id,
    array['branch_admin','super_admin']::public.adci_app_role[])
  then raise exception 'Administration permission required'; end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'course_id', c.id, 'title', c.title, 'status', c.status,
      'enrolment_status', e.status, 'access_expires_at', e.access_expires_at,
      'enrolled_at', e.enrolled_at
    ) order by c.title), '[]'::jsonb)
    from public.adci_courses c
    left join public.adci_enrolments e on e.course_id = c.id and e.learner_id = target_user_id
    where c.organization_id = target_organization_id and c.status <> 'retired'
  );
end;
$$;

create or replace function public.adci_admin_set_course_enrolment(
  target_user_id uuid,
  target_course_id uuid,
  target_status public.adci_enrolment_status,
  target_access_expires_at timestamptz default null
)
returns public.adci_enrolments
language plpgsql security definer set search_path = ''
as $$
declare target_organization_id uuid; enrolment_record public.adci_enrolments;
begin
  select organization_id into target_organization_id from public.adci_courses where id = target_course_id;
  if target_organization_id is null or not public.adci_current_user_has_role(target_organization_id,
    array['branch_admin','super_admin']::public.adci_app_role[])
  then raise exception 'Administration permission required'; end if;
  if not exists (select 1 from public.adci_profiles where id = target_user_id)
  then raise exception 'User profile not found'; end if;

  insert into public.adci_enrolments (
    learner_id, course_id, status, access_expires_at
  ) values (
    target_user_id, target_course_id, target_status, target_access_expires_at
  ) on conflict (learner_id, course_id) do update set
    status = excluded.status,
    access_expires_at = excluded.access_expires_at
  returning * into enrolment_record;

  insert into public.adci_audit_events (
    organization_id, actor_id, action, entity_type, entity_id, new_values
  ) values (
    target_organization_id, auth.uid(), 'enrolment.updated', 'enrolment',
    enrolment_record.id, jsonb_build_object(
      'learner_id', target_user_id, 'course_id', target_course_id,
      'status', target_status, 'access_expires_at', target_access_expires_at
    )
  );
  return enrolment_record;
end;
$$;

create or replace function public.adci_get_my_courses()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'title', c.title,
    'slug', c.slug,
    'description', c.description,
    'status', e.status,
    'access_expires_at', e.access_expires_at,
    'lesson_count', (
      select count(*) from public.adci_modules m
      join public.adci_lessons l on l.module_id = m.id where m.course_id = c.id
    ),
    'completed_count', (
      select count(*) from public.adci_lesson_progress lp
      join public.adci_lessons l on l.id = lp.lesson_id
      join public.adci_modules m on m.id = l.module_id
      where m.course_id = c.id and lp.learner_id = auth.uid() and lp.completed_at is not null
    )
  ) order by e.enrolled_at desc), '[]'::jsonb)
  from public.adci_enrolments e
  join public.adci_courses c on c.id = e.course_id
  where e.learner_id = auth.uid()
    and e.status in ('active','completed')
    and (e.access_expires_at is null or e.access_expires_at > now())
    and c.status = 'published';
$$;

revoke all on function public.adci_admin_get_user_enrolments(uuid) from public;
revoke all on function public.adci_admin_set_course_enrolment(uuid,uuid,public.adci_enrolment_status,timestamptz) from public;
revoke all on function public.adci_get_my_courses() from public;
grant execute on function public.adci_admin_get_user_enrolments(uuid) to authenticated;
grant execute on function public.adci_admin_set_course_enrolment(uuid,uuid,public.adci_enrolment_status,timestamptz) to authenticated;
grant execute on function public.adci_get_my_courses() to authenticated;
