-- Remove the embedded Agora classroom. Live sessions are Zoom-only from now on.
-- Existing Agora bookable sessions are retired (sales stopped, hidden from
-- schedules); payment, invoice and attendance records are kept for support.
begin;

-- 1. Retire every course that still holds an Agora live class.
with agora_courses as (
  select distinct m.course_id
  from public.adci_live_classes lc
  join public.adci_lessons l on l.id = lc.lesson_id
  join public.adci_modules m on m.id = l.module_id
  where lc.provider = 'agora'
)
update public.adci_course_offers o
set active = false
from agora_courses ac
where o.course_id = ac.course_id and o.active;

update public.adci_courses c
set status = 'retired'
where c.status <> 'retired'
  and exists (
    select 1 from public.adci_live_classes lc
    join public.adci_lessons l on l.id = lc.lesson_id
    join public.adci_modules m on m.id = l.module_id
    where m.course_id = c.id and lc.provider = 'agora'
  );

update public.adci_lessons l
set status = 'retired'
from public.adci_live_classes lc
where lc.lesson_id = l.id and lc.provider = 'agora' and l.status <> 'retired';

delete from public.adci_live_classes where provider = 'agora';

-- 2. Drop the Agora token-authorisation entry point.
drop function if exists public.adci_authorize_agora_join(uuid);

-- 3. Bookable live series are Zoom-only. Keep the signature so the API is
--    unchanged; reject any non-Zoom provider and drop the Agora channel path.
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
  if coalesce(nullif(trim(session_provider), ''), 'zoom') <> 'zoom' then
    raise exception 'Only Zoom Live sessions are supported';
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
    if occurrence_end - occurrence_start > interval '480 minutes' then
      raise exception 'Zoom Live sessions cannot exceed 480 minutes';
    end if;

    occurrence_meeting_number := nullif(regexp_replace(occurrence->>'meeting_number', '[^0-9]', '', 'g'), '');
    occurrence_meeting_passcode := nullif(trim(occurrence->>'meeting_passcode'), '');
    if occurrence_meeting_number is null or occurrence_meeting_number !~ '^[0-9]{9,11}$'
      or occurrence_meeting_passcode is null then
      raise exception 'Zoom did not provide valid private meeting credentials';
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
      lesson_id, 'zoom', 'zoom://private', null,
      occurrence_meeting_number, occurrence_meeting_passcode,
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
      'price_paise', session_price_paise, 'provider', 'zoom'
    )
  );

  return jsonb_build_object(
    'series_id', target_series_id,
    'classes_created', jsonb_array_length(created_items),
    'sessions', created_items
  );
end;
$$;

revoke all on function public.adci_create_bookable_live_series(text,text,text,bigint,numeric,jsonb,text) from public, anon;
grant execute on function public.adci_create_bookable_live_series(text,text,text,bigint,numeric,jsonb,text) to authenticated;

commit;
