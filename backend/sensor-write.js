const { METRICS } = require("./sensor-normalization");

async function storeSensorSample(client, token, connectionId, sample) {
  if (!connectionId || !sample?.connector || !sample?.deviceId || !sample?.observedAt ||
    !Array.isArray(sample.measurements) || !sample.measurements.length) {
    throw new Error("A bound connection and normalised sensor sample are required.");
  }
  const measurements = sample.measurements.map(({ metric, value, unit }) => {
    if (!METRICS[metric] || METRICS[metric].unit !== unit || !Number.isFinite(value)) {
      throw new Error(`Invalid normalised sensor measurement: ${metric}.`);
    }
    return { metric, value, unit };
  });
  const { data, error } = await client.rpc("wbp_store_sensor_sample", {
    p_token: token,
    p_connection_id: connectionId,
    p_sample: {
      connector: sample.connector,
      deviceId: sample.deviceId,
      observedAt: sample.observedAt,
      measurements,
    },
  });
  if (error || !data) throw error || new Error("Sensor sample was not accepted for this connection.");
  return true;
}

module.exports = { storeSensorSample };
