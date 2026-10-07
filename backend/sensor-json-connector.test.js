const test = require("node:test");
const assert = require("node:assert/strict");
const { decodeJsonSensorMessage } = require("./sensor-json-connector");
const { decodeAirGradientOne } = require("./airgradient-connector");

const receivedAt = "2026-10-07T12:00:00Z";

test("maps nested JSON with explicit units and a bound source", () => {
  const sample = decodeJsonSensorMessage({
    connector: "generic-mqtt-json", deviceId: "sensor-1", topic: "house/sensor-1",
    expectedTopic: "house/sensor-1", identityField: "device.id", receivedAt,
    observedAt: receivedAt,
    payload: JSON.stringify({ device: { id: "sensor-1" }, readings: { tempF: 68, rh: 45 } }),
    mapping: {
      temperature: { path: "readings.tempF", unit: "F" },
      relative_humidity: { path: "readings.rh", unit: "%" },
      co2: { path: "readings.co2", unit: "ppm" },
    },
  });
  assert.deepEqual(sample.measurements.map(({ metric, value }) => [metric, value]), [
    ["temperature", 20], ["relative_humidity", 45],
  ]);
  assert.equal(sample.deviceId, "sensor-1");
});

test("rejects another device, topic, executable path or oversized payload", () => {
  const base = { connector: "generic", deviceId: "sensor-1", observedAt: receivedAt,
    identityField: "id", payload: { id: "sensor-2", temp: 20 },
    mapping: { temperature: { path: "temp", unit: "C" } } };
  assert.throws(() => decodeJsonSensorMessage(base), /identity/);
  assert.throws(() => decodeJsonSensorMessage({ ...base, identityField: undefined,
    topic: "wrong", expectedTopic: "house/sensor-1" }), /topic/);
  assert.throws(() => decodeJsonSensorMessage({ ...base, identityField: undefined,
    mapping: { temperature: { path: "temp[0]", unit: "C" } } }), /field path/);
  assert.throws(() => decodeJsonSensorMessage({ ...base, identityField: undefined,
    payload: "x".repeat(65537) }), /64 KiB/);
});

test("AirGradient preset preserves VOC and NOx as indices", () => {
  const sample = decodeAirGradientOne({ serial: "34b7daa16674", receivedAt,
    topic: "airgradient/readings/34b7daa16674",
    payload: { serialno: "34b7daa16674", atmp: 26.61, rhum: 42.91,
      pm02: 8, pm10: 10, rco2: 397.33, tvocIndex: 98.83, noxIndex: 1 } });
  assert.equal(sample.measurements.length, 7);
  assert.deepEqual(sample.measurements.find(({ metric }) => metric === "pm2_5"),
    { metric: "pm2_5", value: 8, unit: "ug/m3", sourceValue: 8, sourceUnit: "ug/m3" });
  assert.equal(sample.measurements.find(({ metric }) => metric === "tvoc_index").unit,
    "device_index");
  assert.throws(() => decodeAirGradientOne({ serial: "34b7daa16674", receivedAt,
    payload: { serialno: "other", atmp: 20 } }), /identity/);
});
