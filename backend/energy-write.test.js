const test = require("node:test");
const assert = require("node:assert/strict");
const { storeEnergySample } = require("./energy-write");

const token = "a".repeat(64);
const sample = { observedAt: "2026-10-11T19:00:00Z", fuelType: "gas", readingType: "interval", usageKwh: 1.2 };

test("writes only normalised sample fields through the paired-token RPC", async () => {
  let call;
  const client = { rpc: async (...args) => { call = args; return { data: true, error: null }; } };
  assert.equal(await storeEnergySample(client, token, { ...sample, buildingId: "other", rawPayload: { secret: 1 } }), true);
  assert.deepEqual(call, ["wbp_store_energy_sample", { p_token: token, p_sample: sample }]);
});

test("rejects invalid values before calling Supabase", async () => {
  const client = { rpc: async () => { throw new Error("RPC should not run"); } };
  await assert.rejects(storeEnergySample(client, token, { ...sample, usageKwh: -1 }), /non-negative/);
  await assert.rejects(storeEnergySample(client, "bad", sample), /paired tablet token/);
});

test("rejects a token the database does not accept", async () => {
  const client = { rpc: async () => ({ data: false, error: null }) };
  await assert.rejects(storeEnergySample(client, token, sample), /not accepted/);
});
