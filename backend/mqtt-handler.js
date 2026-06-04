// mqtt-handler.js

const mqtt = require('mqtt');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const BUILDING_ID = process.env.BUILDING_ID || "";
const MQTT_URL = process.env.MQTT_URL || "mqtt://localhost";
const MQTT_TOPIC = process.env.MQTT_TOPIC || "glow/#";
const MQTT_TOPIC_BUILDING_MAP = process.env.MQTT_TOPIC_BUILDING_MAP || "";
const MQTT_USERNAME = process.env.MQTT_USERNAME || process.env.BRIGHT_USERNAME;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || process.env.BRIGHT_PASSWORD;
const GLOW_RAW_ENERGY_DIVISOR = Number(process.env.GLOW_RAW_ENERGY_DIVISOR || 1000);
const COLLECTOR_INSTANCE = process.env.COLLECTOR_INSTANCE || "unknown";
const SOURCE_NAME = `mqtt:${COLLECTOR_INSTANCE}`;
const topicBuildingMap = parseTopicBuildingMap(MQTT_TOPIC_BUILDING_MAP);
const mqttTopics = MQTT_TOPIC.split(",")
  .map((topic) => topic.trim())
  .filter(Boolean);

console.log(
  `Starting MQTT collector (${COLLECTOR_INSTANCE}) for ${BUILDING_ID || "unscoped building"} on ${MQTT_URL}`
);

const withBuildingId = (topic, payload) => {
  const buildingId = getBuildingIdForTopic(topic);

  if (!buildingId) {
    return payload;
  }

  return {
    ...payload,
    building_id: buildingId,
  };
};

function parseTopicBuildingMap(value) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((map, entry) => {
      const separatorIndex = entry.indexOf("=");

      if (separatorIndex === -1) {
        console.warn(`Ignoring invalid MQTT_TOPIC_BUILDING_MAP entry: ${entry}`);
        return map;
      }

      const topic = entry.slice(0, separatorIndex).trim();
      const buildingId = entry.slice(separatorIndex + 1).trim();

      if (topic && buildingId) {
        map[topic] = buildingId;
      }

      return map;
    }, {});
}

function getBuildingIdForTopic(topic) {
  return topicBuildingMap[topic] || BUILDING_ID;
}

const mqttOptions = {
  clientId: `wbpai_${BUILDING_ID || "collector"}_${Math.random()
    .toString(16)
    .slice(2)}`,
  protocolVersion: Number(process.env.MQTT_PROTOCOL_VERSION || 4),
  keepalive: 60,
  clean: true,
};

if (MQTT_USERNAME && MQTT_PASSWORD) {
  mqttOptions.username = MQTT_USERNAME;
  mqttOptions.password = MQTT_PASSWORD;
}

const parsePowerValue = (payload) => {
  const nestedPower = payload?.electricitymeter?.power?.value;

  if (nestedPower !== undefined && nestedPower !== null) {
    return Number(nestedPower);
  }

  const glowInstantPower = payload?.elecMtr?.["0702"]?.["04"]?.["00"];

  if (glowInstantPower !== undefined && glowInstantPower !== null) {
    const parsed = parseSignedHex(glowInstantPower);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  if (Array.isArray(payload?.data) && payload.data.length > 0) {
    return Number(payload.data[0]);
  }

  if (payload?.power !== undefined && payload.power !== null) {
    return Number(payload.power);
  }

  return null;
};

const getNestedValue = (payload, path) =>
  path.reduce((value, key) => value?.[key], payload);

const parseNumericValue = (value, { hex = false, signed = false, divisor = 1 } = {}) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value === "number") {
    return value / divisor;
  }

  const stringValue = String(value).trim();
  const parsed =
    hex || (/^[0-9a-f]+$/i.test(stringValue) && /[a-f]/i.test(stringValue))
      ? signed
        ? parseSignedHex(stringValue)
        : parseInt(stringValue, 16)
      : Number(stringValue);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed / divisor;
};

const pickFirstNumeric = (payload, candidates, options) => {
  for (const path of candidates) {
    const value = parseNumericValue(getNestedValue(payload, path), options);

    if (Number.isFinite(value)) {
      return value;
    }
  }

  return null;
};

const buildEnergyReadings = ({ topic, timestamp, payload }) => {
  const baseReading = withBuildingId(topic, {
    timestamp,
    source: SOURCE_NAME,
    topic,
    raw_payload: payload,
  });

  const readings = [];
  const electricityPowerKw = pickFirstNumeric(
    payload,
    [
      ["electricitymeter", "power", "value"],
      ["electricitymeter", "energy", "import", "power"],
      ["power"],
    ],
    { signed: true, divisor: 1000 }
  );
  const rawGlowElectricityPowerKw = pickFirstNumeric(
    payload,
    [["elecMtr", "0702", "04", "00"]],
    { hex: true, signed: true, divisor: 1000 }
  );
  const normalizedElectricityPowerKw =
    electricityPowerKw ?? rawGlowElectricityPowerKw;

  if (Number.isFinite(normalizedElectricityPowerKw)) {
    readings.push({
      ...baseReading,
      fuel_type: "electricity",
      reading_type: "instant_power",
      power_kw: normalizedElectricityPowerKw,
      usage_kwh: null,
    });
  }

  const electricityDailyKwh = pickFirstNumeric(
    payload,
    [
      ["electricitymeter", "energy", "import", "day"],
      ["electricitymeter", "energy", "import", "today"],
    ],
    { divisor: GLOW_RAW_ENERGY_DIVISOR }
  );
  const rawGlowElectricityDailyKwh = pickFirstNumeric(
    payload,
    [["elecMtr", "0702", "04", "01"]],
    { hex: true, divisor: GLOW_RAW_ENERGY_DIVISOR }
  );
  const normalizedElectricityDailyKwh =
    electricityDailyKwh ?? rawGlowElectricityDailyKwh;

  if (Number.isFinite(normalizedElectricityDailyKwh)) {
    readings.push({
      ...baseReading,
      fuel_type: "electricity",
      reading_type: "daily_total",
      usage_kwh: normalizedElectricityDailyKwh,
      power_kw: null,
    });
  }

  const gasDailyKwh = pickFirstNumeric(
    payload,
    [
      ["gasmeter", "energy", "import", "day"],
      ["gasmeter", "energy", "import", "today"],
    ],
    { divisor: GLOW_RAW_ENERGY_DIVISOR }
  );
  const rawGlowGasDailyKwh = pickFirstNumeric(
    payload,
    [["gasMtr", "0702", "0C", "01"]],
    { hex: true, divisor: GLOW_RAW_ENERGY_DIVISOR }
  );
  const normalizedGasDailyKwh = gasDailyKwh ?? rawGlowGasDailyKwh;

  if (Number.isFinite(normalizedGasDailyKwh)) {
    readings.push({
      ...baseReading,
      fuel_type: "gas",
      reading_type: "daily_total",
      usage_kwh: normalizedGasDailyKwh,
      power_kw: null,
    });
  }

  return readings;
};

const parseSignedHex = (value) => {
  const hex = String(value).replace(/^0x/i, "");
  const parsed = parseInt(hex, 16);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  const bits = hex.length * 4;
  const signBoundary = 2 ** (bits - 1);
  const fullRange = 2 ** bits;

  return parsed >= signBoundary ? parsed - fullRange : parsed;
};

const client = mqtt.connect(MQTT_URL, mqttOptions);

client.on('connect', () => {
  console.log(`[${new Date().toISOString()}] Connected to MQTT broker: ${MQTT_URL}`);
  client.subscribe(mqttTopics, (err, granted) => {
    if (err) {
      console.error('Subscription error:', err);
    } else {
      const subscribedTopics = (granted || mqttTopics)
        .map((entry) => entry.topic || entry)
        .join(", ");
      console.log(`Subscribed to ${subscribedTopics}`);
    }
  });
});

client.on('message', async (topic, message) => {
  const timestamp = new Date().toISOString();
  console.debug(`[${timestamp}] Received topic: ${topic}`);

  let payload;
  try {
    payload = JSON.parse(message.toString());
  } catch (err) {
    console.error(`[${timestamp}] Failed to parse message:`, message.toString());
    return;
  }

  const powerValue = parsePowerValue(payload);
  const energyReadings = buildEnergyReadings({ topic, timestamp, payload });

  if (energyReadings.length > 0) {
    const { error } = await supabase
      .from('EnergyReadings')
      .insert(energyReadings);

    if (error) {
      console.error(`[${timestamp}] EnergyReadings insert error:`, error.message);
    } else {
      console.log(`[${timestamp}] Logged ${energyReadings.length} energy reading(s) to Supabase`);
    }
  }

  if (typeof powerValue === 'number' && !Number.isNaN(powerValue)) {
    const kWh = powerValue / 1000;
    const reading = withBuildingId(topic, {
      timestamp,
      energy_usage: kWh,
      electricity_usage: kWh,
      fuel_type: "electricity",
      reading_type: "instant_power",
    });
    const { data, error } = await supabase
      .from('Readings')
      .insert([reading]);

    if (error) {
      console.error(`[${timestamp}] ❌ Supabase insert error:`, error.message);
    } else {
      console.log(`[${timestamp}] ✅ Logged ${kWh} kWh to Supabase`);
    }
  } else {
    console.warn(`[${timestamp}] ⚠️ power value missing or invalid`);
  }
});

client.on('error', (err) => {
  console.error('❌ MQTT client error:', err);
});

client.on('offline', () => {
  console.warn('⚠️ MQTT client went offline');
});

client.on('reconnect', () => {
  console.log('🔄 Reconnecting to MQTT broker...');
});

