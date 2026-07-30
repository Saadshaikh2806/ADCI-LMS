import { getSupabaseBrowserClient } from "./client";

export type EmailPreferences = {
  email_announcements: boolean;
};

export type EmailDelivery = {
  id: string;
  announcement_id: string | null;
  message_kind: "announcement" | "payment_receipt" | "assignment_graded";
  announcement_title: string;
  recipient_name: string;
  recipient_email: string;
  status: "queued" | "processing" | "sent" | "failed" | "cancelled";
  attempts: number;
  provider_message_id: string | null;
  provider_status: "pending" | "accepted" | "sent" | "delivered" | "delayed" | "bounced" | "complained" | "suppressed" | "failed";
  provider_event_at: string | null;
  last_error: string | null;
  sent_at: string | null;
  created_at: string;
};

export type AdminEmailDeliveryData = {
  summary: {
    queued: number;
    sent: number;
    failed: number;
    cancelled: number;
    delivered: number;
    bounced: number;
  };
  deliveries: EmailDelivery[];
};

function requireClient() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase;
}

export async function getMyEmailPreferences() {
  const { data, error } = await requireClient().rpc("adci_get_my_email_preferences");
  if (error) throw error;
  return data as EmailPreferences;
}

export async function saveMyEmailPreferences(enabled: boolean) {
  const { data, error } = await requireClient().rpc("adci_save_my_email_preferences", {
    receive_announcement_emails: enabled
  });
  if (error) throw error;
  return data as EmailPreferences;
}

export async function getAdminEmailDelivery() {
  const { data, error } = await requireClient().rpc("adci_admin_get_email_delivery");
  if (error) throw error;
  return data as AdminEmailDeliveryData;
}

export async function retryEmailDelivery(deliveryId: string) {
  const { error } = await requireClient().rpc("adci_admin_retry_email_delivery", {
    target_delivery_id: deliveryId
  });
  if (error) throw error;
}

export async function dispatchAdciEmails() {
  const supabase = requireClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Please sign in again");
  const response = await fetch("/api/notifications/dispatch", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}` }
  });
  const payload = await response.json().catch(() => ({})) as {
    claimed?: number;
    sent?: number;
    failed?: number;
    error?: string;
  };
  if (!response.ok) throw new Error(payload.error || "Unable to dispatch email");
  return {
    claimed: payload.claimed ?? 0,
    sent: payload.sent ?? 0,
    failed: payload.failed ?? 0
  };
}
