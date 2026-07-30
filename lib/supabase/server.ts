import "server-only";

import { createClient } from "@supabase/supabase-js";

export function requireServerEnvironment(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export function getServerServiceSupabase() {
  return createClient(
    requireServerEnvironment("NEXT_PUBLIC_SUPABASE_URL"),
    requireServerEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

export async function requireServerUser(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Authentication required");

  const url = requireServerEnvironment("NEXT_PUBLIC_SUPABASE_URL");
  const publishableKey = requireServerEnvironment("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const service = getServerServiceSupabase();
  const { data, error } = await service.auth.getUser(token);
  if (error || !data.user) throw new Error("Your session has expired. Please sign in again.");

  const userClient = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
  return { user: data.user, userClient, service };
}
