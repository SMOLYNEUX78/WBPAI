const SUPABASE_URL = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL || "https://hvtuvapshvhwfgnnhzbh.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2dHV2YXBzaHZod2Znbm5oemJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQ3MjM4NTMsImV4cCI6MjA2MDI5OTg1M30.rZzCXqkhf93-8o5EYylgaCWxyTxeMzsNvl1lEzeBSpY";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async function baselineExport(request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Vary", "Authorization");
  if (request.method !== "GET") return response.status(405).json({ error: "Method not allowed" });
  const buildingId = String(request.query?.buildingId || "");
  if (!UUID.test(buildingId)) return response.status(400).json({ error: "A saved building ID is required." });
  const authorization = String(request.headers?.authorization || "");
  if (!/^Bearer \S+$/.test(authorization)) return response.status(401).json({ error: "Sign in to review this baseline." });

  try {
    const upstream = await fetch(`${SUPABASE_URL}/rest/v1/rpc/wbp_owner_baseline_export`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, authorization, "Content-Type": "application/json" },
      body: JSON.stringify({ p_building_record_id: buildingId }),
      signal: AbortSignal.timeout(10000),
    });
    if (upstream.status === 401) return response.status(401).json({ error: "Sign in again to review this baseline." });
    if (upstream.status === 403) return response.status(403).json({ error: "This building is not available to your account." });
    if (!upstream.ok) return response.status(503).json({ error: "The owner export is not available yet. Apply the Baseline Owner Export SQL first." });
    const pack = await upstream.json();
    if (!pack || pack.buildingRecordId?.toLowerCase() !== buildingId.toLowerCase() || pack.shareable !== false) {
      return response.status(502).json({ error: "The baseline export could not be verified." });
    }
    return response.status(200).json({
      buildingRecordId: pack.buildingRecordId,
      status: "owner-review",
      shareable: false,
      generatedAt: pack.generatedAt,
      validFrom: pack.validFrom,
      cutoverReason: pack.cutoverReason,
      periodStart: pack.periodStart,
      periodEnd: pack.periodEnd,
      meteredDays: pack.meteredDays,
      fuelSummaries: (Array.isArray(pack.fuelSummaries) ? pack.fuelSummaries : []).map((fuel) => ({
        fuelType: fuel.fuelType,
        intervalCount: fuel.intervalCount,
        totalKwh: fuel.totalKwh,
        lastReceivedAt: fuel.lastReceivedAt,
      })),
    });
  } catch {
    return response.status(503).json({ error: "The baseline export is temporarily unavailable." });
  }
};
