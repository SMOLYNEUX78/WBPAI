const test = require("node:test");
const assert = require("node:assert/strict");
const { createEnergyShadowWriter } = require("./energy-shadow-write");

const token = "a".repeat(64);
const buildingRecordId = "11111111-1111-4111-8111-111111111111";
const gas = { building_id: "home", timestamp: new Date().toISOString(), fuel_type: "gas", reading_type: "interval_30m", usage_kwh: 1.2 };

test("shadow writer is disabled until explicitly scoped", () => {
  assert.equal(createEnergyShadowWriter({}, { token }), null);
  assert.throws(() => createEnergyShadowWriter({}, { legacyBuildingId: "home" }), /paired/);
  assert.throws(() => createEnergyShadowWriter({}, { token, legacyBuildingId: "home" }), /UUID/);
});

test("writes only rows for the selected legacy building and strips its ID", async () => {
  const calls = [];
  const client = { rpc: async (...args) => { calls.push(args); return { data: args[0] === "wbp_collector_building_record_id" ? buildingRecordId : true, error: null }; } };
  const write = createEnergyShadowWriter(client, { token, legacyBuildingId: "home", buildingRecordId });
  assert.equal(await write([gas, { ...gas, building_id: "museum" }]), 1);
  assert.deepEqual(calls, [["wbp_collector_building_record_id", { p_token: token }], ["wbp_store_energy_sample", {
    p_token: token,
    p_sample: { observedAt: gas.timestamp, fuelType: "gas", readingType: "interval", usageKwh: 1.2 },
  }]]);
});

test("refuses to mirror to a different paired building", async () => {
  const client = { rpc: async () => ({ data: "22222222-2222-4222-8222-222222222222", error: null }) };
  const write = createEnergyShadowWriter(client, { token, legacyBuildingId: "home", buildingRecordId });
  await assert.rejects(write([gas]), /different building/);
});

test("skips historical catch-up rows without touching the paired record", async () => {
  const client = { rpc: async () => { throw new Error("RPC should not run"); } };
  const write = createEnergyShadowWriter(client, { token, legacyBuildingId: "home", buildingRecordId });
  assert.equal(await write([{ ...gas, timestamp: "2020-01-01T00:00:00Z" }]), 0);
});
