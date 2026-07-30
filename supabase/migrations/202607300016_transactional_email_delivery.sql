-- Durable transactional email queue, preferences, retries and delivery reporting.
-- Run this complete file once after migration 202607300015.

alter table public.adci_announcements
  add column if not exists email_delivery_enabled boolean not null default false;

create table if not exists public.adci_notification_preferences (
  user_id uuid primary key references public.adci_profiles on delete cascade,
  email_announcements boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.adci_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.adci_organizations on delete cascade,
  announcement_id uuid references public.adci_announcements on delete cascade,
  user_id uuid not null references public.adci_profiles on delete cascade,
  message_kind text not null default 'announcement'
    check (message_kind in ('announcement','payment_receipt','assignment_graded')),
  event_key text not null unique,
  recipient_name text not null,
  recipient_email text not null,
  subject text not null,
  body text not null,
  priority text not null default 'info'
    check (priority in ('info','important','urgent')),
  status text not null default 'queued'
    check (status in ('queued','processing','sent','failed','cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  provider_message_id text,
  provider_status text not null default 'pending'
    check (provider_status in ('pending','accepted','sent','delivered','delayed','bounced','complained','suppressed','failed')),
  provider_event_at timestamptz,
  provider_event_payload jsonb not null default '{}'::jsonb,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (announcement_id is not null or message_kind <> 'announcement')
);

create table if not exists public.adci_email_webhook_events (
  provider_event_id text primary key,
  event_type text not null,
  provider_message_id text,
  payload jsonb not null,
  received_at timestamptz not null default now()
);

alter table public.adci_notification_preferences enable row level security;
alter table public.adci_email_deliveries enable row level security;
alter table public.adci_email_webhook_events enable row level security;

drop policy if exists "users read own notification preferences" on public.adci_notification_preferences;
create policy "users read own notification preferences"
on public.adci_notification_preferences for select to authenticated
using (user_id = auth.uid());

drop policy if exists "users create own notification preferences" on public.adci_notification_preferences;
create policy "users create own notification preferences"
on public.adci_notification_preferences for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "users update own notification preferences" on public.adci_notification_preferences;
create policy "users update own notification preferences"
on public.adci_notification_preferences for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "administrators read email deliveries" on public.adci_email_deliveries;
create policy "administrators read email deliveries"
on public.adci_email_deliveries for select to authenticated
using (
  public.adci_current_user_has_role(
    organization_id,
    array['content_author','academic_lead','branch_admin','super_admin','support']::public.adci_app_role[]
  )
);

create index if not exists adci_email_deliveries_dispatch_idx
on public.adci_email_deliveries (status, next_attempt_at, created_at);
create index if not exists adci_email_deliveries_announcement_idx
on public.adci_email_deliveries (announcement_id, status);
create index if not exists adci_email_deliveries_org_created_idx
on public.adci_email_deliveries (organization_id, created_at desc);
create unique index if not exists adci_email_deliveries_announcement_user_idx
on public.adci_email_deliveries (announcement_id, user_id)
where announcement_id is not null;

create or replace function public.adci_enable_email_for_new_publication()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.status <> 'published' then
    new.email_delivery_enabled := false;
  elsif tg_op = 'INSERT'
    or old.status <> 'published'
    or new.published_at is distinct from old.published_at then
    new.email_delivery_enabled := true;
  end if;
  return new;
end;
$$;

drop trigger if exists adci_enable_email_for_new_publication on public.adci_announcements;
create trigger adci_enable_email_for_new_publication
before insert or update on public.adci_announcements
for each row execute function public.adci_enable_email_for_new_publication();

create or replace function public.adci_get_my_email_preferences()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'email_announcements',
    coalesce((
      select preference.email_announcements
      from public.adci_notification_preferences preference
      where preference.user_id = auth.uid()
    ), true)
  );
$$;

create or replace function public.adci_save_my_email_preferences(
  receive_announcement_emails boolean
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  insert into public.adci_notification_preferences (
    user_id, email_announcements, updated_at
  ) values (
    auth.uid(), receive_announcement_emails, now()
  )
  on conflict (user_id) do update set
    email_announcements = excluded.email_announcements,
    updated_at = now();

  if not receive_announcement_emails then
    update public.adci_email_deliveries
    set status = 'cancelled', updated_at = now()
    where user_id = auth.uid()
      and message_kind = 'announcement'
      and status in ('queued','failed');
  end if;

  return jsonb_build_object('email_announcements', receive_announcement_emails);
end;
$$;

create or replace function public.adci_queue_due_announcement_emails()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare queued_count integer;
begin
  insert into public.adci_email_deliveries (
    organization_id, announcement_id, user_id, message_kind, event_key,
    recipient_name, recipient_email, subject, body, priority
  )
  select
    announcement.organization_id,
    announcement.id,
    profile.id,
    'announcement',
    'announcement/' || announcement.id::text || '/' || profile.id::text,
    coalesce(nullif(trim(profile.full_name), ''), split_part(auth_user.email::text, '@', 1)),
    lower(auth_user.email::text),
    announcement.title,
    announcement.body,
    announcement.priority
  from public.adci_announcements announcement
  join public.adci_profiles profile on true
  join auth.users auth_user on auth_user.id = profile.id
  left join public.adci_notification_preferences preference on preference.user_id = profile.id
  where announcement.status = 'published'
    and announcement.email_delivery_enabled
    and announcement.published_at <= now()
    and (announcement.expires_at is null or announcement.expires_at > now())
    and auth_user.email is not null
    and auth_user.email_confirmed_at is not null
    and coalesce(preference.email_announcements, true)
    and (
      announcement.audience = 'all'
      or (
        announcement.audience = 'learners'
        and exists (
          select 1
          from public.adci_enrolments enrolment
          join public.adci_courses course on course.id = enrolment.course_id
          where enrolment.learner_id = profile.id
            and course.organization_id = announcement.organization_id
            and enrolment.status in ('active','completed')
            and (enrolment.access_expires_at is null or enrolment.access_expires_at > now())
        )
      )
      or (
        announcement.audience = 'staff'
        and exists (
          select 1 from public.adci_memberships membership
          where membership.user_id = profile.id
            and membership.organization_id = announcement.organization_id
            and membership.active
            and membership.role <> 'student'
        )
      )
    )
  on conflict do nothing;
  get diagnostics queued_count = row_count;
  return queued_count;
end;
$$;

create or replace function public.adci_claim_email_deliveries(
  claim_limit integer default 25
)
returns table (
  delivery_id uuid,
  announcement_id uuid,
  message_kind text,
  recipient_email text,
  recipient_name text,
  message_subject text,
  message_body text,
  message_priority text,
  attempt_number integer
)
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.adci_queue_due_announcement_emails();

  update public.adci_email_deliveries delivery
  set status = 'cancelled', updated_at = now()
  where delivery.status in ('queued','failed')
    and exists (
      select 1 from public.adci_announcements announcement
      where announcement.id = delivery.announcement_id
        and (
          announcement.status <> 'published'
          or announcement.published_at > now()
          or (announcement.expires_at is not null and announcement.expires_at <= now())
        )
    );

  update public.adci_email_deliveries
  set status = 'failed',
      next_attempt_at = now(),
      last_error = 'Delivery claim expired before completion',
      updated_at = now()
  where status = 'processing' and claimed_at < now() - interval '15 minutes';

  return query
  with candidates as (
    select delivery.id
    from public.adci_email_deliveries delivery
    where delivery.status in ('queued','failed')
      and delivery.attempts < 5
      and delivery.next_attempt_at <= now()
    order by delivery.next_attempt_at, delivery.created_at
    for update skip locked
    limit greatest(1, least(100, claim_limit))
  ),
  claimed as (
    update public.adci_email_deliveries delivery
    set status = 'processing',
        attempts = delivery.attempts + 1,
        claimed_at = now(),
        last_error = null,
        updated_at = now()
    from candidates
    where delivery.id = candidates.id
    returning delivery.*
  )
  select
    claimed.id,
    claimed.announcement_id,
    claimed.message_kind,
    claimed.recipient_email,
    claimed.recipient_name,
    claimed.subject,
    claimed.body,
    claimed.priority,
    claimed.attempts
  from claimed
  join public.adci_profiles profile on profile.id = claimed.user_id;
end;
$$;

create or replace function public.adci_mark_email_delivery_sent(
  target_delivery_id uuid,
  provider_email_id text
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.adci_email_deliveries
  set status = 'sent',
      provider_message_id = nullif(trim(provider_email_id), ''),
      provider_status = case when provider_status = 'pending' then 'accepted' else provider_status end,
      sent_at = coalesce(sent_at, now()),
      last_error = null,
      updated_at = now()
  where id = target_delivery_id and status in ('processing','sent');
  if not found then raise exception 'Claimed email delivery not found'; end if;
end;
$$;

create or replace function public.adci_mark_email_delivery_failed(
  target_delivery_id uuid,
  failure_message text
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.adci_email_deliveries
  set status = 'failed',
      last_error = left(coalesce(failure_message, 'Email delivery failed'), 1500),
      next_attempt_at = now() + make_interval(
        mins => (greatest(1, power(2, least(attempts, 6))::integer) * 5)
      ),
      updated_at = now()
  where id = target_delivery_id and status = 'processing';
  if not found then raise exception 'Claimed email delivery not found'; end if;
end;
$$;

create or replace function public.adci_admin_get_email_delivery()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare target_organization_id uuid;
begin
  select id into target_organization_id
  from public.adci_organizations where slug = 'adci';
  if not public.adci_current_user_has_role(
    target_organization_id,
    array['content_author','academic_lead','branch_admin','super_admin','support']::public.adci_app_role[]
  ) then raise exception 'Messaging administration permission required'; end if;

  return jsonb_build_object(
    'summary', jsonb_build_object(
      'queued', (
        select count(*) from public.adci_email_deliveries
        where organization_id = target_organization_id and status in ('queued','processing')
      ),
      'sent', (
        select count(*) from public.adci_email_deliveries
        where organization_id = target_organization_id and status = 'sent'
      ),
      'failed', (
        select count(*) from public.adci_email_deliveries
        where organization_id = target_organization_id and status = 'failed'
      ),
      'cancelled', (
        select count(*) from public.adci_email_deliveries
        where organization_id = target_organization_id and status = 'cancelled'
      ),
      'delivered', (
        select count(*) from public.adci_email_deliveries
        where organization_id = target_organization_id and provider_status = 'delivered'
      ),
      'bounced', (
        select count(*) from public.adci_email_deliveries
        where organization_id = target_organization_id
          and provider_status in ('bounced','complained','suppressed','failed')
      )
    ),
    'deliveries', coalesce((
      select jsonb_agg(recent_delivery.payload order by recent_delivery.created_at desc)
      from (
        select
          delivery.created_at,
          jsonb_build_object(
            'id', delivery.id,
            'announcement_id', delivery.announcement_id,
            'message_kind', delivery.message_kind,
            'announcement_title', delivery.subject,
            'recipient_name', delivery.recipient_name,
            'recipient_email', delivery.recipient_email,
            'status', delivery.status,
            'attempts', delivery.attempts,
            'provider_message_id', delivery.provider_message_id,
            'provider_status', delivery.provider_status,
            'provider_event_at', delivery.provider_event_at,
            'last_error', delivery.last_error,
            'sent_at', delivery.sent_at,
            'created_at', delivery.created_at
          ) as payload
        from public.adci_email_deliveries delivery
        join public.adci_profiles profile on profile.id = delivery.user_id
        where delivery.organization_id = target_organization_id
        order by delivery.created_at desc
        limit 100
      ) recent_delivery
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.adci_record_email_provider_event(
  provider_event_id text,
  provider_event_type text,
  provider_email_id text,
  provider_event_payload jsonb
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare inserted_event_count integer; mapped_status text;
begin
  insert into public.adci_email_webhook_events (
    provider_event_id, event_type, provider_message_id, payload
  ) values (
    provider_event_id, provider_event_type, provider_email_id,
    coalesce(provider_event_payload, '{}'::jsonb)
  )
  on conflict (provider_event_id) do nothing;
  get diagnostics inserted_event_count = row_count;
  if inserted_event_count = 0 then return false; end if;

  mapped_status := case provider_event_type
    when 'email.sent' then 'sent'
    when 'email.delivered' then 'delivered'
    when 'email.delivery_delayed' then 'delayed'
    when 'email.bounced' then 'bounced'
    when 'email.complained' then 'complained'
    when 'email.suppressed' then 'suppressed'
    when 'email.failed' then 'failed'
    else null
  end;
  if mapped_status is not null then
    update public.adci_email_deliveries
    set provider_status = case
          when provider_status in ('bounced','complained','suppressed','failed') then provider_status
          when mapped_status in ('bounced','complained','suppressed','failed') then mapped_status
          when provider_status = 'delivered' then provider_status
          when mapped_status = 'delivered' then 'delivered'
          when mapped_status = 'delayed'
            and provider_status in ('pending','accepted','sent') then 'delayed'
          when mapped_status = 'sent'
            and provider_status in ('pending','accepted') then 'sent'
          else provider_status
        end,
        provider_event_at = coalesce(
          nullif(provider_event_payload->>'created_at', '')::timestamptz,
          now()
        ),
        provider_event_payload = coalesce(provider_event_payload, '{}'::jsonb),
        last_error = case
          when mapped_status in ('bounced','complained','suppressed','failed')
          then coalesce(
            provider_event_payload #>> '{data,bounce,message}',
            provider_event_payload #>> '{data,error,message}',
            provider_event_type
          )
          else last_error
        end,
        updated_at = now()
    where provider_message_id = provider_email_id
      or id::text = provider_event_payload #>> '{data,tags,delivery}';
  end if;
  return true;
end;
$$;

create or replace function public.adci_queue_invoice_email()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  target_organization_id uuid;
  target_email text;
  target_name text;
  target_course_title text;
begin
  select
    payment_order.organization_id,
    auth_user.email::text,
    coalesce(nullif(trim(profile.full_name), ''), split_part(auth_user.email::text, '@', 1)),
    course.title
  into target_organization_id, target_email, target_name, target_course_title
  from public.adci_orders payment_order
  join public.adci_profiles profile on profile.id = payment_order.learner_id
  join auth.users auth_user on auth_user.id = payment_order.learner_id
  join public.adci_courses course on course.id = new.course_id
  where payment_order.id = new.order_id
    and auth_user.email is not null
    and auth_user.email_confirmed_at is not null;

  if target_email is not null then
    insert into public.adci_email_deliveries (
      organization_id, user_id, message_kind, event_key, recipient_name,
      recipient_email, subject, body, priority
    ) values (
      target_organization_id, new.learner_id, 'payment_receipt',
      'invoice/' || new.id::text, target_name, lower(target_email),
      'Payment received for ' || target_course_title,
      'Your payment of INR ' || to_char(new.total_paise / 100.0, 'FM999999990.00') ||
        ' was received successfully. Invoice ' || new.invoice_number ||
        ' is available in Courses and billing.',
      'important'
    )
    on conflict (event_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists adci_queue_invoice_email on public.adci_invoices;
create trigger adci_queue_invoice_email
after insert on public.adci_invoices
for each row execute function public.adci_queue_invoice_email();

create or replace function public.adci_queue_assignment_grade_email()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  target_organization_id uuid;
  target_email text;
  target_name text;
  target_assignment_title text;
  target_max_score numeric;
begin
  if new.status <> 'graded'
    or (old.status = 'graded' and new.graded_at is not distinct from old.graded_at)
  then return new; end if;

  select
    course.organization_id,
    auth_user.email::text,
    coalesce(nullif(trim(profile.full_name), ''), split_part(auth_user.email::text, '@', 1)),
    assignment.title,
    assignment.max_score
  into target_organization_id, target_email, target_name,
       target_assignment_title, target_max_score
  from public.adci_assignments assignment
  join public.adci_courses course on course.id = assignment.course_id
  join public.adci_profiles profile on profile.id = new.learner_id
  join auth.users auth_user on auth_user.id = new.learner_id
  where assignment.id = new.assignment_id
    and auth_user.email is not null
    and auth_user.email_confirmed_at is not null;

  if target_email is not null then
    insert into public.adci_email_deliveries (
      organization_id, user_id, message_kind, event_key, recipient_name,
      recipient_email, subject, body, priority
    ) values (
      target_organization_id, new.learner_id, 'assignment_graded',
      'assignment-graded/' || new.id::text || '/' ||
        coalesce(extract(epoch from new.graded_at)::bigint::text, '0'),
      target_name, lower(target_email),
      'Your assignment has been graded: ' || target_assignment_title,
      'Your submission for ' || target_assignment_title || ' received ' ||
        coalesce(new.score::text, '0') || ' out of ' || target_max_score::text ||
        '. Open Assignments in the ADCI Learning Hub to review your feedback.',
      'important'
    )
    on conflict (event_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists adci_queue_assignment_grade_email on public.adci_assignment_submissions;
create trigger adci_queue_assignment_grade_email
after update on public.adci_assignment_submissions
for each row execute function public.adci_queue_assignment_grade_email();

create or replace function public.adci_admin_retry_email_delivery(
  target_delivery_id uuid
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare delivery_record public.adci_email_deliveries;
begin
  select * into delivery_record
  from public.adci_email_deliveries where id = target_delivery_id;
  if delivery_record.id is null or not public.adci_current_user_has_role(
    delivery_record.organization_id,
    array['content_author','academic_lead','branch_admin','super_admin','support']::public.adci_app_role[]
  ) then raise exception 'Messaging administration permission required'; end if;

  update public.adci_email_deliveries
  set status = 'queued', attempts = 0, next_attempt_at = now(),
      claimed_at = null, last_error = null, updated_at = now()
  where id = target_delivery_id and status = 'failed';
  if not found then raise exception 'Only failed email deliveries can be retried'; end if;
end;
$$;

revoke all on function public.adci_enable_email_for_new_publication() from public;
revoke all on function public.adci_queue_invoice_email() from public;
revoke all on function public.adci_queue_assignment_grade_email() from public;
revoke all on function public.adci_get_my_email_preferences() from public;
revoke all on function public.adci_save_my_email_preferences(boolean) from public;
revoke all on function public.adci_queue_due_announcement_emails() from public;
revoke all on function public.adci_claim_email_deliveries(integer) from public;
revoke all on function public.adci_mark_email_delivery_sent(uuid,text) from public;
revoke all on function public.adci_mark_email_delivery_failed(uuid,text) from public;
revoke all on function public.adci_record_email_provider_event(text,text,text,jsonb) from public;
revoke all on function public.adci_admin_get_email_delivery() from public;
revoke all on function public.adci_admin_retry_email_delivery(uuid) from public;
grant execute on function public.adci_get_my_email_preferences() to authenticated;
grant execute on function public.adci_save_my_email_preferences(boolean) to authenticated;
grant execute on function public.adci_queue_due_announcement_emails() to service_role;
grant execute on function public.adci_claim_email_deliveries(integer) to service_role;
grant execute on function public.adci_mark_email_delivery_sent(uuid,text) to service_role;
grant execute on function public.adci_mark_email_delivery_failed(uuid,text) to service_role;
grant execute on function public.adci_record_email_provider_event(text,text,text,jsonb) to service_role;
grant execute on function public.adci_admin_get_email_delivery() to authenticated;
grant execute on function public.adci_admin_retry_email_delivery(uuid) to authenticated;
