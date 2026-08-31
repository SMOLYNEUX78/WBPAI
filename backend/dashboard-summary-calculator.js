const cron = require("node-cron");
const supabase = require("./supabaseClient");

const BUILDING_IDS = (process.env.DASHBOARD_SUMMARY_BUILDING_IDS || "home,museum")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const CRON_SCHEDULE = process.env.DASHBOARD_SUMMARY_CRON || "*/30 * * * *";
const ENERGY_LOOKBACK_DAYS = Number(process.env.DASHBOARD_SUMMARY_ENERGY_DAYS || 120);
const SENSOR_LOOKBACK_DAYS = Number(process.env.DASHBOARD_SUMMARY_SENSOR_DAYS || 35);
const RAIN_HUMIDITY_LOOKBACK_DAYS = Number(
  process.env.DASHBOARD_SUMMARY_RAIN_HUMIDITY_DAYS || 180
);
const MAX_ENERGY_ROWS = Number(process.env.DASHBOARD_SUMMARY_MAX_ENERGY_ROWS || 5000);
const MAX_SENSOR_ROWS = Number(process.env.DASHBOARD_SUMMARY_MAX_SENSOR_ROWS || 5000);
const MAX_RAIN_HUMIDITY_ROWS = Number(
  process.env.DASHBOARD_SUMMARY_MAX_RAIN_HUMIDITY_ROWS || 10000
);
const SUPABASE_PAGE_SIZE = Number(process.env.SUPABASE_PAGE_SIZE || 1000);

const average = (values) => {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  return finiteValues.length
    ? finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length
    : null;
};

const numericOrNull = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const isoDaysAgo = (days) =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

const dayKey = (timestamp) => {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

const bucketHour = (timestamp) => {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  date.setMinutes(0, 0, 0);
  return date.toISOString();
};

const normaliseRoomLabel = (readingType) =>
  String(readingType || "")
    .replace(/^dyson:/, "")
    .replace(/^thingsboard:/, "")
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");

const dysonAppDisplayValue = (readingType, metric, value) => {
  const number = numericOrNull(value);
  if (!String(readingType || "").startsWith("dyson:") || number === null) {
    return number;
  }
  if (metric === "vocs" && number <= 10) return 0;
  if (metric === "no2" && number <= 2) return 0;
  return number;
};

const pearsonCorrelation = (pairs) => {
  const validPairs = pairs.filter(
    (pair) => Number.isFinite(pair.x) && Number.isFinite(pair.y)
  );

  if (validPairs.length < 3) {
    return null;
  }

  const avgX = average(validPairs.map((pair) => pair.x));
  const avgY = average(validPairs.map((pair) => pair.y));
  const numerator = validPairs.reduce(
    (sum, pair) => sum + (pair.x - avgX) * (pair.y - avgY),
    0
  );
  const denominatorX = Math.sqrt(
    validPairs.reduce((sum, pair) => sum + (pair.x - avgX) ** 2, 0)
  );
  const denominatorY = Math.sqrt(
    validPairs.reduce((sum, pair) => sum + (pair.y - avgY) ** 2, 0)
  );

  if (!denominatorX || !denominatorY) {
    return null;
  }

  return numerator / (denominatorX * denominatorY);
};

async function fetchEnergyRows(buildingId) {
  const { data, error } = await supabase
    .from("EnergyReadings")
    .select("timestamp, created_at, fuel_type, reading_type, usage_kwh, power_kw, raw_payload")
    .eq("building_id", buildingId)
    .gte("timestamp", isoDaysAgo(ENERGY_LOOKBACK_DAYS))
    .order("timestamp", { ascending: false })
    .limit(MAX_ENERGY_ROWS);

  if (error) throw error;
  return data || [];
}

async function fetchSensorRows(buildingId) {
  const { data, error } = await supabase
    .from("Readings")
    .select(
      "timestamp, reading_type, temperature_inside, temperature_outside, humidity, co2, vocs, pm25, pm10, hcho, no2, rainfall_mm, rainfall_1h_mm, rainfall_3h_mm"
    )
    .eq("building_id", buildingId)
    .gte("timestamp", isoDaysAgo(SENSOR_LOOKBACK_DAYS))
    .order("timestamp", { ascending: false })
    .limit(MAX_SENSOR_ROWS);

  if (error) throw error;
  return data || [];
}

async function fetchPagedRows(buildQuery, maxRows) {
  const rows = [];
  const pageSize = Math.min(SUPABASE_PAGE_SIZE, maxRows);

  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const { data, error } = await buildQuery().range(offset, offset + pageSize - 1);
    if (error) throw error;

    const pageRows = data || [];
    rows.push(...pageRows);

    if (pageRows.length < pageSize) {
      break;
    }
  }

  return rows;
}

async function fetchRainHumidityRows(buildingId) {
  if (buildingId !== "home") {
    return { rainRows: [], humidityRows: [] };
  }

  const timestampFrom = isoDaysAgo(RAIN_HUMIDITY_LOOKBACK_DAYS);
  const [rainRows, downstairsHumidityRows, upstairsHumidityRows] = await Promise.all([
    fetchPagedRows(
      () =>
        supabase
          .from("Readings")
          .select("timestamp, rainfall_mm, rainfall_1h_mm, rainfall_3h_mm")
          .eq("building_id", buildingId)
          .not("rainfall_mm", "is", null)
          .gte("timestamp", timestampFrom)
          .order("timestamp", { ascending: false }),
      MAX_RAIN_HUMIDITY_ROWS
    ),
    fetchPagedRows(
      () =>
        supabase
          .from("Readings")
          .select("timestamp, reading_type, humidity")
          .eq("building_id", buildingId)
          .in("reading_type", ["dyson:living_room", "dyson:downstairs"])
          .not("humidity", "is", null)
          .gte("timestamp", timestampFrom)
          .order("timestamp", { ascending: false }),
      MAX_RAIN_HUMIDITY_ROWS
    ),
    fetchPagedRows(
      () =>
        supabase
          .from("Readings")
          .select("timestamp, reading_type, humidity")
          .eq("building_id", buildingId)
          .eq("reading_type", "dyson:upstairs")
          .not("humidity", "is", null)
          .gte("timestamp", timestampFrom)
          .order("timestamp", { ascending: false }),
      MAX_RAIN_HUMIDITY_ROWS
    ),
  ]);

  return {
    rainRows,
    humidityRows: [...downstairsHumidityRows, ...upstairsHumidityRows],
  };
}

function buildEnergySummary(energyRows) {
  const dailyRows = energyRows.filter(
    (row) => row.reading_type === "daily_total" && Number.isFinite(Number(row.usage_kwh))
  );
  const intervalRows = energyRows.filter(
    (row) => row.reading_type === "interval_30m" && Number.isFinite(Number(row.usage_kwh))
  );
  const intervalDays = new Set(
    intervalRows
      .map((row) => {
        const day = dayKey(row.timestamp);
        return day ? `${row.fuel_type}:${day}` : null;
      })
      .filter(Boolean)
  );
  const fuelDayTotals = new Map();

  dailyRows.forEach((row) => {
    const day = dayKey(row.timestamp);
    if (!day || intervalDays.has(`${row.fuel_type}:${day}`)) {
      return;
    }
    const key = `${row.fuel_type}:${day}`;
    const usage = Number(row.usage_kwh);
    fuelDayTotals.set(key, Math.max(fuelDayTotals.get(key) || 0, usage));
  });

  intervalRows.forEach((row) => {
    const day = dayKey(row.timestamp);
    if (!day) {
      return;
    }
    const key = `${row.fuel_type}:${day}`;
    fuelDayTotals.set(key, (fuelDayTotals.get(key) || 0) + Number(row.usage_kwh));
  });

  const byDay = {};
  for (const [key, usage] of fuelDayTotals.entries()) {
    const [fuelType, day] = key.split(":");
    byDay[day] = byDay[day] || {};
    byDay[day][fuelType] = usage;
  }

  const days = Object.keys(byDay).sort();
  const electricityValues = days
    .map((day) => byDay[day].electricity)
    .filter((value) => Number.isFinite(value));
  const gasValues = days
    .map((day) => byDay[day].gas)
    .filter((value) => Number.isFinite(value));
  const dayTotals = days
    .map((day) =>
      ["electricity", "gas"].reduce(
        (sum, fuelType) =>
          sum + (Number.isFinite(byDay[day][fuelType]) ? byDay[day][fuelType] : 0),
        0
      )
    )
    .filter((value) => Number.isFinite(value) && value > 0);
  const latestPower = energyRows.find(
    (row) => row.reading_type === "instant_power" && Number.isFinite(Number(row.power_kw))
  );
  const today = new Date().toISOString().slice(0, 10);

  return {
    electricityDailyAverage: average(electricityValues),
    electricityTodayKwh: byDay[today]?.electricity || 0,
    gasDailyAverage: average(gasValues),
    gasTodayKwh: byDay[today]?.gas || 0,
    totalDailyAverage: average(dayTotals),
    electricityPowerKw: latestPower ? Number(latestPower.power_kw) : 0,
    hasGasData: gasValues.length > 0 || energyRows.some((row) => row.fuel_type === "gas"),
    baselineMeteredDays: days.length,
    baselineStartDate: days[0] || null,
    baselineEndDate: days[days.length - 1] || null,
    summaryLookbackDays: ENERGY_LOOKBACK_DAYS,
  };
}

function buildSensorSummary(sensorRows) {
  const iaqRows = sensorRows.filter((row) =>
    [
      row.temperature_inside,
      row.humidity,
      row.co2,
      row.vocs,
      row.pm25,
      row.pm10,
      row.hcho,
      row.no2,
    ].some((value) => Number.isFinite(Number(value)))
  );
  const dysonRows = iaqRows.filter((row) =>
    String(row.reading_type || "").startsWith("dyson:")
  );
  const wholeHomeRow =
    dysonRows.find((row) => row.reading_type === "dyson:whole_home") || null;
  const latestIaqRow = wholeHomeRow || iaqRows[0] || null;
  const roomRows = dysonRows
    .filter((row) => row.reading_type !== "dyson:whole_home")
    .reduce((rooms, row) => {
      if (!row.reading_type || rooms.some((room) => room.key === row.reading_type)) {
        return rooms;
      }
      rooms.push({
        key: row.reading_type,
        label: normaliseRoomLabel(row.reading_type),
        internalTemp: numericOrNull(row.temperature_inside),
        humidity: numericOrNull(row.humidity),
        co2: numericOrNull(row.co2),
        vocs: dysonAppDisplayValue(row.reading_type, "vocs", row.vocs),
        pm25: numericOrNull(row.pm25),
        pm10: numericOrNull(row.pm10),
        hcho: numericOrNull(row.hcho),
        no2: dysonAppDisplayValue(row.reading_type, "no2", row.no2),
      });
      return rooms;
    }, [])
    .sort((a, b) => {
      const order = { Upstairs: 0, Downstairs: 1 };
      return (order[a.label] ?? 10) - (order[b.label] ?? 10);
    });
  const combinedFromRooms =
    !wholeHomeRow && roomRows.length > 0
      ? {
          temperature_inside: average(roomRows.map((row) => row.internalTemp)),
          humidity: average(roomRows.map((row) => row.humidity)),
          co2: average(roomRows.map((row) => row.co2)),
          vocs: average(roomRows.map((row) => row.vocs)),
          pm25: average(roomRows.map((row) => row.pm25)),
          pm10: average(roomRows.map((row) => row.pm10)),
          hcho: average(roomRows.map((row) => row.hcho)),
          no2: average(roomRows.map((row) => row.no2)),
        }
      : null;

  return {
    latestIaq: latestIaqRow
      ? {
          internalTemp: numericOrNull(
            combinedFromRooms?.temperature_inside ?? latestIaqRow.temperature_inside
          ),
          humidity: numericOrNull(combinedFromRooms?.humidity ?? latestIaqRow.humidity),
          co2: numericOrNull(combinedFromRooms?.co2 ?? latestIaqRow.co2),
          vocs:
            combinedFromRooms?.vocs ??
            dysonAppDisplayValue(latestIaqRow.reading_type, "vocs", latestIaqRow.vocs),
          pm25: numericOrNull(combinedFromRooms?.pm25 ?? latestIaqRow.pm25),
          pm10: numericOrNull(combinedFromRooms?.pm10 ?? latestIaqRow.pm10),
          hcho: numericOrNull(combinedFromRooms?.hcho ?? latestIaqRow.hcho),
          no2:
            combinedFromRooms?.no2 ??
            dysonAppDisplayValue(latestIaqRow.reading_type, "no2", latestIaqRow.no2),
        }
      : {},
    roomIaq: roomRows,
    latestIaqTimestamp: latestIaqRow?.timestamp || null,
    sampleCount: iaqRows.length,
    summaryLookbackDays: SENSOR_LOOKBACK_DAYS,
  };
}

function buildWeatherSummary(sensorRows) {
  const latestWeather = sensorRows.find((row) =>
    Number.isFinite(Number(row.temperature_outside))
  );
  const rainfallValues = sensorRows
    .map((row) => Number(row.rainfall_mm ?? row.rainfall_1h_mm ?? row.rainfall_3h_mm))
    .filter((value) => Number.isFinite(value));

  return {
    externalTemp: numericOrNull(latestWeather?.temperature_outside),
    latestWeatherTimestamp: latestWeather?.timestamp || null,
    maxRainfallMm: rainfallValues.length ? Math.max(...rainfallValues) : null,
    rainySamples: rainfallValues.filter((value) => value >= 0.1).length,
    sampleCount: rainfallValues.length,
  };
}

function buildRainHumidityAreaSummary({ rainByHour, humidityRows, windowDays }) {
  const humidityByHour = new Map();
  humidityRows.forEach((row) => {
    const bucket = bucketHour(row.timestamp);
    const humidity = Number(row.humidity);
    if (!bucket || !Number.isFinite(humidity)) {
      return;
    }
    const values = humidityByHour.get(bucket) || [];
    values.push(humidity);
    humidityByHour.set(bucket, values);
  });

  const rows = Array.from(humidityByHour.entries())
    .map(([bucket, values]) => {
      const bucketTime = new Date(bucket).getTime();
      const recentRainfall = [0, 1, 2, 3].reduce((sum, hoursAgo) => {
        const rainDate = new Date(bucketTime - hoursAgo * 60 * 60 * 1000);
        return sum + (rainByHour.get(rainDate.toISOString()) || 0);
      }, 0);

      return {
        rainfall: recentRainfall,
        humidity: average(values),
      };
    })
    .filter((row) => Number.isFinite(row.rainfall) && Number.isFinite(row.humidity));
  const rainyRows = rows.filter((row) => row.rainfall >= 0.1);
  const dryRows = rows.filter((row) => row.rainfall < 0.1);
  const averageRainyRh = average(rainyRows.map((row) => row.humidity));
  const averageDryRh = average(dryRows.map((row) => row.humidity));

  return {
    rainySamples: rainyRows.length,
    drySamples: dryRows.length,
    averageRainyRh,
    averageDryRh,
    rhUplift:
      Number.isFinite(averageRainyRh) && Number.isFinite(averageDryRh)
        ? averageRainyRh - averageDryRh
        : null,
    correlation: pearsonCorrelation(
      rows.map((row) => ({ x: row.rainfall, y: row.humidity }))
    ),
    maxRainfallMm: rows.length ? Math.max(...rows.map((row) => row.rainfall)) : null,
    windowDays,
    status:
      rainyRows.length >= 3 && dryRows.length >= 3
        ? "ready"
        : rainByHour.size > 0
        ? "collecting"
        : "pending-rainfall",
  };
}

function buildRainHumiditySummary({ sensorRows = [], rainRows, humidityRows, buildingId }) {
  if (buildingId !== "home") {
    return {};
  }

  const rainByHour = new Map();
  const rainSourceRows = Array.isArray(rainRows) ? rainRows : sensorRows;
  const humiditySourceRows = Array.isArray(humidityRows)
    ? humidityRows
    : sensorRows.filter((row) =>
        ["dyson:living_room", "dyson:downstairs", "dyson:upstairs"].includes(
          row.reading_type
        )
      );

  rainSourceRows.forEach((row) => {
    const bucket = bucketHour(row.timestamp);
    const rainfall = Number(row.rainfall_mm ?? row.rainfall_1h_mm ?? row.rainfall_3h_mm);
    if (!bucket || !Number.isFinite(rainfall)) {
      return;
    }
    rainByHour.set(bucket, (rainByHour.get(bucket) || 0) + Math.max(0, rainfall));
  });

  const downstairsSummary = buildRainHumidityAreaSummary({
    rainByHour,
    humidityRows: humiditySourceRows.filter((row) =>
      ["dyson:living_room", "dyson:downstairs"].includes(row.reading_type)
    ),
    windowDays: RAIN_HUMIDITY_LOOKBACK_DAYS,
  });
  const upstairsSummary = buildRainHumidityAreaSummary({
    rainByHour,
    humidityRows: humiditySourceRows.filter((row) => row.reading_type === "dyson:upstairs"),
    windowDays: RAIN_HUMIDITY_LOOKBACK_DAYS,
  });

  return {
    ...downstairsSummary,
    area: "downstairs",
    downstairs: downstairsSummary,
    upstairs: upstairsSummary,
    areas: {
      downstairs: downstairsSummary,
      upstairs: upstairsSummary,
    },
  };
}

async function upsertSummary(buildingId) {
  const [energyRows, sensorRows, rainHumidityRows] = await Promise.all([
    fetchEnergyRows(buildingId),
    fetchSensorRows(buildingId),
    fetchRainHumidityRows(buildingId),
  ]);
  const calculatedAt = new Date().toISOString();
  const energySummary = buildEnergySummary(energyRows);
  const iaqSummary = buildSensorSummary(sensorRows);
  const weatherSummary = buildWeatherSummary(sensorRows);
  const rainHumiditySummary = buildRainHumiditySummary({
    sensorRows,
    rainRows: rainHumidityRows.rainRows,
    humidityRows: rainHumidityRows.humidityRows,
    buildingId,
  });
  const snapshot = {
    building_id: buildingId,
    calculated_at: calculatedAt,
    updated_at: calculatedAt,
    source: "dashboard-summary-calculator",
    energy_summary: energySummary,
    iaq_summary: iaqSummary,
    weather_summary: weatherSummary,
    rain_humidity_summary: rainHumiditySummary,
    raw_payload: {
      energy_rows: energyRows.length,
      sensor_rows: sensorRows.length,
      rain_rows: rainHumidityRows.rainRows.length,
      rain_humidity_rows: rainHumidityRows.humidityRows.length,
      energy_lookback_days: ENERGY_LOOKBACK_DAYS,
      sensor_lookback_days: SENSOR_LOOKBACK_DAYS,
      rain_humidity_lookback_days: RAIN_HUMIDITY_LOOKBACK_DAYS,
    },
  };
  const today = calculatedAt.slice(0, 10);
  const dailySummary = {
    building_id: buildingId,
    summary_date: today,
    calculated_at: calculatedAt,
    updated_at: calculatedAt,
    source: "dashboard-summary-calculator",
    energy_summary: energySummary,
    iaq_summary: iaqSummary,
    weather_summary: weatherSummary,
    rain_humidity_summary: rainHumiditySummary,
    raw_payload: snapshot.raw_payload,
  };

  const latestResult = await supabase
    .from("BuildingLatestSnapshot")
    .upsert(snapshot, { onConflict: "building_id" });

  if (latestResult.error) {
    throw latestResult.error;
  }

  const dailyResult = await supabase
    .from("BuildingDailySummary")
    .upsert(dailySummary, { onConflict: "building_id,summary_date" });

  if (dailyResult.error) {
    throw dailyResult.error;
  }

  console.log(
    `[dashboard-summary] ${buildingId}: ${energyRows.length} energy row(s), ${sensorRows.length} sensor row(s), ${energySummary.baselineMeteredDays} metered day(s).`
  );
}

async function calculateDashboardSummaries() {
  for (const buildingId of BUILDING_IDS) {
    try {
      await upsertSummary(buildingId);
    } catch (error) {
      if (/BuildingLatestSnapshot|BuildingDailySummary|schema cache/i.test(error.message || "")) {
        console.warn(
          `[dashboard-summary] Table unavailable: dashboard snapshots will remain browser-cache/raw-query only until the summary tables are created. (${error.message})`
        );
        return;
      }

      console.error(`[dashboard-summary] ${buildingId} failed:`, error.message);
    }
  }
}

if (process.argv.includes("--schedule")) {
  console.log(
    `[dashboard-summary] Scheduling dashboard summaries for ${BUILDING_IDS.join(
      ", "
    )} with "${CRON_SCHEDULE}".`
  );
  calculateDashboardSummaries();
  cron.schedule(CRON_SCHEDULE, calculateDashboardSummaries);
} else {
  calculateDashboardSummaries().catch((error) => {
    console.error("[dashboard-summary] Calculation failed:", error.message);
    process.exit(1);
  });
}

module.exports = { calculateDashboardSummaries };
