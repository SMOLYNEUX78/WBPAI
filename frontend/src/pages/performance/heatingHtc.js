const DAY_MS = 24 * 60 * 60 * 1000;
const HALF_HOUR_MS = 30 * 60 * 1000;
const ASSUMED_BOILER_EFFICIENCY = 0.85;

const dayKey = (time) => new Date(time).toISOString().slice(0, 10);
const slotOfDay = (time) => Math.floor((time % DAY_MS) / HALF_HOUR_MS);
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

const byCompleteDay = (rows) => {
  const unique = new Map();
  (rows || []).forEach((row) => {
    const time = Date.parse(row.timestamp);
    const value = Number(row.usage_kwh);
    if (Number.isFinite(time) && Number.isFinite(value) && value >= 0) {
      unique.set(time, Math.max(unique.get(time) || 0, value));
    }
  });
  const days = new Map();
  unique.forEach((value, time) => {
    const day = dayKey(time);
    if (!days.has(day)) days.set(day, new Map());
    days.get(day).set(slotOfDay(time), value);
  });
  return [...days.entries()].filter(([, slots]) => slots.size >= 44);
};

export function estimateHeatingOnlyHtc(baselineGasRows, recentGasRows, temperatureRows, now = new Date()) {
  const pending = { htcEstimate: null, htcSamples: 0, htcDeltaTotal: 0,
    htcConfidence: "pending-heating", htcBoilerEfficiency: ASSUMED_BOILER_EFFICIENCY };
  const baselineDays = byCompleteDay(baselineGasRows);
  if (baselineDays.length < 14) return pending;

  const typicalBySlot = new Map();
  for (let slot = 0; slot < 48; slot += 1) {
    const values = baselineDays.map(([, readings]) => readings.get(slot))
      .filter(Number.isFinite).sort((a, b) => a - b);
    if (values.length >= 10) typicalBySlot.set(slot, values[Math.floor((values.length - 1) * 0.75)]);
  }
  if (typicalBySlot.size < 44) return pending;

  const temperatureBuckets = new Map();
  (temperatureRows || []).forEach((row) => {
    const time = Date.parse(row.timestamp);
    if (!Number.isFinite(time)) return;
    const bucketTime = Math.floor(time / HALF_HOUR_MS) * HALF_HOUR_MS;
    if (!temperatureBuckets.has(bucketTime)) temperatureBuckets.set(bucketTime, { inside: [], outside: [] });
    const bucket = temperatureBuckets.get(bucketTime);
    const inside = Number(row.temperature_inside);
    const outside = Number(row.temperature_outside);
    if (row.temperature_inside != null && Number.isFinite(inside) && inside > 0 && inside < 45) bucket.inside.push(inside);
    if (row.temperature_outside != null && Number.isFinite(outside) && outside > -30 && outside < 45) bucket.outside.push(outside);
  });
  const temperaturesByDay = new Map();
  temperatureBuckets.forEach((bucket, time) => {
    if (!bucket.inside.length || !bucket.outside.length) return;
    const day = dayKey(time);
    if (!temperaturesByDay.has(day)) temperaturesByDay.set(day, []);
    temperaturesByDay.get(day).push({ time, inside: mean(bucket.inside), outside: mean(bucket.outside) });
  });

  let deliveredKwh = 0;
  let degreeHours = 0;
  let days = 0;
  let deltaTotal = 0;
  byCompleteDay(recentGasRows).forEach(([day, slots]) => {
    if (day >= now.toISOString().slice(0, 10)) return;
    const temperatures = (temperaturesByDay.get(day) || []).sort((a, b) => a.time - b.time);
    if (temperatures.length < 6) return;
    const gap = mean(temperatures.map((row) => row.inside - row.outside));
    const insideDrift = Math.abs(mean(temperatures.slice(0, 3).map((row) => row.inside)) -
      mean(temperatures.slice(-3).map((row) => row.inside)));
    if (gap < 4 || insideDrift > 1.5) return;
    const heatingGasKwh = [...slots.entries()].reduce(
      (sum, [slot, value]) => sum + Math.max(0, value - (typicalBySlot.get(slot) || 0)), 0
    );
    if (heatingGasKwh < 4) return;
    deliveredKwh += heatingGasKwh * ASSUMED_BOILER_EFFICIENCY;
    degreeHours += gap * slots.size * 0.5;
    deltaTotal += gap;
    days += 1;
  });

  return days >= 5 && degreeHours > 0
    ? { htcEstimate: deliveredKwh * 1000 / degreeHours, htcSamples: days,
      htcDeltaTotal: deltaTotal, htcConfidence: "provisional-heating-gas",
      htcBoilerEfficiency: ASSUMED_BOILER_EFFICIENCY }
    : { ...pending, htcSamples: days, htcDeltaTotal: deltaTotal };
}
