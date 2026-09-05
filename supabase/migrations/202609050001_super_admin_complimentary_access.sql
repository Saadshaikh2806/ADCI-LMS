-- Learners need a verified purchase or an explicit super-admin grant for Zoom.
-- Existing unattributed manual enrolments require super-admin reapproval.
begin;

alter table public.adci_enrolments
  add column if not exists complimentary_granted_by uuid references public.adci_profiles(id),
  add column if not exists complimentary_granted_at timestamptz;

create or replace function public.adci_admin_set_course_enrolment(
  target_user_id uuid,
  target_course_id uuid,
  target_status public.adci_enrolment_status,
  target_access_expires_at timestamptz default null
)
returns public.adci_enrolments
language plpgsql security definer set search_path = ''
as $$
declare
  target_organization_id uuid;
  enrolment_record public.adci_enrolments;
begin
  select organization_id into target_organization_id
  from public.adci_courses where id = target_course_id;
  if target_organization_id is null or not public.adci_current_user_has_role(
    target_organization_id, array['super_admin']::public.adci_app_role[]
  ) then raise exception 'Only a super administrator can grant or change course access'; end if;
  if not exists (select 1 from public.adci_profiles where id = target_user_id)
  then raise exception 'User profile not found'; end if;

  insert into public.adci_enrolments (
    learner_id, course_id, status, access_expires_at,
    entitlement_source, complimentary_granted_by, complimentary_granted_at
  ) values (
    target_user_id, target_course_id, target_status, target_access_expires_at,
    'admin',
    case when target_status in ('active','completed') then auth.uid() end,
    case when target_status in ('active','completed') then now() end
  ) on conflict (learner_id, course_id) do update set
    status = excluded.status,
    access_expires_at = excluded.access_expires_at,
    entitlement_source = case when excluded.status in ('active','completed')
      then 'admin' else public.adci_enrolments.entitlement_source end,
    complimentary_granted_by = excluded.complimentary_granted_by,
    complimentary_granted_at = excluded.complimentary_granted_at
  returning * into enrolment_record;

  insert into public.adci_audit_events (
    organization_id, actor_id, action, entity_type, entity_id, new_values
  ) values (
    target_organization_id, auth.uid(), 'enrolment.updated', 'enrolment',
    enrolment_record.id, jsonb_build_object(
      'learner_id', target_user_id, 'course_id', target_course_id,
      'status', target_status, 'access_expires_at', target_access_expires_at,
      'complimentary_granted_by', enrolment_record.complimentary_granted_by,
      'complimentary_granted_at', enrolment_record.complimentary_granted_at
    )
  );
  return enrolment_record;
end;
$$;

-- Never expose this arbitrary-user check to browser clients.
create or replace function public.adci_has_verified_zoom_enrolment(
  target_course_id uuid, target_user_id uuid
)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.adci_enrolments e
    where e.learner_id = target_user_id and e.course_id = target_course_id
      and e.status in ('active','completed')
      and (e.access_expires_at is null or e.access_expires_at > now())
      and (
        (e.entitlement_source = 'admin'
          and e.complimentary_granted_by is not null
          and e.complimentary_granted_at is not null)
        or (e.entitlement_source = 'payment' and exists (
          select 1 from public.adci_orders o
          join public.adci_course_offers offer on offer.id = o.offer_id
          join public.adci_payment_transactions payment on payment.order_id = o.id
          where o.id = e.source_order_id and o.learner_id = e.learner_id
            and offer.course_id = e.course_id and o.status = 'paid'
            and payment.status = 'captured'
            and payment.provider_payment_id = o.provider_payment_id
            and payment.amount_paise >= o.total_paise
        ))
      )
  );
$$;

create or replace function public.adci_get_zoom_access(
  target_lesson_id uuid, target_user_id uuid
)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  class_record record;
  participant_name text;
  participant_email text;
  is_staff boolean := false;
begin
  select course.organization_id, course.id as course_id,
    live_class.zoom_meeting_number, live_class.zoom_meeting_passcode,
    live_class.starts_at, live_class.ends_at
  into class_record
  from public.adci_live_classes live_class
  join public.adci_lessons lesson on lesson.id = live_class.lesson_id
  join public.adci_modules module on module.id = lesson.module_id
  join public.adci_courses course on course.id = module.course_id
  where live_class.lesson_id = target_lesson_id and live_class.provider = 'zoom';
  if class_record.zoom_meeting_number is null then raise exception 'Zoom Live is unavailable'; end if;

  select profile.full_name, account.email into participant_name, participant_email
  from auth.users account
  left join public.adci_profiles profile on profile.id = account.id
  where account.id = target_user_id;
  if participant_email is null then raise exception 'Participant account was not found'; end if;

  select exists (
    select 1 from public.adci_memberships membership
    where membership.user_id = target_user_id
      and membership.organization_id = class_record.organization_id
      and membership.active
      and membership.role::text in ('instructor','content_author','academic_lead','branch_admin','super_admin')
  ) into is_staff;

  if not is_staff and not public.adci_has_verified_zoom_enrolment(class_record.course_id, target_user_id)
  then raise exception 'Purchase this Zoom Live session or ask a super administrator to grant access'; end if;

  return jsonb_build_object(
    'meeting_number', class_record.zoom_meeting_number,
    'meeting_passcode', class_record.zoom_meeting_passcode,
    'participant_name', coalesce(nullif(trim(participant_name), ''), split_part(participant_email, '@', 1)),
    'participant_email', participant_email,
    'is_staff', is_staff,
    'organization_id', class_record.organization_id,
    'starts_at', class_record.starts_at,
    'ends_at', class_record.ends_at,
    'can_join', now() between class_record.starts_at - interval '15 minutes' and class_record.ends_at
  );
end;
$$;

revoke all on function public.adci_admin_set_course_enrolment(uuid,uuid,public.adci_enrolment_status,timestamptz) from public, anon;
grant execute on function public.adci_admin_set_course_enrolment(uuid,uuid,public.adci_enrolment_status,timestamptz) to authenticated;
revoke all on function public.adci_has_verified_zoom_enrolment(uuid,uuid) from public, anon, authenticated;
grant execute on function public.adci_has_verified_zoom_enrolment(uuid,uuid) to service_role;
revoke all on function public.adci_get_zoom_access(uuid,uuid) from public, anon, authenticated;
grant execute on function public.adci_get_zoom_access(uuid,uuid) to service_role;

commit;
