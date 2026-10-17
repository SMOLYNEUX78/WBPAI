import React, { useState } from "react";
import supabase from "../../supabaseClient";
import { DATA_LICENCE_REFERENCE_GBP_PER_YEAR } from "./retrofitEconomics";

const LICENCE_PARTS = [
  { label: "Energy performance", value: 144, colour: "#087f5b" },
  { label: "Home conditions", value: 120, colour: "#dc6b33" },
  { label: "Demand profile", value: 180, colour: "#2b69a4" },
];

const formatDate = (value) => value ? new Date(value).toLocaleDateString("en-GB") : "No readings";

export default function BaselineDataPanel({ DetailSurface, baseline = {}, onOpenRetrofit }) {
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

  return <section className="-mx-4 border-t border-gray-300 bg-white px-4 py-6 text-gray-900 sm:px-8" aria-label="Baseline outcomes">
    <h2 className="text-lg font-bold">What your baseline can tell you</h2>
    <p className="mt-1 max-w-2xl text-sm text-gray-700">A preview of what a complete baseline could unlock. Your measured readings and permissions remain unchanged.</p>
    <div className="mt-4 grid gap-2 sm:grid-cols-3">
      {[["report", "Property report", "Health and energy"], ["retrofit", "Retrofit options", "What to explore"], ["sale", "Sell baseline data", "Potential data value"]].map(([id, label, description]) =>
        <button key={id} type="button" onClick={() => setOpenPanel(id)} className="flex min-h-20 flex-col justify-center border border-emerald-700 bg-white px-4 py-3 text-left hover:bg-emerald-50">
          <strong className="text-sm text-emerald-950">{label}</strong><span className="mt-1 text-xs text-gray-600">{description}</span>
        </button>)}
    </div>

    {openPanel === "report" ? <DetailSurface modal title="Property report" onClose={() => setOpenPanel(null)}>
      <div className="space-y-5 px-4 py-5 text-sm sm:px-6">
        <div>
          <h2 className="font-bold">Home at a glance</h2>
          <p className="mt-1 text-gray-700">{Number.isFinite(area) && area > 0 ? `${area.toFixed(1)} m² home` : "Floor area pending"} · {hasEui ? `${eui.toFixed(1)} kWh/m²/year measured energy use` : "Energy use pending"}</p>
          <p className="mt-1 text-gray-700">Health score: {Number.isFinite(baseline.healthScore) ? `${Math.round(baseline.healthScore)}/100` : "Pending"} · Energy score: {Number.isFinite(baseline.energyScore) ? `${Math.round(baseline.energyScore)}/100` : "Pending"}</p>
          {hasEui && Number.isFinite(target) && target > 0 ? <p className="mt-1 text-gray-700">{aboveTarget ? "Above" : "At or below"} the dashboard's {target.toFixed(0)} kWh/m²/year planning target. This is not an EPC rating or a like-for-like peer comparison.</p> : null}
        </div>
        <div className="border-t border-gray-200 pt-4">
          <h2 className="font-bold">Room conditions</h2>
          <p className="mt-1 text-xs text-gray-600">Latest available readings, not a count of incidents across the whole baseline.</p>
          {rooms.length ? <div className="mt-3 divide-y divide-gray-200 border-y border-gray-200">{rooms.map((room) => {
            const flags = redReadings.filter((reading) => reading.key.startsWith(`${room.key}:`));
            const readingTime = Date.parse(room.timestamp || "");
            const recent = Number.isFinite(readingTime) && readingTime <= Date.now() && Date.now() - readingTime <= 2 * 60 * 60 * 1000;
            return <div key={room.key} className="flex flex-wrap items-start justify-between gap-2 py-3">
              <div><strong>{room.label}</strong><p className="text-xs text-gray-600">{room.timestamp ? `Reading ${new Date(room.timestamp).toLocaleString("en-GB")}` : "No recent timestamp"}</p></div>
              <span className={`text-xs font-semibold ${flags.length ? "text-red-800" : "text-gray-600"}`}>{flags.length ? flags.map((flag) => `${flag.label.replace(`${room.label} `, "")} ${flag.value} ${flag.unit}`).join(" · ") : recent ? "No current red-band reading" : "No recent reading"}</span>
            </div>;
          })}</div> : <p className="mt-2 text-gray-700">No room sensor readings available yet.</p>}
          <p className="mt-2 text-xs text-gray-600">A quiet or missing latest reading does not prove that a room stayed healthy throughout the year.</p>
        </div>
        <details className="border-t border-gray-200 pt-4"><summary className="cursor-pointer font-semibold text-emerald-900">View my energy readings</summary>
          <div className="mt-3 space-y-2"><button type="button" onClick={reviewExport} disabled={exportLoading} className="border border-emerald-700 px-3 py-2 font-semibold text-emerald-900 disabled:opacity-50">{exportLoading ? "Loading readings..." : "Load readings"}</button>
            {exportError ? <p role="alert" className="text-red-800">{exportError}</p> : null}
            {ownerExport ? <div aria-label="Private energy readings" className="space-y-1 text-gray-700"><p className="font-semibold">Private to you, not available to buyers</p><p>{formatDate(ownerExport.periodStart)} to {formatDate(ownerExport.periodEnd)} · {ownerExport.meteredDays} days with readings; some days may have gaps.</p>{(ownerExport.fuelSummaries || []).map((fuel) => <p key={fuel.fuelType}>{fuel.fuelType === "gas" ? "Gas" : "Electricity"}: {Number(fuel.totalKwh).toFixed(1)} kWh</p>)}</div> : null}
          </div>
        </details>
      </div>
    </DetailSurface> : null}

    {openPanel === "retrofit" ? <DetailSurface modal title="Retrofit options" onClose={() => setOpenPanel(null)}>
      <div className="space-y-5 px-4 py-5 text-sm sm:px-6">
        <div><h2 className="font-bold">A sensible starting point</h2><p className="mt-1 text-gray-700">Use the readings to decide what to investigate, then check the home in person before choosing works.</p></div>
        <ol className="space-y-3 border-y border-gray-200 py-4">
          {airFlags.length ? <li><strong>1. Check ventilation and moisture</strong><p className="text-gray-700">Current red-band air readings in {Array.from(new Set(airFlags.map((flag) => flag.label.split(" ")[0]))).join(" and ")} make ventilation, sources and controls worth reviewing.</p></li> : <li><strong>1. Review ventilation</strong><p className="text-gray-700">Check airflow and moisture before changing insulation or airtightness, even without a current red-band reading.</p></li>}
          {temperatureFlags.length || aboveTarget ? <li><strong>2. Survey heat loss and comfort</strong><p className="text-gray-700">{temperatureFlags.length ? "A room temperature is currently in the red band. " : ""}{aboveTarget ? "Energy use is above the planning target. " : ""}Assess the fabric, draughts and heating controls together.</p></li> : <li><strong>2. Check fabric and heating</strong><p className="text-gray-700">A survey can identify practical improvements without assuming that a major retrofit is needed.</p></li>}
          <li><strong>3. Compare whole-home options</strong><p className="text-gray-700">Use the existing retrofit planner to compare staged fabric, ventilation and heating measures. Costs and savings remain estimates until surveyed and quoted.</p></li>
        </ol>
        {onOpenRetrofit ? <button type="button" onClick={() => { setOpenPanel(null); onOpenRetrofit(); }} className="border border-emerald-700 bg-emerald-700 px-4 py-2 font-semibold text-white">Open retrofit planner</button> : null}
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
