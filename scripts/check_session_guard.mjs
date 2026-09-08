import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const uid = "00000000-0000-0000-0000-000000000001";
for (const hasDeviceTable of [false, true]) {
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls; create role authenticator;
  create schema auth; create schema storage;
  grant usage on schema auth, storage to authenticated;
  create function auth.jwt() returns jsonb language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
  create table auth.users(id uuid primary key);
  create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz,not_after timestamptz);
  create table auth.mfa_factors(user_id uuid,status text);
  create table public.adci_fixture(id integer);
  create table storage.objects(id integer);
  insert into public.adci_fixture values (1);
  insert into storage.objects values (1);
  alter table public.adci_fixture enable row level security;
  alter table storage.objects enable row level security;
  grant select on public.adci_fixture,storage.objects to authenticated;
  create policy fixture_access on public.adci_fixture for select to authenticated using (true);
  create policy storage_access on storage.objects for select to authenticated using (true);
`);
if (hasDeviceTable) await db.exec(readFileSync("supabase/migrations/202609060002_single_active_session.sql", "utf8"));
await db.exec(readFileSync("supabase/migrations/202609080002_verified_active_sessions.sql", "utf8"));
const old = "00000000-0000-0000-0000-000000000010";
const newer = "00000000-0000-0000-0000-000000000020";
await db.query("insert into auth.users values ($1)", [uid]);
await db.query("insert into auth.sessions values ($1,$3,now()-interval '1 hour',null),($2,$3,now(),null)", [old,newer,uid]);
async function actor(sid, aal = "aal1", user = uid) {
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({sub:user, session_id:sid, role:"authenticated", aal})]);
}
const claim = () => db.query("select public.adci_claim_active_session()");
const check = () => db.query("select public.adci_check_active_session()");
await actor(old);
await assert.rejects(check, /no longer active/, "missing ownership fails closed");
await claim(); await check();
await actor(newer); await claim(); await check();
await actor(old);
await assert.rejects(check, /no longer active/, "new login denies old token");
await assert.rejects(claim, /another device/, "old login cannot reclaim ownership");
await db.exec("set role authenticated");
assert.equal((await db.query("select * from public.adci_fixture")).rows.length, 0, "old session cannot read realtime tables");
assert.equal((await db.query("select * from storage.objects")).rows.length, 0, "old session cannot read storage");
await assert.rejects(() => db.query("delete from public.adci_active_sessions"), /permission denied/, "client cannot erase ownership");
await db.exec("reset role");
await actor(newer);
await db.exec("set role authenticated");
assert.equal((await db.query("select * from public.adci_fixture")).rows.length, 1);
assert.equal((await db.query("select * from storage.objects")).rows.length, 1);
await db.exec("reset role");
await db.query("insert into auth.mfa_factors values ($1,'verified')", [uid]);
await assert.rejects(claim, /authenticator/, "enrolled MFA must finish before claiming");
await assert.rejects(check, /no longer active/, "AAL1 token blocked for enrolled user");
await actor(newer,"aal2"); await claim(); await check();
await actor(newer,"aal2","00000000-0000-0000-0000-000000000099");
await assert.rejects(claim, /expired/, "another user's session cannot be claimed");
await actor(newer,"aal2");
await db.query("delete from auth.sessions where id=$1", [newer]);
await assert.rejects(check, /no longer active/, "revoked session is rejected");
await actor(old,"aal2");
await assert.rejects(claim, /another device/, "signing out the newer session cannot revive the old one");
await db.query("select set_config('request.path','/rpc/adci_claim_active_session',false),set_config('request.method','POST',false)");
await db.query("select public.adci_check_request_session()");
await db.query("select set_config('request.path','/rpc/adci_admin_delete_live_schedule',false)");
await assert.rejects(() => db.query("select public.adci_check_request_session()"), /no longer active/, "pre-request guards security-definer RPCs");
await db.query("select set_config('request.jwt.claims','{\"role\":\"anon\"}',false)");
await db.query("select public.adci_check_request_session()");
await db.close();
}

// Exercise the actual browser/server helper: returned Supabase errors must reject.
const exports = {};
runInNewContext(ts.transpileModule(readFileSync("lib/supabase/session.ts","utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, {exports});
for (const claim of [false,true]) {
  await assert.rejects(() => exports.verifyActiveSession({rpc:async()=>({error:{message:"Database unavailable"}})},claim), /Database unavailable/);
}
// A valid Auth token alone must not authorize the privileged Next.js APIs.
let ownershipError = {message:"Session no longer active"};
const server = {};
runInNewContext(ts.transpileModule(readFileSync("lib/supabase/server.ts","utf8"), {
  compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText, {
  exports:server,process:{env:{NEXT_PUBLIC_SUPABASE_URL:"https://example.test",NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"test",SUPABASE_SERVICE_ROLE_KEY:"test"}},
  require:name=>name==="server-only"?{}:name==="./session"?exports:{createClient:(_url,_key,options)=>options.global
    ? {rpc:async()=>({error:ownershipError})}
    : {auth:{getUser:async()=>({data:{user:{id:uid}},error:null})}}}
});
const request=new Request("https://example.test/api/live-sessions/zoom",{headers:{authorization:"Bearer test-only"}});
await assert.rejects(()=>server.requireServerUser(request),/Session no longer active/);
ownershipError=null;
assert.equal((await server.requireServerUser(request)).user.id,uid);
console.log("Session checks passed: two logins, old-token rejection, immutable ownership, revoked sessions, optional/enrolled MFA, RLS, Storage, RPC guard, and database failures.");
