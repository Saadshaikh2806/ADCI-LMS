// Retry only Zoom meetings captured by the LMS deletion transaction.
// Legacy untracked meetings are NOT assumed to belong to the LMS.
// Dry run: node scripts/cleanup_orphan_zoom_meetings.mjs
// Apply:   node scripts/cleanup_orphan_zoom_meetings.mjs --apply
import { readFileSync } from "node:fs";

for (const file of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(new URL("../" + file, import.meta.url), "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match && !(match[1] in process.env)) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* optional */ }
}
const apply = process.argv.includes("--apply");
function need(name) {
  const value = process.env[name];
  if (!value) throw new Error("Missing " + name);
  return value;
}
const supabaseUrl = need("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = need("SUPABASE_SERVICE_ROLE_KEY");

async function database(query, init = {}) {
  const response = await fetch(supabaseUrl + "/rest/v1/adci_zoom_cleanup?" + query, {
    ...init,
    headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error("Supabase cleanup request failed: " + response.status);
  return response.status === 204 ? null : response.json();
}

// Fetch all pages before mutating, so deleting a row cannot shift a later page.
const pending = [];
for (let offset = 0; ; offset += 200) {
  const page = await database("select=lesson_id,meeting_number,title&order=lesson_id&limit=200&offset=" + offset);
  pending.push(...page);
  if (page.length < 200) break;
}
console.log("LMS-approved pending Zoom removals: " + pending.length);
for (const item of pending) console.log(item.meeting_number + "  " + item.title);

if (!apply) {
  console.log("Dry run. Use --apply to retry these approved removals.");
} else if (pending.length) {
  const auth = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(need("ZOOM_API_CLIENT_ID") + ":" + need("ZOOM_API_CLIENT_SECRET")).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({ grant_type: "account_credentials", account_id: need("ZOOM_ACCOUNT_ID") }),
    signal: AbortSignal.timeout(15_000)
  });
  const credentials = await auth.json();
  if (!auth.ok || !credentials.access_token) throw new Error("Zoom authentication failed");
  async function zoom(path, init = {}) {
    const response = await fetch("https://api.zoom.us/v2" + path, {
      ...init,
      headers: { Authorization: "Bearer " + credentials.access_token, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(20_000)
    });
    if (response.status === 204) return null;
    const body = await response.json().catch(() => ({}));
    if (response.status === 404 && body.code === 3001) return null;
    if (!response.ok) throw new Error(body.message || "Zoom request failed: " + response.status);
    return body;
  }
  let failed = 0;
  for (const item of pending) {
    try {
      const path = "/meetings/" + encodeURIComponent(item.meeting_number);
      const meeting = await zoom(path);
      if (meeting && meeting.status !== "waiting") {
        await zoom(path + "/status", { method: "PUT", body: JSON.stringify({ action: "end" }) });
      }
      await zoom(path, { method: "DELETE" });
      await database("lesson_id=eq." + item.lesson_id, { method: "DELETE" });
    } catch (error) {
      failed++;
      console.error("Pending removal " + item.meeting_number + ": " + error.message);
    }
  }
  console.log("Removed " + (pending.length - failed) + " / " + pending.length);
  if (failed) process.exitCode = 1;
}
