const FRESH_MS = 15 * 60 * 1000;
const LOOKBACK_MS = 24 * 60 * 60 * 1000;

function readingType(device) {
  const name = String(device.name || "").trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `${device.connector}:${name}`;
}

function classifySignals(signals = [], isTablet = false) {
  if (isTablet) return "tablet";
  const details = signals.map((signal) => signal.detail).join(" ").toLowerCase();
  if (details.includes("internetgatewaydevice")) return "network gateway";
  if (/mediarenderer|spotify-connect|_undok\./.test(details)) return "audio device";
  return "unidentified network device";
}

async function readTelemetry(devices, client, buildingId, now = Date.now()) {
  if (!client) return devices.map((device) => ({ ...device, telemetry: { status: "not checked" } }));
  return Promise.all(devices.map(async (device) => {
    try {
      const { data, error } = await client.from("Readings")
        .select("timestamp").eq("building_id", buildingId)
        .eq("reading_type", readingType(device))
        .gte("timestamp", new Date(now - LOOKBACK_MS).toISOString())
        .order("timestamp", { ascending: false }).limit(1);
      if (error) throw error;
      const timestamp = data?.[0]?.timestamp || null;
      const age = timestamp ? now - Date.parse(timestamp) : Infinity;
      return { ...device, telemetry: { status: age >= 0 && age <= FRESH_MS ? "reporting" : timestamp ? "stale" : "no readings in 24h", lastReadingAt: timestamp } };
    } catch {
      return { ...device, telemetry: { status: "check failed" } };
    }
  }));
}

function buildInventory(report, configuredWithTelemetry) {
  const configuredByAddress = new Map(configuredWithTelemetry.map((device) => [device.address, device]));
  const advertisedByAddress = new Map(report.candidates.map((candidate) => [candidate.address, candidate]));
  const addresses = new Set([...configuredByAddress.keys(), ...advertisedByAddress.keys(), ...report.tabletAddresses]);
  return [...addresses].sort().map((address) => {
    const configured = configuredByAddress.get(address);
    const advertised = advertisedByAddress.get(address);
    return {
      address,
      name: configured?.name || null,
      kind: configured ? "configured sensor" : classifySignals(advertised?.signals, report.tabletAddresses.includes(address)),
      connector: configured?.connector || null,
      telemetry: configured?.telemetry || null,
      advertisedServices: advertised?.signals || [],
      interpretation: configured ? "Collector configured; telemetry status is a separate check." : "Network presence alone does not provide sensor readings.",
    };
  });
}

module.exports = { readingType, classifySignals, readTelemetry, buildInventory };
