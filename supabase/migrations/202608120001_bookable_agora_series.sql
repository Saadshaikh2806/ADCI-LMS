-- Paid embedded Agora counselling sessions. Every occurrence is its own published
-- one-lesson course so one Razorpay purchase grants exactly one live class.

alter table public.adci_live_classes
  drop constraint if exists adci_live_classes_provider_check;

alter table public.adci_live_classes
  add constraint adci_live_classes_provider_check
  check (provider in ('agora','zoom','youtube_live')) not valid;

-- Learners receive room credentials only through the protected token endpoint.
drop policy if exists "course members read live classes" on public.adci_live_classes;

alter table public.adci_live_classes
  add column if not exists agora_channel_name text,
  add column if not exists series_id uuid,
  add column if not exists series_date date;

create index if not exists adci_live_classes_series_idx
on public.adci_live_classes (series_id, series_date)
where series_id is not null;

create unique index if not exists adci_live_classes_agora_channel_idx
on public.adci_live_classes (agora_channel_name)
where agora_channel_name is not null;

alter table public.adci_course_offers
  add column if not exists sale_ends_at timestamptz;

create index if not exists adci_course_offers_sale_ends_idx
on public.adci_course_offers (active, sale_ends_at);

-- The standard editor remains available for legacy external streams.
create or replace function public.adci_save_live_class(
  target_lesson_id uuid,
  class_provider text,
  class_url text,
  class_instructor text,
  class_starts_at timestamptz,
  class_ends_at timestamptz
)
returns public.adci_live_classes
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  class_record public.adci_live_classes;
begin
  select course.organization_id into target_organization_id
  from public.adci_lessons lesson
  join public.adci_modules module on module.id = lesson.module_id
  join public.adci_courses course on course.id = module.course_id
  where lesson.id = target_lesson_id and lesson.lesson_type = 'live';

  if target_organization_id is null or not public.adci_current_user_has_role(
    target_organization_id,
    array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  ) then
    raise exception 'Live class administration permission required';
  end if;
  if class_provider not in ('zoom','youtube_live') then
    raise exception 'Unsupported live provider';
  end if;
  if class_url is null or class_url !~ '^https://.+' then
    raise exception 'A valid HTTPS meeting URL is required';
  end if;
  if nullif(trim(class_instructor), '') is null then
    raise exception 'Instructor name is required';
  end if;
  if class_starts_at is null or class_ends_at is null or class_ends_at <= class_starts_at then
    raise exception 'The live class must end after it starts';
  end if;

  insert into public.adci_live_classes (
    lesson_id, provider, meeting_url, instructor_name, starts_at, ends_at, updated_by, updated_at
  ) values (
    target_lesson_id, class_provider, trim(class_url), trim(class_instructor),
    class_starts_at, class_ends_at, auth.uid(), now()
  ) on conflict (lesson_id) do update set
    provider = excluded.provider,
    meeting_url = excluded.meeting_url,
    instructor_name = excluded.instructor_name,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    updated_by = auth.uid(),
    updated_at = now()
  returning * into class_record;

  update public.adci_lessons
  set status = 'published', updated_at = now()
  where id = target_lesson_id and status <> 'published';

  return class_record;
end;
$$;

create or replace function public.adci_create_bookable_live_series(
  session_title text,
  session_description text,
  session_instructor text,
  session_price_paise bigint,
  session_gst_rate numeric,
  session_occurrences jsonb
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
  course_title text;
  slug_base text;
  course_slug text;
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

  if nullif(trim(session_title), '') is null
    or nullif(trim(session_instructor), '') is null then
    raise exception 'Session title and instructor are required';
  end if;
  if session_price_paise < 100 then
    raise exception 'Session price must be at least INR 1';
  end if;
  if session_gst_rate < 0 or session_gst_rate > 100 then
    raise exception 'GST rate must be between 0 and 100';
  end if;
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

    if occurrence_start <= now() or occurrence_end <= occurrence_start
      or occurrence_end - occurrence_start > interval '60 minutes' then
      raise exception 'Each session must be in the future and no longer than 60 minutes';
    end if;
    occurrence_channel := 'adci_' || replace(gen_random_uuid()::text, '-', '');

    course_title := trim(session_title) || ' - ' ||
      to_char(occurrence_start at time zone 'Asia/Kolkata', 'DD Mon YYYY');
    course_slug := left(slug_base, 70) || '-' || to_char(occurrence_date, 'YYYY-MM-DD') || '-' ||
      left(replace(target_series_id::text, '-', ''), 8);

    insert into public.adci_courses (
      organization_id, title, slug, description, status, owner_id, published_at
    ) values (
      target_organization_id,
      course_title,
      course_slug,
      coalesce(session_description, '') || E'\n\nLive online session: ' ||
        to_char(occurrence_start at time zone 'Asia/Kolkata', 'FMDay, DD Mon YYYY at HH12:MI AM'),
      'draft',
      auth.uid(),
      null
    ) returning id into course_id;

    insert into public.adci_modules (course_id, title, position)
    values (course_id, 'Live counselling', 1)
    returning id into module_id;

    insert into public.adci_lessons (
      module_id, title, lesson_type, position, duration_seconds, status
    ) values (
      module_id, trim(session_title), 'live', 1,
      extract(epoch from occurrence_end - occurrence_start)::integer,
      'published'
    ) returning id into lesson_id;

    insert into public.adci_live_classes (
      lesson_id, provider, meeting_url, agora_channel_name, instructor_name,
      starts_at, ends_at, updated_by, series_id, series_date
    ) values (
      lesson_id, 'agora', 'agora://' || occurrence_channel, occurrence_channel, trim(session_instructor),
      occurrence_start, occurrence_end, auth.uid(), target_series_id, occurrence_date
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
      'course_id', course_id,
      'lesson_id', lesson_id,
      'offer_id', offer_id,
      'starts_at', occurrence_start
    ));
  end loop;

  insert into public.adci_audit_events (
    organization_id, actor_id, action, entity_type, entity_id, new_values
  ) values (
    target_organization_id, auth.uid(), 'live_series.created', 'live_series',
    target_series_id, jsonb_build_object(
      'title', trim(session_title),
      'classes_created', jsonb_array_length(created_items),
      'price_paise', session_price_paise,
      'provider', 'agora'
    )
  );

  return jsonb_build_object(
    'series_id', target_series_id,
    'classes_created', jsonb_array_length(created_items),
    'sessions', created_items
  );
end;
$$;

-- Hide expired dated sessions from the catalogue and expose their date to the UI.
create or replace function public.adci_get_course_catalog()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'offer_id', offer.id,
    'course_id', course.id,
    'course_title', course.title,
    'course_slug', course.slug,
    'course_description', course.description,
    'offer_title', offer.title,
    'offer_description', offer.description,
    'price_paise', offer.price_paise,
    'compare_at_paise', offer.compare_at_paise,
    'gst_rate', offer.gst_rate,
    'access_days', offer.access_days,
    'sale_ends_at', offer.sale_ends_at,
    'live_starts_at', (
      select min(live_class.starts_at)
      from public.adci_modules module
      join public.adci_lessons lesson on lesson.module_id = module.id
      join public.adci_live_classes live_class on live_class.lesson_id = lesson.id
      where module.course_id = course.id
    ),
    'lesson_count', (
      select count(*) from public.adci_modules module
      join public.adci_lessons lesson on lesson.module_id = module.id
      where module.course_id = course.id
    ),
    'has_access', exists (
      select 1 from public.adci_enrolments enrolment
      where enrolment.course_id = course.id
        and enrolment.learner_id = auth.uid()
        and enrolment.status in ('active','completed')
        and (enrolment.access_expires_at is null or enrolment.access_expires_at > now())
    )
  ) order by coalesce(offer.sale_ends_at, 'infinity'::timestamptz), course.title), '[]'::jsonb)
  from public.adci_course_offers offer
  join public.adci_courses course on course.id = offer.course_id
  where offer.active
    and (offer.sale_ends_at is null or offer.sale_ends_at > now())
    and course.status = 'published';
$$;

create or replace function public.adci_prepare_payment_order(
  target_offer_id uuid,
  customer_name text,
  customer_email text,
  customer_phone text default null,
  customer_gstin text default null
)
returns public.adci_orders
language plpgsql security definer set search_path = ''
as $$
declare offer_record public.adci_course_offers; order_record public.adci_orders; computed_tax bigint;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into offer_record from public.adci_course_offers
  where id = target_offer_id and active
    and (sale_ends_at is null or sale_ends_at > now());
  if offer_record.id is null or not exists (
    select 1 from public.adci_courses
    where id = offer_record.course_id and status = 'published'
  ) then raise exception 'Course offer is unavailable'; end if;
  if exists (
    select 1 from public.adci_enrolments
    where learner_id = auth.uid() and course_id = offer_record.course_id
      and status in ('active','completed')
      and (access_expires_at is null or access_expires_at > now())
  ) then raise exception 'You already have access to this course'; end if;
  if trim(customer_name) = '' or trim(customer_email) = ''
  then raise exception 'Billing name and email are required'; end if;

  computed_tax := round(offer_record.price_paise * offer_record.gst_rate / 100)::bigint;
  insert into public.adci_orders (
    organization_id, learner_id, offer_id, receipt,
    subtotal_paise, tax_paise, total_paise,
    billing_name, billing_email, billing_phone, billing_gstin
  ) values (
    offer_record.organization_id, auth.uid(), offer_record.id,
    'ADCI-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 20)),
    offer_record.price_paise, computed_tax, offer_record.price_paise + computed_tax,
    trim(customer_name), lower(trim(customer_email)), nullif(trim(customer_phone), ''),
    nullif(upper(trim(customer_gstin)), '')
  ) returning * into order_record;
  return order_record;
end;
$$;

-- Include the dated offer ID so administrators can copy a purchase link.
create or replace function public.adci_admin_get_live_schedule(target_days integer default 30)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare target_organization_id uuid; schedule_window integer;
begin
  select id into target_organization_id
  from public.adci_organizations where slug = 'adci';
  if not public.adci_current_user_has_role(
    target_organization_id,
    array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  ) then raise exception 'Live schedule administration permission required'; end if;

  schedule_window := greatest(7, least(180, target_days));
  return jsonb_build_object(
    'summary', jsonb_build_object(
      'scheduled', (
        select count(*) from public.adci_live_classes live_class
        join public.adci_lessons lesson on lesson.id = live_class.lesson_id
        join public.adci_modules module on module.id = lesson.module_id
        join public.adci_courses course on course.id = module.course_id
        where course.organization_id = target_organization_id
          and live_class.starts_at between now() and now() + make_interval(days => schedule_window)
      ),
      'live_now', (
        select count(*) from public.adci_live_classes live_class
        join public.adci_lessons lesson on lesson.id = live_class.lesson_id
        join public.adci_modules module on module.id = lesson.module_id
        join public.adci_courses course on course.id = module.course_id
        where course.organization_id = target_organization_id
          and now() between live_class.starts_at - interval '15 minutes' and live_class.ends_at
      ),
      'attendance', (
        select count(*) from public.adci_live_attendance attendance
        join public.adci_lessons lesson on lesson.id = attendance.lesson_id
        join public.adci_modules module on module.id = lesson.module_id
        join public.adci_courses course on course.id = module.course_id
        where course.organization_id = target_organization_id
          and attendance.joined_at >= now() - make_interval(days => schedule_window)
      ),
      'unscheduled', (
        select count(*) from public.adci_lessons lesson
        join public.adci_modules module on module.id = lesson.module_id
        join public.adci_courses course on course.id = module.course_id
        left join public.adci_live_classes live_class on live_class.lesson_id = lesson.id
        where course.organization_id = target_organization_id
          and lesson.lesson_type = 'live' and live_class.lesson_id is null
      )
    ),
    'classes', coalesce((
      select jsonb_agg(to_jsonb(class_row) order by class_row.starts_at)
      from (
        select
          lesson.id as lesson_id,
          lesson.title as lesson_title,
          module.title as module_title,
          course.id as course_id,
          course.title as course_title,
          course.status as course_status,
          offer.id as offer_id,
          live_class.provider,
          live_class.meeting_url,
          live_class.instructor_name,
          live_class.starts_at,
          live_class.ends_at,
          case
            when now() between live_class.starts_at - interval '15 minutes' and live_class.ends_at then 'live'
            when live_class.ends_at < now() then 'ended'
            else 'scheduled'
          end as status,
          count(distinct attendance.learner_id)::integer as attendance_count,
          coalesce(sum(attendance.join_count), 0)::integer as total_joins
        from public.adci_live_classes live_class
        join public.adci_lessons lesson on lesson.id = live_class.lesson_id
        join public.adci_modules module on module.id = lesson.module_id
        join public.adci_courses course on course.id = module.course_id
        left join public.adci_course_offers offer on offer.course_id = course.id
        left join public.adci_live_attendance attendance on attendance.lesson_id = lesson.id
        where course.organization_id = target_organization_id
          and live_class.starts_at >= now() - interval '30 days'
          and live_class.starts_at <= now() + make_interval(days => schedule_window)
        group by lesson.id, lesson.title, module.title, course.id, course.title,
          course.status, offer.id, live_class.provider, live_class.meeting_url,
          live_class.instructor_name, live_class.starts_at, live_class.ends_at
      ) class_row
    ), '[]'::jsonb),
    'unscheduled_lessons', coalesce((
      select jsonb_agg(jsonb_build_object(
        'lesson_id', lesson.id,
        'lesson_title', lesson.title,
        'module_title', module.title,
        'course_id', course.id,
        'course_title', course.title,
        'course_status', course.status
      ) order by course.title, module.position, lesson.position)
      from public.adci_lessons lesson
      join public.adci_modules module on module.id = lesson.module_id
      join public.adci_courses course on course.id = module.course_id
      left join public.adci_live_classes live_class on live_class.lesson_id = lesson.id
      where course.organization_id = target_organization_id
        and lesson.lesson_type = 'live' and live_class.lesson_id is null
    ), '[]'::jsonb)
  );
end;
$$;

-- Authorise Agora tokens at the server boundary. The channel name never appears
-- in learner-facing database reads and attendance is recorded automatically.
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
      last_joined_at = now(),
      join_count = public.adci_live_attendance.join_count + 1;
  end if;

  return jsonb_build_object(
    'channel', target_channel,
    'participant_name', coalesce(nullif(trim(participant_name), ''), 'ADCI learner'),
    'ends_at', target_ends_at,
    'is_staff', coalesce(is_staff, false)
  );
end;
$$;

-- Preserve legacy Zoom/YouTube joins without ever returning an Agora channel.
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
    last_joined_at = now(),
    join_count = public.adci_live_attendance.join_count + 1;

  return class_record.meeting_url;
end;
$$;

-- Give staff the authorised buyer and attendance list for support.
create or replace function public.adci_admin_get_live_attendance(target_lesson_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare target_organization_id uuid; target_course_id uuid;
begin
  select course.organization_id, course.id
  into target_organization_id, target_course_id
  from public.adci_lessons lesson
  join public.adci_modules module on module.id = lesson.module_id
  join public.adci_courses course on course.id = module.course_id
  where lesson.id = target_lesson_id;

  if not public.adci_current_user_has_role(
    target_organization_id,
    array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  ) then raise exception 'Live session access-list permission required'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'learner_id', profile.id,
      'full_name', coalesce(nullif(trim(profile.full_name), ''), split_part(account.email::text, '@', 1)),
      'email', account.email,
      'joined_at', attendance.joined_at,
      'last_joined_at', attendance.last_joined_at,
      'join_count', coalesce(attendance.join_count, 0)
    ) order by coalesce(attendance.joined_at, enrolment.enrolled_at), profile.full_name)
    from public.adci_enrolments enrolment
    join public.adci_profiles profile on profile.id = enrolment.learner_id
    join auth.users account on account.id = profile.id
    left join public.adci_live_attendance attendance
      on attendance.lesson_id = target_lesson_id and attendance.learner_id = enrolment.learner_id
    where enrolment.course_id = target_course_id
      and enrolment.status in ('active','completed')
      and (enrolment.access_expires_at is null or enrolment.access_expires_at > now())
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.adci_create_bookable_live_series(text,text,text,bigint,numeric,jsonb) from public;
revoke all on function public.adci_save_live_class(uuid,text,text,text,timestamptz,timestamptz) from public;
revoke all on function public.adci_get_course_catalog() from public;
revoke all on function public.adci_prepare_payment_order(uuid,text,text,text,text) from public;
revoke all on function public.adci_admin_get_live_schedule(integer) from public;
revoke all on function public.adci_admin_get_live_attendance(uuid) from public;
revoke all on function public.adci_authorize_agora_join(uuid) from public;
grant execute on function public.adci_create_bookable_live_series(text,text,text,bigint,numeric,jsonb) to authenticated;
grant execute on function public.adci_save_live_class(uuid,text,text,text,timestamptz,timestamptz) to authenticated;
grant execute on function public.adci_get_course_catalog() to authenticated;
grant execute on function public.adci_prepare_payment_order(uuid,text,text,text,text) to authenticated;
grant execute on function public.adci_admin_get_live_schedule(integer) to authenticated;
grant execute on function public.adci_admin_get_live_attendance(uuid) to authenticated;
grant execute on function public.adci_authorize_agora_join(uuid) to authenticated;
