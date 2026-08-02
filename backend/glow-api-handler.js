const { createClient } = require("@supabase/supabase-js");
const { calculateCarbonSavings } = require("./carbon-savings-calculator");
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
const GLOW_API_DAILY_TOTAL_INTERVAL_MS = Number(
  process.env.GLOW_API_DAILY_TOTAL_INTERVAL_MS || 30 * 60 * 1000
);
const GLOW_API_INTERVAL_TOTAL_INTERVAL_MS = Number(
  process.env.GLOW_API_INTERVAL_TOTAL_INTERVAL_MS || 30 * 60 * 1000
);
const GLOW_API_INTERVAL_LOOKBACK_HOURS = Number(
  process.env.GLOW_API_INTERVAL_LOOKBACK_HOURS || 72
);
const GLOW_API_INSTANT_POWER_INTERVAL_MS = Number(
  process.env.GLOW_API_INSTANT_POWER_INTERVAL_MS || 30 * 60 * 1000
);
const GLOW_API_STORE_RAW_PAYLOAD =
  String(process.env.GLOW_API_STORE_RAW_PAYLOAD || "").toLowerCase() === "true";
const CARBON_SAVINGS_AFTER_GLOW_INTERVAL_MS = Number(
  process.env.CARBON_SAVINGS_AFTER_GLOW_INTERVAL_MS || 0
);
const CARBON_SAVINGS_BUILDING_ID =
  process.env.CARBON_SAVINGS_BUILDING_ID || "home";
const COLLECTOR_INSTANCE = process.env.COLLECTOR_INSTANCE || "unknown";
const SOURCE_NAME = `glow-api:${COLLECTOR_INSTANCE}`;
const GLOW_API_RESOURCES = process.env.GLOW_API_RESOURCES || "";
const GLOW_API_INTERVAL_FUELS = new Set(
  (process.env.GLOW_API_INTERVAL_FUELS || "electricity")
    .split(",")
    .map((fuel) => fuel.trim().toLowerCase())
    .filter(Boolean)
);

let cachedToken = null;
let tokenExpiresAt = 0;
const lastDailyTotalPollByResource = new Map();
const lastIntervalTotalPollByResource = new Map();
const lastInstantPowerPollByResource = new Map();
let lastCarbonSavingsRefreshAt = 0;
let carbonSavingsRefreshInFlight = false;

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

function buildIntervalQuery() {
  const now = new Date();
  const start = new Date(
    now.getTime() - GLOW_API_INTERVAL_LOOKBACK_HOURS * 60 * 60 * 1000
  );
  start.setUTCMinutes(start.getUTCMinutes() < 30 ? 0 : 30, 0, 0);

  const params = new URLSearchParams({
    from: start.toISOString().slice(0, 19),
    to: now.toISOString().slice(0, 19),
    period: "PT30M",
    function: "sum",
  });

  return { query: params.toString(), from: start, to: now };
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

function shouldPollDailyTotal(resource, nowMs) {
  const key = `${resource.buildingId}:${resource.fuelType}:${resource.resourceId}`;
  const lastPoll = lastDailyTotalPollByResource.get(key);

  if (!lastPoll || nowMs - lastPoll >= GLOW_API_DAILY_TOTAL_INTERVAL_MS) {
    lastDailyTotalPollByResource.set(key, nowMs);
    return true;
  }

  return false;
}

function shouldPollIntervalTotal(resource, nowMs) {
  if (!GLOW_API_INTERVAL_FUELS.has(String(resource.fuelType).toLowerCase())) {
    return false;
  }

  const key = `${resource.buildingId}:${resource.fuelType}:${resource.resourceId}`;
  const lastPoll = lastIntervalTotalPollByResource.get(key);

  if (!lastPoll || nowMs - lastPoll >= GLOW_API_INTERVAL_TOTAL_INTERVAL_MS) {
    lastIntervalTotalPollByResource.set(key, nowMs);
    return true;
  }

  return false;
}

function shouldPollInstantPower(resource, nowMs) {
  if (GLOW_API_INSTANT_POWER_INTERVAL_MS <= 0) {
    return false;
  }

  const key = `${resource.buildingId}:${resource.resourceId}`;
  const lastPoll = lastInstantPowerPollByResource.get(key);

  if (!lastPoll || nowMs - lastPoll >= GLOW_API_INSTANT_POWER_INTERVAL_MS) {
    lastInstantPowerPollByResource.set(key, nowMs);
    return true;
  }

  return false;
}

async function existingIntervalTimestamps(resource, from, to) {
  const timestamps = new Set();
  const pageSize = 1000;

  for (let page = 0; page < 10; page += 1) {
    const { data, error } = await supabase
      .from("EnergyReadings")
      .select("timestamp")
      .eq("building_id", resource.buildingId)
      .eq("fuel_type", resource.fuelType)
      .eq("reading_type", "interval_30m")
      .eq("topic", resource.resourceId)
      .gte("timestamp", from.toISOString())
      .lte("timestamp", to.toISOString())
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) {
      throw error;
    }

    (data || []).forEach((row) => {
      if (row.timestamp) {
        timestamps.add(new Date(row.timestamp).toISOString());
      }
    });

    if (!data || data.length < pageSize) {
      break;
    }
  }

  return timestamps;
}

async function collectResource(resource) {
  const rows = [];
  const nowMs = Date.now();

  if (shouldPollDailyTotal(resource, nowMs)) {
    const dailyData = await glowFetch(
      `/resource/${resource.resourceId}/readings?${buildDailyQuery()}`
    );
    const daily = latestPair(dailyData);

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
        raw_payload: GLOW_API_STORE_RAW_PAYLOAD ? dailyData : null,
      });
    }
  }

  if (shouldPollIntervalTotal(resource, nowMs)) {
    const intervalQuery = buildIntervalQuery();
    const intervalData = await glowFetch(
      `/resource/${resource.resourceId}/readings?${intervalQuery.query}`
    );
    const existingTimestamps = await existingIntervalTimestamps(
      resource,
      intervalQuery.from,
      intervalQuery.to
    );

    if (Array.isArray(intervalData?.data)) {
      intervalData.data.forEach(([timestampSeconds, value]) => {
        const usageKwh = Number(value);
        const timestamp = new Date(Number(timestampSeconds) * 1000).toISOString();

        if (
          !Number.isFinite(usageKwh) ||
          existingTimestamps.has(timestamp)
        ) {
          return;
        }

        existingTimestamps.add(timestamp);
        rows.push({
          timestamp,
          building_id: resource.buildingId,
          fuel_type: resource.fuelType,
          reading_type: "interval_30m",
          usage_kwh: usageKwh,
          power_kw: null,
          source: SOURCE_NAME,
          topic: resource.resourceId,
          raw_payload: GLOW_API_STORE_RAW_PAYLOAD ? intervalData : null,
        });
      });
    }
  }

  if (resource.fuelType === "electricity" && shouldPollInstantPower(resource, nowMs)) {
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
        raw_payload: GLOW_API_STORE_RAW_PAYLOAD ? currentData : null,
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
    scheduleCarbonSavingsRefresh(rows, timestamp);
  } catch (error) {
    console.error(`[${timestamp}] Glow API poll failed:`, error.message);
  }
}

function scheduleCarbonSavingsRefresh(rows, timestamp) {
  const hasCarbonRelevantEnergy = rows.some(
    (row) =>
      row.building_id === CARBON_SAVINGS_BUILDING_ID &&
      ["daily_total", "interval_30m"].includes(row.reading_type) &&
      Number.isFinite(Number(row.usage_kwh))
  );

  if (!hasCarbonRelevantEnergy || CARBON_SAVINGS_AFTER_GLOW_INTERVAL_MS <= 0) {
    return;
  }

  const nowMs = Date.now();

  if (
    carbonSavingsRefreshInFlight ||
    nowMs - lastCarbonSavingsRefreshAt < CARBON_SAVINGS_AFTER_GLOW_INTERVAL_MS
  ) {
    return;
  }

  lastCarbonSavingsRefreshAt = nowMs;
  carbonSavingsRefreshInFlight = true;
  calculateCarbonSavings()
    .then(() => {
      console.log(`[${timestamp}] Refreshed carbon savings summary after Glow energy update`);
    })
    .catch((error) => {
      console.error(
        `[${timestamp}] Carbon savings refresh after Glow update failed:`,
        error.message
      );
    })
    .finally(() => {
      carbonSavingsRefreshInFlight = false;
    });
}

if (!GLOW_USERNAME || !GLOW_PASSWORD) {
  console.error("Glow API credentials are missing.");
  process.exit(1);
}

console.log(
  `Starting Glow API collector (${COLLECTOR_INSTANCE}) for ${resources.length} resource(s) every ${GLOW_API_POLL_INTERVAL_MS}ms; daily totals every ${GLOW_API_DAILY_TOTAL_INTERVAL_MS}ms; interval totals every ${GLOW_API_INTERVAL_TOTAL_INTERVAL_MS}ms; instant power every ${GLOW_API_INSTANT_POWER_INTERVAL_MS}ms`
);

pollGlowApi();
setInterval(pollGlowApi, GLOW_API_POLL_INTERVAL_MS);
