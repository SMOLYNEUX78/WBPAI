async function storeEnergySample(client, token, sample) {
  if (!/^[0-9a-f]{64}$/.test(token || "")) throw new Error("A paired tablet token is required.");
  if (!["electricity", "gas"].includes(sample?.fuelType) ||
      !["interval", "daily_total", "instant_power"].includes(sample?.readingType) ||
      !Number.isFinite(Date.parse(sample?.observedAt))) {
    throw new Error("A timestamped, normalised energy sample is required.");
  }
  const power = sample.readingType === "instant_power";
  const value = power ? sample.powerKw : sample.usageKwh;
  if (!Number.isFinite(value) || value < 0 ||
      (power ? sample.usageKwh != null : sample.powerKw != null)) {
    throw new Error("The sample must contain one non-negative energy value.");
  }
  const { data, error } = await client.rpc("wbp_store_energy_sample", {
    p_token: token,
    p_sample: {
      observedAt: sample.observedAt,
      fuelType: sample.fuelType,
      readingType: sample.readingType,
      ...(power ? { powerKw: value } : { usageKwh: value }),
    },
  });
  if (error || data !== true) throw error || new Error("Energy sample was not accepted for this tablet.");
  return true;
}

module.exports = { storeEnergySample };
