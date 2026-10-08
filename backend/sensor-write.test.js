const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeSensorSample } = require("./sensor-normalization");
const { storeSensorSample } = require("./sensor-write");

test("sends a normalised sample through the shared collector RPC", async () => {
  let call;
  const client = { rpc: async (...args) => { call = args; return { data: true, error: null }; } };
  const sample = normalizeSensorSample({ connector: "test-json", deviceId: "unit-1",
    observedAt: "2026-10-08T10:00:00Z", readings: [
      { metric: "temperature", value: 68, unit: "F" },
      { metric: "relative_humidity", value: 48, unit: "%" },
    ] });
  await storeSensorSample(client, "tablet-token", "connection-id", sample);
  assert.equal(call[0], "wbp_store_sensor_sample");
  assert.deepEqual(call[1].p_sample.measurements, [
    { metric: "temperature", value: 20, unit: "C" },
    { metric: "relative_humidity", value: 48, unit: "%" },
  ]);
  assert.equal(call[1].p_sample.deviceId, "unit-1");
});

test("rejects unnormalised values and rejected connections", async () => {
  const client = { rpc: async () => ({ data: false, error: null }) };
  await assert.rejects(storeSensorSample(client, "token", "connection", {
    connector: "test", deviceId: "unit", observedAt: new Date().toISOString(),
    measurements: [{ metric: "temperature", value: 68, unit: "F" }],
  }), /Invalid normalised/);
  await assert.rejects(storeSensorSample(client, "token", "connection", {
    connector: "test", deviceId: "unit", observedAt: new Date().toISOString(),
    measurements: [{ metric: "temperature", value: 20, unit: "C" }],
  }), /not accepted/);
});
