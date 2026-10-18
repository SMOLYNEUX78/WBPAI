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
  { key: "electricity", label: "Electricity", unit: "kWh", color: "#2563eb", group: "energy" },
  { key: "gas", label: "Gas", unit: "kWh", color: "#dc2626", group: "energy" },
  { key: "internalTemp", label: "Indoor", unit: "°C", color: "#c2410c", group: "temperature" },
  { key: "externalTemp", label: "Outside", unit: "°C", color: "#4338ca", group: "temperature" },
  { key: "upstairsHumidity", label: "Upstairs RH", unit: "%", color: "#0891b2", group: "humidity" },
  { key: "downstairsHumidity", label: "Downstairs RH", unit: "%", color: "#7c3aed", group: "humidity" },
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
  return `<div id="seasonal-chart" class="chart"><div class="chart-top"><strong>Seasonal Performance Trends</strong><div id="chart-seasons" class="chart-tabs" role="group" aria-label="Season">${data.map((record, index) => `<button type="button" data-season="${index}" aria-pressed="${index === 0}">${escapeHtml(record.name)}</button>`).join("")}</div></div><div id="chart-periods" class="chart-tabs chart-periods" role="group" aria-label="Trend period"><button type="button" data-period="day" aria-pressed="false">Day</button><button type="button" data-period="week" aria-pressed="false">Week</button><button type="button" data-period="month" aria-pressed="true">Month</button></div><div id="chart-groups" class="chart-tabs chart-groups" role="group" aria-label="Measure group"><button type="button" data-group="energy" aria-pressed="true">Energy</button><button type="button" data-group="temperature" aria-pressed="false">Temperature</button><button type="button" data-group="humidity" aria-pressed="false">Humidity</button></div><div class="chart-plot-wrap"><svg id="chart-plot" viewBox="0 0 800 310" role="img" aria-label="Seasonal performance trend chart"></svg><div id="chart-tooltip" class="chart-tooltip" hidden></div></div><div id="chart-metrics" class="chart-metrics" aria-label="Show or hide measures"></div><p id="chart-caption" class="muted"></p></div><script type="application/json" id="chart-data">${encoded}</script>`;
};

const INTERACTIVE_CHART_SCRIPT = `<script>(function(){
  var root=document.getElementById('seasonal-chart'); if(!root)return;
  var source=JSON.parse(document.getElementById('chart-data').textContent);
  var metricBox=document.getElementById('chart-metrics');
  var svg=document.getElementById('chart-plot');
  var caption=document.getElementById('chart-caption');
  var tooltip=document.getElementById('chart-tooltip');
  var ns='http://www.w3.org/2000/svg';
  var seasonIndex=0,period='month',group='energy',selected=new Set();
  var plotted=[],visible=[],chartMin=0,chartMax=1;
  function average(rows,key){var values=rows.map(function(row){return row[key]}).filter(Number.isFinite);return values.length?values.reduce(function(a,b){return a+b},0)/values.length:null}
  function points(record,period){
    if(period==='week')return record.weekly;
    if(period==='day')return Array.from({length:24},function(_,hour){var rows=record.weekly.filter(function(row){return Number(row.hour)===hour});var point={label:String(hour).padStart(2,'0')+':00'};source.metrics.forEach(function(item){point[item.key]=average(rows,item.key)});return point});
    var sorted=record.daily.slice().sort(function(a,b){return a.label.localeCompare(b.label)});
    var weeks=[]; for(var i=0;i<sorted.length;i+=7){var rows=sorted.slice(i,i+7);var point={label:rows[0].label+' to '+rows[rows.length-1].label};source.metrics.forEach(function(item){point[item.key]=average(rows,item.key)});weeks.push(point)}return weeks;
  }
  function element(tag,attrs,text){var el=document.createElementNS(ns,tag);Object.keys(attrs).forEach(function(key){el.setAttribute(key,attrs[key])});if(text!=null)el.textContent=text;return el}
  function x(index,count){return 56+(count>1?index/(count-1)*714:357)}
  function y(value){return 246-(value-chartMin)/(chartMax-chartMin)*200}
  function addBand(low,high,color,label){
    var top=y(Math.min(high,chartMax)),bottom=y(Math.max(low,chartMin));
    if(bottom<=top)return;
    svg.appendChild(element('rect',{x:56,y:top,width:714,height:bottom-top,fill:color,opacity:0.28}));
    svg.appendChild(element('text',{x:63,y:top+13,fill:'#334155','font-size':10,opacity:0.68},label));
  }
  function syncButtons(){
    document.querySelectorAll('#chart-seasons button').forEach(function(button){button.setAttribute('aria-pressed',String(Number(button.dataset.season)===seasonIndex))});
    document.querySelectorAll('#chart-periods button').forEach(function(button){button.setAttribute('aria-pressed',String(button.dataset.period===period))});
    document.querySelectorAll('#chart-groups button').forEach(function(button){button.setAttribute('aria-pressed',String(button.dataset.group===group))});
  }
  function draw(){
    var record=source.data[seasonIndex],rows=points(record,period);
    var groups=['energy','temperature','humidity'];
    function availableFor(key){return source.metrics.filter(function(item){return item.group===key&&rows.some(function(row){return Number.isFinite(row[item.key])})})}
    if(!availableFor(group).length)group=groups.find(function(key){return availableFor(key).length})||'energy';
    document.querySelectorAll('#chart-groups button').forEach(function(button){button.disabled=!availableFor(button.dataset.group).length});
    var available=availableFor(group);
    if(!available.some(function(item){return selected.has(item.key)}))selected=new Set(available.map(function(item){return item.key}));
    visible=available.filter(function(item){return selected.has(item.key)});
    syncButtons();tooltip.hidden=true;metricBox.replaceChildren();svg.replaceChildren();
    available.forEach(function(item){
      var button=document.createElement('button');button.type='button';button.setAttribute('aria-pressed',String(selected.has(item.key)));
      var dot=document.createElement('span');dot.className='chart-dot';dot.style.backgroundColor=item.color;
      var label=document.createElement('span');label.textContent=item.label;
      var value=document.createElement('strong');var mean=average(rows,item.key);value.textContent=Number.isFinite(mean)?mean.toFixed(1)+' '+(group==='energy'&&period!=='month'?'kWh/h':group==='energy'?'kWh/day':item.unit):'No data';
      button.append(dot,label,value);button.onclick=function(){if(selected.has(item.key)&&selected.size>1)selected.delete(item.key);else selected.add(item.key);draw()};metricBox.appendChild(button);
    });
    if(!visible.length){caption.textContent='No readings for this season and view.';return}
    var values=rows.flatMap(function(row){return visible.map(function(item){return row[item.key]})}).filter(Number.isFinite);
    if(group==='humidity'){chartMin=0;chartMax=100}
    else if(group==='temperature'){chartMin=Math.min(10,Math.floor(Math.min.apply(null,values)-2));chartMax=Math.max(30,Math.ceil(Math.max.apply(null,values)+2))}
    else {chartMin=0;chartMax=Math.max(1,Math.ceil(Math.max.apply(null,values)*1.15))}
    if(group==='temperature'){addBand(chartMin,16,'#fecaca','Cold');addBand(16,18,'#fde68a','Cool');addBand(18,22,'#bbf7d0','Comfort');addBand(22,24,'#fde68a','Warm');addBand(24,chartMax,'#fecaca','Hot')}
    if(group==='humidity'){addBand(0,30,'#fecaca','Dry');addBand(30,40,'#fde68a','Low');addBand(40,60,'#bbf7d0','Comfort');addBand(60,70,'#fde68a','High');addBand(70,100,'#fecaca','Humid')}
    for(var tick=0;tick<=4;tick++){var value=chartMax-(chartMax-chartMin)*tick/4,yy=y(value);svg.appendChild(element('line',{x1:56,y1:yy,x2:770,y2:yy,stroke:'#d1d5db','stroke-width':1}));svg.appendChild(element('text',{x:49,y:yy+4,'text-anchor':'end',fill:'#475569','font-size':11},value.toFixed(group==='energy'?1:0)))}
    svg.appendChild(element('text',{x:55,y:20,fill:'#334155','font-size':11,'font-weight':600},group==='energy'?(period==='month'?'kWh/day':'kWh/h'):visible[0].unit));
    var labels=period==='day'?[0,6,12,18,23]:period==='week'?[0,24,48,72,96,120,144]:rows.map(function(_,index){return index}).filter(function(index){return index===0||index===rows.length-1||index%Math.max(1,Math.ceil(rows.length/7))===0});
    labels.forEach(function(index){if(index>=rows.length)return;var xx=x(index,rows.length);svg.appendChild(element('line',{x1:xx,y1:46,x2:xx,y2:246,stroke:'#e5e7eb','stroke-width':1}));var label=period==='week'?['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][Math.floor(index/24)]||'':period==='day'?String(index).padStart(2,'0')+':00':rows[index].label.slice(5,10);svg.appendChild(element('text',{x:xx,y:270,'text-anchor':'middle',fill:'#64748b','font-size':10},label))});
    plotted=rows;
    visible.forEach(function(item){
      var path='',previous=false;
      rows.forEach(function(row,index){var value=row[item.key];if(!Number.isFinite(value)){previous=false;return}path+=(previous?' L':' M')+x(index,rows.length).toFixed(1)+' '+y(value).toFixed(1);previous=true});
      svg.appendChild(element('path',{d:path,fill:'none',stroke:item.color,'stroke-width':2.5,'stroke-linecap':'round','stroke-linejoin':'round'}));
      if(period==='month'||rows.length<=2)rows.forEach(function(row,index){if(!Number.isFinite(row[item.key]))return;var dot=element('circle',{cx:x(index,rows.length),cy:y(row[item.key]),r:4,fill:item.color});dot.appendChild(element('title',{},row.label+': '+item.label+' '+row[item.key].toFixed(2)+' '+item.unit));svg.appendChild(dot)});
    });
    caption.textContent=record.name+' · '+period+' · '+rows.length+' time slots. Shading shows temperature or humidity bands; energy has no comfort band.';
  }
  document.querySelectorAll('#chart-seasons button').forEach(function(button){button.onclick=function(){seasonIndex=Number(button.dataset.season);selected.clear();draw()}});
  document.querySelectorAll('#chart-periods button').forEach(function(button){button.onclick=function(){period=button.dataset.period;selected.clear();draw()}});
  document.querySelectorAll('#chart-groups button').forEach(function(button){button.onclick=function(){group=button.dataset.group;selected.clear();draw()}});
  function inspect(event){if(!plotted.length||!visible.length)return;var bounds=svg.getBoundingClientRect();if(!bounds.width)return;var px=(event.clientX-bounds.left)/bounds.width*800;var index=Math.max(0,Math.min(plotted.length-1,Math.round((px-56)/714*(plotted.length-1))));var point=plotted[index];if(!point)return;var lines=[point.label];visible.forEach(function(item){if(Number.isFinite(point[item.key]))lines.push(item.label+': '+point[item.key].toFixed(2)+' '+item.unit)});tooltip.textContent=lines.join(' · ');tooltip.hidden=false}
  svg.addEventListener('pointermove',inspect);svg.addEventListener('pointerdown',inspect);svg.addEventListener('pointerleave',function(){tooltip.hidden=true});draw();
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Baseline report</title><style>body{font:15px/1.5 system-ui,sans-serif;color:#17212b;max-width:850px;margin:36px auto;padding:0 24px}h1{font-size:28px}h2{font-size:19px;border-bottom:1px solid #aaa;padding-bottom:5px;margin-top:30px}table{border-collapse:collapse;width:100%}th,td{padding:8px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}th{width:38%}.muted{color:#52606b}section{break-inside:avoid}.chart{border:1px solid #d1d5db;border-radius:4px;background:#fff;padding:16px;margin:16px 0;overflow:hidden}.chart-top{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px}.chart-tabs{display:flex;flex-wrap:wrap;gap:4px}.chart-tabs button{border:1px solid #cbd5e1;border-radius:3px;background:#fff;color:#334155;padding:6px 10px;font:600 12px system-ui;cursor:pointer}.chart-tabs button[aria-pressed=true]{border-color:#047857;background:#ecfdf5;color:#065f46}.chart-tabs button:disabled{opacity:.4;cursor:not-allowed}.chart-periods{margin-top:12px;gap:0}.chart-periods button{border-radius:0}.chart-periods button[aria-pressed=true]{background:#111827;border-color:#111827;color:#fff}.chart-groups{margin-top:12px}.chart-groups button[aria-pressed=true]{background:#2563eb;border-color:#2563eb;color:#fff}.chart-plot-wrap{position:relative;margin-top:12px;overflow-x:auto}.chart svg{display:block;width:100%;min-width:560px;height:auto;background:#fff;touch-action:none}.chart-tooltip{position:absolute;right:8px;top:8px;max-width:55%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:3px;background:#fff;box-shadow:0 3px 12px #0002;font-size:12px;pointer-events:none}.chart-tooltip[hidden]{display:none}.chart-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:14px 0}.chart-metrics button{display:flex;min-width:0;align-items:center;gap:7px;border:1px solid #cbd5e1;border-radius:3px;background:#fff;padding:7px 9px;text-align:left;cursor:pointer}.chart-metrics button[aria-pressed=false]{opacity:.5}.chart-metrics button strong{margin-left:auto;font-size:12px}.chart-dot{width:10px;height:10px;flex:none;border-radius:50%}@media(max-width:570px){.chart-metrics{grid-template-columns:1fr}.chart-tooltip{max-width:75%}}@media print{body{margin:0;max-width:none}section{break-inside:auto}.chart-tabs,.chart-metrics{display:none}}</style></head><body>
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

const REPORT_STYLE_PROPERTIES = [
  "display", "position", "box-sizing", "width", "max-width", "min-width", "height", "min-height",
  "flex-direction", "flex-wrap", "flex-grow", "flex-shrink", "align-items", "align-self",
  "justify-content", "grid-template-columns", "grid-column", "gap", "row-gap", "column-gap",
  "margin", "padding", "border", "border-radius", "background", "background-color",
  "color", "font-family", "font-size", "font-weight", "line-height", "text-align",
  "text-decoration", "white-space", "overflow", "overflow-wrap", "vertical-align",
];

// Capture the rendered Deep Dive instead of maintaining a second report layout.
export function buildDetailedReportHtml(deepDiveElement, seasonalTrends, energyExport) {
  if (!deepDiveElement) throw new Error("Open the detailed report before downloading it.");
  const clone = deepDiveElement.cloneNode(true);
  const sourceNodes = [deepDiveElement, ...deepDiveElement.querySelectorAll("*")];
  const cloneNodes = [clone, ...clone.querySelectorAll("*")];
  const view = deepDiveElement.ownerDocument.defaultView;
  sourceNodes.forEach((source, index) => {
    const target = cloneNodes[index];
    if (!target || !source.nodeType || source.nodeType !== 1) return;
    const computed = view.getComputedStyle(source);
    REPORT_STYLE_PROPERTIES.forEach((property) => {
      const value = computed.getPropertyValue(property);
      if (value) target.style.setProperty(property, value);
    });
    for (const attribute of [...target.attributes]) {
      if (/^on/i.test(attribute.name)) target.removeAttribute(attribute.name);
    }
  });
  clone.querySelectorAll("script,iframe,form,input,button").forEach((node) => node.remove());
  const chart = interactiveSeasonalChart(seasonalTrends);
  const generated = escapeHtml(new Date().toLocaleString("en-GB"));
  const period = `${escapeHtml(energyExport?.periodStart || "Unknown")} to ${escapeHtml(energyExport?.periodEnd || "Unknown")}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Detailed report</title><style>
    *{box-sizing:border-box}body{margin:0;background:#f3f4f6;color:#111827;font:14px/1.5 system-ui,sans-serif}main{max-width:1080px;margin:0 auto;padding:24px}header{border-bottom:1px solid #d1d5db;margin-bottom:16px;padding-bottom:12px}h1{font-size:22px;margin:0 0 4px}.report-meta{color:#4b5563;font-size:12px;margin:0}.report-content{background:#fff;padding:16px;border:1px solid #d1d5db}.report-content svg{max-width:100%}.chart{border:1px solid #d1d5db;border-radius:4px;background:#fff;padding:16px;margin:16px 0;overflow:hidden}.chart-top{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px}.chart-tabs{display:flex;flex-wrap:wrap;gap:4px}.chart-tabs button{border:1px solid #cbd5e1;border-radius:3px;background:#fff;color:#334155;padding:6px 10px;font:600 12px system-ui;cursor:pointer}.chart-tabs button[aria-pressed=true]{border-color:#047857;background:#ecfdf5;color:#065f46}.chart-tabs button:disabled{opacity:.4;cursor:not-allowed}.chart-periods{margin-top:12px;gap:0}.chart-periods button{border-radius:0}.chart-periods button[aria-pressed=true]{background:#111827;border-color:#111827;color:#fff}.chart-groups{margin-top:12px}.chart-groups button[aria-pressed=true]{background:#2563eb;border-color:#2563eb;color:#fff}.chart-plot-wrap{position:relative;margin-top:12px;overflow-x:auto}.chart svg{display:block;width:100%;min-width:560px;height:auto;background:#fff;touch-action:none}.chart-tooltip{position:absolute;right:8px;top:8px;max-width:55%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:3px;background:#fff;box-shadow:0 3px 12px #0002;font-size:12px;pointer-events:none}.chart-tooltip[hidden]{display:none}.chart-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:14px 0}.chart-metrics button{display:flex;min-width:0;align-items:center;gap:7px;border:1px solid #cbd5e1;border-radius:3px;background:#fff;padding:7px 9px;text-align:left;cursor:pointer}.chart-metrics button[aria-pressed=false]{opacity:.5}.chart-metrics button strong{margin-left:auto;font-size:12px}.chart-dot{width:10px;height:10px;flex:none;border-radius:50%}@media(max-width:570px){main{padding:10px}.chart-metrics{grid-template-columns:1fr}.chart-tooltip{max-width:75%}}@media print{body{background:#fff}main{max-width:none;padding:0}.chart-tabs,.chart-metrics{display:none}}
  </style></head><body><main><header><h1>Detailed report</h1><p class="report-meta">Owner-only · Generated ${generated} · Meter period ${period} · Days with readings: ${escapeHtml(energyExport?.meteredDays ?? "Unknown")}</p></header><div class="report-content">${clone.outerHTML}</div>${chart}</main>${INTERACTIVE_CHART_SCRIPT}</body></html>`;
}
