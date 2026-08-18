const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const BUILDING_ID = process.env.RAIN_HISTORY_BUILDING_ID || "home";
const LATITUDE = Number(process.env.RAIN_HISTORY_LAT || 52.0945);
const LONGITUDE = Number(process.env.RAIN_HISTORY_LON || 1.30488);
const HISTORY_FROM = process.env.RAIN_HISTORY_FROM || "2026-03-18";
const HISTORY_TO = process.env.RAIN_HISTORY_TO || new Date().toISOString().slice(0, 10);
const HISTORY_CHUNK_DAYS = Number(process.env.RAIN_HISTORY_CHUNK_DAYS || 31);
const BATCH_SIZE = Number(process.env.RAIN_HISTORY_BATCH_SIZE || 500);
const SOURCE_READING_TYPE = "weather:openmeteo-archive";

function parseDate(value, label) {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label} is not a valid date: ${value}`);
  }

  return date;
}

function addDays(date, days) {
  const nextDate = new Date(date);
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return nextDate;
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function chunkRows(rows, size) {
  const chunks = [];

  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }

  return chunks;
}

async function fetchOpenMeteoRain(fromDate, toDate) {
  const params = new URLSearchParams({
    latitude: String(LATITUDE),
    longitude: String(LONGITUDE),
    start_date: dateKey(fromDate),
    end_date: dateKey(toDate),
    hourly: "temperature_2m,precipitation,rain",
    timezone: "UTC",
  });
  const url = `https://archive-api.open-meteo.com/v1/archive?${params.toString()}`;
  const response = await fetch(url, { headers: { accept: "application/json" } });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`Open-Meteo ${response.status}: ${body}`);
  }

  return JSON.parse(body);
}

function mapOpenMeteoRows(payload) {
  const hourly = payload?.hourly || {};
  const times = hourly.time || [];

  return times
    .map((time, index) => {
      const rainfall = Number(hourly.rain?.[index] ?? hourly.precipitation?.[index] ?? 0);
      const precipitation = Number(hourly.precipitation?.[index] ?? rainfall);
      const temperatureOutside = Number(hourly.temperature_2m?.[index]);

      if (!time || !Number.isFinite(rainfall)) {
        return null;
      }

      return {
        building_id: BUILDING_ID,
        timestamp: new Date(`${time}:00.000Z`).toISOString(),
        reading_type: SOURCE_READING_TYPE,
        temperature_outside: Number.isFinite(temperatureOutside)
          ? temperatureOutside
          : null,
        rainfall_mm: Math.max(0, rainfall),
        rainfall_1h_mm: Math.max(0, rainfall),
        rainfall_3h_mm: Math.max(0, precipitation),
      };
    })
    .filter(Boolean);
}

async function insertMissingRows(rows) {
  let insertedRows = 0;

  for (const batch of chunkRows(rows, BATCH_SIZE)) {
    const timestamps = batch.map((row) => row.timestamp);
    const { data: existingRows, error: existingError } = await supabase
      .from("Readings")
      .select("timestamp")
      .eq("building_id", BUILDING_ID)
      .eq("reading_type", SOURCE_READING_TYPE)
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
      .from("Readings")
      .insert(missingRows);

    if (insertError) {
      if (/rainfall|schema cache/i.test(insertError.message || "")) {
        throw new Error(
          `Rainfall columns are missing. Run Supabase-code/Add weather rainfall columns.sql first. Original error: ${insertError.message}`
        );
      }

      throw insertError;
    }

    insertedRows += missingRows.length;
  }

  return insertedRows;
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error("Supabase environment variables are missing.");
  }

  if (!Number.isFinite(LATITUDE) || !Number.isFinite(LONGITUDE)) {
    throw new Error("RAIN_HISTORY_LAT and RAIN_HISTORY_LON must be valid numbers.");
  }

  const fromDate = parseDate(HISTORY_FROM, "RAIN_HISTORY_FROM");
  const toDate = parseDate(HISTORY_TO, "RAIN_HISTORY_TO");

  if (fromDate > toDate) {
    throw new Error("RAIN_HISTORY_FROM must be before or equal to RAIN_HISTORY_TO.");
  }

  console.log(
    `Backfilling rainfall for ${BUILDING_ID} at ${LATITUDE},${LONGITUDE} from ${dateKey(
      fromDate
    )} to ${dateKey(toDate)}`
  );

  let cursor = new Date(fromDate);
  let totalFetched = 0;
  let totalInserted = 0;

  while (cursor <= toDate) {
    const chunkEnd = new Date(
      Math.min(addDays(cursor, HISTORY_CHUNK_DAYS - 1).getTime(), toDate.getTime())
    );
    const payload = await fetchOpenMeteoRain(cursor, chunkEnd);
    const rows = mapOpenMeteoRows(payload);
    const inserted = await insertMissingRows(rows);

    totalFetched += rows.length;
    totalInserted += inserted;
    console.log(
      `${dateKey(cursor)} to ${dateKey(chunkEnd)}: ${rows.length} row(s), ${inserted} inserted`
    );
    cursor = addDays(chunkEnd, 1);
  }

  console.log(
    `Rainfall backfill complete: ${totalFetched} row(s) fetched, ${totalInserted} inserted.`
  );
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
