// Run with PGlite installed in the ignored test workspace:
// npm install --prefix tmp/access-tests --no-audit --no-fund @electric-sql/pglite
// node scripts/test_zoom_access.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '../tmp/access-tests/node_modules/@electric-sql/pglite/dist/index.js';

const db = new PGlite();
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql as
    $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create type public.adci_app_role as enum
    ('student','instructor','content_author','academic_lead','branch_admin','super_admin','support','mentor','finance');
  create type public.adci_enrolment_status as enum ('pending','active','frozen','completed','cancelled');
  create table auth.users(id uuid primary key, email text);
  create table public.adci_profiles(id uuid primary key, full_name text);
  create table public.adci_courses(id uuid primary key, organization_id uuid);
  create table public.adci_modules(id uuid primary key, course_id uuid);
  create table public.adci_lessons(id uuid primary key, module_id uuid);
  create table public.adci_live_classes(lesson_id uuid, provider text, zoom_meeting_number text,
    zoom_meeting_passcode text, starts_at timestamptz, ends_at timestamptz);
  create table public.adci_memberships(user_id uuid, organization_id uuid, active boolean, role public.adci_app_role);
  create table public.adci_enrolments(id uuid default gen_random_uuid(), learner_id uuid,
    course_id uuid, status public.adci_enrolment_status, access_expires_at timestamptz,
    entitlement_source text default 'admin', source_order_id uuid, unique(learner_id,course_id));
  create table public.adci_course_offers(id uuid, course_id uuid);
  create table public.adci_orders(id uuid, learner_id uuid, offer_id uuid, status text,
    provider_payment_id text, total_paise bigint);
  create table public.adci_payment_transactions(order_id uuid, status text, provider_payment_id text, amount_paise bigint);
  create table public.adci_audit_events(organization_id uuid, actor_id uuid, action text,
    entity_type text, entity_id uuid, new_values jsonb);
`);
// Exercise the application's real role/MFA check rather than a permissive stub.
const mfa = readFileSync('supabase/migrations/202608010001_admin_mfa_security.sql', 'utf8');
await db.exec(mfa.slice(mfa.indexOf('create or replace function'), mfa.indexOf('create or replace function public.adci_record_security_event')));
await db.exec(readFileSync('supabase/migrations/202609050001_super_admin_complimentary_access.sql', 'utf8'));
await db.exec(`
  insert into auth.users values ('${id(1)}','learner@example.test'),('${id(2)}','staff@example.test');
  insert into public.adci_profiles select id, email from auth.users;
  insert into public.adci_courses values ('${id(10)}','${id(20)}');
  insert into public.adci_modules values ('${id(11)}','${id(10)}');
  insert into public.adci_lessons values ('${id(12)}','${id(11)}');
  insert into public.adci_live_classes values ('${id(12)}','zoom','123456789','test',now(),now()+interval '1 hour');
  insert into public.adci_memberships values ('${id(2)}','${id(20)}',true,'branch_admin');
  insert into public.adci_course_offers values ('${id(30)}','${id(10)}');
  insert into public.adci_orders values ('${id(31)}','${id(1)}','${id(30)}','paid','test_payment',100);
  insert into public.adci_payment_transactions values ('${id(31)}','captured','test_payment',100);
`);
const query = async sql => (await db.query(sql)).rows;
const allowed = async () => (await query(`select public.adci_has_verified_zoom_enrolment('${id(10)}','${id(1)}') as allowed`))[0].allowed;
const grant = () => db.query(`select public.adci_admin_set_course_enrolment('${id(1)}','${id(10)}','active',null)`);
const actor = async (role, aal = 'aal2') => {
  await db.query(`update public.adci_memberships set role=$1::public.adci_app_role, active=true`, [role]);
  await db.query(`select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claims',$2,false)`, [id(2), JSON.stringify({ aal })]);
};
assert.equal(await allowed(), false, 'unenrolled learner denied');
for (const role of ['student','instructor','content_author','academic_lead','branch_admin','support','mentor','finance']) {
  await actor(role);
  await assert.rejects(grant, /Only a super administrator/, `${role} cannot grant access`);
}
await actor('super_admin', 'aal1');
await assert.rejects(grant, /Only a super administrator/, 'MFA required for grant');
await actor('super_admin');
await db.exec(`update public.adci_memberships set active=false`);
await assert.rejects(grant, /Only a super administrator/, 'inactive super admin denied');
await actor('super_admin');
await grant();
assert.equal(await allowed(), true, 'explicit super-admin grant accepted');
assert.equal((await query(`select actor_id from public.adci_audit_events`))[0].actor_id, id(2));
await db.exec(`update public.adci_enrolments set complimentary_granted_by=null, complimentary_granted_at=null`);
assert.equal(await allowed(), false, 'unattributed legacy manual access denied');
await db.exec(`update public.adci_enrolments set entitlement_source='payment',source_order_id='${id(31)}'`);
assert.equal(await allowed(), true, 'verified paid learner accepted');
for (const status of ['created','failed','cancelled','refunded']) {
  await db.query(`update public.adci_orders set status=$1`, [status]);
  assert.equal(await allowed(), false, `${status} order denied`);
}
await db.exec(`update public.adci_orders set status='paid'; update public.adci_payment_transactions set status='failed'`);
assert.equal(await allowed(), false, 'uncaptured payment denied');
await db.exec(`update public.adci_payment_transactions set status='captured'; update public.adci_orders set learner_id='${id(2)}'`);
assert.equal(await allowed(), false, 'another learner payment denied');
await db.exec(`update public.adci_orders set learner_id='${id(1)}'; update public.adci_course_offers set course_id='${id(99)}'`);
assert.equal(await allowed(), false, 'another course payment denied');
await db.exec(`update public.adci_course_offers set course_id='${id(10)}'; update public.adci_enrolments set access_expires_at=now()-interval '1 second'`);
assert.equal(await allowed(), false, 'expired enrolment denied');
await db.exec(`update public.adci_enrolments set access_expires_at=null,status='cancelled'`);
assert.equal(await allowed(), false, 'cancelled enrolment denied');
for (const role of ['instructor','content_author','academic_lead','branch_admin','super_admin']) {
  await actor(role);
  const result = await query(`select public.adci_get_zoom_access('${id(12)}','${id(2)}') as access`);
  assert.equal(result[0].access.is_staff, true, `${role} can host`);
}
for (const role of ['support','mentor','finance','student']) {
  await actor(role);
  await assert.rejects(() => db.query(`select public.adci_get_zoom_access('${id(12)}','${id(2)}')`), /Purchase this Zoom Live/, `${role} cannot host`);
}
for (const role of ['anon','authenticated']) {
  for (const fn of ['adci_get_zoom_access','adci_has_verified_zoom_enrolment']) {
    const result = await query(`select has_function_privilege('${role}','public.${fn}(uuid,uuid)','execute') as allowed`);
    assert.equal(result[0].allowed, false, `${role} cannot invoke privileged admission RPC`);
  }
}
console.log('PASS: Zoom payments, complimentary grants, MFA, role boundaries, expiry and RPC permissions');
await db.close();
