import { getServerServiceSupabase } from "../../../lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const checkedAt = new Date().toISOString();
  try {
    const { error } = await getServerServiceSupabase().from("adci_organizations").select("id").limit(1);
    if (error) throw error;
    return Response.json({ status: "ok", checked_at: checkedAt }, {
      headers: { "Cache-Control": "no-store" }
    });
  } catch {
    return Response.json({ status: "unavailable", checked_at: checkedAt }, {
      status: 503,
      headers: { "Cache-Control": "no-store" }
    });
  }
}
