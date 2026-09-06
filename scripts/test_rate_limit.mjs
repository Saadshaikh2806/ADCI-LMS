import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const database = new PGlite();
await database.exec("create role anon; create role authenticated; create role service_role;");
await database.exec(readFileSync(new URL("../supabase/migrations/202609060001_production_readiness.sql", import.meta.url), "utf8"));

async function take(key, maximum = 2, seconds = 60) {
  const rows = await database.query(
    "select public.adci_take_api_rate_limit($1, $2, $3) as allowed",
    [key, maximum, seconds]
  );
  return rows.rows[0].allowed;
}

assert.equal(await take("user-1:payment-create"), true);
assert.equal(await take("user-1:payment-create"), true);
assert.equal(await take("user-1:payment-create"), false);
assert.equal(await take("user-2:payment-create"), true, "limits must be isolated by subject");

await database.exec("update public.adci_api_rate_limits set window_started_at = now() - interval '2 minutes' where request_key = 'user-1:payment-create'");
assert.equal(await take("user-1:payment-create"), true, "expired windows must reset atomically");

await database.exec("set role authenticated");
await assert.rejects(
  () => database.query("select * from public.adci_api_rate_limits"),
  /permission denied/,
  "authenticated clients must not read server rate-limit state"
);
await database.exec("reset role");
await database.close();

console.log("Rate-limit checks passed: atomic threshold, subject isolation, window reset and table permissions.");
