-- Unified personal notifications for support, grading, live classes and assessments.

alter table public.adci_notification_preferences
  add column if not exists notify_support boolean not null default true,
  add column if not exists notify_assignments boolean not null default true,
  add column if not exists notify_live_classes boolean not null default true,
  add column if not exists notify_assessments boolean not null default true;

create table if not exists public.adci_user_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.adci_organizations on delete cascade,
  user_id uuid not null references public.adci_profiles on delete cascade,
  notification_type text not null check (notification_type in ('support','assignment','live_class','assessment','system')),
  title text not null check (char_length(trim(title)) between 1 and 180),
  body text not null check (char_length(trim(body)) between 1 and 5000),
  priority text not null default 'info' check (priority in ('info','important','urgent')),
  entity_type text,
  entity_id uuid,
  action_data jsonb not null default '{}'::jsonb,
  dedupe_key text not null unique,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.adci_user_notifications enable row level security;
drop policy if exists "users read own event notifications" on public.adci_user_notifications;
create policy "users read own event notifications"
on public.adci_user_notifications for select to authenticated
using (user_id = auth.uid());

create index if not exists adci_user_notifications_user_created_idx
  on public.adci_user_notifications (user_id, created_at desc);
create index if not exists adci_user_notifications_unread_idx
  on public.adci_user_notifications (user_id, read_at) where read_at is null;

create or replace function public.adci_add_user_notification(
  target_organization_id uuid,
  target_user_id uuid,
  target_type text,
  notification_title text,
  notification_body text,
  notification_priority text,
  target_entity_type text,
  target_entity_id uuid,
  target_action_data jsonb,
  target_dedupe_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare created_id uuid;
begin
  insert into public.adci_user_notifications (
    organization_id, user_id, notification_type, title, body, priority,
    entity_type, entity_id, action_data, dedupe_key
  ) values (
    target_organization_id, target_user_id, target_type, trim(notification_title),
    trim(notification_body), notification_priority, target_entity_type,
    target_entity_id, coalesce(target_action_data, '{}'::jsonb), target_dedupe_key
  )
  on conflict (dedupe_key) do nothing
  returning id into created_id;
  return created_id;
end;
$$;

create or replace function public.adci_notify_support_reply()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare ticket_record public.adci_support_tickets;
begin
  select * into ticket_record from public.adci_support_tickets where id = new.ticket_id;
  if not new.internal and new.author_id <> ticket_record.requester_id then
    perform public.adci_add_user_notification(
      ticket_record.organization_id, ticket_record.requester_id, 'support',
      'New reply from ADCI support', ticket_record.subject, 'important',
      'support_ticket', ticket_record.id,
      jsonb_build_object('kind','support','id',ticket_record.id),
      'support-reply:' || new.id::text
    );
  end if;
  return new;
end;
$$;

drop trigger if exists adci_notify_support_reply_trigger on public.adci_support_messages;
create trigger adci_notify_support_reply_trigger
after insert on public.adci_support_messages
for each row execute function public.adci_notify_support_reply();

create or replace function public.adci_notify_assignment_decision()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare assignment_record public.adci_assignments; organization_id uuid;
begin
  if new.status in ('graded','returned') and new.status is distinct from old.status then
    select assignment.* into assignment_record from public.adci_assignments assignment where assignment.id = new.assignment_id;
    select course.organization_id into organization_id from public.adci_courses course where course.id = assignment_record.course_id;
    perform public.adci_add_user_notification(
      organization_id, new.learner_id, 'assignment',
      case when new.status = 'graded' then 'Assignment graded' else 'Assignment returned for revision' end,
      assignment_record.title, case when new.status = 'graded' then 'important' else 'urgent' end,
      'assignment', assignment_record.id,
      jsonb_build_object('kind','assignment','id',assignment_record.id),
      'assignment-decision:' || new.id::text || ':' || new.status || ':' || coalesce(new.graded_at::text, new.updated_at::text)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists adci_notify_assignment_decision_trigger on public.adci_assignment_submissions;
create trigger adci_notify_assignment_decision_trigger
after update on public.adci_assignment_submissions
for each row execute function public.adci_notify_assignment_decision();

create or replace function public.adci_notify_assessment_publication()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare organization_id uuid; learner record;
begin
  if new.status = 'published' and tg_op = 'INSERT' then
    null;
  elsif new.status = 'published' and tg_op = 'UPDATE' and old.status is distinct from 'published' then
    null;
  else
    return new;
  end if;

  if new.status = 'published' then
    select course.organization_id into organization_id from public.adci_courses course where course.id = new.course_id;
    for learner in
      select distinct enrolment.learner_id
      from public.adci_enrolments enrolment
      where enrolment.course_id = new.course_id
        and enrolment.status in ('active','completed')
        and (enrolment.access_expires_at is null or enrolment.access_expires_at > now())
    loop
      perform public.adci_add_user_notification(
        organization_id, learner.learner_id, 'assessment', 'New assessment available',
        new.title, 'important', 'assessment', new.id,
        jsonb_build_object('kind','assessment','id',new.id),
        'assessment-published:' || new.id::text || ':' || learner.learner_id::text
      );
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists adci_notify_assessment_publication_trigger on public.adci_assessments;
create trigger adci_notify_assessment_publication_trigger
after insert or update on public.adci_assessments
for each row execute function public.adci_notify_assessment_publication();

create or replace function public.adci_queue_my_live_reminders()
returns integer language plpgsql security definer set search_path = ''
as $$
declare class_record record; organization_id uuid; created_id uuid; queued integer := 0;
begin
  if auth.uid() is null then return 0; end if;
  for class_record in
    select live_class.*, lesson.title as lesson_title, module.course_id, course.title as course_title
    from public.adci_live_classes live_class
    join public.adci_lessons lesson on lesson.id = live_class.lesson_id
    join public.adci_modules module on module.id = lesson.module_id
    join public.adci_courses course on course.id = module.course_id
    where live_class.starts_at between now() - interval '15 minutes' and now() + interval '24 hours'
      and live_class.ends_at > now()
      and public.adci_can_access_course(course.id)
  loop
    select course.organization_id into organization_id from public.adci_courses course where course.id = class_record.course_id;
    created_id := public.adci_add_user_notification(
      organization_id, auth.uid(), 'live_class',
      case when class_record.starts_at <= now() + interval '20 minutes' then 'Live class starting soon' else 'Live class tomorrow' end,
      class_record.lesson_title || ' - ' || class_record.course_title,
      case when class_record.starts_at <= now() + interval '20 minutes' then 'urgent' else 'important' end,
      'live_class', class_record.lesson_id,
      jsonb_build_object('kind','live_class','course_id',class_record.course_id,'lesson_id',class_record.lesson_id),
      'live-reminder:' || class_record.lesson_id::text || ':' || auth.uid()::text || ':' ||
        case when class_record.starts_at <= now() + interval '20 minutes' then 'soon' else 'day' end
    );
    if created_id is not null then queued := queued + 1; end if;
  end loop;
  return queued;
end;
$$;

create or replace function public.adci_get_my_notification_preferences()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'email_announcements', coalesce(preference.email_announcements, true),
    'notify_support', coalesce(preference.notify_support, true),
    'notify_assignments', coalesce(preference.notify_assignments, true),
    'notify_live_classes', coalesce(preference.notify_live_classes, true),
    'notify_assessments', coalesce(preference.notify_assessments, true)
  )
  from (select auth.uid() as user_id) current_user_data
  left join public.adci_notification_preferences preference on preference.user_id = current_user_data.user_id;
$$;

create or replace function public.adci_save_my_event_notification_preferences(
  receive_support boolean,
  receive_assignments boolean,
  receive_live_classes boolean,
  receive_assessments boolean
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  insert into public.adci_notification_preferences (
    user_id, notify_support, notify_assignments, notify_live_classes, notify_assessments, updated_at
  ) values (
    auth.uid(), receive_support, receive_assignments, receive_live_classes, receive_assessments, now()
  ) on conflict (user_id) do update set
    notify_support = excluded.notify_support,
    notify_assignments = excluded.notify_assignments,
    notify_live_classes = excluded.notify_live_classes,
    notify_assessments = excluded.notify_assessments,
    updated_at = now();
  return public.adci_get_my_notification_preferences();
end;
$$;

create or replace function public.adci_get_my_notifications()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare target_organization_id uuid; is_learner boolean; is_staff boolean; preference jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  perform public.adci_queue_my_live_reminders();
  select id into target_organization_id from public.adci_organizations where slug = 'adci';
  select exists (select 1 from public.adci_enrolments enrolment where enrolment.learner_id = auth.uid() and enrolment.status in ('active','completed')) into is_learner;
  select exists (select 1 from public.adci_memberships membership where membership.user_id = auth.uid() and membership.organization_id = target_organization_id and membership.active and membership.role <> 'student') into is_staff;
  preference := public.adci_get_my_notification_preferences();

  return jsonb_build_object(
    'unread_count', (select count(*) from (
      select announcement.id
      from public.adci_announcements announcement
      where announcement.organization_id = target_organization_id and announcement.status = 'published'
        and announcement.published_at <= now() and announcement.published_at >= now() - interval '90 days'
        and (announcement.expires_at is null or announcement.expires_at > now())
        and (announcement.audience = 'all' or (announcement.audience = 'learners' and is_learner) or (announcement.audience = 'staff' and is_staff))
        and not exists (select 1 from public.adci_announcement_reads receipt where receipt.announcement_id = announcement.id and receipt.user_id = auth.uid())
      union all
      select notification.id from public.adci_user_notifications notification
      where notification.user_id = auth.uid() and notification.read_at is null
        and case notification.notification_type
          when 'support' then (preference->>'notify_support')::boolean
          when 'assignment' then (preference->>'notify_assignments')::boolean
          when 'live_class' then (preference->>'notify_live_classes')::boolean
          when 'assessment' then (preference->>'notify_assessments')::boolean
          else true end
    ) unread),
    'items', coalesce((select jsonb_agg(item order by item->>'published_at' desc) from (
      select jsonb_build_object('id',announcement.id,'source','announcement','notification_type','announcement','title',announcement.title,'body',announcement.body,'audience',announcement.audience,'priority',announcement.priority,'published_at',announcement.published_at,'expires_at',announcement.expires_at,'read',receipt.read_at is not null,'action_data','{}'::jsonb) item
      from public.adci_announcements announcement
      left join public.adci_announcement_reads receipt on receipt.announcement_id = announcement.id and receipt.user_id = auth.uid()
      where announcement.organization_id = target_organization_id and announcement.status = 'published'
        and announcement.published_at <= now() and announcement.published_at >= now() - interval '90 days'
        and (announcement.expires_at is null or announcement.expires_at > now())
        and (announcement.audience = 'all' or (announcement.audience = 'learners' and is_learner) or (announcement.audience = 'staff' and is_staff))
      union all
      select jsonb_build_object('id',notification.id,'source','event','notification_type',notification.notification_type,'title',notification.title,'body',notification.body,'audience','personal','priority',notification.priority,'published_at',notification.created_at,'expires_at',null,'read',notification.read_at is not null,'action_data',notification.action_data) item
      from public.adci_user_notifications notification
      where notification.user_id = auth.uid()
        and notification.created_at >= now() - interval '180 days'
        and case notification.notification_type
          when 'support' then (preference->>'notify_support')::boolean
          when 'assignment' then (preference->>'notify_assignments')::boolean
          when 'live_class' then (preference->>'notify_live_classes')::boolean
          when 'assessment' then (preference->>'notify_assessments')::boolean
          else true end
    ) feed), '[]'::jsonb)
  );
end;
$$;

create or replace function public.adci_mark_notification_read(target_notification_id uuid, notification_source text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if notification_source = 'announcement' then
    insert into public.adci_announcement_reads (announcement_id,user_id,read_at)
    select announcement.id,auth.uid(),now() from public.adci_announcements announcement where announcement.id = target_notification_id
    on conflict (announcement_id,user_id) do update set read_at = now();
  elsif notification_source = 'event' then
    update public.adci_user_notifications set read_at = now() where id = target_notification_id and user_id = auth.uid();
  else raise exception 'Invalid notification source'; end if;
end;
$$;

create or replace function public.adci_mark_all_notifications_read()
returns void language plpgsql security definer set search_path = ''
as $$
declare notification_data jsonb;
begin
  notification_data := public.adci_get_my_notifications();
  insert into public.adci_announcement_reads (announcement_id,user_id,read_at)
  select (item->>'id')::uuid,auth.uid(),now() from jsonb_array_elements(notification_data->'items') items(item) where item->>'source' = 'announcement'
  on conflict (announcement_id,user_id) do update set read_at = now();
  update public.adci_user_notifications set read_at = now() where user_id = auth.uid() and read_at is null;
end;
$$;

revoke all on function public.adci_add_user_notification(uuid,uuid,text,text,text,text,text,uuid,jsonb,text) from public;
revoke all on function public.adci_queue_my_live_reminders() from public;
revoke all on function public.adci_get_my_notification_preferences() from public;
revoke all on function public.adci_save_my_event_notification_preferences(boolean,boolean,boolean,boolean) from public;
revoke all on function public.adci_mark_notification_read(uuid,text) from public;
revoke all on function public.adci_mark_all_notifications_read() from public;
grant execute on function public.adci_get_my_notification_preferences() to authenticated;
grant execute on function public.adci_save_my_event_notification_preferences(boolean,boolean,boolean,boolean) to authenticated;
grant execute on function public.adci_mark_notification_read(uuid,text) to authenticated;
grant execute on function public.adci_mark_all_notifications_read() to authenticated;
