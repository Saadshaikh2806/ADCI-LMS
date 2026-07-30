-- Razorpay-ready commerce, signed payment fulfilment, invoices and course entitlements.
-- Run this complete file once after migration 202607300014.

create table if not exists public.adci_course_offers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.adci_organizations on delete cascade,
  course_id uuid not null unique references public.adci_courses on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 180),
  description text not null default '' check (char_length(description) <= 3000),
  price_paise bigint not null check (price_paise >= 100),
  compare_at_paise bigint check (compare_at_paise is null or compare_at_paise >= price_paise),
  gst_rate numeric(5,2) not null default 18 check (gst_rate between 0 and 100),
  access_days integer check (access_days is null or access_days > 0),
  active boolean not null default false,
  created_by uuid references public.adci_profiles,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.adci_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.adci_organizations on delete restrict,
  learner_id uuid not null references public.adci_profiles on delete restrict,
  offer_id uuid not null references public.adci_course_offers on delete restrict,
  receipt text not null unique,
  subtotal_paise bigint not null check (subtotal_paise >= 0),
  tax_paise bigint not null default 0 check (tax_paise >= 0),
  total_paise bigint not null check (total_paise > 0),
  currency text not null default 'INR' check (currency = 'INR'),
  status text not null default 'created'
    check (status in ('created','attempted','paid','failed','cancelled','refunded')),
  provider text not null default 'razorpay' check (provider = 'razorpay'),
  provider_order_id text unique,
  provider_payment_id text unique,
  billing_name text not null,
  billing_email text not null,
  billing_phone text,
  billing_gstin text,
  failure_reason text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.adci_payment_transactions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.adci_orders on delete restrict,
  provider_payment_id text not null unique,
  status text not null check (status in ('captured','failed','refunded')),
  amount_paise bigint not null check (amount_paise >= 0),
  signature text,
  provider_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.adci_invoices (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.adci_orders on delete restrict,
  invoice_number text not null unique,
  learner_id uuid not null references public.adci_profiles on delete restrict,
  course_id uuid not null references public.adci_courses on delete restrict,
  billing_name text not null,
  billing_email text not null,
  billing_phone text,
  billing_gstin text,
  subtotal_paise bigint not null,
  tax_paise bigint not null,
  total_paise bigint not null,
  currency text not null default 'INR',
  issued_at timestamptz not null default now()
);

create table if not exists public.adci_payment_webhook_events (
  provider_event_id text primary key,
  event_type text not null,
  signature text not null,
  payload jsonb not null,
  processed boolean not null default false,
  processing_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.adci_enrolments
  add column if not exists entitlement_source text not null default 'admin'
    check (entitlement_source in ('admin','payment','scholarship')),
  add column if not exists source_order_id uuid references public.adci_orders on delete set null;

alter table public.adci_course_offers enable row level security;
alter table public.adci_orders enable row level security;
alter table public.adci_payment_transactions enable row level security;
alter table public.adci_invoices enable row level security;
alter table public.adci_payment_webhook_events enable row level security;

drop policy if exists "authenticated users read active course offers" on public.adci_course_offers;
create policy "authenticated users read active course offers"
on public.adci_course_offers for select to authenticated
using (
  active and exists (
    select 1 from public.adci_courses course
    where course.id = adci_course_offers.course_id and course.status = 'published'
  )
);

drop policy if exists "commerce staff manage course offers" on public.adci_course_offers;
create policy "commerce staff manage course offers"
on public.adci_course_offers for all to authenticated
using (
  public.adci_current_user_has_role(
    organization_id,
    array['finance','branch_admin','super_admin']::public.adci_app_role[]
  )
)
with check (
  public.adci_current_user_has_role(
    organization_id,
    array['finance','branch_admin','super_admin']::public.adci_app_role[]
  )
);

drop policy if exists "learners read own orders" on public.adci_orders;
create policy "learners read own orders"
on public.adci_orders for select to authenticated
using (learner_id = auth.uid());

drop policy if exists "commerce staff read orders" on public.adci_orders;
create policy "commerce staff read orders"
on public.adci_orders for select to authenticated
using (
  public.adci_current_user_has_role(
    organization_id,
    array['finance','branch_admin','super_admin','support']::public.adci_app_role[]
  )
);

drop policy if exists "learners read own payment transactions" on public.adci_payment_transactions;
create policy "learners read own payment transactions"
on public.adci_payment_transactions for select to authenticated
using (
  exists (
    select 1 from public.adci_orders payment_order
    where payment_order.id = adci_payment_transactions.order_id
      and payment_order.learner_id = auth.uid()
  )
);

drop policy if exists "learners read own invoices" on public.adci_invoices;
create policy "learners read own invoices"
on public.adci_invoices for select to authenticated
using (learner_id = auth.uid());

drop policy if exists "commerce staff read invoices" on public.adci_invoices;
create policy "commerce staff read invoices"
on public.adci_invoices for select to authenticated
using (
  exists (
    select 1 from public.adci_courses course
    where course.id = adci_invoices.course_id
      and public.adci_current_user_has_role(
        course.organization_id,
        array['finance','branch_admin','super_admin','support']::public.adci_app_role[]
      )
  )
);

create index if not exists adci_orders_learner_created_idx
on public.adci_orders (learner_id, created_at desc);
create index if not exists adci_orders_org_status_idx
on public.adci_orders (organization_id, status, created_at desc);
create index if not exists adci_payment_transactions_order_idx
on public.adci_payment_transactions (order_id, created_at desc);
create index if not exists adci_invoices_learner_issued_idx
on public.adci_invoices (learner_id, issued_at desc);

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
  ) order by course.title), '[]'::jsonb)
  from public.adci_course_offers offer
  join public.adci_courses course on course.id = offer.course_id
  where offer.active and course.status = 'published';
$$;

create or replace function public.adci_get_my_billing()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'paid_orders', (
        select count(*) from public.adci_orders where learner_id = auth.uid() and status = 'paid'
      ),
      'total_paid_paise', (
        select coalesce(sum(total_paise), 0) from public.adci_orders where learner_id = auth.uid() and status = 'paid'
      ),
      'invoices', (
        select count(*) from public.adci_invoices where learner_id = auth.uid()
      )
    ),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', payment_order.id,
        'receipt', payment_order.receipt,
        'course_title', course.title,
        'offer_title', offer.title,
        'subtotal_paise', payment_order.subtotal_paise,
        'tax_paise', payment_order.tax_paise,
        'total_paise', payment_order.total_paise,
        'currency', payment_order.currency,
        'status', payment_order.status,
        'provider_order_id', payment_order.provider_order_id,
        'provider_payment_id', payment_order.provider_payment_id,
        'paid_at', payment_order.paid_at,
        'created_at', payment_order.created_at,
        'failure_reason', payment_order.failure_reason,
        'invoice', case when invoice.id is null then null else jsonb_build_object(
          'id', invoice.id,
          'invoice_number', invoice.invoice_number,
          'issued_at', invoice.issued_at
        ) end
      ) order by payment_order.created_at desc)
      from public.adci_orders payment_order
      join public.adci_course_offers offer on offer.id = payment_order.offer_id
      join public.adci_courses course on course.id = offer.course_id
      left join public.adci_invoices invoice on invoice.order_id = payment_order.id
      where payment_order.learner_id = auth.uid()
    ), '[]'::jsonb)
  );
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
  where id = target_offer_id and active;
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

create or replace function public.adci_attach_provider_order(
  target_order_id uuid,
  razorpay_order_id text
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.adci_orders
  set provider_order_id = razorpay_order_id, status = 'attempted', updated_at = now()
  where id = target_order_id and status = 'created';
  if not found then raise exception 'Pending order not found'; end if;
end;
$$;

create or replace function public.adci_fail_payment_order(
  target_order_id uuid,
  error_reason text
)
returns void
language sql security definer set search_path = ''
as $$
  update public.adci_orders
  set status = 'failed', failure_reason = left(error_reason, 1000), updated_at = now()
  where id = target_order_id and status in ('created','attempted');
$$;

create or replace function public.adci_fulfil_paid_order(
  razorpay_order_id text,
  razorpay_payment_id text,
  payment_signature text,
  payment_payload jsonb
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  order_record public.adci_orders;
  offer_record public.adci_course_offers;
  invoice_id uuid;
  entitlement_expiry timestamptz;
begin
  select * into order_record from public.adci_orders
  where provider_order_id = razorpay_order_id
  for update;
  if order_record.id is null then raise exception 'Payment order not found'; end if;
  if order_record.status = 'paid' then
    select id into invoice_id from public.adci_invoices where order_id = order_record.id;
    return invoice_id;
  end if;
  if order_record.status not in ('created','attempted')
  then raise exception 'Payment order cannot be fulfilled'; end if;
  select * into offer_record from public.adci_course_offers where id = order_record.offer_id;
  if offer_record.id is null then raise exception 'Course offer not found'; end if;
  if exists (
    select 1 from public.adci_payment_transactions
    where provider_payment_id = razorpay_payment_id and order_id <> order_record.id
  ) then raise exception 'Payment reference is already attached to another order'; end if;

  insert into public.adci_payment_transactions (
    order_id, provider_payment_id, status, amount_paise, signature, provider_payload
  ) values (
    order_record.id, razorpay_payment_id, 'captured', order_record.total_paise,
    nullif(payment_signature, ''), coalesce(payment_payload, '{}'::jsonb)
  )
  on conflict (provider_payment_id) do update set
    status = 'captured', signature = excluded.signature,
    provider_payload = excluded.provider_payload, updated_at = now();

  update public.adci_orders
  set status = 'paid', provider_payment_id = razorpay_payment_id,
      failure_reason = null, paid_at = coalesce(paid_at, now()), updated_at = now()
  where id = order_record.id;

  entitlement_expiry := case
    when offer_record.access_days is null then null
    else now() + make_interval(days => offer_record.access_days)
  end;
  insert into public.adci_enrolments (
    learner_id, course_id, status, access_expires_at, entitlement_source, source_order_id
  ) values (
    order_record.learner_id, offer_record.course_id, 'active', entitlement_expiry,
    'payment', order_record.id
  )
  on conflict (learner_id, course_id) do update set
    status = 'active',
    access_expires_at = case
      when offer_record.access_days is null then null
      else greatest(coalesce(adci_enrolments.access_expires_at, now()), now())
        + make_interval(days => offer_record.access_days)
    end,
    entitlement_source = 'payment',
    source_order_id = order_record.id;

  insert into public.adci_invoices (
    order_id, invoice_number, learner_id, course_id,
    billing_name, billing_email, billing_phone, billing_gstin,
    subtotal_paise, tax_paise, total_paise
  ) values (
    order_record.id,
    'ADCI-INV-' || to_char(now(), 'YYYY') || '-' ||
      upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
    order_record.learner_id, offer_record.course_id,
    order_record.billing_name, order_record.billing_email,
    order_record.billing_phone, order_record.billing_gstin,
    order_record.subtotal_paise, order_record.tax_paise, order_record.total_paise
  )
  on conflict (order_id) do update set order_id = excluded.order_id
  returning id into invoice_id;

  insert into public.adci_audit_events (
    organization_id, actor_id, action, entity_type, entity_id, new_values
  ) values (
    order_record.organization_id, order_record.learner_id,
    'payment.captured', 'order', order_record.id,
    jsonb_build_object(
      'provider_order_id', razorpay_order_id,
      'provider_payment_id', razorpay_payment_id,
      'total_paise', order_record.total_paise,
      'course_id', offer_record.course_id
    )
  );
  return invoice_id;
end;
$$;

create or replace function public.adci_mark_order_refunded(
  razorpay_order_id text,
  razorpay_payment_id text,
  refund_payload jsonb
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare order_record public.adci_orders;
begin
  select * into order_record from public.adci_orders
  where provider_order_id = razorpay_order_id for update;
  if order_record.id is null then raise exception 'Payment order not found'; end if;
  if order_record.status = 'refunded' then return; end if;

  update public.adci_payment_transactions
  set status = 'refunded', provider_payload = coalesce(refund_payload, provider_payload),
      updated_at = now()
  where provider_payment_id = razorpay_payment_id;
  update public.adci_orders set status = 'refunded', updated_at = now()
  where id = order_record.id;
  update public.adci_enrolments
  set status = 'cancelled'
  where source_order_id = order_record.id and entitlement_source = 'payment';

  insert into public.adci_audit_events (
    organization_id, actor_id, action, entity_type, entity_id, new_values
  ) values (
    order_record.organization_id, null, 'payment.refunded', 'order',
    order_record.id, jsonb_build_object('provider_payment_id', razorpay_payment_id)
  );
end;
$$;

create or replace function public.adci_admin_get_commerce()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare target_organization_id uuid;
begin
  select id into target_organization_id from public.adci_organizations where slug = 'adci';
  if not public.adci_current_user_has_role(
    target_organization_id,
    array['finance','branch_admin','super_admin']::public.adci_app_role[]
  ) then raise exception 'Commerce administration permission required'; end if;

  return jsonb_build_object(
    'summary', jsonb_build_object(
      'revenue_paise', (
        select coalesce(sum(total_paise), 0) from public.adci_orders
        where organization_id = target_organization_id and status = 'paid'
      ),
      'paid_orders', (
        select count(*) from public.adci_orders
        where organization_id = target_organization_id and status = 'paid'
      ),
      'pending_orders', (
        select count(*) from public.adci_orders
        where organization_id = target_organization_id and status in ('created','attempted')
      ),
      'refunds', (
        select count(*) from public.adci_orders
        where organization_id = target_organization_id and status = 'refunded'
      )
    ),
    'courses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', course.id, 'title', course.title, 'status', course.status
      ) order by course.title)
      from public.adci_courses course
      where course.organization_id = target_organization_id and course.status <> 'retired'
    ), '[]'::jsonb),
    'offers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', offer.id,
        'course_id', offer.course_id,
        'course_title', course.title,
        'title', offer.title,
        'description', offer.description,
        'price_paise', offer.price_paise,
        'compare_at_paise', offer.compare_at_paise,
        'gst_rate', offer.gst_rate,
        'access_days', offer.access_days,
        'active', offer.active,
        'paid_orders', (
          select count(*) from public.adci_orders
          where offer_id = offer.id and status = 'paid'
        ),
        'revenue_paise', (
          select coalesce(sum(total_paise), 0) from public.adci_orders
          where offer_id = offer.id and status = 'paid'
        )
      ) order by course.title)
      from public.adci_course_offers offer
      join public.adci_courses course on course.id = offer.course_id
      where offer.organization_id = target_organization_id
    ), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(recent_order.payload order by recent_order.created_at desc)
      from (
        select
          payment_order.created_at,
          jsonb_build_object(
            'id', payment_order.id,
            'receipt', payment_order.receipt,
            'learner_name', coalesce(nullif(trim(profile.full_name), ''), split_part(auth_user.email::text, '@', 1)),
            'learner_email', auth_user.email::text,
            'course_title', course.title,
            'total_paise', payment_order.total_paise,
            'status', payment_order.status,
            'provider_order_id', payment_order.provider_order_id,
            'provider_payment_id', payment_order.provider_payment_id,
            'paid_at', payment_order.paid_at,
            'created_at', payment_order.created_at,
            'invoice_number', invoice.invoice_number
          ) as payload
        from public.adci_orders payment_order
        join public.adci_profiles profile on profile.id = payment_order.learner_id
        join auth.users auth_user on auth_user.id = payment_order.learner_id
        join public.adci_course_offers offer on offer.id = payment_order.offer_id
        join public.adci_courses course on course.id = offer.course_id
        left join public.adci_invoices invoice on invoice.order_id = payment_order.id
        where payment_order.organization_id = target_organization_id
        order by payment_order.created_at desc
        limit 200
      ) recent_order
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.adci_admin_save_course_offer(
  target_offer_id uuid,
  target_course_id uuid,
  offer_title text,
  offer_description text,
  offer_price_paise bigint,
  offer_compare_at_paise bigint,
  offer_gst_rate numeric,
  offer_access_days integer,
  offer_active boolean
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare target_organization_id uuid; saved_id uuid;
begin
  select organization_id into target_organization_id
  from public.adci_courses where id = target_course_id;
  if target_organization_id is null or not public.adci_current_user_has_role(
    target_organization_id,
    array['finance','branch_admin','super_admin']::public.adci_app_role[]
  ) then raise exception 'Commerce administration permission required'; end if;
  if trim(offer_title) = '' or offer_price_paise < 100
  then raise exception 'Offer title and valid price are required'; end if;

  if target_offer_id is null then
    insert into public.adci_course_offers (
      organization_id, course_id, title, description,
      price_paise, compare_at_paise, gst_rate, access_days, active, created_by
    ) values (
      target_organization_id, target_course_id, trim(offer_title),
      coalesce(offer_description, ''), offer_price_paise,
      offer_compare_at_paise, offer_gst_rate, offer_access_days,
      offer_active, auth.uid()
    )
    on conflict (course_id) do update set
      title = excluded.title,
      description = excluded.description,
      price_paise = excluded.price_paise,
      compare_at_paise = excluded.compare_at_paise,
      gst_rate = excluded.gst_rate,
      access_days = excluded.access_days,
      active = excluded.active,
      updated_at = now()
    returning id into saved_id;
  else
    update public.adci_course_offers
    set title = trim(offer_title),
        description = coalesce(offer_description, ''),
        price_paise = offer_price_paise,
        compare_at_paise = offer_compare_at_paise,
        gst_rate = offer_gst_rate,
        access_days = offer_access_days,
        active = offer_active,
        updated_at = now()
    where id = target_offer_id
      and course_id = target_course_id
      and organization_id = target_organization_id
    returning id into saved_id;
    if saved_id is null then raise exception 'Course offer not found'; end if;
  end if;
  return saved_id;
end;
$$;

revoke all on function public.adci_get_course_catalog() from public;
revoke all on function public.adci_get_my_billing() from public;
revoke all on function public.adci_prepare_payment_order(uuid,text,text,text,text) from public;
revoke all on function public.adci_attach_provider_order(uuid,text) from public;
revoke all on function public.adci_fail_payment_order(uuid,text) from public;
revoke all on function public.adci_fulfil_paid_order(text,text,text,jsonb) from public;
revoke all on function public.adci_mark_order_refunded(text,text,jsonb) from public;
revoke all on function public.adci_admin_get_commerce() from public;
revoke all on function public.adci_admin_save_course_offer(uuid,uuid,text,text,bigint,bigint,numeric,integer,boolean) from public;
grant execute on function public.adci_get_course_catalog() to authenticated;
grant execute on function public.adci_get_my_billing() to authenticated;
grant execute on function public.adci_prepare_payment_order(uuid,text,text,text,text) to authenticated;
grant execute on function public.adci_attach_provider_order(uuid,text) to service_role;
grant execute on function public.adci_fail_payment_order(uuid,text) to service_role;
grant execute on function public.adci_fulfil_paid_order(text,text,text,jsonb) to service_role;
grant execute on function public.adci_mark_order_refunded(text,text,jsonb) to service_role;
grant execute on function public.adci_admin_get_commerce() to authenticated;
grant execute on function public.adci_admin_save_course_offer(uuid,uuid,text,text,bigint,bigint,numeric,integer,boolean) to authenticated;
