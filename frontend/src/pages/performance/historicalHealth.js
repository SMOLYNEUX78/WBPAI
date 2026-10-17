const DAY_MS = 24 * 60 * 60 * 1000;

const checks = [
  { field: "internal_temp", label: "Whole-home temperature", red: (v) => v < 16 || v >= 24 },
  { field: "upstairs_humidity", label: "Upstairs humidity", red: (v) => v < 30 || v >= 70 },
  { field: "downstairs_humidity", label: "Downstairs humidity", red: (v) => v < 30 || v >= 70 },
  { field: "upstairs_pm25", label: "Upstairs PM2.5", red: (v) => v >= 35 },
  { field: "downstairs_pm25", label: "Downstairs PM2.5", red: (v) => v >= 35 },
  { field: "upstairs_vocs", label: "Upstairs VOCs", red: (v) => v >= 500 },
  { field: "downstairs_vocs", label: "Downstairs VOCs", red: (v) => v >= 500 },
  { field: "upstairs_pm10", label: "Upstairs PM10", red: (v) => v >= 45 },
  { field: "upstairs_hcho", label: "Upstairs HCHO", red: (v) => v >= 80 },
  { field: "upstairs_no2", label: "Upstairs NO2", red: (v) => v >= 100 },
];

export async function fetchHistoricalHealthDays(supabase, buildingId, now = new Date()) {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const start = end - 364 * DAY_MS;
  const rows = [];
  for (let from = start; from <= end; from += 91 * DAY_MS) {
    const { data, error } = await supabase.rpc("get_seasonal_performance_daily", {
      p_building_id: buildingId,
      p_start_date: new Date(from).toISOString().slice(0, 10),
      p_end_date: new Date(Math.min(from + 90 * DAY_MS, end)).toISOString().slice(0, 10),
    });
    if (error) throw error;
    rows.push(...(data || []));
  }
  return rows;
}

export function summariseHistoricalHealth(rows) {
  return checks.map((check) => {
    const observed = (rows || []).filter((row) => row[check.field] !== null && row[check.field] !== undefined)
      .map((row) => ({ date: row.reading_date, value: Number(row[check.field]) }))
      .filter(({ date, value }) => date && Number.isFinite(value) &&
        (check.field.includes("humidity") || check.field === "internal_temp" ? value > 0 : value >= 0));
    const red = observed.filter(({ value }) => check.red(value));
    return {
      field: check.field, label: check.label, observedDays: observed.length, redDays: red.length,
      lastRedDate: red.length ? red[red.length - 1].date : null,
    };
  }).filter((item) => item.observedDays > 0)
    .sort((a, b) => b.redDays - a.redDays || a.label.localeCompare(b.label));
}
