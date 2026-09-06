import { getServerServiceSupabase } from "../../../lib/supabase/server";
import { productionConfigurationStatus } from "../../../lib/config/production";

export const dynamic = "force-dynamic";

export async function GET() {
  const checkedAt = new Date().toISOString();
  const configuration = productionConfigurationStatus();
  try {
    const { error } = await getServerServiceSupabase().from("adci_organizations").select("id").limit(1);
    if (error) throw error;
    return Response.json({
      status: configuration.configured ? "ok" : "unavailable",
      checked_at: checkedAt,
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || "local",
      checks: { database: "ok", configuration: configuration.configured ? "ok" : "incomplete" }
    }, {
      status: configuration.configured ? 200 : 503,
      headers: { "Cache-Control": "no-store" }
    });
  } catch {
    return Response.json({ status: "unavailable", checked_at: checkedAt, checks: { database: "unavailable", configuration: configuration.configured ? "ok" : "incomplete" } }, {
      status: 503,
      headers: { "Cache-Control": "no-store" }
    });
  }
}
