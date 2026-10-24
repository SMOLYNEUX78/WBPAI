const HALF_HOUR_MS = 30 * 60 * 1000;
const TEMPERATURE_WINDOW_MS = 75 * 60 * 1000;

export function selectRecentGasDays(propertyDays, legacyDays, today) {
  const latestThree = (rows) => {
    const days = (rows || [])
      .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && row.date < today &&
        Number.isFinite(row.gasKwh) && (row.intervals == null || row.intervals >= 48))
      .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
    if (days.length !== 3) return [];
    const consecutive = days.every((day, index) => index === 0 ||
      Date.parse(`${days[index - 1].date}T00:00:00Z`) - Date.parse(`${day.date}T00:00:00Z`) === 86400000);
    return consecutive ? days : [];
  };
  const property = latestThree(propertyDays);
  const legacy = latestThree(legacyDays);
  return property[0]?.date >= (legacy[0]?.date || "") ? property : legacy;
}

export function dailyGasFromIntervals(rows, today = new Date().toISOString().slice(0, 10)) {
  const byTime = new Map();
  (rows || []).forEach((row) => {
    const time = Date.parse(row.timestamp || row.observed_at);
    const kwh = Number(row.usage_kwh);
    if (Number.isFinite(time) && Number.isFinite(kwh) && kwh >= 0) {
      byTime.set(time, Math.max(byTime.get(time) || 0, kwh));
    }
  });
  const londonDate = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  });
  const days = new Map();
  byTime.forEach((kwh, time) => {
    const parts = Object.fromEntries(londonDate.formatToParts(time).map(({ type, value }) => [type, value]));
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    const day = days.get(date) || { date, gasKwh: 0, intervals: 0 };
    day.gasKwh += kwh;
    day.intervals += 1;
    days.set(date, day);
  });
  return [...days.values()].filter((day) => day.date < today && day.intervals >= 36);
}

export function detectHeatingOnset(dailyRows, today = new Date().toISOString().slice(0, 10)) {
  const days = (dailyRows || [])
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && Number.isFinite(row.gasKwh) && row.gasKwh >= 0 && row.date < today)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (days.length < 17 || Date.parse(`${today}T00:00:00Z`) - Date.parse(`${days[days.length - 1].date}T00:00:00Z`) > 3 * 86400000) return null;

  const recent = days.slice(-3);
  for (let index = Math.max(14, days.length - 14); index < days.length - 1; index += 1) {
    const prior = days.slice(Math.max(0, index - 30), index);
    if (prior.length < 14) continue;
    const priorDaily = prior.reduce((sum, day) => sum + day.gasKwh, 0) / prior.length;
    const threshold = Math.max(priorDaily * 2.5, priorDaily + 3);
    const consecutive = Date.parse(`${days[index + 1].date}T00:00:00Z`) - Date.parse(`${days[index].date}T00:00:00Z`) === 86400000;
    if (!consecutive || days[index].gasKwh < threshold || days[index + 1].gasKwh < threshold) continue;
    if (recent.filter((day) => day.gasKwh >= threshold).length < 2) continue;
    const recentDaily = recent.reduce((sum, day) => sum + day.gasKwh, 0) / recent.length;
    return { date: days[index].date, priorDaily, priorDays: prior.length, recentDaily };
  }
  return null;
}

const finiteTemperature = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > -30 && number < 50 ? number : null;
};

const nearestTemperature = (rows, at, key) => {
  const values = rows
    .map((row) => ({ time: Date.parse(row.timestamp), value: finiteTemperature(row[key]) }))
    .filter((row) => Number.isFinite(row.time) && row.value !== null && Math.abs(row.time - at) <= TEMPERATURE_WINDOW_MS)
    .sort((a, b) => Math.abs(a.time - at) - Math.abs(b.time - at));
  const closest = values[0];
  if (!closest) return null;
  const nearby = values.filter((row) => Math.abs(row.time - closest.time) <= 10 * 60 * 1000).slice(0, 3);
  return nearby.reduce((sum, row) => sum + row.value, 0) / nearby.length;
};

export function detectHeatingEvents(gasRows, temperatureRows = []) {
  const byTime = new Map();
  (gasRows || []).forEach((row) => {
    const time = Date.parse(row.timestamp);
    const kwh = Number(row.usage_kwh);
    if (Number.isFinite(time) && Number.isFinite(kwh) && kwh >= 0) {
      byTime.set(time, Math.max(byTime.get(time) || 0, kwh));
    }
  });
  const intervals = [...byTime.entries()].sort(([a], [b]) => a - b);
  if (intervals.length < 3) return [];
  const positive = intervals.map(([, kwh]) => kwh).filter((kwh) => kwh > 0).sort((a, b) => a - b);
  const lowUse = positive.length ? positive[Math.floor((positive.length - 1) * 0.25)] : 0;
  const highUse = positive.length ? positive[Math.floor((positive.length - 1) * 0.75)] : 0;
  const threshold = Math.max(0.45, highUse > lowUse * 2.5 ? lowUse * 2 : 0.45);
  const events = [];
  let run = [];
  const finish = () => {
    const active = run.filter(([, kwh]) => kwh >= threshold);
    const gasKwh = run.reduce((sum, [, kwh]) => sum + kwh, 0);
    if (active.length >= 3 && gasKwh >= 2) {
      const start = run[0][0];
      const end = run[run.length - 1][0] + HALF_HOUR_MS;
      const indoorStart = nearestTemperature(temperatureRows, start, "temperature_inside");
      const indoorEnd = nearestTemperature(temperatureRows, end, "temperature_inside");
      const outdoorStart = nearestTemperature(temperatureRows, start, "temperature_outside");
      const outdoorEnd = nearestTemperature(temperatureRows, end, "temperature_outside");
      const outdoor = outdoorStart ?? outdoorEnd;
      const durationHours = (end - start) / 3600000;
      const meanInside = indoorStart !== null && indoorEnd !== null ? (indoorStart + indoorEnd) / 2 : null;
      const meanOutside = outdoorStart !== null && outdoorEnd !== null ? (outdoorStart + outdoorEnd) / 2 : null;
      const temperatureGap = meanInside !== null && meanOutside !== null ? meanInside - meanOutside : null;
      const degreeHours = temperatureGap !== null && temperatureGap > 2 ? temperatureGap * durationHours : null;
      events.push({
        start: new Date(start).toISOString(), end: new Date(end).toISOString(),
        durationHours, gasKwh,
        indoorStart, indoorEnd, outdoorStart, outdoorEnd,
        indoorRiseC: indoorStart !== null && indoorEnd !== null ? indoorEnd - indoorStart : null,
        temperatureGapC: temperatureGap,
        gasKwhPerDegreeHour: degreeHours !== null ? gasKwh / degreeHours : null,
        hddAtStart: outdoor !== null ? Math.max(0, 15.5 - outdoor) : null,
        classification: outdoor !== null && outdoor < 18 ? "probable heating" : "sustained gas use",
      });
    }
    run = [];
  };
  intervals.forEach((interval) => {
    const [time, kwh] = interval;
    if (run.length && time - run[run.length - 1][0] > HALF_HOUR_MS * 1.5) finish();
    if (kwh >= threshold) run.push(interval);
    else if (run.length && kwh < threshold && run[run.length - 1][1] >= threshold) run.push(interval);
    else if (run.length) finish();
  });
  if (run.length) finish();
  return events.sort((a, b) => b.start.localeCompare(a.start));
}
