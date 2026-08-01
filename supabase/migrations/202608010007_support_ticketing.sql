-- Learner help desk and protected staff support inbox.

create table if not exists public.adci_support_tickets (
  id uuid primary key default gen_random_uuid(),
  reference_code text not null unique default (
    'ADCI-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
  ),
  organization_id uuid not null references public.adci_organizations on delete cascade,
  requester_id uuid not null references public.adci_profiles on delete cascade,
  subject text not null check (char_length(trim(subject)) between 5 and 180),
  category text not null check (category in ('technical','course_content','assessment','payment','account','mentor','other')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'open' check (status in ('open','in_progress','waiting_learner','resolved','closed')),
  assigned_to uuid references public.adci_profiles on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.adci_support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.adci_support_tickets on delete cascade,
  author_id uuid not null references public.adci_profiles on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 5000),
  internal boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists adci_support_tickets_requester_idx
  on public.adci_support_tickets (requester_id, updated_at desc);
create index if not exists adci_support_tickets_queue_idx
  on public.adci_support_tickets (organization_id, status, priority, updated_at desc);
create index if not exists adci_support_messages_ticket_idx
  on public.adci_support_messages (ticket_id, created_at);

alter table public.adci_support_tickets enable row level security;
alter table public.adci_support_messages enable row level security;

drop policy if exists "learners read own support tickets" on public.adci_support_tickets;
create policy "learners read own support tickets"
on public.adci_support_tickets for select to authenticated
using (requester_id = auth.uid());

drop policy if exists "support staff read tickets" on public.adci_support_tickets;
create policy "support staff read tickets"
on public.adci_support_tickets for select to authenticated
using (public.adci_current_user_has_role(
  organization_id,
  array['mentor','support','branch_admin','super_admin']::public.adci_app_role[]
));

drop policy if exists "learners read own support messages" on public.adci_support_messages;
create policy "learners read own support messages"
on public.adci_support_messages for select to authenticated
using (
  not internal
  and exists (
    select 1 from public.adci_support_tickets ticket
    where ticket.id = ticket_id and ticket.requester_id = auth.uid()
  )
);

drop policy if exists "support staff read support messages" on public.adci_support_messages;
create policy "support staff read support messages"
on public.adci_support_messages for select to authenticated
using (
  exists (
    select 1 from public.adci_support_tickets ticket
    where ticket.id = ticket_id
      and public.adci_current_user_has_role(
        ticket.organization_id,
        array['mentor','support','branch_admin','super_admin']::public.adci_app_role[]
      )
  )
);

create or replace function public.adci_get_my_support_tickets()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ticket.id,
    'reference_code', ticket.reference_code,
    'subject', ticket.subject,
    'category', ticket.category,
    'priority', ticket.priority,
    'status', ticket.status,
    'assigned_name', coalesce(nullif(trim(assignee.full_name), ''), 'ADCI Support'),
    'created_at', ticket.created_at,
    'updated_at', ticket.updated_at,
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', message.id,
        'body', message.body,
        'author_id', message.author_id,
        'author_name', coalesce(nullif(trim(author.full_name), ''), 'ADCI User'),
        'is_mine', message.author_id = auth.uid(),
        'created_at', message.created_at
      ) order by message.created_at)
      from public.adci_support_messages message
      join public.adci_profiles author on author.id = message.author_id
      where message.ticket_id = ticket.id and not message.internal
    ), '[]'::jsonb)
  ) order by ticket.updated_at desc), '[]'::jsonb)
  from public.adci_support_tickets ticket
  left join public.adci_profiles assignee on assignee.id = ticket.assigned_to
  where ticket.requester_id = auth.uid();
$$;

create or replace function public.adci_create_support_ticket(
  ticket_subject text,
  ticket_category text,
  ticket_priority text,
  ticket_message text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  created_ticket_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to contact support'; end if;
  if char_length(trim(ticket_subject)) not between 5 and 180 then raise exception 'Subject must be between 5 and 180 characters'; end if;
  if char_length(trim(ticket_message)) not between 3 and 5000 then raise exception 'Message must be between 3 and 5000 characters'; end if;
  if ticket_category not in ('technical','course_content','assessment','payment','account','mentor','other') then raise exception 'Select a valid category'; end if;
  if ticket_priority not in ('low','normal','high','urgent') then raise exception 'Select a valid priority'; end if;

  select course.organization_id into target_organization_id
  from public.adci_enrolments enrolment
  join public.adci_courses course on course.id = enrolment.course_id
  where enrolment.learner_id = auth.uid()
  order by enrolment.enrolled_at desc
  limit 1;

  if target_organization_id is null then
    select organization.id into target_organization_id
    from public.adci_organizations organization
    where organization.slug = 'adci'
    limit 1;
  end if;
  if target_organization_id is null then raise exception 'ADCI support is not configured'; end if;

  insert into public.adci_support_tickets (
    organization_id, requester_id, subject, category, priority
  ) values (
    target_organization_id, auth.uid(), trim(ticket_subject), ticket_category, ticket_priority
  ) returning id into created_ticket_id;

  insert into public.adci_support_messages (ticket_id, author_id, body)
  values (created_ticket_id, auth.uid(), trim(ticket_message));

  return created_ticket_id;
end;
$$;

create or replace function public.adci_reply_to_support_ticket(
  target_ticket_id uuid,
  reply_body text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if char_length(trim(reply_body)) not between 1 and 5000 then raise exception 'Reply is required'; end if;
  if not exists (
    select 1 from public.adci_support_tickets ticket
    where ticket.id = target_ticket_id
      and ticket.requester_id = auth.uid()
      and ticket.status <> 'closed'
  ) then raise exception 'This ticket is not available for replies'; end if;

  insert into public.adci_support_messages (ticket_id, author_id, body)
  values (target_ticket_id, auth.uid(), trim(reply_body));

  update public.adci_support_tickets
  set status = case when status in ('waiting_learner','resolved') then 'open' else status end,
      resolved_at = case when status in ('waiting_learner','resolved') then null else resolved_at end,
      updated_at = now()
  where id = target_ticket_id;
end;
$$;

create or replace function public.adci_admin_get_support_tickets()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  payload jsonb;
begin
  select organization.id into target_organization_id
  from public.adci_organizations organization where organization.slug = 'adci' limit 1;
  if not public.adci_current_user_has_role(
    target_organization_id,
    array['mentor','support','branch_admin','super_admin']::public.adci_app_role[]
  ) then raise exception 'Support inbox permission required'; end if;

  select jsonb_build_object(
    'summary', jsonb_build_object(
      'open', count(*) filter (where ticket.status = 'open'),
      'in_progress', count(*) filter (where ticket.status = 'in_progress'),
      'waiting_learner', count(*) filter (where ticket.status = 'waiting_learner'),
      'urgent', count(*) filter (where ticket.priority = 'urgent' and ticket.status not in ('resolved','closed')),
      'resolved', count(*) filter (where ticket.status in ('resolved','closed'))
    ),
    'tickets', coalesce(jsonb_agg(jsonb_build_object(
      'id', ticket.id,
      'reference_code', ticket.reference_code,
      'requester_id', ticket.requester_id,
      'requester_name', coalesce(nullif(trim(requester.full_name), ''), 'Learner'),
      'subject', ticket.subject,
      'category', ticket.category,
      'priority', ticket.priority,
      'status', ticket.status,
      'assigned_to', ticket.assigned_to,
      'assigned_name', coalesce(nullif(trim(assignee.full_name), ''), ''),
      'created_at', ticket.created_at,
      'updated_at', ticket.updated_at,
      'messages', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', message.id,
          'body', message.body,
          'author_id', message.author_id,
          'author_name', coalesce(nullif(trim(author.full_name), ''), 'ADCI User'),
          'internal', message.internal,
          'is_staff', exists (
            select 1 from public.adci_memberships membership
            where membership.user_id = message.author_id
              and membership.organization_id = target_organization_id
              and membership.active
              and membership.role in ('mentor','support','branch_admin','super_admin')
          ),
          'created_at', message.created_at
        ) order by message.created_at)
        from public.adci_support_messages message
        join public.adci_profiles author on author.id = message.author_id
        where message.ticket_id = ticket.id
      ), '[]'::jsonb)
    ) order by
      case ticket.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,
      ticket.updated_at desc
    ) filter (where ticket.id is not null), '[]'::jsonb)
  ) into payload
  from public.adci_support_tickets ticket
  join public.adci_profiles requester on requester.id = ticket.requester_id
  left join public.adci_profiles assignee on assignee.id = ticket.assigned_to
  where ticket.organization_id = target_organization_id;

  return payload;
end;
$$;

create or replace function public.adci_admin_reply_support_ticket(
  target_ticket_id uuid,
  reply_body text,
  internal_note boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ticket_record public.adci_support_tickets;
begin
  select * into ticket_record from public.adci_support_tickets where id = target_ticket_id;
  if ticket_record.id is null or not public.adci_current_user_has_role(
    ticket_record.organization_id,
    array['mentor','support','branch_admin','super_admin']::public.adci_app_role[]
  ) then raise exception 'Support reply permission required'; end if;
  if ticket_record.status = 'closed' then raise exception 'Closed tickets cannot receive replies'; end if;
  if char_length(trim(reply_body)) not between 1 and 5000 then raise exception 'Reply is required'; end if;

  insert into public.adci_support_messages (ticket_id, author_id, body, internal)
  values (target_ticket_id, auth.uid(), trim(reply_body), internal_note);

  update public.adci_support_tickets
  set assigned_to = coalesce(assigned_to, auth.uid()),
      status = case when internal_note then status else 'waiting_learner' end,
      updated_at = now()
  where id = target_ticket_id;
end;
$$;

create or replace function public.adci_admin_update_support_ticket(
  target_ticket_id uuid,
  next_status text,
  assign_to_me boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ticket_record public.adci_support_tickets;
begin
  select * into ticket_record from public.adci_support_tickets where id = target_ticket_id;
  if ticket_record.id is null or not public.adci_current_user_has_role(
    ticket_record.organization_id,
    array['mentor','support','branch_admin','super_admin']::public.adci_app_role[]
  ) then raise exception 'Support update permission required'; end if;
  if next_status not in ('open','in_progress','waiting_learner','resolved','closed') then raise exception 'Invalid ticket status'; end if;

  update public.adci_support_tickets
  set status = next_status,
      assigned_to = case when assign_to_me then auth.uid() else assigned_to end,
      resolved_at = case when next_status in ('resolved','closed') then coalesce(resolved_at, now()) else null end,
      updated_at = now()
  where id = target_ticket_id;
end;
$$;

revoke all on function public.adci_get_my_support_tickets() from public;
revoke all on function public.adci_create_support_ticket(text,text,text,text) from public;
revoke all on function public.adci_reply_to_support_ticket(uuid,text) from public;
revoke all on function public.adci_admin_get_support_tickets() from public;
revoke all on function public.adci_admin_reply_support_ticket(uuid,text,boolean) from public;
revoke all on function public.adci_admin_update_support_ticket(uuid,text,boolean) from public;

grant execute on function public.adci_get_my_support_tickets() to authenticated;
grant execute on function public.adci_create_support_ticket(text,text,text,text) to authenticated;
grant execute on function public.adci_reply_to_support_ticket(uuid,text) to authenticated;
grant execute on function public.adci_admin_get_support_tickets() to authenticated;
grant execute on function public.adci_admin_reply_support_ticket(uuid,text,boolean) to authenticated;
grant execute on function public.adci_admin_update_support_ticket(uuid,text,boolean) to authenticated;
