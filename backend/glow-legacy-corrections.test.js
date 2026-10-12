const test = require("node:test");
const assert = require("node:assert/strict");
const { applyLegacyIntervalCorrections } = require("./glow-legacy-corrections");

test("sends a revised interval through the paired RPC", async () => {
  let called;
  const client = { async rpc(name, args) { called = { name, args }; return { data: 1, error: null }; } };
  const row = {
    building_id: "home", fuel_type: "gas", reading_type: "interval_30m",
    timestamp: "2026-10-11T22:30:00.000Z", topic: "gas-resource", usage_kwh: 11.409,
  };
  const token = "a".repeat(64);
  const count = await applyLegacyIntervalCorrections(client, [
    { row, previous: { usage_kwh: 0, raw_payload: { original: true } } },
  ], "glow-api:home-tablet", token);

  assert.equal(count, 1);
  assert.equal(called.name, "wbp_revise_legacy_energy_interval");
  assert.deepEqual(called.args, { p_token: token, p_sample: {
    observedAt: row.timestamp, fuelType: "gas", usageKwh: 11.409,
    topic: "gas-resource", source: "glow-api:home-tablet",
  } });
});

test("reports a correction that matched no legacy row", async () => {
  const client = { async rpc() { return { data: 0, error: null }; } };
  await assert.rejects(
    applyLegacyIntervalCorrections(client, [{
      row: { timestamp: "2026-10-11T22:30:00.000Z", usage_kwh: 1 },
      previous: { usage_kwh: 0, raw_payload: null },
    }], "glow-api:home-tablet", "a".repeat(64)),
    /No legacy Glow interval was updated/
  );
});
test("refuses an unpaired correction", async () => {
  await assert.rejects(applyLegacyIntervalCorrections({}, [{}], "glow-api:home-tablet", "bad"),
    /paired collector token/);
});
