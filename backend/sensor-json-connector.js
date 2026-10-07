const { METRICS, normalizeSensorSample } = require("./sensor-normalization");

function fieldAt(payload, path) {
  if (!/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/.test(path)) {
    throw new Error(`Invalid sensor field path: ${path}`);
  }
  return path.split(".").reduce((value, key) =>
    value && Object.hasOwn(value, key) ? value[key] : undefined, payload);
}

function decodeJsonSensorMessage({ connector, deviceId, payload, mapping, observedAt,
  expectedTopic, topic, identityField }) {
  if (!deviceId || !mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
    throw new Error("A bound device ID and metric mapping are required.");
  }
  if (expectedTopic && topic !== expectedTopic) throw new Error("Unexpected sensor topic.");
  const raw = Buffer.isBuffer(payload) ? payload.toString("utf8") : payload;
  if (typeof raw === "string" && Buffer.byteLength(raw) > 65536) {
    throw new Error("Sensor payload exceeds 64 KiB.");
  }
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Sensor payload must be a JSON object.");
  }
  if (identityField && fieldAt(data, identityField) !== deviceId) {
    throw new Error("Sensor payload identity does not match the bound device.");
  }
  const readings = Object.entries(mapping).flatMap(([metric, field]) => {
    if (!METRICS[metric] || !field || typeof field.path !== "string" ||
      typeof field.unit !== "string") {
      throw new Error(`Invalid mapping for ${metric}.`);
    }
    const value = fieldAt(data, field.path);
    return value === undefined || value === null ? [] : [{ metric, value, unit: field.unit }];
  });
  return normalizeSensorSample({ connector, deviceId, observedAt, readings });
}

module.exports = { decodeJsonSensorMessage };
