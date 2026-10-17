import React, { useState } from "react";
import supabase from "../../supabaseClient";
import { DATA_LICENCE_REFERENCE_GBP_PER_YEAR } from "./retrofitEconomics";
import RetrofitPlanner from "./RetrofitPlanner";

const LICENCE_PARTS = [
  { label: "Energy performance", value: 144, colour: "#087f5b" },
  { label: "Home conditions", value: 120, colour: "#dc6b33" },
  { label: "Demand profile", value: 180, colour: "#2b69a4" },
];

const formatDate = (value) => value ? new Date(value).toLocaleDateString("en-GB") : "No readings";

const averageField = (rows, field) => {
  const values = (rows || []).map((row) => row[field]).filter((value) => Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
};

export default function BaselineDataPanel({ DetailSurface, baseline = {} }) {
  const [openPanel, setOpenPanel] = useState(null);
  const [ownerExport, setOwnerExport] = useState(null);
  const [exportError, setExportError] = useState("");
  const [exportLoading, setExportLoading] = useState(false);
  const rooms = baseline.rooms || [];
  const redReadings = baseline.redReadings || [];
  const area = Number(baseline.area);
  const eui = Number(baseline.annualEui);
  const target = Number(baseline.targetEui);
  const hasEui = Number.isFinite(eui) && eui > 0;
  const aboveTarget = hasEui && Number.isFinite(target) && target > 0 && eui > target;
  const airFlags = redReadings.filter((reading) => /RH|PM|VOCs|HCHO|NO2|CO2/.test(reading.label));
  const temperatureFlags = redReadings.filter((reading) => /Temperature/.test(reading.label));
  const rainFlags = (baseline.rainHumidityAreas || []).filter((area) => area.summary?.status === "ready" && Number.isFinite(area.summary.rhUplift) && area.summary.rhUplift >= 8);
  const weeklyRooms = [
    { label: "Upstairs", humidity: "upstairsHumidity", pm25: "upstairsPm25", vocs: "upstairsVocs" },
    { label: "Downstairs", humidity: "downstairsHumidity", pm25: "downstairsPm25", vocs: "downstairsVocs" },
  ];

  const reviewExport = async () => {
    setExportError("");
    setOwnerExport(null);
    if (!baseline.buildingId) {
      setExportError("Save this home profile before viewing its readings.");
      return;
    }
    setExportLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sign in again to view these readings.");
      const { data: payload, error } = await supabase.rpc("wbp_owner_baseline_export", {
        p_building_record_id: baseline.buildingId,
      });
      if (error) throw new Error(error.message || "Readings unavailable.");
      if (payload?.buildingRecordId?.toLowerCase() !== baseline.buildingId.toLowerCase() || payload.shareable !== false) {
        throw new Error("These readings could not be verified.");
      }
      setOwnerExport(payload);
    } catch (error) {
      setExportError(error.message || "Readings unavailable.");
    } finally {
      setExportLoading(false);
    }
  };

  return <section className="-mx-4 border-t border-gray-300 bg-white px-4 py-6 text-gray-900 sm:px-8" aria-label="Baseline report">
    <h2 className="text-lg font-bold">Baseline report</h2>
    <p className="mt-1 max-w-2xl text-xs text-gray-600">100% baseline scenario using the readings currently available. This is a working report, not a verified full-year audit.</p>
    <div className="mt-5 space-y-5 text-sm">
      <div className="grid gap-5 border-y border-gray-200 py-4 sm:grid-cols-2">
        <div>
          <h3 className="font-bold">Energy for this home</h3>
          <p className="mt-1 text-gray-700">{Number.isFinite(area) && area > 0 ? `${area.toFixed(1)} m² home` : "Floor area pending"} · {hasEui ? `${eui.toFixed(1)} kWh/m²/year measured energy use` : "Energy use pending"}</p>
          {hasEui && Number.isFinite(target) && target > 0 ? <p className="mt-1 text-gray-700">{aboveTarget ? "Above" : "At or below"} the dashboard's {target.toFixed(0)} kWh/m²/year planning target. This is not an EPC rating or a like-for-like peer comparison.</p> : null}
          <p className="mt-2 text-gray-700">Average day: {Number.isFinite(baseline.electricityDailyKwh) ? `${baseline.electricityDailyKwh.toFixed(1)} kWh electricity` : "electricity pending"} · {Number.isFinite(baseline.gasDailyKwh) ? `${baseline.gasDailyKwh.toFixed(1)} kWh gas` : "gas pending"}</p>
          <p className="mt-1 text-gray-700">Weather-normalised use: {Number.isFinite(baseline.heatLoss?.weatherNormalisedEui) ? `${baseline.heatLoss.weatherNormalisedEui.toFixed(1)} kWh/m²/year` : "Pending cold-weather evidence"}</p>
        </div>
        <div>
          <h3 className="font-bold">What needs attention</h3>
          <p className="mt-1 text-gray-700">Health score: {Number.isFinite(baseline.healthScore) ? `${Math.round(baseline.healthScore)}/100` : "Pending"} · Energy score: {Number.isFinite(baseline.energyScore) ? `${Math.round(baseline.energyScore)}/100` : "Pending"}</p>
          <ul className="mt-2 space-y-1 text-gray-700">
            {redReadings.map((reading) => <li key={reading.key} className="font-semibold text-red-800">{reading.label}: {reading.value} {reading.unit} in the red band now</li>)}
            {rainFlags.map((area) => <li key={area.label} className="font-semibold text-red-800">{area.label}: humidity rises {area.summary.rhUplift.toFixed(1)} percentage points after rain</li>)}
            {aboveTarget ? <li>Energy use is above the {target.toFixed(0)} kWh/m²/year planning target.</li> : null}
            {!redReadings.length && !rainFlags.length && !aboveTarget ? <li>No current red-band or rain-related flags in the available summaries.</li> : null}
          </ul>
          <p className="mt-2 text-xs text-gray-600">A missing flag does not rule out past problems or unmonitored rooms.</p>
        </div>
      </div>
      <div>
        <h3 className="font-bold">Room-by-room picture</h3>
        <p className="mt-1 text-xs text-gray-600">Latest readings and available weekly-profile averages. More rooms appear here as their sensors connect.</p>
        {rooms.length ? <div className="mt-2 divide-y divide-gray-200 border-y border-gray-200">{rooms.map((room) => {
            const flags = redReadings.filter((reading) => reading.key.startsWith(`${room.key}:`));
            const readingTime = Date.parse(room.timestamp || "");
            const recent = Number.isFinite(readingTime) && readingTime <= Date.now() && Date.now() - readingTime <= 2 * 60 * 60 * 1000;
            const weekly = weeklyRooms.find((item) => item.label.toLowerCase() === room.label.toLowerCase());
            const averages = weekly ? [["RH", weekly.humidity, "%"], ["PM2.5", weekly.pm25, "µg/m³"], ["VOCs", weekly.vocs, "ppb"]]
              .map(([label, field, unit]) => { const value = averageField(baseline.weeklyTrend, field); return Number.isFinite(value) ? `${label} ${value.toFixed(1)} ${unit}` : null; }).filter(Boolean) : [];
            return <div key={room.key} className="grid gap-1 py-3 sm:grid-cols-[minmax(100px,0.4fr)_minmax(0,1fr)] sm:gap-4">
              <div><strong>{room.label}</strong><p className="text-xs text-gray-600">{room.timestamp ? `Latest ${new Date(room.timestamp).toLocaleString("en-GB")}` : "No recent timestamp"}</p></div>
              <div><p className={flags.length ? "font-semibold text-red-800" : "text-gray-700"}>{flags.length ? flags.map((flag) => `${flag.label.replace(`${room.label} `, "")} ${flag.value} ${flag.unit}`).join(" · ") : recent ? "No current red-band reading" : "No recent reading"}</p>{averages.length ? <p className="mt-1 text-xs text-gray-600">Weekly profile averages: {averages.join(" · ")}</p> : null}</div>
            </div>;
          })}</div> : <p className="mt-2 text-gray-700">No room sensor readings available yet.</p>}
      </div>
      <div className="border-t border-gray-200 pt-4">
        <h3 className="font-bold">Heat and weather</h3>
        <p className="mt-1 text-gray-700">Heat-loss estimate: {Number.isFinite(baseline.heatLoss?.htcEstimate) ? `${baseline.heatLoss.htcEstimate.toFixed(0)} W/K` : "Pending indoor/outdoor and energy overlap"} · Night cooldown: {Number.isFinite(baseline.heatLoss?.nightCooldownRateCPerHour) ? `${baseline.heatLoss.nightCooldownRateCPerHour.toFixed(2)} °C/hour` : "Pending qualifying nights"}</p>
        {(baseline.rainHumidityAreas || []).map((area) => <p key={area.label} className="mt-1 text-gray-700">{area.label} after rain: {Number.isFinite(area.summary?.rhUplift) ? `${area.summary.rhUplift.toFixed(1)} percentage points higher RH` : "Comparison pending"}</p>)}
        <p className="mt-2 text-xs text-gray-600">These are indications for a survey, not diagnoses of damp or measured retrofit savings.</p>
      </div>
      <details className="border-t border-gray-200 pt-4"><summary className="cursor-pointer font-semibold text-emerald-900">View my energy readings</summary>
          <div className="mt-3 space-y-2"><button type="button" onClick={reviewExport} disabled={exportLoading} className="border border-emerald-700 px-3 py-2 font-semibold text-emerald-900 disabled:opacity-50">{exportLoading ? "Loading readings..." : "Load readings"}</button>
            {exportError ? <p role="alert" className="text-red-800">{exportError}</p> : null}
            {ownerExport ? <div aria-label="Private energy readings" className="space-y-1 text-gray-700"><p className="font-semibold">Private to you, not available to buyers</p><p>{formatDate(ownerExport.periodStart)} to {formatDate(ownerExport.periodEnd)} · {ownerExport.meteredDays} days with readings; some days may have gaps.</p>{(ownerExport.fuelSummaries || []).map((fuel) => <p key={fuel.fuelType}>{fuel.fuelType === "gas" ? "Gas" : "Electricity"}: {Number(fuel.totalKwh).toFixed(1)} kWh</p>)}</div> : null}
          </div>
      </details>
    </div>
    <div className="mt-5 grid gap-2 sm:grid-cols-2">
      <button type="button" onClick={() => setOpenPanel("retrofit")} className="border border-emerald-700 bg-white px-4 py-3 text-left text-sm font-semibold text-emerald-950 hover:bg-emerald-50">Retrofit options</button>
      <button type="button" onClick={() => setOpenPanel("sale")} className="border border-emerald-700 bg-white px-4 py-3 text-left text-sm font-semibold text-emerald-950 hover:bg-emerald-50">Sell baseline data</button>
    </div>

    {openPanel === "retrofit" ? <DetailSurface modal title="Retrofit options" onClose={() => setOpenPanel(null)}>
      <div className="space-y-5 px-4 py-5 text-sm sm:px-6">
        <div><h2 className="font-bold">A sensible starting point</h2><p className="mt-1 text-gray-700">Use the readings to decide what to investigate, then check the home in person before choosing works.</p></div>
        <ol className="space-y-3 border-y border-gray-200 py-4">
          {airFlags.length ? <li><strong>1. Check ventilation and moisture</strong><p className="text-gray-700">Current red-band air readings in {Array.from(new Set(airFlags.map((flag) => flag.label.split(" ")[0]))).join(" and ")} make ventilation, sources and controls worth reviewing.</p></li> : <li><strong>1. Review ventilation</strong><p className="text-gray-700">Check airflow and moisture before changing insulation or airtightness, even without a current red-band reading.</p></li>}
          {temperatureFlags.length || aboveTarget ? <li><strong>2. Survey heat loss and comfort</strong><p className="text-gray-700">{temperatureFlags.length ? "A room temperature is currently in the red band. " : ""}{aboveTarget ? "Energy use is above the planning target. " : ""}Assess the fabric, draughts and heating controls together.</p></li> : <li><strong>2. Check fabric and heating</strong><p className="text-gray-700">A survey can identify practical improvements without assuming that a major retrofit is needed.</p></li>}
          <li><strong>3. Compare whole-home options</strong><p className="text-gray-700">Use the existing retrofit planner to compare staged fabric, ventilation and heating measures. Costs and savings remain estimates until surveyed and quoted.</p></li>
        </ol>
        <RetrofitPlanner ready annualEui={baseline.annualEui} area={area} electricityDailyKwh={baseline.electricityDailyKwh} gasDailyKwh={baseline.gasDailyKwh} billReview={baseline.billReview} DetailSurface={DetailSurface} />
      </div>
    </DetailSurface> : null}

    {openPanel === "sale" ? <DetailSurface modal title="Sell baseline data" onClose={() => setOpenPanel(null)}>
      <div className="space-y-5 px-4 py-5 text-sm sm:px-6">
        <div><h2 className="font-bold">Potential data value</h2><p className="mt-1 text-gray-700">One verified home record could support more than one permitted use. The amounts below are WBP planning assumptions, not offers or expected earnings for this home.</p></div>
        <div className="flex flex-col items-center gap-5 border-y border-gray-200 py-5 sm:flex-row" aria-label="Illustrative annual data licence split">
          <div role="img" aria-label="Illustrative annual value split: energy performance £144, home conditions £120, demand profile £180" className="relative aspect-square w-40 shrink-0 rounded-full" style={{ background: "conic-gradient(#087f5b 0% 32.43%, #dc6b33 32.43% 59.46%, #2b69a4 59.46% 100%)" }}><div className="absolute inset-8 flex flex-col items-center justify-center rounded-full bg-white text-center"><strong className="text-xl">£{DATA_LICENCE_REFERENCE_GBP_PER_YEAR}</strong><span className="text-xs">illustrative / year</span></div></div>
          <div className="w-full space-y-2">{LICENCE_PARTS.map((part) => <div key={part.label} className="flex items-center gap-2"><span className="h-3 w-3 shrink-0" style={{ backgroundColor: part.colour }} /><span className="flex-1">{part.label}</span><strong>£{part.value}</strong></div>)}</div>
        </div>
        <div><strong>£0 secured</strong><p className="mt-1 text-gray-700">No buyer, price, licence or payment is agreed. For one home, buyers may offer much less or nothing; portfolio-scale data may be more attractive.</p></div>
        <p className="border-t border-gray-200 pt-4 text-gray-700">WBP would check the data, find a suitable buyer and show you the exact use and payment before asking you to agree. Nothing is shared automatically. Data licensing is separate from retrofit savings and carbon credits.</p>
      </div>
    </DetailSurface> : null}
  </section>;
}
