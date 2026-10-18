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

const CHART_METRICS = [
  { key: "electricity", label: "Electricity", unit: "kWh" },
  { key: "gas", label: "Gas", unit: "kWh" },
  { key: "internalTemp", label: "Indoor temperature", unit: "°C" },
  { key: "externalTemp", label: "Outdoor temperature", unit: "°C" },
  { key: "upstairsHumidity", label: "Upstairs RH", unit: "%" },
  { key: "downstairsHumidity", label: "Downstairs RH", unit: "%" },
];

const interactiveSeasonalChart = (records) => {
  const fields = CHART_METRICS.map(({ key }) => key);
  const points = (rows, labelKey) => (rows || []).map((row) => ({
    label: String(row[labelKey] || row.label || ""),
    hour: row.hour,
    ...Object.fromEntries(fields.map((field) => [field, Number.isFinite(row[field]) ? row[field] : null])),
  }));
  const data = (records || []).map((record) => ({
    name: `${record.name || "Season"} ${record.year || (record.startDate || "").slice(0, 4)}`,
    weekly: points(record.data, "label"),
    daily: points(record.dailyData, "date"),
  })).filter((record) => record.weekly.length || record.daily.length);
  if (!data.length) return "";
  const encoded = JSON.stringify({ data, metrics: CHART_METRICS }).replace(/</g, "\\u003c");
  return `<div id="seasonal-chart" class="chart"><div class="chart-controls"><label>Season <select id="chart-season">${data.map((record, index) => `<option value="${index}">${escapeHtml(record.name)}</option>`).join("")}</select></label><fieldset><legend>View</legend><label><input type="radio" name="chart-period" value="day"> Day</label><label><input type="radio" name="chart-period" value="week"> Week</label><label><input type="radio" name="chart-period" value="month" checked> Month</label></fieldset></div><div id="chart-metrics" class="chart-metrics" aria-label="Highlight a measure"></div><svg id="chart-plot" viewBox="0 0 800 270" role="img" aria-label="Seasonal trend chart"></svg><p id="chart-caption" class="muted"></p></div><script type="application/json" id="chart-data">${encoded}</script>`;
};

const INTERACTIVE_CHART_SCRIPT = `<script>(function(){
  var root=document.getElementById('seasonal-chart'); if(!root)return;
  var source=JSON.parse(document.getElementById('chart-data').textContent);
  var selector=document.getElementById('chart-season');
  var metricBox=document.getElementById('chart-metrics');
  var svg=document.getElementById('chart-plot');
  var caption=document.getElementById('chart-caption');
  var metric='electricity';
  var ns='http://www.w3.org/2000/svg';
  function average(rows,key){var values=rows.map(function(row){return row[key]}).filter(Number.isFinite);return values.length?values.reduce(function(a,b){return a+b},0)/values.length:null}
  function points(record,period){
    if(period==='week')return record.weekly;
    if(period==='day')return Array.from({length:24},function(_,hour){var rows=record.weekly.filter(function(row){return Number(row.hour)===hour});var point={label:String(hour).padStart(2,'0')+':00'};source.metrics.forEach(function(item){point[item.key]=average(rows,item.key)});return point});
    var sorted=record.daily.slice().sort(function(a,b){return a.label.localeCompare(b.label)});
    var weeks=[]; for(var i=0;i<sorted.length;i+=7){var rows=sorted.slice(i,i+7);var point={label:rows[0].label+' to '+rows[rows.length-1].label};source.metrics.forEach(function(item){point[item.key]=average(rows,item.key)});weeks.push(point)}return weeks;
  }
  function element(tag,attrs,text){var el=document.createElementNS(ns,tag);Object.keys(attrs).forEach(function(key){el.setAttribute(key,attrs[key])});if(text!=null)el.textContent=text;return el}
  function draw(){
    var record=source.data[Number(selector.value)]||source.data[0];
    var period=document.querySelector('input[name="chart-period"]:checked').value;
    var rows=points(record,period);
    var available=source.metrics.filter(function(item){return rows.some(function(row){return Number.isFinite(row[item.key])})});
    if(!available.some(function(item){return item.key===metric}))metric=available[0]?available[0].key:'';
    metricBox.replaceChildren();available.forEach(function(item){var button=document.createElement('button');button.type='button';button.textContent=item.label;button.setAttribute('aria-pressed',String(item.key===metric));button.onclick=function(){metric=item.key;draw()};metricBox.appendChild(button)});
    svg.replaceChildren(); if(!metric){caption.textContent='No chart readings for this season and view.';return}
    var values=rows.map(function(row){return row[metric]}).filter(Number.isFinite);
    var low=Math.min.apply(null,values),high=Math.max.apply(null,values);if(low===high){low-=1;high+=1}
    var plot=rows.map(function(row,index){if(!Number.isFinite(row[metric]))return null;return {x:45+(rows.length===1?0:index/(rows.length-1)*720),y:225-(row[metric]-low)/(high-low)*190,value:row[metric],label:row.label}});
    svg.appendChild(element('line',{x1:45,y1:225,x2:765,y2:225,stroke:'#94a3b8'}));
    svg.appendChild(element('text',{x:4,y:39,fill:'#475569','font-size':12},high.toFixed(1)));
    svg.appendChild(element('text',{x:4,y:228,fill:'#475569','font-size':12},low.toFixed(1)));
    var path='',previous=false;plot.forEach(function(point){if(!point){previous=false;return}path+=(previous?' L':' M')+point.x.toFixed(1)+' '+point.y.toFixed(1);previous=true});
    svg.appendChild(element('path',{d:path,fill:'none',stroke:'#047857','stroke-width':2.5}));
    plot.forEach(function(point){if(!point)return;var dot=element('circle',{cx:point.x,cy:point.y,r:period==='week'?2:4,fill:'#047857'});dot.appendChild(element('title',{},point.label+': '+point.value.toFixed(2)));svg.appendChild(dot)});
    var item=source.metrics.find(function(entry){return entry.key===metric});caption.textContent=record.name+' · '+period+' · '+item.label+' ('+item.unit+') · '+values.length+' plotted points';
  }
  selector.onchange=draw;document.querySelectorAll('input[name="chart-period"]').forEach(function(input){input.onchange=draw});draw();
})();</script>`;

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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Baseline report</title><style>body{font:15px/1.5 system-ui,sans-serif;color:#17212b;max-width:850px;margin:36px auto;padding:0 24px}h1{font-size:28px}h2{font-size:19px;border-bottom:1px solid #aaa;padding-bottom:5px;margin-top:30px}table{border-collapse:collapse;width:100%}th,td{padding:8px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}th{width:38%}.muted{color:#52606b}section{break-inside:avoid}.chart{border:1px solid #cbd5e1;padding:16px;margin:16px 0;overflow:hidden}.chart-controls{display:flex;flex-wrap:wrap;gap:12px;align-items:center}.chart-controls fieldset{display:flex;gap:12px;border:0;padding:0;margin:0}.chart-controls select{padding:5px}.chart-metrics{display:flex;flex-wrap:wrap;gap:6px;margin:14px 0}.chart-metrics button{border:1px solid #94a3b8;background:white;padding:5px 9px;cursor:pointer}.chart-metrics button[aria-pressed=true]{border-color:#047857;background:#d1fae5;color:#064e3b;font-weight:700}.chart svg{display:block;width:100%;height:auto;min-height:180px}.chart table{overflow:auto}@media print{body{margin:0;max-width:none}section{break-inside:auto}.chart-controls,.chart-metrics{display:none}}</style></head><body>
  <h1>Building baseline report</h1><p class="muted">Generated ${escapeHtml(new Date().toLocaleString("en-GB"))} · Owner-only evidence pack · Not a licensed buyer package</p>
  ${section("Building and evidence", `<table>${row("Building record", baseline.buildingId || "Pending")}${row("Floor area", metric(baseline.area, "m²"))}${row("Meter period", `${energyExport.periodStart || "Unknown"} to ${energyExport.periodEnd || "Unknown"}`)}${row("Days with meter readings", energyExport.meteredDays ?? "Unknown")}${row("Coverage", "Days with readings do not prove complete half-hour coverage")}</table>`)}
  ${section("Energy performance", `<table>${row("Observed annual EUI", metric(eui, "kWh/m²/year"))}${row("WBP planning target", metric(target, "kWh/m²/year"))}${row("Target comparison", Number.isFinite(eui) && Number.isFinite(target) ? (eui > target ? "Above target" : "At or below target") : "Pending")}${row("Average electricity day", metric(baseline.electricityDailyKwh, "kWh"))}${row("Average gas day", metric(baseline.gasDailyKwh, "kWh"))}${row("Observed-weather extrapolation", metric(heat.weatherNormalisedEui, "kWh/m²/year"))}${fuelRows}</table><p>The 35 kWh/m²/year target, where shown, is WBP's planning threshold, not an EPC, SAP, HEM, LETI or EnerPHit rating.</p>`)}
  ${concerns.length ? section("Areas to review", list(concerns)) : ""}
  ${section("Health and monitored rooms", `<table>${row("Health score", metric(baseline.healthScore, "/100", 0))}${row("Energy score", metric(baseline.energyScore, "/100", 0))}${roomRows}</table>${history.status === "ready" ? (flags.length ? list(flags) : "<p>No historical room averages available.</p>") : "<p>Historical comparison unavailable.</p>"}<p>Counts cover daily averages in the past year, not individual peaks. Missing days and unmonitored rooms are excluded.</p>`)}
  ${section("Heat loss and summer resilience", `<table>${row("HLA score", metric(baseline.hlaScore, "/100", 0))}${row("HDD intensity", metric(heat.kwhPerHdd, "kWh/HDD", 3))}${row("Heating-degree evidence", heat.hddDays ? `${heat.hddDays} days` : "Pending")}${row("HTC estimate", metric(heat.htcEstimate, "W/K", 1))}${row("HTC samples", heat.htcSamples ?? "Unknown")}${row("Night cooldown HTC", metric(heat.nightCooldownHtc, "W/K", 1))}${row("Night cooldown time constant", metric(heat.nightCooldownTauHours, "hours", 1))}${row("Night cooldown rate", metric(heat.nightCooldownRateCPerHour, "°C/hour", 2))}${row("Qualifying cooldown nights", heat.nightCooldownNights ?? "Unknown")}${row("Heat exclusion", exclusionValue)}${row("Hot-weather samples", exclusion.sampleCount ?? "Unknown")}${row("Indoor overheating share", Number.isFinite(exclusion.overheatingShare) ? `${(exclusion.overheatingShare * 100).toFixed(0)}%` : "Not available")}</table>${rain.length ? list(rain) : "<p>Rain/humidity comparison pending.</p>"}<p>${weatherNote}</p>`)}
  ${section("Seasonal performance trends", `${interactiveSeasonalChart(baseline.seasonalTrends)}${seasons.length ? `<table><thead><tr><th>Season and coverage</th><th>Electricity</th><th>Gas</th><th>Inside</th><th>Outside</th><th>Upstairs / downstairs RH</th></tr></thead><tbody>${seasonRows}</tbody></table><p>Values are averages of dated readings available in the seasonal trend archive. Observed days are not proof of complete seasonal coverage; missing fuels or sensors are shown as unavailable.</p>` : "<p>No dated seasonal trend readings are available in this report yet.</p>"}`)}
  ${section("Retrofit design brief", list(recommendations))}
  ${section("Data licensing preparation", `<p>This owner-only report can inform a redacted, purpose-specific licence pack. It is not itself approved for sharing. Define the buyer, permitted use, retention, consent, re-identification controls and price before release.</p><p>Candidate fields: period and coverage, fuel totals and intervals, area and EUI method, room/sensor inventory, health summaries, weather context, provenance and exclusions. Remove building identifiers and occupant-level traces unless explicitly licensed.</p>`)}
  <p class="muted">This report supports scoping, not a condition survey, EPC, retrofit design or independently verified carbon claim.</p>${INTERACTIVE_CHART_SCRIPT}</body></html>`;
}
