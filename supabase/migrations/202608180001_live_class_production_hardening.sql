-- Harden private classroom attendance and prevent paid-session data loss.

create or replace function public.adci_authorize_agora_join(target_lesson_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  target_organization_id uuid;
  target_course_id uuid;
  target_channel text;
  target_ends_at timestamptz;
  participant_name text;
  is_staff boolean;
begin
  select course.organization_id, course.id, live_class.agora_channel_name,
    live_class.ends_at, profile.full_name
  into target_organization_id, target_course_id, target_channel,
    target_ends_at, participant_name
  from public.adci_live_classes live_class
  join public.adci_lessons lesson on lesson.id = live_class.lesson_id
  join public.adci_modules module on module.id = lesson.module_id
  join public.adci_courses course on course.id = module.course_id
  left join public.adci_profiles profile on profile.id = auth.uid()
  where live_class.lesson_id = target_lesson_id
    and live_class.provider = 'agora';

  if target_channel is null then
    raise exception 'This private classroom is unavailable';
  end if;

  is_staff := public.adci_current_user_has_role(
    target_organization_id,
    array['instructor','content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  );

  if not coalesce(is_staff, false)
    and not coalesce(public.adci_can_access_course(target_course_id), false) then
    raise exception 'This live class is not available to this account';
  end if;

  if now() not between (
    select starts_at - interval '15 minutes'
    from public.adci_live_classes where lesson_id = target_lesson_id
  ) and target_ends_at then
    raise exception 'The Join button opens 15 minutes before class';
  end if;

  if not coalesce(is_staff, false) then
    insert into public.adci_live_attendance (lesson_id, learner_id)
    values (target_lesson_id, auth.uid())
    on conflict (lesson_id, learner_id) do update set
      join_count = case
        when coalesce(public.adci_live_attendance.last_joined_at, '-infinity'::timestamptz) < now() - interval '2 minutes'
          then coalesce(public.adci_live_attendance.join_count, 0) + 1
        else public.adci_live_attendance.join_count
      end,
      last_joined_at = now();
  end if;

  return jsonb_build_object(
    'channel', target_channel,
    'participant_name', nullif(trim(participant_name), ''),
    'ends_at', target_ends_at,
    'is_staff', coalesce(is_staff, false)
  );
end;
$$;

create or replace function public.adci_join_live_class(target_lesson_id uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare class_record public.adci_live_classes; target_course_id uuid;
begin
  select live_class.* into class_record
  from public.adci_live_classes live_class
  where live_class.lesson_id = target_lesson_id;

  select module.course_id into target_course_id
  from public.adci_live_classes live_class
  join public.adci_lessons lesson on lesson.id = live_class.lesson_id
  join public.adci_modules module on module.id = lesson.module_id
  where live_class.lesson_id = target_lesson_id;

  if class_record.lesson_id is null or not public.adci_can_access_course(target_course_id)
  then raise exception 'Live class is not available to this account'; end if;
  if class_record.provider = 'agora'
  then raise exception 'Enter this class through the private LMS classroom'; end if;
  if now() not between class_record.starts_at - interval '15 minutes' and class_record.ends_at
  then raise exception 'The Join button opens 15 minutes before class'; end if;

  insert into public.adci_live_attendance (lesson_id, learner_id)
  values (target_lesson_id, auth.uid())
  on conflict (lesson_id, learner_id) do update set
    join_count = case
      when coalesce(public.adci_live_attendance.last_joined_at, '-infinity'::timestamptz) < now() - interval '2 minutes'
        then coalesce(public.adci_live_attendance.join_count, 0) + 1
      else public.adci_live_attendance.join_count
    end,
    last_joined_at = now();

  return class_record.meeting_url;
end;
$$;

create or replace function public.adci_admin_delete_live_schedule(target_lesson_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare target_organization_id uuid; target_course_id uuid;
begin
  select course.organization_id, course.id
  into target_organization_id, target_course_id
  from public.adci_lessons lesson
  join public.adci_modules module on module.id = lesson.module_id
  join public.adci_courses course on course.id = module.course_id
  where lesson.id = target_lesson_id and lesson.lesson_type = 'live';

  if target_organization_id is null then
    raise exception 'Live schedule not found';
  end if;

  if not public.adci_current_user_has_role(
    target_organization_id,
    array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  ) then raise exception 'Live schedule administration permission required'; end if;

  if exists (
    select 1 from public.adci_course_offers offer
    where offer.course_id = target_course_id
  ) then
    raise exception 'Paid live sessions cannot be removed after publication';
  end if;

  delete from public.adci_live_classes where lesson_id = target_lesson_id;
  insert into public.adci_audit_events (
    organization_id, actor_id, action, entity_type, entity_id
  ) values (
    target_organization_id, auth.uid(), 'live_schedule.deleted', 'lesson', target_lesson_id
  );
end;
$$;

revoke all on function public.adci_authorize_agora_join(uuid) from public;
revoke all on function public.adci_join_live_class(uuid) from public;
revoke all on function public.adci_admin_delete_live_schedule(uuid) from public;
grant execute on function public.adci_authorize_agora_join(uuid) to authenticated;
grant execute on function public.adci_join_live_class(uuid) to authenticated;
grant execute on function public.adci_admin_delete_live_schedule(uuid) to authenticated;
