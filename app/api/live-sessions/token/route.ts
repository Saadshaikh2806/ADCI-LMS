import AgoraToken from "agora-token";
import { requireServerEnvironment, requireServerUser } from "../../../../lib/supabase/server";

const { RtcRole, RtcTokenBuilder } = AgoraToken;

export const runtime = "nodejs";

type JoinAuthorization = {
  channel: string;
  participant_name: string;
  ends_at: string;
  is_staff: boolean;
};

export async function POST(request: Request) {
  try {
    const { user, userClient } = await requireServerUser(request);
    const { lessonId } = await request.json() as { lessonId?: string };
    if (!lessonId?.match(/^[0-9a-f-]{36}$/i)) throw new Error("A valid live lesson is required");

    const { data, error } = await userClient.rpc("adci_authorize_agora_join", {
      target_lesson_id: lessonId
    });
    if (error) throw new Error(error.message);

    const access = data as JoinAuthorization;
    const appId = requireServerEnvironment("AGORA_APP_ID");
    const appCertificate = requireServerEnvironment("AGORA_APP_CERTIFICATE");
    const secondsUntilEnd = Math.ceil((new Date(access.ends_at).getTime() - Date.now()) / 1000);
    const expiresIn = Math.max(60, Math.min(7200, secondsUntilEnd + 300));
    const token = RtcTokenBuilder.buildTokenWithUserAccount(
      appId,
      appCertificate,
      access.channel,
      user.id,
      RtcRole.PUBLISHER,
      expiresIn,
      expiresIn
    );

    return Response.json({
      appId,
      token,
      channel: access.channel,
      uid: user.id,
      name: access.participant_name || user.email || "ADCI learner",
      isStaff: access.is_staff
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to enter the private classroom";
    return Response.json(
      { error: message },
      { status: message.includes("not configured") ? 503 : 403, headers: { "cache-control": "private, no-store" } }
    );
  }
}
