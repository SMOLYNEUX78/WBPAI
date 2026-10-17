const escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const metric = (value, unit, digits = 1) => Number.isFinite(value) ? `${value.toFixed(digits)} ${unit}` : "Not available";
const row = (label, value) => `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;
const section = (title, body) => `<section><h2>${escapeHtml(title)}</h2>${body}</section>`;
const list = (items) => `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
const average = (rows, field) => {
  const values = (rows || []).map((item) => item[field]).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
};
const seasonalSummary = (records) => (records || [])
  .map((record) => {
    const days = (record.dailyData || []).filter((day) => day.date && (!record.startDate || day.date >= record.startDate) && (!record.endDate || day.date <= record.endDate));
    if (!days.length) return null;
    const observed = days.filter((day) => ["electricity", "gas", "internalTemp", "externalTemp", "upstairsHumidity", "downstairsHumidity"].some((field) => Number.isFinite(day[field])));
    if (!observed.length) return null;
    return {
      label: `${record.name || "Season"} ${record.year || (record.startDate || "").slice(0, 4)}`,
      period: `${observed[0].date} to ${observed[observed.length - 1].date}`,
      days: observed.length,
      electricity: average(observed, "electricity"),
      gas: average(observed, "gas"),
      internalTemp: average(observed, "internalTemp"),
      externalTemp: average(observed, "externalTemp"),
      upstairsHumidity: average(observed, "upstairsHumidity"),
      downstairsHumidity: average(observed, "downstairsHumidity"),
      startDate: record.startDate || observed[0].date,
    };
  })
  .filter(Boolean)
  .sort((a, b) => a.startDate.localeCompare(b.startDate));

export function buildBaselineReportHtml(baseline, energyExport) {
  const rooms = baseline.rooms || [];
  const heat = baseline.heatLoss || {};
  const exclusion = baseline.heatExclusion || {};
  const seasons = seasonalSummary(baseline.seasonalTrends);
  const target = baseline.targetEui;
  const eui = baseline.annualEui;
  const history = baseline.historicalHealth || { status: "unavailable", findings: [] };
  const flags = history.findings.map((finding) => `${finding.label}: ${finding.redDays} of ${finding.observedDays} observed days had a red-band daily average${finding.lastRedDate ? `; last on ${finding.lastRedDate}` : ""}`);
  const concerns = [
    ...history.findings.filter((finding) => finding.redDays > 0).map((finding) => `${finding.label}: ${finding.redDays} red days of ${finding.observedDays} observed`),
    ...(baseline.performanceConcerns || []).map((item) => `${item.label}: ${item.detail}`),
    ...(baseline.redReadings || []).map((item) => `${item.label} (recent): ${item.value} ${item.unit}`),
  ];
  const rain = (baseline.rainHumidityAreas || []).map((area) => `${area.label}: ${metric(area.summary?.rhUplift, "percentage-point RH uplift after rain")}`);
  const fuelRows = (energyExport.fuelSummaries || []).map((fuel) => row(`${fuel.fuelType} total`, metric(Number(fuel.totalKwh), "kWh"))).join("");
  const roomRows = rooms.map((room) => {
    const prefix = room.label.toLowerCase();
    const profile = [
      metric(average(baseline.weeklyTrend, `${prefix}Humidity`), "% average RH"),
      metric(average(baseline.weeklyTrend, `${prefix}Pm25`), "µg/m³ average PM2.5"),
      metric(average(baseline.weeklyTrend, `${prefix}Vocs`), "ppb average VOCs"),
    ].filter((value) => value !== "Not available").join("; ");
    return row(room.label, `${room.timestamp ? `Latest ${new Date(room.timestamp).toLocaleString("en-GB")}` : "No recent timestamp"}${profile ? `; weekly profile: ${profile}` : ""}`);
  }).join("");
  const seasonRows = seasons.map((season) => `<tr><th scope="row">${escapeHtml(season.label)}<br><span class="muted">${escapeHtml(season.period)} · ${season.days} observed days</span></th><td>${escapeHtml(metric(season.electricity, "kWh/day"))}</td><td>${escapeHtml(metric(season.gas, "kWh/day"))}</td><td>${escapeHtml(metric(season.internalTemp, "°C"))}</td><td>${escapeHtml(metric(season.externalTemp, "°C"))}</td><td>${escapeHtml(metric(season.upstairsHumidity, "%"))} / ${escapeHtml(metric(season.downstairsHumidity, "%"))}</td></tr>`).join("");
  const exclusionValue = Number.isFinite(exclusion.averageBuffer)
    ? `${Math.abs(exclusion.averageBuffer).toFixed(1)} °C ${exclusion.averageBuffer >= 0 ? "cooler" : "hotter"} than outside`
    : "Not available";
  const weatherNote = "No comparison with a long-term local weather reference has been completed. A warm or cold winter could bias the observed baseline and retrofit savings.";
  const recommendations = [
    "Survey fabric, airtightness, thermal bridges, heating and hot-water systems before specifying works.",
    "Check ventilation and moisture sources alongside any insulation or airtightness measures.",
    "Reconcile meter gaps, floor area, tariff evidence and source IDs; compare heating-degree days with a local long-term reference.",
    "Confirm room coverage, sensor calibration and any red-band events before making health claims.",
  ];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Baseline report</title><style>body{font:15px/1.5 system-ui,sans-serif;color:#17212b;max-width:850px;margin:36px auto;padding:0 24px}h1{font-size:28px}h2{font-size:19px;border-bottom:1px solid #aaa;padding-bottom:5px;margin-top:30px}table{border-collapse:collapse;width:100%}th,td{padding:8px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}th{width:38%}.muted{color:#52606b}section{break-inside:avoid}@media print{body{margin:0;max-width:none}section{break-inside:auto}}</style></head><body>
  <h1>Building baseline report</h1><p class="muted">Generated ${escapeHtml(new Date().toLocaleString("en-GB"))} · Owner-only evidence pack · Not a licensed buyer package</p>
  ${section("Building and evidence", `<table>${row("Building record", baseline.buildingId || "Pending")}${row("Floor area", metric(baseline.area, "m²"))}${row("Meter period", `${energyExport.periodStart || "Unknown"} to ${energyExport.periodEnd || "Unknown"}`)}${row("Days with meter readings", energyExport.meteredDays ?? "Unknown")}${row("Coverage", "Days with readings do not prove complete half-hour coverage")}</table>`)}
  ${section("Energy performance", `<table>${row("Observed annual EUI", metric(eui, "kWh/m²/year"))}${row("WBP planning target", metric(target, "kWh/m²/year"))}${row("Target comparison", Number.isFinite(eui) && Number.isFinite(target) ? (eui > target ? "Above target" : "At or below target") : "Pending")}${row("Average electricity day", metric(baseline.electricityDailyKwh, "kWh"))}${row("Average gas day", metric(baseline.gasDailyKwh, "kWh"))}${row("Observed-weather extrapolation", metric(heat.weatherNormalisedEui, "kWh/m²/year"))}${fuelRows}</table><p>The 35 kWh/m²/year target, where shown, is WBP's planning threshold, not an EPC, SAP, HEM, LETI or EnerPHit rating.</p>`)}
  ${concerns.length ? section("Areas to review", list(concerns)) : ""}
  ${section("Health and monitored rooms", `<table>${row("Health score", metric(baseline.healthScore, "/100", 0))}${row("Energy score", metric(baseline.energyScore, "/100", 0))}${roomRows}</table>${history.status === "ready" ? (flags.length ? list(flags) : "<p>No historical room averages available.</p>") : "<p>Historical comparison unavailable.</p>"}<p>Counts cover daily averages in the past year, not individual peaks. Missing days and unmonitored rooms are excluded.</p>`)}
  ${section("Heat loss and summer resilience", `<table>${row("HLA score", metric(baseline.hlaScore, "/100", 0))}${row("HDD intensity", metric(heat.kwhPerHdd, "kWh/HDD", 3))}${row("Heating-degree evidence", heat.hddDays ? `${heat.hddDays} days` : "Pending")}${row("HTC estimate", metric(heat.htcEstimate, "W/K", 1))}${row("HTC samples", heat.htcSamples ?? "Unknown")}${row("Night cooldown HTC", metric(heat.nightCooldownHtc, "W/K", 1))}${row("Night cooldown time constant", metric(heat.nightCooldownTauHours, "hours", 1))}${row("Night cooldown rate", metric(heat.nightCooldownRateCPerHour, "°C/hour", 2))}${row("Qualifying cooldown nights", heat.nightCooldownNights ?? "Unknown")}${row("Heat exclusion", exclusionValue)}${row("Hot-weather samples", exclusion.sampleCount ?? "Unknown")}${row("Indoor overheating share", Number.isFinite(exclusion.overheatingShare) ? `${(exclusion.overheatingShare * 100).toFixed(0)}%` : "Not available")}</table>${rain.length ? list(rain) : "<p>Rain/humidity comparison pending.</p>"}<p>${weatherNote}</p>`)}
  ${section("Seasonal performance trends", seasons.length ? `<table><thead><tr><th>Season and coverage</th><th>Electricity</th><th>Gas</th><th>Inside</th><th>Outside</th><th>Upstairs / downstairs RH</th></tr></thead><tbody>${seasonRows}</tbody></table><p>Values are averages of dated readings available in the seasonal trend archive. Observed days are not proof of complete seasonal coverage; missing fuels or sensors are shown as unavailable.</p>` : "<p>No dated seasonal trend readings are available in this report yet.</p>")}
  ${section("Retrofit design brief", list(recommendations))}
  ${section("Data licensing preparation", `<p>This owner-only report can inform a redacted, purpose-specific licence pack. It is not itself approved for sharing. Define the buyer, permitted use, retention, consent, re-identification controls and price before release.</p><p>Candidate fields: period and coverage, fuel totals and intervals, area and EUI method, room/sensor inventory, health summaries, weather context, provenance and exclusions. Remove building identifiers and occupant-level traces unless explicitly licensed.</p>`)}
  <p class="muted">This report supports scoping, not a condition survey, EPC, retrofit design or independently verified carbon claim.</p></body></html>`;
}
