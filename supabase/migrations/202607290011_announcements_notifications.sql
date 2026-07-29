-- Institution announcements, learner notifications and read receipts.
-- Safe to run more than once.

create table if not exists public.adci_announcements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.adci_organizations on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 180),
  body text not null check (char_length(trim(body)) between 1 and 5000),
  audience text not null default 'all' check (audience in ('all','learners','staff')),
  priority text not null default 'info' check (priority in ('info','important','urgent')),
  status text not null default 'draft' check (status in ('draft','published','retired')),
  published_at timestamptz,
  expires_at timestamptz,
  created_by uuid references public.adci_profiles,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or published_at is null or expires_at > published_at)
);

create table if not exists public.adci_announcement_reads (
  announcement_id uuid not null references public.adci_announcements on delete cascade,
  user_id uuid not null references public.adci_profiles on delete cascade,
  read_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

alter table public.adci_announcements enable row level security;
alter table public.adci_announcement_reads enable row level security;

drop policy if exists "users read relevant published announcements" on public.adci_announcements;
create policy "users read relevant published announcements"
on public.adci_announcements for select to authenticated
using (
  status = 'published'
  and published_at <= now()
  and (expires_at is null or expires_at > now())
  and (
    audience = 'all'
    or (audience = 'learners' and exists (
      select 1 from public.adci_enrolments e
      where e.learner_id = auth.uid() and e.status in ('active','completed')
    ))
    or (audience = 'staff' and exists (
      select 1 from public.adci_memberships m
      where m.user_id = auth.uid() and m.active and m.role <> 'student'
    ))
  )
);

drop policy if exists "administrators manage announcements" on public.adci_announcements;
create policy "administrators manage announcements"
on public.adci_announcements for all to authenticated
using (
  public.adci_current_user_has_role(
    organization_id,
    array['content_author','academic_lead','branch_admin','super_admin','support']::public.adci_app_role[]
  )
)
with check (
  public.adci_current_user_has_role(
    organization_id,
    array['content_author','academic_lead','branch_admin','super_admin','support']::public.adci_app_role[]
  )
);

drop policy if exists "users read own announcement receipts" on public.adci_announcement_reads;
create policy "users read own announcement receipts"
on public.adci_announcement_reads for select
using (user_id = auth.uid());

drop policy if exists "users create own announcement receipts" on public.adci_announcement_reads;
create policy "users create own announcement receipts"
on public.adci_announcement_reads for insert
with check (user_id = auth.uid());

drop policy if exists "users update own announcement receipts" on public.adci_announcement_reads;
create policy "users update own announcement receipts"
on public.adci_announcement_reads for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create index if not exists adci_announcements_org_publish_idx
on public.adci_announcements (organization_id, status, published_at desc);
create index if not exists adci_announcement_reads_user_idx
on public.adci_announcement_reads (user_id, read_at desc);

create or replace function public.adci_get_my_notifications()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare target_organization_id uuid; is_learner boolean; is_staff boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select id into target_organization_id from public.adci_organizations where slug = 'adci';
  select exists (
    select 1 from public.adci_enrolments e
    where e.learner_id = auth.uid() and e.status in ('active','completed')
      and (e.access_expires_at is null or e.access_expires_at > now())
  ) into is_learner;
  select exists (
    select 1 from public.adci_memberships m
    where m.user_id = auth.uid() and m.organization_id = target_organization_id
      and m.active and m.role <> 'student'
  ) into is_staff;

  return jsonb_build_object(
    'unread_count', (
      select count(*) from public.adci_announcements announcement
      where announcement.organization_id = target_organization_id
        and announcement.status = 'published'
        and announcement.published_at <= now()
        and announcement.published_at >= now() - interval '90 days'
        and (announcement.expires_at is null or announcement.expires_at > now())
        and (announcement.audience = 'all'
          or (announcement.audience = 'learners' and is_learner)
          or (announcement.audience = 'staff' and is_staff))
        and not exists (
          select 1 from public.adci_announcement_reads receipt
          where receipt.announcement_id = announcement.id and receipt.user_id = auth.uid()
        )
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', announcement.id,
        'title', announcement.title,
        'body', announcement.body,
        'audience', announcement.audience,
        'priority', announcement.priority,
        'published_at', announcement.published_at,
        'expires_at', announcement.expires_at,
        'read', receipt.read_at is not null
      ) order by announcement.published_at desc)
      from public.adci_announcements announcement
      left join public.adci_announcement_reads receipt
        on receipt.announcement_id = announcement.id and receipt.user_id = auth.uid()
      where announcement.organization_id = target_organization_id
        and announcement.status = 'published'
        and announcement.published_at <= now()
        and announcement.published_at >= now() - interval '90 days'
        and (announcement.expires_at is null or announcement.expires_at > now())
        and (announcement.audience = 'all'
          or (announcement.audience = 'learners' and is_learner)
          or (announcement.audience = 'staff' and is_staff))
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.adci_mark_announcement_read(target_announcement_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1
    from jsonb_array_elements(public.adci_get_my_notifications()->'items') as items(item)
    where (item->>'id')::uuid = target_announcement_id
  ) then raise exception 'Announcement not found or unavailable'; end if;
  insert into public.adci_announcement_reads (announcement_id, user_id, read_at)
  values (target_announcement_id, auth.uid(), now())
  on conflict (announcement_id, user_id) do update set read_at = now();
end;
$$;

create or replace function public.adci_mark_all_announcements_read()
returns void
language plpgsql security definer set search_path = ''
as $$
declare notification_data jsonb;
begin
  notification_data := public.adci_get_my_notifications();
  insert into public.adci_announcement_reads (announcement_id, user_id)
  select (item->>'id')::uuid, auth.uid()
  from jsonb_array_elements(notification_data->'items') as items(item)
  on conflict (announcement_id, user_id) do update set read_at = now();
end;
$$;

create or replace function public.adci_admin_get_announcements()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare target_organization_id uuid;
begin
  select id into target_organization_id from public.adci_organizations where slug = 'adci';
  if not public.adci_current_user_has_role(
    target_organization_id,
    array['content_author','academic_lead','branch_admin','super_admin','support']::public.adci_app_role[]
  ) then raise exception 'Announcement administration permission required'; end if;

  return jsonb_build_object(
    'summary', jsonb_build_object(
      'total', (select count(*) from public.adci_announcements where organization_id = target_organization_id),
      'published', (select count(*) from public.adci_announcements where organization_id = target_organization_id and status = 'published'),
      'drafts', (select count(*) from public.adci_announcements where organization_id = target_organization_id and status = 'draft'),
      'urgent', (select count(*) from public.adci_announcements where organization_id = target_organization_id and status = 'published' and priority = 'urgent')
    ),
    'announcements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', announcement.id,
        'title', announcement.title,
        'body', announcement.body,
        'audience', announcement.audience,
        'priority', announcement.priority,
        'status', announcement.status,
        'published_at', announcement.published_at,
        'expires_at', announcement.expires_at,
        'created_at', announcement.created_at,
        'read_count', (select count(*) from public.adci_announcement_reads receipt where receipt.announcement_id = announcement.id),
        'recipient_count', case announcement.audience
          when 'learners' then (
            select count(distinct e.learner_id) from public.adci_enrolments e
            join public.adci_courses c on c.id = e.course_id
            where c.organization_id = target_organization_id and e.status in ('active','completed')
          )
          when 'staff' then (
            select count(distinct m.user_id) from public.adci_memberships m
            where m.organization_id = target_organization_id and m.active and m.role <> 'student'
          )
          else (select count(*) from public.adci_profiles)
        end
      ) order by announcement.created_at desc)
      from public.adci_announcements announcement
      where announcement.organization_id = target_organization_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.adci_admin_save_announcement(
  target_announcement_id uuid,
  announcement_title text,
  announcement_body text,
  announcement_audience text,
  announcement_priority text,
  announcement_status text,
  announcement_published_at timestamptz,
  announcement_expires_at timestamptz
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare target_organization_id uuid; saved_id uuid;
begin
  select id into target_organization_id from public.adci_organizations where slug = 'adci';
  if not public.adci_current_user_has_role(
    target_organization_id,
    array['content_author','academic_lead','branch_admin','super_admin','support']::public.adci_app_role[]
  ) then raise exception 'Announcement administration permission required'; end if;
  if trim(announcement_title) = '' or trim(announcement_body) = ''
  then raise exception 'Title and message are required'; end if;
  if announcement_audience not in ('all','learners','staff')
     or announcement_priority not in ('info','important','urgent')
     or announcement_status not in ('draft','published','retired')
  then raise exception 'Invalid announcement setting'; end if;

  if target_announcement_id is null then
    insert into public.adci_announcements (
      organization_id, title, body, audience, priority, status,
      published_at, expires_at, created_by
    ) values (
      target_organization_id, trim(announcement_title), trim(announcement_body),
      announcement_audience, announcement_priority, announcement_status,
      case when announcement_status = 'published' then coalesce(announcement_published_at, now()) else announcement_published_at end,
      announcement_expires_at, auth.uid()
    ) returning id into saved_id;
  else
    update public.adci_announcements
    set title = trim(announcement_title), body = trim(announcement_body),
        audience = announcement_audience, priority = announcement_priority,
        status = announcement_status,
        published_at = case when announcement_status = 'published' then coalesce(announcement_published_at, published_at, now()) else announcement_published_at end,
        expires_at = announcement_expires_at, updated_at = now()
    where id = target_announcement_id and organization_id = target_organization_id
    returning id into saved_id;
    if saved_id is null then raise exception 'Announcement not found'; end if;
  end if;

  insert into public.adci_audit_events (
    organization_id, actor_id, action, entity_type, entity_id, new_values
  ) values (
    target_organization_id, auth.uid(), 'announcement.saved', 'announcement', saved_id,
    jsonb_build_object('title', trim(announcement_title), 'status', announcement_status, 'audience', announcement_audience)
  );
  return saved_id;
end;
$$;

create or replace function public.adci_admin_delete_announcement(target_announcement_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare target_organization_id uuid;
begin
  select organization_id into target_organization_id
  from public.adci_announcements where id = target_announcement_id;
  if not public.adci_current_user_has_role(
    target_organization_id,
    array['content_author','academic_lead','branch_admin','super_admin','support']::public.adci_app_role[]
  ) then raise exception 'Announcement administration permission required'; end if;
  delete from public.adci_announcements where id = target_announcement_id;
  insert into public.adci_audit_events (
    organization_id, actor_id, action, entity_type, entity_id
  ) values (
    target_organization_id, auth.uid(), 'announcement.deleted', 'announcement', target_announcement_id
  );
end;
$$;

revoke all on function public.adci_get_my_notifications() from public;
revoke all on function public.adci_mark_announcement_read(uuid) from public;
revoke all on function public.adci_mark_all_announcements_read() from public;
revoke all on function public.adci_admin_get_announcements() from public;
revoke all on function public.adci_admin_save_announcement(uuid,text,text,text,text,text,timestamptz,timestamptz) from public;
revoke all on function public.adci_admin_delete_announcement(uuid) from public;
grant execute on function public.adci_get_my_notifications() to authenticated;
grant execute on function public.adci_mark_announcement_read(uuid) to authenticated;
grant execute on function public.adci_mark_all_announcements_read() to authenticated;
grant execute on function public.adci_admin_get_announcements() to authenticated;
grant execute on function public.adci_admin_save_announcement(uuid,text,text,text,text,text,timestamptz,timestamptz) to authenticated;
grant execute on function public.adci_admin_delete_announcement(uuid) to authenticated;
