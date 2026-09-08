import { getServerServiceSupabase, requireServerUser } from "../../../../lib/supabase/server";
import { apiErrorHeaders, apiErrorStatus, enforceApiRateLimit } from "../../../../lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function retire() {
  const service = getServerServiceSupabase();
  const { data, error } = await service.rpc("adci_retire_ended_live_courses");
  if (error) throw error;
  return data as { retired: number };
}

// Vercel Cron: archive bookable live-lecture courses whose session has ended.
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return Response.json(await retire());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Retire failed" }, { status: 500 });
  }
}

// Manual "run now" for a live-schedule admin.
export async function POST(request: Request) {
  try {
    const { user, userClient, service } = await requireServerUser(request);
    await enforceApiRateLimit(service, user.id, "live-retire", 6, 300);
    const { error: permissionError } = await userClient.rpc("adci_admin_get_live_schedule", { target_days: 7 });
    if (permissionError) throw permissionError;
    return Response.json(await retire());
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Retire failed" },
      { status: apiErrorStatus(error), headers: apiErrorHeaders(error) }
    );
  }
}
