async function reconcileRecentEnergySummaries(client, buildingId, carbonRows, today, updatedAt) {
  const since = new Date(`${today}T00:00:00.000Z`);
  since.setUTCDate(since.getUTCDate() - 2);
  const { data, error } = await client.from("BuildingDailySummary")
    .select("summary_date,energy_summary")
    .eq("building_id", buildingId)
    .gte("summary_date", since.toISOString().slice(0, 10))
    .lt("summary_date", today);
  if (error) throw error;

  const carbonByDay = new Map(carbonRows.map((row) => [row.saving_date, row]));
  let repaired = 0;
  for (const summary of data || []) {
    const carbon = carbonByDay.get(summary.summary_date);
    if (!carbon) continue;
    const electricity = Number(carbon.baseline_electricity_kwh);
    const gas = Number(carbon.baseline_gas_kwh);
    if (!Number.isFinite(electricity) || !Number.isFinite(gas)) continue;
    const prior = summary.energy_summary || {};
    if (Math.abs(Number(prior.electricityTodayKwh) - electricity) < 0.000001 &&
        Math.abs(Number(prior.gasTodayKwh) - gas) < 0.000001) continue;

    const result = await client.from("BuildingDailySummary")
      .update({
        energy_summary: { ...prior, electricityTodayKwh: electricity, gasTodayKwh: gas },
        updated_at: updatedAt,
      })
      .eq("building_id", buildingId)
      .eq("summary_date", summary.summary_date);
    if (result.error) throw result.error;
    repaired += 1;
  }
  return repaired;
}

module.exports = { reconcileRecentEnergySummaries };
