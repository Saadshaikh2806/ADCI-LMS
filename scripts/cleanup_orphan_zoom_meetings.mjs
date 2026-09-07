// One-off cleanup for Zoom meetings that the LMS no longer tracks.
//
// Deleting a live class in the LMS drops its adci_live_classes row but, until
// now, left the scheduled meeting sitting in the Zoom account. This script lists
// every scheduled meeting for the host user, keeps the ones still referenced in
// adci_live_classes, and deletes the rest.
//
// Dry run by default. Pass --apply to actually delete.
//
//   node scripts/cleanup_orphan_zoom_meetings.mjs           # list orphans
//   node scripts/cleanup_orphan_zoom_meetings.mjs --apply   # delete them
//
// Reads ZOOM_ACCOUNT_ID, ZOOM_API_CLIENT_ID, ZOOM_API_CLIENT_SECRET,
// ZOOM_HOST_USER_ID, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from
// the environment or .env.local.

import { readFileSync } from "node:fs";

for (const file of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(new URL(`../${file}`, import.meta.url), "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && !(match[1] in process.env)) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // optional
  }
}

const apply = process.argv.includes("--apply");

function need(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}`);
    process.exit(1);
  }
  return value;
}

const accountId = need("ZOOM_ACCOUNT_ID");
const clientId = need("ZOOM_API_CLIENT_ID");
const clientSecret = need("ZOOM_API_CLIENT_SECRET");
const hostUserId = need("ZOOM_HOST_USER_ID");
const supabaseUrl = need("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = need("SUPABASE_SERVICE_ROLE_KEY");

async function zoomToken() {
  const response = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({ grant_type: "account_credentials", account_id: accountId })
  });
  const body = await response.json();
  if (!response.ok || !body.access_token) throw new Error(body.message || "Zoom auth failed");
  return body.access_token;
}

async function zoom(token, path, init = {}) {
  const response = await fetch(`https://api.zoom.us/v2${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers }
  });
  if (response.status === 204) return undefined;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || `Zoom ${path} -> ${response.status}`);
  return body;
}

async function listScheduledMeetings(token) {
  const meetings = [];
  let pageToken = "";
  do {
    const query = new URLSearchParams({ type: "scheduled", page_size: "300" });
    if (pageToken) query.set("next_page_token", pageToken);
    const page = await zoom(token, `/users/${encodeURIComponent(hostUserId)}/meetings?${query}`);
    meetings.push(...(page.meetings ?? []));
    pageToken = page.next_page_token || "";
  } while (pageToken);
  return meetings;
}

async function trackedMeetingNumbers() {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/adci_live_classes?select=zoom_meeting_number&zoom_meeting_number=not.is.null`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  if (!response.ok) throw new Error(`Supabase read failed: ${response.status}`);
  const rows = await response.json();
  return new Set(rows.map((row) => String(row.zoom_meeting_number)));
}

const token = await zoomToken();
const [meetings, tracked] = await Promise.all([listScheduledMeetings(token), trackedMeetingNumbers()]);
const orphans = meetings.filter((meeting) => !tracked.has(String(meeting.id)));

console.log(`Scheduled meetings in Zoom : ${meetings.length}`);
console.log(`Still tracked by the LMS   : ${meetings.length - orphans.length}`);
console.log(`Orphans                    : ${orphans.length}`);
for (const meeting of orphans) {
  console.log(`  ${meeting.id}  ${meeting.start_time ?? "no start"}  ${meeting.topic ?? ""}`);
}

if (!orphans.length) {
  console.log("Nothing to delete.");
} else if (!apply) {
  console.log("\nDry run. Re-run with --apply to delete the meetings listed above.");
} else {
  let deleted = 0;
  for (const meeting of orphans) {
    try {
      await zoom(token, `/meetings/${meeting.id}`, { method: "DELETE" });
      deleted += 1;
    } catch (error) {
      console.error(`  failed ${meeting.id}: ${error.message}`);
    }
  }
  console.log(`\nDeleted ${deleted} / ${orphans.length} orphan meetings.`);
}
