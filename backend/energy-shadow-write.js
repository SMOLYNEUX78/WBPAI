const { storeEnergySample } = require("./energy-write");

function createEnergyShadowWriter(client, { token, legacyBuildingId, buildingRecordId } = {}) {
  if (!legacyBuildingId) return null;
  if (!/^[0-9a-f]{64}$/.test(token || "")) {
    throw new Error("WBP_ENERGY_SHADOW_BUILDING_ID requires a paired WBP_SCAN_DEVICE_TOKEN.");
  }
  if (!/^[0-9a-f-]{36}$/i.test(buildingRecordId || "")) {
    throw new Error("WBP_ENERGY_SHADOW_RECORD_ID must be the paired building UUID.");
  }

  let verified = false;

  return async (rows) => {
    const now = Date.now();
    const scopedRows = rows.filter((row) => {
      const observedAt = Date.parse(row.timestamp);
      return row.building_id === legacyBuildingId && Number.isFinite(observedAt) &&
        observedAt >= now - 48 * 60 * 60 * 1000 && observedAt <= now + 5 * 60 * 1000;
    });
    if (!scopedRows.length) return 0;
    if (!verified) {
      const { data, error } = await client.rpc("wbp_collector_building_record_id", { p_token: token });
      if (error || String(data).toLowerCase() !== buildingRecordId.toLowerCase()) {
        throw error || new Error("Paired tablet belongs to a different building record.");
      }
      verified = true;
    }
    let written = 0;
    for (const row of scopedRows) {
      const readingType = row.reading_type === "interval_30m" ? "interval" : row.reading_type;
      if (!["interval", "daily_total", "instant_power"].includes(readingType)) continue;
      await storeEnergySample(client, token, {
        observedAt: row.timestamp,
        fuelType: row.fuel_type,
        readingType,
        ...(readingType === "instant_power"
          ? { powerKw: Number(row.power_kw) }
          : { usageKwh: Number(row.usage_kwh) }),
      });
      written += 1;
    }
    return written;
  };
}

module.exports = { createEnergyShadowWriter };
