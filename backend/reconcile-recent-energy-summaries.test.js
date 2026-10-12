const test = require("node:test");
const assert = require("node:assert/strict");
const { reconcileRecentEnergySummaries } = require("./reconcile-recent-energy-summaries");

test("repairs recent completed energy totals without replacing other summary fields", async () => {
  const writes = [];
  const client = { from(table) {
    assert.equal(table, "BuildingDailySummary");
    return {
      select() { return this; },
      update(value) { writes.push(value); return this; },
      eq() { return this; },
      gte() { return this; },
      lt() { return Promise.resolve({ data: [
        { summary_date: "2026-10-11", energy_summary: {
          gasTodayKwh: 8.2, electricityTodayKwh: 5.8, baselineMeteredDays: 204,
        } },
      ], error: null }); },
      then(resolve) { resolve({ error: null }); },
    };
  } };
  const count = await reconcileRecentEnergySummaries(client, "home", [
    { saving_date: "2026-10-11", baseline_gas_kwh: 20.41862678, baseline_electricity_kwh: 5.86421667 },
  ], "2026-10-12", "2026-10-12T09:00:00Z");
  assert.equal(count, 1);
  assert.equal(writes[0].energy_summary.gasTodayKwh, 20.41862678);
  assert.equal(writes[0].energy_summary.electricityTodayKwh, 5.86421667);
  assert.equal(writes[0].energy_summary.baselineMeteredDays, 204);
  assert.equal(writes[0].updated_at, "2026-10-12T09:00:00Z");
});

test("leaves an unchanged completed day alone", async () => {
  let updated = false;
  const client = { from: () => ({
    select() { return this; }, eq() { return this; }, gte() { return this; },
    lt() { return Promise.resolve({ data: [{ summary_date: "2026-10-11", energy_summary: {
      gasTodayKwh: 20.4, electricityTodayKwh: 5.8,
    } }], error: null }); },
    update() { updated = true; return this; },
  }) };
  const count = await reconcileRecentEnergySummaries(client, "home", [
    { saving_date: "2026-10-11", baseline_gas_kwh: 20.4, baseline_electricity_kwh: 5.8 },
  ], "2026-10-12", "2026-10-12T09:00:00Z");
  assert.equal(count, 0);
  assert.equal(updated, false);
});
