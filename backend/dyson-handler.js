const mqtt = require("mqtt");
const supabase = require("./supabaseClient");
require("dotenv").config();

const BUILDING_ID = process.env.DYSON_BUILDING_ID || "home";
const DYSON_POLL_INTERVAL_MS = Number(
  process.env.DYSON_POLL_INTERVAL_MS || 60000
);
const DYSON_SAVE_INTERVAL_MS = Number(
  process.env.DYSON_SAVE_INTERVAL_MS || 60000
);
const DYSON_DEVICES = parseDevices(process.env.DYSON_DEVICES || "");

const latestByDevice = new Map();
let lastSavedAt = 0;

function parseDevices(value) {
  if (!value.trim()) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, host, productCode, serial, password] = entry
        .split(":")
        .map((part) => part.trim());

      return { name, host, productCode, serial, password };
    })
    .filter(
      (device) =>
        device.name &&
        device.host &&
        device.productCode &&
        device.serial &&
        device.password
    );
}

function numberFromDyson(value) {
  if (value === undefined || value === null || value === "OFF" || value === "INIT") {
    return null;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function celsiusFromKelvinTimesTen(value) {
  const numericValue = numberFromDyson(value);
  return Number.isFinite(numericValue) ? numericValue / 10 - 273.15 : null;
}

function firstFinite(...values) {
  for (const value of values) {
    const numericValue = numberFromDyson(value);

    if (Number.isFinite(numericValue)) {
      return numericValue;
    }
  }

  return null;
}

function average(values) {
  const finiteValues = values.filter((value) => Number.isFinite(value));

  if (finiteValues.length === 0) {
    return null;
  }

  return finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length;
}

function slug(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function mapEnvironmentalData(data) {
  return {
    temperature_inside: celsiusFromKelvinTimesTen(data.tact || data.temperature),
    humidity: firstFinite(data.hact, data.humidity),
    // Dyson local payloads vary by model/firmware. Keep these deliberately broad.
    pm25: firstFinite(data.pm25, data.pm2_5, data.p25r, data.pact),
    pm10: firstFinite(data.pm10, data.p10r),
    vocs: firstFinite(data.vact, data.va10, data.tvoc, data.voc),
    hcho: firstFinite(data.hcho, data.hchr),
  };
}

function requestCurrentState(client, device) {
  const topic = `${device.productCode}/${device.serial}/command`;
  const payload = {
    msg: "REQUEST-CURRENT-STATE",
    time: new Date().toISOString(),
  };

  client.publish(topic, JSON.stringify(payload));
}

function connectDevice(device) {
  const client = mqtt.connect(`mqtt://${device.host}:1883`, {
    username: device.serial,
    password: device.password,
    protocolVersion: 4,
    reconnectPeriod: 10000,
    connectTimeout: 15000,
  });

  const statusTopic = `${device.productCode}/${device.serial}/status/current`;

  client.on("connect", () => {
    console.log(`[dyson] Connected to ${device.name} at ${device.host}`);
    client.subscribe(statusTopic, (error) => {
      if (error) {
        console.error(`[dyson] Subscribe failed for ${device.name}:`, error.message);
        return;
      }

      requestCurrentState(client, device);
    });
  });

  client.on("message", (topic, message) => {
    try {
      const payload = JSON.parse(message.toString());

      if (payload.msg !== "ENVIRONMENTAL-CURRENT-SENSOR-DATA" || !payload.data) {
        return;
      }

      const mappedValues = mapEnvironmentalData(payload.data);
      latestByDevice.set(device.name, {
        ...mappedValues,
        device: device.name,
        timestamp: payload.time || new Date().toISOString(),
        raw: payload.data,
      });

      console.log(`[dyson] Updated ${device.name}:`, mappedValues);
    } catch (error) {
      console.error(`[dyson] Parse error for ${device.name}:`, error.message);
    }
  });

  client.on("error", (error) => {
    console.error(`[dyson] MQTT error for ${device.name}:`, error.message);
  });

  setInterval(() => {
    if (client.connected) {
      requestCurrentState(client, device);
    }
  }, DYSON_POLL_INTERVAL_MS);
}

function buildReadingRow(values, readingType) {
  return {
    building_id: BUILDING_ID,
    temperature_inside: average(values.map((value) => value.temperature_inside)),
    humidity: average(values.map((value) => value.humidity)),
    vocs: average(values.map((value) => value.vocs)),
    pm25: average(values.map((value) => value.pm25)),
    timestamp: new Date().toISOString(),
    reading_type: readingType,
  };
}

function hasAnyReadingValue(row) {
  return [
    row.temperature_inside,
    row.humidity,
    row.vocs,
    row.pm25,
  ].some((value) => Number.isFinite(value));
}

async function persistReadings() {
  const values = [...latestByDevice.values()];

  if (values.length === 0) {
    console.log("[dyson] No purifier telemetry yet; skipping insert");
    return;
  }

  const latestTimestamp = Math.max(
    ...values.map((value) => new Date(value.timestamp).getTime()).filter(Number.isFinite)
  );

  if (latestTimestamp <= lastSavedAt) {
    console.log("[dyson] No new purifier telemetry since last insert; skipping");
    return;
  }

  const rows = [
    buildReadingRow(values, "dyson:whole_home"),
    ...values.map((value) =>
      buildReadingRow([value], `dyson:${slug(value.device)}`)
    ),
  ].filter(hasAnyReadingValue);

  if (rows.length === 0) {
    console.log("[dyson] Purifier telemetry had no mapped IAQ values; skipping");
    return;
  }

  const { error } = await supabase.from("Readings").insert(rows);

  if (error) {
    console.error("[dyson] Supabase insert error:", error.message);
    return;
  }

  lastSavedAt = latestTimestamp;
  console.log(
    `[dyson] Inserted ${rows.length} purifier telemetry row(s) for ${BUILDING_ID}`
  );
}

if (DYSON_DEVICES.length === 0) {
  console.error(
    "Dyson collector is not configured. Set DYSON_DEVICES=name:ip:productCode:serial:password"
  );
  process.exit(1);
}

console.log(
  `[dyson] Starting Dyson collector for ${BUILDING_ID} with ${DYSON_DEVICES.length} device(s)`
);

DYSON_DEVICES.forEach(connectDevice);
setInterval(persistReadings, DYSON_SAVE_INTERVAL_MS);
