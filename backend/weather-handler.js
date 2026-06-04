const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const WEATHER_API_KEY = process.env.WBP;
const WEATHER_POLL_INTERVAL_MS = Number(
  process.env.WEATHER_POLL_INTERVAL_MS || 5 * 60 * 1000
);
const WEATHER_LOCATIONS = process.env.WEATHER_LOCATIONS || "";

const defaultLocations = [
  {
    buildingId: process.env.BUILDING_ID || "museum",
    lat: process.env.DEFAULT_LAT,
    lon: process.env.DEFAULT_LON,
  },
].filter((location) => location.lat && location.lon);

const locations = parseWeatherLocations(WEATHER_LOCATIONS);

function parseWeatherLocations(value) {
  if (!value.trim()) {
    return defaultLocations;
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [buildingId, lat, lon] = entry.split(":").map((part) => part.trim());
      return { buildingId, lat, lon };
    })
    .filter((location) => location.buildingId && location.lat && location.lon);
}

async function fetchExternalTemperature({ buildingId, lat, lon }) {
  const timestamp = new Date().toISOString();

  try {
    const response = await axios.get(
      "https://api.openweathermap.org/data/2.5/weather",
      {
        params: {
          lat,
          lon,
          units: "metric",
          appid: WEATHER_API_KEY,
        },
      }
    );

    const externalTemp = response.data.main.temp;
    const { error } = await supabase.from("Readings").insert([
      {
        building_id: buildingId,
        temperature_outside: externalTemp,
        timestamp,
      },
    ]);

    if (error) {
      console.error(
        `[${timestamp}] Weather insert error for ${buildingId}:`,
        error.message
      );
      return;
    }

    console.log(
      `[${timestamp}] External temperature for ${buildingId}: ${externalTemp} C`
    );
  } catch (error) {
    console.error(
      `[${timestamp}] Weather fetch failed for ${buildingId}:`,
      error.message
    );
  }
}

async function pollWeather() {
  if (!WEATHER_API_KEY) {
    console.error("WBP OpenWeather API key is missing.");
    return;
  }

  if (locations.length === 0) {
    console.error(
      "No weather locations configured. Set WEATHER_LOCATIONS or DEFAULT_LAT/DEFAULT_LON."
    );
    return;
  }

  await Promise.all(locations.map(fetchExternalTemperature));
}

console.log(
  `Starting weather collector for ${locations
    .map((location) => location.buildingId)
    .join(", ")} every ${WEATHER_POLL_INTERVAL_MS}ms`
);

pollWeather();
setInterval(pollWeather, WEATHER_POLL_INTERVAL_MS);
