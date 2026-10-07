const { normalizeSensorSample, legacyReadingValues } = require("./sensor-normalization");

const serialPattern = /^[0-9a-f]{12}$/i;

function normaliseAirGradientSerial(value) {
  const serial = String(value || "").replace(/[^0-9a-f]/gi, "").toLowerCase();
  if (!serialPattern.test(serial)) throw new Error("AirGradient needs the 12-character serial printed on its label.");
  return serial;
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseAirGradientReading(payload, serial) {
  if (!payload || typeof payload !== "object" || String(payload.serialno || "").toLowerCase() !== serial) {
    throw new Error("The monitor's serial does not match the scanned label.");
  }
  const fields = [
    ["temperature", payload.atmpCompensated ?? payload.atmp, "C"],
    ["relative_humidity", payload.rhumCompensated ?? payload.rhum, "%"],
    ["pm2_5", payload.pm02Compensated ?? payload.pm02, "ug/m3"],
    ["pm10", payload.pm10, "ug/m3"],
    ["co2", payload.rco2, "ppm"],
    ["tvoc_index", payload.tvocIndex, "device_index"],
    ["nox_index", payload.noxIndex, "device_index"],
  ];
  const sample = normalizeSensorSample({
    connector: "airgradient-local", deviceId: serial, observedAt: new Date().toISOString(),
    readings: fields.map(([metric, value, unit]) => ({ metric, value: finite(value), unit })),
  });
  if (!sample.measurements.length) throw new Error("The monitor returned no usable measurements.");
  return {
    serial,
    model: String(payload.model || "").slice(0, 50),
    observedAt: sample.observedAt,
    measurements: legacyReadingValues(sample),
    co2: sample.measurements.find((item) => item.metric === "co2")?.value ?? null,
    nox: sample.measurements.find((item) => item.metric === "nox_index")?.value ?? null,
  };
}

async function probeAirGradient(serialInput, fetchImpl = fetch) {
  const serial = normaliseAirGradientSerial(serialInput);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetchImpl(`http://airgradient_${serial}.local/measures/current`, {
      signal: controller.signal, redirect: "error",
    });
    if (!response.ok) throw new Error(`Monitor returned HTTP ${response.status}.`);
    const body = await response.text();
    if (body.length > 32768) throw new Error("Monitor response was unexpectedly large.");
    return parseAirGradientReading(JSON.parse(body), serial);
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { normaliseAirGradientSerial, parseAirGradientReading, probeAirGradient };
