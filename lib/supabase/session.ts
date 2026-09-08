import type { SupabaseClient } from "@supabase/supabase-js";

export async function verifyActiveSession(client: SupabaseClient, claim = false) {
  const { error } = claim
    ? await client.rpc("adci_claim_active_session")
    : await client.rpc("adci_check_active_session");
  if (error) throw new Error(error.message || "We could not verify your session. Please sign in again.");
}
