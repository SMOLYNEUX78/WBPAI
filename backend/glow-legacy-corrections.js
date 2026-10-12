async function applyLegacyIntervalCorrections(client, corrections, source, token) {
  if (!/^[0-9a-f]{64}$/.test(token || "")) {
    throw new Error("A paired collector token is required to revise legacy energy intervals.");
  }
  let written = 0;
  for (const { row } of corrections) {
    const { data, error } = await client.rpc("wbp_revise_legacy_energy_interval", {
      p_token: token,
      p_sample: {
        observedAt: row.timestamp,
        fuelType: row.fuel_type,
        usageKwh: row.usage_kwh,
        topic: row.topic,
        source,
      },
    });
    if (error) throw error;
    if (data !== 1) throw new Error(`No legacy Glow interval was updated at ${row.timestamp}.`);
    written += data;
  }
  return written;
}

module.exports = { applyLegacyIntervalCorrections };
