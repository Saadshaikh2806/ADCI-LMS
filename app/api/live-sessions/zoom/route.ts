import { requireServerUser } from "../../../../lib/supabase/server";
import {
  createMeetingSdkSignature,
  createZoomRegistrant,
  deleteZoomRegistrant,
  getZoomHostZak,
  personalZoomCode,
  zoomCodesMatch
} from "../../../../lib/zoom/server";

export const runtime = "nodejs";

type ZoomAccess = {
  meeting_number: string;
  meeting_passcode: string;
  participant_name: string;
  participant_email: string;
  is_staff: boolean;
  starts_at: string;
  ends_at: string;
  can_join: boolean;
};

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error && typeof error.message === "string") return error.message;
  return "Zoom Live could not be opened";
}

export async function POST(request: Request) {
  try {
    const { user, service } = await requireServerUser(request);
    const body = await request.json() as { lessonId?: string; code?: string };
    if (!body.lessonId?.match(/^[0-9a-f-]{36}$/i)) throw new Error("Choose a valid Zoom Live session");

    const { data, error } = await service.rpc("adci_get_zoom_access", {
      target_lesson_id: body.lessonId,
      target_user_id: user.id
    });
    if (error) throw error;
    const access = data as ZoomAccess;
    const expectedCode = personalZoomCode(user.id, body.lessonId);

    if (!access.is_staff && !body.code) {
      return Response.json({ requiresCode: true, personalCode: expectedCode });
    }
    if (!access.can_join) throw new Error("Zoom Live opens 15 minutes before the session");
    if (!access.is_staff && !zoomCodesMatch(body.code || "", expectedCode)) {
      throw new Error("That personal meeting code is incorrect");
    }

    let registrantToken: string | undefined;
    let zak: string | undefined;
    if (access.is_staff) {
      zak = await getZoomHostZak();
    } else {
      const { data: existing, error: registrantError } = await service
        .from("adci_zoom_registrants")
        .select("zoom_registrant_id,registrant_token,registered_email")
        .eq("lesson_id", body.lessonId)
        .eq("learner_id", user.id)
        .maybeSingle();
      if (registrantError) throw registrantError;

      if (existing?.registrant_token && existing.registered_email === access.participant_email) {
        registrantToken = existing.registrant_token;
      } else {
        if (existing?.zoom_registrant_id) {
          await deleteZoomRegistrant(access.meeting_number, existing.zoom_registrant_id);
        }
        const registrant = await createZoomRegistrant({
          meetingNumber: access.meeting_number,
          fullName: access.participant_name,
          email: access.participant_email
        });
        registrantToken = registrant.registrantToken;
        const { error: saveError } = await service.from("adci_zoom_registrants").upsert({
          lesson_id: body.lessonId,
          learner_id: user.id,
          zoom_registrant_id: registrant.registrantId,
          registrant_token: registrant.registrantToken,
          registered_email: access.participant_email,
          updated_at: new Date().toISOString()
        });
        if (saveError) throw saveError;
      }

      const { error: attendanceError } = await service.rpc("adci_record_zoom_join", {
        target_lesson_id: body.lessonId,
        target_user_id: user.id
      });
      if (attendanceError) throw attendanceError;
    }

    const sdk = createMeetingSdkSignature(access.meeting_number, access.is_staff ? 1 : 0);
    return Response.json({
      requiresCode: false,
      ...sdk,
      meetingNumber: access.meeting_number,
      password: access.meeting_passcode,
      userName: access.participant_name,
      userEmail: access.participant_email,
      tk: registrantToken,
      zak
    });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 400 });
  }
}
