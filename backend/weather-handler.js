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
let supportsRainfallColumns = true;

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
    const rain1h = Number(response.data.rain?.["1h"] || 0);
    const rain3h = Number(response.data.rain?.["3h"] || 0);
    const weatherPayload = {
      building_id: buildingId,
      temperature_outside: externalTemp,
      timestamp,
      reading_type: "weather:openweather",
    };

    if (supportsRainfallColumns) {
      weatherPayload.rainfall_mm = rain1h || rain3h || 0;
      weatherPayload.rainfall_1h_mm = rain1h;
      weatherPayload.rainfall_3h_mm = rain3h;
    }

    let { error } = await supabase.from("Readings").insert([weatherPayload]);

    if (
      error &&
      supportsRainfallColumns &&
      /rainfall|schema cache/i.test(error.message || "")
    ) {
      supportsRainfallColumns = false;
      const {
        rainfall_mm,
        rainfall_1h_mm,
        rainfall_3h_mm,
        ...fallbackPayload
      } = weatherPayload;
      const fallbackResult = await supabase.from("Readings").insert([
        fallbackPayload,
      ]);
      error = fallbackResult.error;
      console.warn(
        `[${timestamp}] Readings table is missing rainfall columns; weather rows will save temperature only until the migration is applied.`
      );
    }

    if (error) {
      console.error(
        `[${timestamp}] Weather insert error for ${buildingId}:`,
        error.message
      );
      return;
    }

    console.log(
      `[${timestamp}] Weather for ${buildingId}: ${externalTemp} C, rain ${rain1h || rain3h || 0} mm`
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
