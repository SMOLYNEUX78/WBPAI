const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeSensorSample, legacyReadingValues } = require("./sensor-normalization");

const base = { connector: "test", deviceId: "serial-1", observedAt: "2026-10-07T12:00:00Z" };

test("normalizes documented units while retaining source values", () => {
  const sample = normalizeSensorSample({ ...base, readings: [
    { metric: "temperature", value: 68, unit: "F" },
    { metric: "relative_humidity", value: 45, unit: "%" },
    { metric: "pm2_5", value: 0.012, unit: "mg/m3" },
  ] });
  assert.equal(sample.observedAt, "2026-10-07T12:00:00.000Z");
  assert.deepEqual(legacyReadingValues(sample), {
    temperature_inside: 20, humidity: 45, pm25: 12,
  });
  assert.deepEqual(sample.measurements[2], {
    metric: "pm2_5", value: 12, unit: "ug/m3", sourceValue: 0.012, sourceUnit: "mg/m3",
  });
});

test("preserves Dyson-style device-reported values without inventing units", () => {
  const sample = normalizeSensorSample({ ...base, readings: [
    { metric: "pm2_5_raw", value: "15", unit: "device_raw" },
    { metric: "tvoc_index", value: 4, unit: "device_index" },
    { metric: "no2_index", value: null, unit: "device_index" },
  ] });
  assert.deepEqual(legacyReadingValues(sample), { pm25: 15, vocs: 4 });
  assert.equal(sample.measurements[0].unit, "device_raw");
});

test("rejects guessed units, duplicate metrics and impossible humidity", () => {
  assert.throws(() => normalizeSensorSample({ ...base, readings: [
    { metric: "pm2_5", value: 5, unit: "device_raw" },
  ] }), /Unsupported sensor unit/);
  assert.throws(() => normalizeSensorSample({ ...base, readings: [
    { metric: "temperature", value: 20, unit: "C" },
    { metric: "temperature", value: 21, unit: "C" },
  ] }), /duplicate sensor metric/);
  assert.throws(() => normalizeSensorSample({ ...base, readings: [
    { metric: "relative_humidity", value: 120, unit: "%" },
  ] }), /Relative humidity/);
});
