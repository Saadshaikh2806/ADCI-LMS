-- Secure paid Zoom Live sessions alongside the existing Agora classroom.
-- Zoom meeting secrets and registrant tokens are available only to server-side RPCs.

alter table public.adci_live_classes
  add column if not exists zoom_meeting_number text,
  add column if not exists zoom_meeting_passcode text;

create unique index if not exists adci_live_classes_zoom_meeting_idx
on public.adci_live_classes (zoom_meeting_number)
where zoom_meeting_number is not null;

create table if not exists public.adci_zoom_registrants (
  lesson_id uuid not null references public.adci_lessons(id) on delete cascade,
  learner_id uuid not null references auth.users(id) on delete cascade,
  zoom_registrant_id text not null,
  registrant_token text not null,
  registered_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (lesson_id, learner_id)
);

alter table public.adci_zoom_registrants enable row level security;
revoke all on table public.adci_zoom_registrants from public, anon, authenticated;
grant select, insert, update, delete on table public.adci_zoom_registrants to service_role;

create or replace function public.adci_create_bookable_live_series(
  session_title text,
  session_description text,
  session_instructor text,
  session_price_paise bigint,
  session_gst_rate numeric,
  session_occurrences jsonb,
  session_provider text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  target_series_id uuid := gen_random_uuid();
  occurrence jsonb;
  occurrence_start timestamptz;
  occurrence_end timestamptz;
  occurrence_date date;
  course_id uuid;
  module_id uuid;
  lesson_id uuid;
  offer_id uuid;
  occurrence_channel text;
  occurrence_meeting_number text;
  occurrence_meeting_passcode text;
  course_title text;
  course_slug text;
  slug_base text;
  created_items jsonb := '[]'::jsonb;
begin
  select id into target_organization_id
  from public.adci_organizations where slug = 'adci';

  if target_organization_id is null or not public.adci_current_user_has_role(
    target_organization_id,
    array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  ) then
    raise exception 'Live class administration permission required';
  end if;
  if session_provider not in ('agora', 'zoom') then
    raise exception 'Choose Agora Live or Zoom Live';
  end if;
  if nullif(trim(session_title), '') is null or nullif(trim(session_instructor), '') is null then
    raise exception 'Session title and instructor are required';
  end if;
  if session_price_paise < 100 then raise exception 'Session price must be at least INR 1'; end if;
  if session_gst_rate < 0 or session_gst_rate > 100 then raise exception 'GST rate must be between 0 and 100'; end if;
  if jsonb_typeof(session_occurrences) <> 'array'
    or jsonb_array_length(session_occurrences) not between 1 and 10 then
    raise exception 'Schedule between 1 and 10 sessions at a time';
  end if;

  slug_base := trim(both '-' from regexp_replace(lower(trim(session_title)), '[^a-z0-9]+', '-', 'g'));
  if slug_base = '' then slug_base := 'live-session'; end if;

  for occurrence in select value from jsonb_array_elements(session_occurrences) loop
    occurrence_start := (occurrence->>'starts_at')::timestamptz;
    occurrence_end := (occurrence->>'ends_at')::timestamptz;
    occurrence_date := (occurrence_start at time zone 'Asia/Kolkata')::date;

    if occurrence_start <= now() or occurrence_end <= occurrence_start then
      raise exception 'Each session must be scheduled in the future';
    end if;
    if session_provider = 'agora' and occurrence_end - occurrence_start > interval '60 minutes' then
      raise exception 'Agora Live sessions cannot exceed 60 minutes';
    end if;
    if session_provider = 'zoom' and occurrence_end - occurrence_start > interval '480 minutes' then
      raise exception 'Zoom Live sessions cannot exceed 480 minutes';
    end if;

    occurrence_channel := null;
    occurrence_meeting_number := null;
    occurrence_meeting_passcode := null;
    if session_provider = 'agora' then
      occurrence_channel := 'adci_' || replace(gen_random_uuid()::text, '-', '');
    else
      occurrence_meeting_number := nullif(regexp_replace(occurrence->>'meeting_number', '[^0-9]', '', 'g'), '');
      occurrence_meeting_passcode := nullif(trim(occurrence->>'meeting_passcode'), '');
      if occurrence_meeting_number is null or occurrence_meeting_number !~ '^[0-9]{9,11}$'
        or occurrence_meeting_passcode is null then
        raise exception 'Zoom did not provide valid private meeting credentials';
      end if;
    end if;

    course_title := trim(session_title) || ' - ' ||
      to_char(occurrence_start at time zone 'Asia/Kolkata', 'DD Mon YYYY');
    course_slug := left(slug_base, 70) || '-' || to_char(occurrence_date, 'YYYY-MM-DD') || '-' ||
      left(replace(target_series_id::text, '-', ''), 8);

    insert into public.adci_courses (
      organization_id, title, slug, description, status, owner_id, published_at
    ) values (
      target_organization_id, course_title, course_slug,
      coalesce(session_description, '') || E'\n\nLive online session: ' ||
        to_char(occurrence_start at time zone 'Asia/Kolkata', 'FMDay, DD Mon YYYY at HH12:MI AM'),
      'draft', auth.uid(), null
    ) returning id into course_id;

    insert into public.adci_modules (course_id, title, position)
    values (course_id, 'Live counselling', 1) returning id into module_id;

    insert into public.adci_lessons (
      module_id, title, lesson_type, position, duration_seconds, status
    ) values (
      module_id, trim(session_title), 'live', 1,
      extract(epoch from occurrence_end - occurrence_start)::integer, 'published'
    ) returning id into lesson_id;

    insert into public.adci_live_classes (
      lesson_id, provider, meeting_url, agora_channel_name,
      zoom_meeting_number, zoom_meeting_passcode, instructor_name,
      starts_at, ends_at, updated_by, series_id, series_date
    ) values (
      lesson_id, session_provider,
      case when session_provider = 'agora' then 'agora://' || occurrence_channel else 'zoom://private' end,
      occurrence_channel, occurrence_meeting_number, occurrence_meeting_passcode,
      trim(session_instructor), occurrence_start, occurrence_end,
      auth.uid(), target_series_id, occurrence_date
    );

    update public.adci_courses
    set status = 'published', published_at = now(), updated_at = now()
    where id = course_id;

    insert into public.adci_course_offers (
      organization_id, course_id, title, description, price_paise, gst_rate,
      access_days, active, sale_ends_at, created_by
    ) values (
      target_organization_id, course_id, course_title, coalesce(session_description, ''),
      session_price_paise, session_gst_rate, null, true,
      occurrence_start - interval '15 minutes', auth.uid()
    ) returning id into offer_id;

    created_items := created_items || jsonb_build_array(jsonb_build_object(
      'course_id', course_id, 'lesson_id', lesson_id, 'offer_id', offer_id,
      'starts_at', occurrence_start
    ));
  end loop;

  insert into public.adci_audit_events (
    organization_id, actor_id, action, entity_type, entity_id, new_values
  ) values (
    target_organization_id, auth.uid(), 'live_series.created', 'live_series', target_series_id,
    jsonb_build_object(
      'title', trim(session_title), 'classes_created', jsonb_array_length(created_items),
      'price_paise', session_price_paise, 'provider', session_provider
    )
  );

  return jsonb_build_object(
    'series_id', target_series_id,
    'classes_created', jsonb_array_length(created_items),
    'sessions', created_items
  );
end;
$$;

-- Existing Agora callers keep working unchanged.
create or replace function public.adci_create_bookable_live_series(
  session_title text,
  session_description text,
  session_instructor text,
  session_price_paise bigint,
  session_gst_rate numeric,
  session_occurrences jsonb
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.adci_create_bookable_live_series(
    session_title, session_description, session_instructor,
    session_price_paise, session_gst_rate, session_occurrences, 'agora'
  );
$$;

-- Called only by the authenticated server route. It reveals secrets only after
-- verifying staff membership or a paid, active enrolment for this exact class.
create or replace function public.adci_get_zoom_access(
  target_lesson_id uuid,
  target_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  class_record record;
  participant_name text;
  participant_email text;
  is_staff boolean := false;
  has_access boolean := false;
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

  select profile.full_name, account.email
  into participant_name, participant_email
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

  select exists (
    select 1 from public.adci_enrolments enrolment
    where enrolment.learner_id = target_user_id
      and enrolment.course_id = class_record.course_id
      and enrolment.status in ('active','completed')
      and (enrolment.access_expires_at is null or enrolment.access_expires_at > now())
  ) into has_access;

  if not is_staff and not has_access then
    raise exception 'Purchase this Zoom Live session before joining';
  end if;

  return jsonb_build_object(
    'meeting_number', class_record.zoom_meeting_number,
    'meeting_passcode', class_record.zoom_meeting_passcode,
    'participant_name', coalesce(nullif(trim(participant_name), ''), split_part(participant_email, '@', 1)),
    'participant_email', participant_email,
    'is_staff', is_staff,
    'starts_at', class_record.starts_at,
    'ends_at', class_record.ends_at,
    'can_join', now() between class_record.starts_at - interval '15 minutes' and class_record.ends_at
  );
end;
$$;

create or replace function public.adci_record_zoom_join(
  target_lesson_id uuid,
  target_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare target_course_id uuid;
begin
  select module.course_id into target_course_id
  from public.adci_live_classes live_class
  join public.adci_lessons lesson on lesson.id = live_class.lesson_id
  join public.adci_modules module on module.id = lesson.module_id
  where live_class.lesson_id = target_lesson_id and live_class.provider = 'zoom';

  if target_course_id is null or not exists (
    select 1 from public.adci_enrolments enrolment
    where enrolment.learner_id = target_user_id
      and enrolment.course_id = target_course_id
      and enrolment.status in ('active','completed')
      and (enrolment.access_expires_at is null or enrolment.access_expires_at > now())
  ) then raise exception 'Zoom Live access is unavailable'; end if;

  insert into public.adci_live_attendance (lesson_id, learner_id)
  values (target_lesson_id, target_user_id)
  on conflict (lesson_id, learner_id) do update set
    last_joined_at = now(),
    join_count = case
      when public.adci_live_attendance.last_joined_at < now() - interval '2 minutes'
      then public.adci_live_attendance.join_count + 1
      else public.adci_live_attendance.join_count
    end;
end;
$$;

revoke all on function public.adci_create_bookable_live_series(text,text,text,bigint,numeric,jsonb,text) from public;
revoke all on function public.adci_create_bookable_live_series(text,text,text,bigint,numeric,jsonb) from public;
revoke all on function public.adci_get_zoom_access(uuid,uuid) from public, anon, authenticated;
revoke all on function public.adci_record_zoom_join(uuid,uuid) from public, anon, authenticated;
grant execute on function public.adci_create_bookable_live_series(text,text,text,bigint,numeric,jsonb,text) to authenticated;
grant execute on function public.adci_create_bookable_live_series(text,text,text,bigint,numeric,jsonb) to authenticated;
grant execute on function public.adci_get_zoom_access(uuid,uuid) to service_role;
grant execute on function public.adci_record_zoom_join(uuid,uuid) to service_role;
