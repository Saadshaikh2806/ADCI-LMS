import { dispatchPendingEmails } from "../../../../lib/email/delivery";
import {
  getServerServiceSupabase,
  requireServerUser
} from "../../../../lib/supabase/server";
import { apiErrorHeaders, apiErrorStatus, enforceApiRateLimit } from "../../../../lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function errorResponse(error: unknown, status = 400) {
  return Response.json({
    error: error instanceof Error ? error.message : "Unable to dispatch email"
  }, { status });
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return errorResponse(new Error("Unauthorized"), 401);
  }
  try {
    return Response.json(await dispatchPendingEmails(getServerServiceSupabase()));
  } catch (error) {
    return errorResponse(error, 500);
  }
}

export async function POST(request: Request) {
  try {
    const { user, userClient, service } = await requireServerUser(request);
    await enforceApiRateLimit(service, user.id, "email-dispatch", 5, 60);
    const { error: permissionError } = await userClient.rpc("adci_admin_get_email_delivery");
    if (permissionError) throw permissionError;
    return Response.json(await dispatchPendingEmails(service));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to dispatch email" }, { status: apiErrorStatus(error), headers: apiErrorHeaders(error) });
  }
}
