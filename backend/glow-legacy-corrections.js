async function applyLegacyIntervalCorrections(client, corrections, source) {
  let written = 0;
  for (const { row, previous } of corrections) {
    const originalPayload = previous.raw_payload;
    const rawPayload = originalPayload && typeof originalPayload === "object" && !Array.isArray(originalPayload)
      ? { ...originalPayload }
      : {};
    rawPayload.glow_revision = {
      previous_usage_kwh: previous.usage_kwh,
      revised_at: new Date().toISOString(),
      timing_unverified: true,
    };

    const { data, error } = await client.from("EnergyReadings")
      .update({ usage_kwh: row.usage_kwh, raw_payload: rawPayload })
      .eq("building_id", row.building_id)
      .eq("fuel_type", row.fuel_type)
      .eq("reading_type", "interval_30m")
      .eq("timestamp", row.timestamp)
      .eq("topic", row.topic)
      .eq("source", source)
      .select("id");
    if (error) throw error;
    if (!data?.length) throw new Error(`No legacy Glow interval was updated at ${row.timestamp}.`);
    written += data.length;
  }
  return written;
}

module.exports = { applyLegacyIntervalCorrections };
