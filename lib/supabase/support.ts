import { getSupabaseBrowserClient } from "./client";

export type SupportCategory = "technical" | "course_content" | "assessment" | "payment" | "account" | "mentor" | "other";
export type SupportPriority = "low" | "normal" | "high" | "urgent";
export type SupportStatus = "open" | "in_progress" | "waiting_learner" | "resolved" | "closed";

export type SupportMessage = {
  id: string;
  body: string;
  author_id: string;
  author_name: string;
  is_mine?: boolean;
  is_staff?: boolean;
  internal?: boolean;
  created_at: string;
};

export type LearnerSupportTicket = {
  id: string;
  reference_code: string;
  subject: string;
  category: SupportCategory;
  priority: SupportPriority;
  status: SupportStatus;
  assigned_name: string;
  created_at: string;
  updated_at: string;
  messages: SupportMessage[];
};

export type AdminSupportTicket = Omit<LearnerSupportTicket, "assigned_name"> & {
  requester_id: string;
  requester_name: string;
  assigned_to: string | null;
  assigned_name: string;
};

export type AdminSupportData = {
  summary: { open: number; in_progress: number; waiting_learner: number; urgent: number; resolved: number };
  tickets: AdminSupportTicket[];
};

function client() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase;
}

export async function getMySupportTickets() {
  const { data, error } = await client().rpc("adci_get_my_support_tickets");
  if (error) throw error;
  return (data ?? []) as LearnerSupportTicket[];
}

export async function createSupportTicket(input: {
  subject: string;
  category: SupportCategory;
  priority: SupportPriority;
  message: string;
}) {
  const { data, error } = await client().rpc("adci_create_support_ticket", {
    ticket_subject: input.subject,
    ticket_category: input.category,
    ticket_priority: input.priority,
    ticket_message: input.message
  });
  if (error) throw error;
  return data as string;
}

export async function replyToSupportTicket(ticketId: string, body: string) {
  const { error } = await client().rpc("adci_reply_to_support_ticket", {
    target_ticket_id: ticketId,
    reply_body: body
  });
  if (error) throw error;
}

export async function getAdminSupportTickets() {
  const { data, error } = await client().rpc("adci_admin_get_support_tickets");
  if (error) throw error;
  return data as AdminSupportData;
}

export async function replyToSupportTicketAsStaff(ticketId: string, body: string, internal: boolean) {
  const { error } = await client().rpc("adci_admin_reply_support_ticket", {
    target_ticket_id: ticketId,
    reply_body: body,
    internal_note: internal
  });
  if (error) throw error;
}

export async function updateSupportTicket(ticketId: string, status: SupportStatus, assignToMe = false) {
  const { error } = await client().rpc("adci_admin_update_support_ticket", {
    target_ticket_id: ticketId,
    next_status: status,
    assign_to_me: assignToMe
  });
  if (error) throw error;
}
