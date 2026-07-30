import { dispatchPendingEmails } from "../../../../lib/email/delivery";
import {
  getServerServiceSupabase,
  requireServerUser
} from "../../../../lib/supabase/server";

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
    const { userClient, service } = await requireServerUser(request);
    const { error: permissionError } = await userClient.rpc("adci_admin_get_email_delivery");
    if (permissionError) throw permissionError;
    return Response.json(await dispatchPendingEmails(service));
  } catch (error) {
    return errorResponse(error);
  }
}
