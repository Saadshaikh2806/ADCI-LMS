import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { requireServerEnvironment } from "../supabase/server";

const ZOOM_API = "https://api.zoom.us/v2";

type ZoomMeeting = {
  id: number;
  password?: string;
};

type ZoomRegistrant = {
  id: string;
  join_url?: string;
};

function zoomConfiguration() {
  return {
    accountId: requireServerEnvironment("ZOOM_ACCOUNT_ID"),
    apiClientId: requireServerEnvironment("ZOOM_API_CLIENT_ID"),
    apiClientSecret: requireServerEnvironment("ZOOM_API_CLIENT_SECRET"),
    hostUserId: requireServerEnvironment("ZOOM_HOST_USER_ID"),
    sdkClientId: requireServerEnvironment("ZOOM_MEETING_SDK_CLIENT_ID"),
    sdkClientSecret: requireServerEnvironment("ZOOM_MEETING_SDK_CLIENT_SECRET")
  };
}

async function zoomAccessToken() {
  const config = zoomConfiguration();
  const response = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.apiClientId}:${config.apiClientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({ grant_type: "account_credentials", account_id: config.accountId }),
    cache: "no-store"
  });
  const result = await response.json() as { access_token?: string; message?: string };
  if (!response.ok || !result.access_token) throw new Error(result.message || "Zoom account authentication failed");
  return result.access_token;
}

async function zoomRequest<T>(path: string, init: RequestInit = {}) {
  const token = await zoomAccessToken();
  const response = await fetch(`${ZOOM_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers
    },
    cache: "no-store"
  });
  if (response.status === 204) return undefined as T;
  const result = await response.json() as T & { message?: string };
  if (!response.ok) throw new Error(result.message || "Zoom could not complete this request");
  return result;
}

export function createZoomPasscode() {
  return randomBytes(6).toString("base64url").slice(0, 8);
}

export async function createZoomMeeting(input: {
  topic: string;
  startTime: string;
  durationMinutes: number;
  passcode: string;
}) {
  const { hostUserId } = zoomConfiguration();
  const meeting = await zoomRequest<ZoomMeeting>(`/users/${encodeURIComponent(hostUserId)}/meetings`, {
    method: "POST",
    body: JSON.stringify({
      topic: input.topic,
      type: 2,
      start_time: input.startTime,
      duration: input.durationMinutes,
      timezone: "Asia/Kolkata",
      password: input.passcode,
      settings: {
        approval_type: 0,
        registration_type: 1,
        join_before_host: false,
        waiting_room: false,
        mute_upon_entry: true,
        host_video: true,
        participant_video: true,
        registrants_email_notification: false,
        registrants_confirmation_email: false,
        use_pmi: false
      }
    })
  });
  return { meetingNumber: String(meeting.id), passcode: meeting.password || input.passcode };
}

export async function deleteZoomMeeting(meetingNumber: string) {
  try {
    await zoomRequest<void>(`/meetings/${encodeURIComponent(meetingNumber)}`, { method: "DELETE" });
  } catch {
    // Creation rollback is best effort; the original failure is more useful to the administrator.
  }
}

export async function createZoomRegistrant(input: {
  meetingNumber: string;
  fullName: string;
  email: string;
}) {
  const names = input.fullName.trim().split(/\s+/);
  const firstName = names.shift() || "ADCI";
  const lastName = names.join(" ") || "Learner";
  const registrant = await zoomRequest<ZoomRegistrant>(
    `/meetings/${encodeURIComponent(input.meetingNumber)}/registrants`,
    {
      method: "POST",
      body: JSON.stringify({ email: input.email, first_name: firstName, last_name: lastName })
    }
  );
  const registrantToken = registrant.join_url ? new URL(registrant.join_url).searchParams.get("tk") : null;
  if (!registrantToken) throw new Error("Zoom did not issue a private participant token");
  return { registrantId: registrant.id, registrantToken };
}

export async function deleteZoomRegistrant(meetingNumber: string, registrantId: string) {
  try {
    await zoomRequest<void>(
      `/meetings/${encodeURIComponent(meetingNumber)}/registrants/${encodeURIComponent(registrantId)}`,
      { method: "DELETE" }
    );
  } catch {
    // The stale registrant may belong to a meeting that no longer exists; re-registering is what matters.
  }
}

export async function getZoomHostZak() {
  const { hostUserId } = zoomConfiguration();
  const result = await zoomRequest<{ token: string }>(
    `/users/${encodeURIComponent(hostUserId)}/token?type=zak`
  );
  if (!result.token) throw new Error("Zoom did not issue a host token");
  return result.token;
}

function base64Url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

export function createMeetingSdkSignature(meetingNumber: string, role: 0 | 1) {
  const { sdkClientId, sdkClientSecret } = zoomConfiguration();
  const issuedAt = Math.floor(Date.now() / 1000) - 30;
  const expiresAt = issuedAt + 2 * 60 * 60;
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    appKey: sdkClientId,
    sdkKey: sdkClientId,
    mn: meetingNumber,
    role,
    iat: issuedAt,
    exp: expiresAt,
    tokenExp: expiresAt
  }));
  const signature = createHmac("sha256", sdkClientSecret).update(`${header}.${payload}`).digest("base64url");
  return { sdkKey: sdkClientId, signature: `${header}.${payload}.${signature}` };
}

export function personalZoomCode(userId: string, lessonId: string) {
  const { sdkClientSecret } = zoomConfiguration();
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const digest = createHmac("sha256", sdkClientSecret)
    .update(`adci-zoom-code:${lessonId}:${userId}`)
    .digest();
  const code = Array.from(digest.subarray(0, 8), (byte) => alphabet[byte % alphabet.length]).join("");
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function zoomCodesMatch(actual: string, expected: string) {
  const normalize = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const left = Buffer.from(normalize(actual));
  const right = Buffer.from(normalize(expected));
  return left.length === right.length && timingSafeEqual(left, right);
}
