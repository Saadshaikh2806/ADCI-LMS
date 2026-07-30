import { Webhook } from "svix";
import {
  getServerServiceSupabase,
  requireServerEnvironment
} from "../../../../lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ResendWebhookEvent = {
  type: string;
  created_at: string;
  data?: { email_id?: string };
};

export async function POST(request: Request) {
  const payload = await request.text();
  const eventId = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signature = request.headers.get("svix-signature");
  if (!eventId || !timestamp || !signature) {
    return Response.json({ error: "Missing webhook signature headers" }, { status: 400 });
  }

  let event: ResendWebhookEvent;
  try {
    event = new Webhook(requireServerEnvironment("RESEND_WEBHOOK_SECRET")).verify(payload, {
      "svix-id": eventId,
      "svix-timestamp": timestamp,
      "svix-signature": signature
    }) as ResendWebhookEvent;
  } catch {
    return Response.json({ error: "Invalid webhook signature" }, { status: 400 });
  }

  const service = getServerServiceSupabase();
  const { data, error } = await service.rpc("adci_record_email_provider_event", {
    provider_event_id: eventId,
    provider_event_type: event.type,
    provider_email_id: event.data?.email_id || "",
    provider_event_payload: event
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ received: true, processed: data });
}
