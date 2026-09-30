const FRESH_READING_MS = 2 * 60 * 60 * 1000;

const redMetrics = [
  { key: "internalTemp", label: "Temperature", unit: "deg C", red: (value) => value < 16 || value >= 24 },
  { key: "humidity", label: "RH", unit: "%", red: (value) => value < 30 || value >= 70 },
  { key: "pm25", label: "PM2.5", unit: "ug/m3", red: (value) => value >= 35 },
  { key: "vocs", label: "VOCs", unit: "ppb", red: (value) => value >= 500 },
  { key: "pm10", label: "PM10", unit: "ug/m3", red: (value) => value >= 45 },
  { key: "hcho", label: "HCHO", unit: "ppb", red: (value) => value >= 80 },
  { key: "no2", label: "NO2", unit: "ppb", red: (value) => value >= 100 },
];

export const liveRedReadings = (rooms, now = Date.now()) => (rooms || []).flatMap((room) => {
  const timestamp = Date.parse(room.timestamp || "");
  if (!Number.isFinite(timestamp) || timestamp > now || now - timestamp > FRESH_READING_MS) return [];
  return redMetrics.flatMap((metric) => {
    const value = room[metric.key];
    if (value == null || !Number.isFinite(Number(value)) ||
        (["internalTemp", "humidity"].includes(metric.key) && Number(value) === 0) ||
        !metric.red(Number(value))) return [];
    return [{ key: `${room.key}:${metric.key}`, label: `${room.label} ${metric.label}`, value: Number(value), unit: metric.unit }];
  });
});
