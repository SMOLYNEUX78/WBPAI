const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const GLOW_USERNAME = process.env.GLOW_USERNAME || process.env.MQTT_USERNAME || process.env.BRIGHT_USERNAME;
const GLOW_PASSWORD = process.env.GLOW_PASSWORD || process.env.MQTT_PASSWORD || process.env.BRIGHT_PASSWORD;
const GLOW_APPLICATION_ID =
  process.env.GLOW_APPLICATION_ID || "b0f1b774-a586-4f72-9edd-27ead8aa7a8d";
const GLOW_API_BASE_URL =
  process.env.GLOW_API_BASE_URL || "https://api.glowmarkt.com/api/v0-1";
const GLOW_API_POLL_INTERVAL_MS = Number(
  process.env.GLOW_API_POLL_INTERVAL_MS || 60000
);
const COLLECTOR_INSTANCE = process.env.COLLECTOR_INSTANCE || "unknown";
const SOURCE_NAME = `glow-api:${COLLECTOR_INSTANCE}`;
const GLOW_API_RESOURCES = process.env.GLOW_API_RESOURCES || "";

let cachedToken = null;
let tokenExpiresAt = 0;

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

const resources = parseResourceConfig(GLOW_API_RESOURCES);

function parseResourceConfig(value) {
  if (!value.trim()) {
    return defaultResources;
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [buildingId, fuelType, resourceId] = entry.split(":").map((part) => part.trim());
      return { buildingId, fuelType, resourceId };
    })
    .filter((resource) => resource.buildingId && resource.fuelType && resource.resourceId);
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

function buildDailyQuery() {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  const params = new URLSearchParams({
    from: start.toISOString().slice(0, 19),
    to: now.toISOString().slice(0, 19),
    period: "P1D",
    function: "sum",
  });

  return params.toString();
}

function latestPair(data) {
  if (!Array.isArray(data?.data) || data.data.length === 0) {
    return null;
  }

  const [timestampSeconds, value] = data.data[data.data.length - 1];
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return null;
  }

  return {
    timestamp: new Date(Number(timestampSeconds) * 1000).toISOString(),
    value: numericValue,
    units: data.units,
  };
}

async function collectResource(resource) {
  const dailyData = await glowFetch(
    `/resource/${resource.resourceId}/readings?${buildDailyQuery()}`
  );
  const daily = latestPair(dailyData);
  const rows = [];

  if (daily) {
    rows.push({
      timestamp: daily.timestamp,
      building_id: resource.buildingId,
      fuel_type: resource.fuelType,
      reading_type: "daily_total",
      usage_kwh: daily.value,
      power_kw: null,
      source: SOURCE_NAME,
      topic: resource.resourceId,
      raw_payload: dailyData,
    });
  }

  if (resource.fuelType === "electricity") {
    const currentData = await glowFetch(`/resource/${resource.resourceId}/current`);
    const current = latestPair(currentData);

    if (current && current.units === "W") {
      rows.push({
        timestamp: current.timestamp,
        building_id: resource.buildingId,
        fuel_type: "electricity",
        reading_type: "instant_power",
        usage_kwh: null,
        power_kw: current.value / 1000,
        source: SOURCE_NAME,
        topic: resource.resourceId,
        raw_payload: currentData,
      });
    }
  }

  return rows;
}

async function pollGlowApi() {
  const timestamp = new Date().toISOString();

  try {
    const results = await Promise.all(resources.map(collectResource));
    const rows = results.flat();

    if (rows.length === 0) {
      console.warn(`[${timestamp}] Glow API returned no energy rows`);
      return;
    }

    const { error } = await supabase.from("EnergyReadings").insert(rows);

    if (error) {
      console.error(`[${timestamp}] EnergyReadings insert error:`, error.message);
      return;
    }

    console.log(`[${timestamp}] Logged ${rows.length} Glow API energy row(s)`);
  } catch (error) {
    console.error(`[${timestamp}] Glow API poll failed:`, error.message);
  }
}

if (!GLOW_USERNAME || !GLOW_PASSWORD) {
  console.error("Glow API credentials are missing.");
  process.exit(1);
}

console.log(
  `Starting Glow API collector (${COLLECTOR_INSTANCE}) for ${resources.length} resource(s) every ${GLOW_API_POLL_INTERVAL_MS}ms`
);

pollGlowApi();
setInterval(pollGlowApi, GLOW_API_POLL_INTERVAL_MS);
