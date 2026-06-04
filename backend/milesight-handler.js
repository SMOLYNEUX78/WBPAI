const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const BUILDING_ID = process.env.BUILDING_ID || "home";
const MILESIGHT_API_BASE_URL = process.env.MILESIGHT_API_BASE_URL;
const MILESIGHT_USERNAME = process.env.MILESIGHT_USERNAME;
const MILESIGHT_PASSWORD = process.env.MILESIGHT_PASSWORD;
const MILESIGHT_API_TOKEN = process.env.MILESIGHT_API_TOKEN;
const MILESIGHT_POLL_INTERVAL_MS = Number(
  process.env.MILESIGHT_POLL_INTERVAL_MS || 60000
);

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const requiredConfig = [
  ["MILESIGHT_API_BASE_URL", MILESIGHT_API_BASE_URL],
  ["MILESIGHT_USERNAME or MILESIGHT_API_TOKEN", MILESIGHT_USERNAME || MILESIGHT_API_TOKEN],
];

const missingConfig = requiredConfig
  .filter(([, value]) => !value)
  .map(([name]) => name);

if (missingConfig.length > 0) {
  console.error(
    `Milesight collector is not configured. Missing: ${missingConfig.join(", ")}`
  );
  process.exit(1);
}

const withBuildingId = (payload) => ({
  ...payload,
  building_id: BUILDING_ID,
});

async function getMilesightToken() {
  if (MILESIGHT_API_TOKEN) {
    return MILESIGHT_API_TOKEN;
  }

  // Placeholder for the exact Milesight endpoint once the account/API details
  // are known. Keep this collector opt-in until then.
  throw new Error(
    "Milesight username/password login is not implemented yet. Use MILESIGHT_API_TOKEN once available."
  );
}

async function pollMilesight() {
  const timestamp = new Date().toISOString();

  try {
    const token = await getMilesightToken();
    console.log(
      `[${timestamp}] Milesight collector configured for ${BUILDING_ID}; token present: ${Boolean(token)}`
    );

    // Once the Milesight device/API payload is confirmed, insert IAQ rows into
    // Readings here with temperature_inside, humidity, co2, vocs and pm25.
    await supabase.from("Readings").select("timestamp").limit(1);
  } catch (error) {
    console.error(`[${timestamp}] Milesight poll failed:`, error.message);
  }
}

console.log(
  `Starting Milesight IAQ collector for ${BUILDING_ID} every ${MILESIGHT_POLL_INTERVAL_MS}ms`
);

pollMilesight();
setInterval(pollMilesight, MILESIGHT_POLL_INTERVAL_MS);
