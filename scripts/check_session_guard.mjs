import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const read = (relativePath) => readFileSync(new URL(relativePath, root), "utf8");

// Single active session per account.
const migration = read("./supabase/migrations/202609060002_single_active_session.sql");
assert.ok(/create table if not exists public\.adci_active_sessions/.test(migration), "session table must be created");
assert.ok(/enable row level security/.test(migration), "session table must enable RLS");
assert.ok(/revoke all on table public\.adci_active_sessions from public, anon/.test(migration), "anon must have no grant");
assert.ok(
  /using \(auth\.uid\(\) = user_id\)\s*\n\s*with check \(auth\.uid\(\) = user_id\)/.test(migration),
  "policy must scope every account to its own row"
);

const authGate = read("./components/AuthGate.tsx");
assert.ok(authGate.includes('"adci_active_sessions"'), "AuthGate must read/write the session table");
assert.ok(authGate.includes("SIGNED_IN_ELSEWHERE"), "AuthGate must surface a sign-in-elsewhere message");
assert.ok(
  authGate.includes("await claimActiveSession(supabase, data.user?.id)"),
  "a password sign-in must claim the active session"
);
assert.ok(
  authGate.includes("await claimActiveSession(supabase, data.session.user.id)"),
  "completing MFA must claim the active session"
);
assert.ok(
  authGate.includes("confirmActiveSession(authClient, verifiedUser.id, true)"),
  "session validation must confirm this device still owns the account"
);
assert.ok(
  authGate.includes("confirmActiveSession(client, userId, false)"),
  "a background poll must keep confirming ownership"
);
assert.ok(/setInterval\(\(\) => void ensureStillOwner\(\), 60000\)/.test(authGate), "ownership poll must run about once a minute");

// Trimmed Zoom Live UI.
const zoomLive = read("./components/ZoomLive.tsx");
for (const flag of ["disableRecord: true", "disableReport: true", "disableZoomPhone: true", "disablePictureInPicture: true"]) {
  assert.ok(zoomLive.includes(flag), `Zoom Live init must set ${flag}`);
}

const styles = read("./app/globals.css");
assert.ok(
  styles.includes('#zmmtg-root [aria-label="Whiteboards" i]') && styles.includes("display: none !important;"),
  "non-working Zoom footer controls must be hidden"
);

console.log("Session + Zoom UI checks passed: single active session, ownership poll, trimmed meeting controls.");
