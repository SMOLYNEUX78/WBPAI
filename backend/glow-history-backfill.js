const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const GLOW_USERNAME =
  process.env.GLOW_USERNAME ||
  process.env.MQTT_USERNAME ||
  process.env.BRIGHT_USERNAME;
const GLOW_PASSWORD =
  process.env.GLOW_PASSWORD ||
  process.env.MQTT_PASSWORD ||
  process.env.BRIGHT_PASSWORD;
const GLOW_APPLICATION_ID =
  process.env.GLOW_APPLICATION_ID || "b0f1b774-a586-4f72-9edd-27ead8aa7a8d";
const GLOW_API_BASE_URL =
  process.env.GLOW_API_BASE_URL || "https://api.glowmarkt.com/api/v0-1";
const COLLECTOR_INSTANCE = process.env.COLLECTOR_INSTANCE || "manual";
const GLOW_API_RESOURCES =
  process.env.GLOW_HISTORY_RESOURCES || process.env.GLOW_API_RESOURCES || "";

const HISTORY_FROM = process.env.GLOW_HISTORY_FROM || "2020-01-01";
const HISTORY_TO = process.env.GLOW_HISTORY_TO || new Date().toISOString();
const HISTORY_PERIOD = process.env.GLOW_HISTORY_PERIOD || "PT30M";
const HISTORY_CHUNK_DAYS = Number(process.env.GLOW_HISTORY_CHUNK_DAYS || 30);
const BATCH_SIZE = Number(process.env.GLOW_HISTORY_BATCH_SIZE || 500);

const defaultResources = [
  {
    buildingId: "home",
    fuelType: "electricity",
    resourceId: "042517ae-601f-4928-b3d2-e49b1de0e695",
  },
  {
    buildingId: "home",
    fuelType: "gas",
    resourceId: "a2130979-fb09-48bf-89f9-5703c30037b8",
  },
  {
    buildingId: "museum",
    fuelType: "electricity",
    resourceId: "12e31e6d-11dc-4bc3-a70b-dab6f76fc73c",
  },
];

let cachedToken = null;
let tokenExpiresAt = 0;

function parseResourceConfig(value) {
  if (!value.trim()) {
    return defaultResources;
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [buildingId, fuelType, resourceId] = entry
        .split(":")
        .map((part) => part.trim());
      return { buildingId, fuelType, resourceId };
    })
    .filter((resource) => resource.buildingId && resource.fuelType && resource.resourceId);
}

function parseDate(value, label) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label} is not a valid date: ${value}`);
  }

  return date;
}

function toGlowDate(date) {
  return date.toISOString().slice(0, 19);
}

function addDays(date, days) {
  const nextDate = new Date(date);
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return nextDate;
}

function chunkRows(rows, size) {
  const chunks = [];

  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }

  return chunks;
}

async function getGlowToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedToken;
  }

  const response = await fetch(`${GLOW_API_BASE_URL}/auth`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      applicationId: GLOW_APPLICATION_ID,
    },
    body: JSON.stringify({
      username: GLOW_USERNAME,
      password: GLOW_PASSWORD,
    }),
  });

  const body = await response.json();

  if (!response.ok || !body.token) {
    throw new Error(`Glow login failed: ${JSON.stringify(body)}`);
  }

  cachedToken = body.token;
  tokenExpiresAt = body.exp ? body.exp * 1000 : Date.now() + 10 * 60 * 1000;
  return cachedToken;
}

async function glowFetch(path) {
  const token = await getGlowToken();
  const response = await fetch(`${GLOW_API_BASE_URL}${path}`, {
    headers: {
      applicationId: GLOW_APPLICATION_ID,
      token,
    },
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${response.status} ${path}: ${text}`);
  }

  return JSON.parse(text);
}

function readingsPath(resourceId, from, to) {
  const params = new URLSearchParams({
    from: toGlowDate(from),
    to: toGlowDate(to),
    period: HISTORY_PERIOD,
    function: "sum",
  });

  return `/resource/${resourceId}/readings?${params.toString()}`;
}

function mapReadingsToRows(resource, data) {
  if (!Array.isArray(data?.data)) {
    return [];
  }

  return data.data
    .map(([timestampSeconds, value]) => {
      const usageKwh = Number(value);

      if (!Number.isFinite(usageKwh)) {
        return null;
      }

      return {
        timestamp: new Date(Number(timestampSeconds) * 1000).toISOString(),
        building_id: resource.buildingId,
        fuel_type: resource.fuelType,
        reading_type: "interval_30m",
        usage_kwh: usageKwh,
        power_kw: null,
        source: `glow-history:${COLLECTOR_INSTANCE}`,
        topic: resource.resourceId,
        raw_payload: {
          resourceId: resource.resourceId,
          units: data.units,
          period: HISTORY_PERIOD,
        },
      };
    })
    .filter(Boolean);
}

async function insertMissingRows(rows) {
  if (rows.length === 0) {
    return;
  }

  for (const batch of chunkRows(rows, BATCH_SIZE)) {
    const sample = batch[0];
    const timestamps = batch.map((row) => row.timestamp);
    const { data: existingRows, error: existingError } = await supabase
      .from("EnergyReadings")
      .select("timestamp")
      .eq("building_id", sample.building_id)
      .eq("fuel_type", sample.fuel_type)
      .eq("reading_type", "interval_30m")
      .in("timestamp", timestamps);

    if (existingError) {
      throw existingError;
    }

    const existingTimestamps = new Set(
      (existingRows || []).map((row) => new Date(row.timestamp).toISOString())
    );
    const missingRows = batch.filter(
      (row) => !existingTimestamps.has(new Date(row.timestamp).toISOString())
    );

    if (missingRows.length === 0) {
      continue;
    }

    const { error: insertError } = await supabase
      .from("EnergyReadings")
      .insert(missingRows);

    if (insertError) {
      throw insertError;
    }
  }
}

async function backfillResource(resource, fromDate, toDate) {
  let cursor = new Date(fromDate);
  let totalRows = 0;

  while (cursor < toDate) {
    const chunkEnd = new Date(Math.min(addDays(cursor, HISTORY_CHUNK_DAYS), toDate));
    const data = await glowFetch(readingsPath(resource.resourceId, cursor, chunkEnd));
    const rows = mapReadingsToRows(resource, data);

    await insertMissingRows(rows);
    totalRows += rows.length;

    console.log(
      `[${resource.buildingId}/${resource.fuelType}] ${toGlowDate(cursor)} to ${toGlowDate(
        chunkEnd
      )}: ${rows.length} row(s)`
    );

    cursor = chunkEnd;
  }

  return totalRows;
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error("Supabase environment variables are missing.");
  }

  if (!GLOW_USERNAME || !GLOW_PASSWORD) {
    throw new Error("Glow/Bright API credentials are missing.");
  }

  const fromDate = parseDate(HISTORY_FROM, "GLOW_HISTORY_FROM");
  const toDate = parseDate(HISTORY_TO, "GLOW_HISTORY_TO");
  const resources = parseResourceConfig(GLOW_API_RESOURCES);

  if (fromDate >= toDate) {
    throw new Error("GLOW_HISTORY_FROM must be before GLOW_HISTORY_TO.");
  }

  console.log(
    `Backfilling ${resources.length} Glow resource(s) from ${fromDate.toISOString()} to ${toDate.toISOString()} at ${HISTORY_PERIOD}`
  );

  let totalRows = 0;

  for (const resource of resources) {
    totalRows += await backfillResource(resource, fromDate, toDate);
  }

  console.log(`Glow history backfill complete: ${totalRows} interval row(s) processed.`);
}

main().catch((error) => {
  console.error("Glow history backfill failed:", error.message);
  process.exit(1);
});
