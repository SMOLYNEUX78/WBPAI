const test = require("node:test");
const assert = require("node:assert/strict");
const { applyLegacyIntervalCorrections } = require("./glow-legacy-corrections");

test("revises only the matching legacy Glow interval and marks timing unverified", async () => {
  const filters = [];
  let patch;
  const query = {
    update(value) { patch = value; return this; },
    eq(key, value) { filters.push([key, value]); return this; },
    async select() { return { data: [{ id: 1 }], error: null }; },
  };
  const client = { from(table) { assert.equal(table, "EnergyReadings"); return query; } };
  const row = {
    building_id: "home", fuel_type: "gas", reading_type: "interval_30m",
    timestamp: "2026-10-11T22:30:00.000Z", topic: "gas-resource", usage_kwh: 11.409,
  };
  const count = await applyLegacyIntervalCorrections(client, [
    { row, previous: { usage_kwh: 0, raw_payload: { original: true } } },
  ], "glow-api:home-tablet");

  assert.equal(count, 1);
  assert.equal(patch.usage_kwh, 11.409);
  assert.equal(patch.raw_payload.original, true);
  assert.equal(patch.raw_payload.glow_revision.previous_usage_kwh, 0);
  assert.equal(patch.raw_payload.glow_revision.timing_unverified, true);
  assert.deepEqual(filters, [
    ["building_id", "home"], ["fuel_type", "gas"], ["reading_type", "interval_30m"],
    ["timestamp", row.timestamp], ["topic", "gas-resource"], ["source", "glow-api:home-tablet"],
  ]);
});

test("reports a correction that matched no legacy row", async () => {
  const query = { update() { return this; }, eq() { return this; }, async select() { return { data: [], error: null }; } };
  await assert.rejects(
    applyLegacyIntervalCorrections({ from: () => query }, [{
      row: { timestamp: "2026-10-11T22:30:00.000Z", usage_kwh: 1 },
      previous: { usage_kwh: 0, raw_payload: null },
    }], "glow-api:home-tablet"),
    /No legacy Glow interval was updated/
  );
});
