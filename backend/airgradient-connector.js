const { decodeJsonSensorMessage } = require("./sensor-json-connector");

// AirGradient ONE MQTT and /measures/current share these documented fields.
const mapping = Object.freeze({
  temperature: { path: "atmp", unit: "C" },
  relative_humidity: { path: "rhum", unit: "%" },
  pm2_5: { path: "pm02", unit: "ug/m3" },
  pm10: { path: "pm10", unit: "ug/m3" },
  co2: { path: "rco2", unit: "ppm" },
  tvoc_index: { path: "tvocIndex", unit: "device_index" },
  nox_index: { path: "noxIndex", unit: "device_index" },
});

function decodeAirGradientOne({ serial, payload, receivedAt, topic }) {
  if (!/^[a-f0-9]{12}$/i.test(serial || "")) {
    throw new Error("AirGradient serial must be a 12-character hex ID.");
  }
  return decodeJsonSensorMessage({
    connector: "airgradient-one", deviceId: serial.toLowerCase(), payload, mapping,
    observedAt: receivedAt, identityField: "serialno",
    expectedTopic: topic === undefined ? undefined : `airgradient/readings/${serial.toLowerCase()}`,
    topic,
  });
}

module.exports = { decodeAirGradientOne, mapping };
