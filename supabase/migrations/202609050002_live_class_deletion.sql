begin;

create or replace function public.adci_admin_live_delete_details(target_lesson_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  class_record record;
  buyers integer;
begin
  select c.id as course_id, c.organization_id into class_record
  from public.adci_live_classes lc
  join public.adci_lessons l on l.id = lc.lesson_id
  join public.adci_modules m on m.id = l.module_id
  join public.adci_courses c on c.id = m.course_id
  where lc.lesson_id = target_lesson_id;
  if not found then raise exception 'Live class no longer exists'; end if;
  if not public.adci_current_user_has_role(class_record.organization_id,
    array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[])
  then raise exception 'Live schedule administration permission required'; end if;
  select count(distinct o.learner_id) into buyers
  from public.adci_orders o join public.adci_course_offers offer on offer.id = o.offer_id
  where offer.course_id = class_record.course_id
    and (o.paid_at is not null or o.status in ('paid','refunded'));
  return jsonb_build_object('purchased_learners', buyers);
end;
$$;

-- The original entry point must not bypass the purchase confirmation.
create or replace function public.adci_admin_delete_live_schedule(target_lesson_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  raise exception 'Open the live-class delete confirmation before deleting';
end;
$$;

create or replace function public.adci_admin_delete_live_schedule(
  target_lesson_id uuid, confirmed_purchased_learners integer
)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  class_record record;
  details jsonb;
begin
  select c.id as course_id, c.organization_id, lc.series_id, l.title
  into class_record
  from public.adci_live_classes lc
  join public.adci_lessons l on l.id = lc.lesson_id
  join public.adci_modules m on m.id = l.module_id
  join public.adci_courses c on c.id = m.course_id
  where lc.lesson_id = target_lesson_id
  for update of lc, c;
  if not found then raise exception 'Live class no longer exists'; end if;
  if not public.adci_current_user_has_role(class_record.organization_id,
    array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[])
  then raise exception 'Live schedule administration permission required'; end if;

  perform 1 from public.adci_course_offers where course_id = class_record.course_id for update;
  perform 1 from public.adci_orders o
    join public.adci_course_offers offer on offer.id = o.offer_id
    where offer.course_id = class_record.course_id for update of o;
  details := public.adci_admin_live_delete_details(target_lesson_id);
  if confirmed_purchased_learners is null or
    confirmed_purchased_learners <> (details->>'purchased_learners')::integer
  then raise exception 'Purchases changed. Close and reopen the delete confirmation'; end if;

  -- Retain lessons, enrolments, attendance, invoices and orders for support/refunds.
  -- Series occurrences are individual courses: stop selling the removed session.
  if class_record.series_id is not null or not exists (
    select 1 from public.adci_lessons l join public.adci_modules m on m.id = l.module_id
    where m.course_id = class_record.course_id and l.id <> target_lesson_id and l.status <> 'retired'
  ) then
    update public.adci_course_offers set active = false where course_id = class_record.course_id;
    update public.adci_courses set status = 'retired' where id = class_record.course_id;
  end if;
  update public.adci_lessons set status = 'retired' where id = target_lesson_id;
  delete from public.adci_live_classes where lesson_id = target_lesson_id;
  insert into public.adci_audit_events(organization_id,actor_id,action,entity_type,entity_id,new_values)
  values(class_record.organization_id,auth.uid(),'live_schedule.deleted','lesson',target_lesson_id,
    details || jsonb_build_object('title',class_record.title,'course_id',class_record.course_id));
end;
$$;

revoke all on function public.adci_admin_live_delete_details(uuid) from public, anon;
revoke all on function public.adci_admin_delete_live_schedule(uuid,integer) from public, anon;
grant execute on function public.adci_admin_live_delete_details(uuid) to authenticated;
grant execute on function public.adci_admin_delete_live_schedule(uuid,integer) to authenticated;
commit;
