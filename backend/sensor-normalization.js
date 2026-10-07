const METRICS = Object.freeze({
  temperature: { unit: "C", legacyColumn: "temperature_inside" },
  relative_humidity: { unit: "%", legacyColumn: "humidity" },
  pm2_5: { unit: "ug/m3", legacyColumn: "pm25" },
  pm10: { unit: "ug/m3", legacyColumn: "pm10" },
  pm2_5_raw: { unit: "device_raw", legacyColumn: "pm25" },
  pm10_raw: { unit: "device_raw", legacyColumn: "pm10" },
  co2: { unit: "ppm", legacyColumn: "co2" },
  tvoc_index: { unit: "device_index", legacyColumn: "vocs" },
  no2_index: { unit: "device_index", legacyColumn: "no2" },
  nox_index: { unit: "device_index" },
  formaldehyde_raw: { unit: "device_raw", legacyColumn: "hcho" },
});

function convert(value, from, to) {
  if (from === to) return value;
  if (to === "C" && from === "F") return (value - 32) * 5 / 9;
  if (to === "C" && from === "K") return value - 273.15;
  if (to === "C" && from === "K10") return value / 10 - 273.15;
  if (to === "ug/m3" && from === "mg/m3") return value * 1000;
  throw new Error(`Unsupported sensor unit: ${from} for ${to}`);
}

function normalizeSensorSample({ connector, deviceId, observedAt, readings }) {
  if (!connector || !deviceId || !Array.isArray(readings)) {
    throw new Error("Sensor sample needs a connector, device ID and readings.");
  }
  const time = new Date(observedAt);
  if (!Number.isFinite(time.getTime())) throw new Error("Invalid sensor observation time.");
  const seen = new Set();
  const measurements = readings.filter(({ value }) => value !== null && value !== undefined && value !== "")
    .map(({ metric, value, unit }) => {
      const definition = METRICS[metric];
      if (!definition || !unit || seen.has(metric)) throw new Error(`Invalid or duplicate sensor metric: ${metric}`);
      seen.add(metric);
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) throw new Error(`Invalid sensor value for ${metric}`);
      const converted = convert(numeric, unit, definition.unit);
      if (metric === "relative_humidity" && (converted < 0 || converted > 100)) {
        throw new Error("Relative humidity must be between 0 and 100%.");
      }
      return { metric, value: converted, unit: definition.unit, sourceValue: numeric, sourceUnit: unit };
    });
  return { connector, deviceId, observedAt: time.toISOString(), measurements };
}

function legacyReadingValues(sample) {
  return Object.fromEntries(sample.measurements
    .filter(({ metric }) => METRICS[metric].legacyColumn)
    .map(({ metric, value }) => [METRICS[metric].legacyColumn, value]));
}

module.exports = { METRICS, normalizeSensorSample, legacyReadingValues };
