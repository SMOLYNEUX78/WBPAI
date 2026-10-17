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

export function buildBaselineReportHtml(baseline, energyExport) {
  const rooms = baseline.rooms || [];
  const heat = baseline.heatLoss || {};
  const target = baseline.targetEui;
  const eui = baseline.annualEui;
  const flags = (baseline.redReadings || []).map((reading) => `${reading.label}: ${reading.value} ${reading.unit} (latest red-band reading)`);
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
  ${section("Health and monitored rooms", `<table>${row("Health score", metric(baseline.healthScore, "/100", 0))}${row("Energy score", metric(baseline.energyScore, "/100", 0))}${roomRows}</table>${flags.length ? list(flags) : "<p>No current red-band flags in the available summaries.</p>"}<p>Unmonitored rooms and past events may not appear in the current flags.</p>`)}
  ${section("Heat, moisture and weather", `<table>${row("Heat-loss estimate", metric(heat.htcEstimate, "W/K", 0))}${row("Night cooldown", metric(heat.nightCooldownRateCPerHour, "°C/hour", 2))}${row("Heating-degree evidence", heat.hddDays ? `${heat.hddDays} days` : "Pending")}</table>${rain.length ? list(rain) : "<p>Rain/humidity comparison pending.</p>"}<p>${weatherNote}</p>`)}
  ${section("Retrofit design brief", list(recommendations))}
  ${section("Data licensing preparation", `<p>This owner-only report can inform a redacted, purpose-specific licence pack. It is not itself approved for sharing. Define the buyer, permitted use, retention, consent, re-identification controls and price before release.</p><p>Candidate fields: period and coverage, fuel totals and intervals, area and EUI method, room/sensor inventory, health summaries, weather context, provenance and exclusions. Remove building identifiers and occupant-level traces unless explicitly licensed.</p>`)}
  <p class="muted">This report supports scoping, not a condition survey, EPC, retrofit design or independently verified carbon claim.</p></body></html>`;
}
