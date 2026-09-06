import AgoraToken from "agora-token";
import { requireServerEnvironment, requireServerUser } from "../../../../lib/supabase/server";
import { apiErrorHeaders, apiErrorStatus, enforceApiRateLimit } from "../../../../lib/security/rate-limit";

const { RtcRole, RtcTokenBuilder } = AgoraToken;

export const runtime = "nodejs";

type JoinAuthorization = {
  channel: string;
  participant_name: string | null;
  ends_at: string;
  is_staff: boolean;
};

export async function POST(request: Request) {
  try {
    const { user, userClient, service } = await requireServerUser(request);
    await enforceApiRateLimit(service, user.id, "agora-token", 60, 300);
    const { lessonId } = await request.json() as { lessonId?: string };
    if (!lessonId?.match(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i)) throw new Error("A valid live lesson is required");

    const { data, error } = await userClient.rpc("adci_authorize_agora_join", {
      target_lesson_id: lessonId
    });
    if (error) throw new Error(error.message);

    const access = data as JoinAuthorization;
    const appId = requireServerEnvironment("AGORA_APP_ID");
    const appCertificate = requireServerEnvironment("AGORA_APP_CERTIFICATE");
    const secondsUntilEnd = Math.ceil((new Date(access.ends_at).getTime() - Date.now()) / 1000);
    const expiresIn = Math.max(60, Math.min(7200, secondsUntilEnd + 300));
    const participantName = access.participant_name || user.email?.split("@")[0] || "ADCI learner";
    const participantRole = access.is_staff ? "host" : "learner";
    const rtcUid = `${user.id}:${participantRole}:${participantName.replace(/[:\r\n]/g, " ").trim().slice(0, 48)}`;
    const token = RtcTokenBuilder.buildTokenWithUserAccount(
      appId,
      appCertificate,
      access.channel,
      rtcUid,
      RtcRole.PUBLISHER,
      expiresIn,
      expiresIn
    );

    return Response.json({
      appId,
      token,
      channel: access.channel,
      uid: rtcUid,
      name: participantName,
      isStaff: access.is_staff
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to enter the private classroom";
    return Response.json(
      { error: message },
      { status: apiErrorStatus(error, message.includes("not configured") ? 503 : 403), headers: { ...apiErrorHeaders(error), "cache-control": "private, no-store" } }
    );
  }
}
