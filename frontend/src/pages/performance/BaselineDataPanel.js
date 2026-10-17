import React, { useEffect, useState } from "react";
import supabase from "../../supabaseClient";
import { DATA_LICENCE_REFERENCE_GBP_PER_YEAR } from "./retrofitEconomics";
import RetrofitPlanner from "./RetrofitPlanner";
import { buildBaselineReportHtml } from "./baselineReport";
import { fetchHistoricalHealthDays, summariseHistoricalHealth } from "./historicalHealth";

const LICENCE_PARTS = [
  { label: "Energy performance", value: 144, colour: "#087f5b" },
  { label: "Home conditions", value: 120, colour: "#dc6b33" },
  { label: "Demand profile", value: 180, colour: "#2b69a4" },
];

export default function BaselineDataPanel({ DetailSurface, baseline = {} }) {
  const [openPanel, setOpenPanel] = useState(null);
  const [ownerExport, setOwnerExport] = useState(null);
  const [exportError, setExportError] = useState("");
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [historicalHealth, setHistoricalHealth] = useState({ status: "loading", findings: [] });
  const area = Number(baseline.area);
  const eui = Number(baseline.annualEui);
  const target = Number(baseline.targetEui);
  const hasEui = Number.isFinite(eui) && eui > 0;
  const aboveTarget = hasEui && Number.isFinite(target) && target > 0 && eui > target;
  const rainFlags = (baseline.rainHumidityAreas || []).filter((area) => area.summary?.status === "ready" && Number.isFinite(area.summary.rhUplift) && area.summary.rhUplift >= 8);
  useEffect(() => {
    let cancelled = false;
    if (!baseline.buildingId) {
      setHistoricalHealth({ status: "unavailable", findings: [] });
      return undefined;
    }
    setHistoricalHealth({ status: "loading", findings: [] });
    fetchHistoricalHealthDays(supabase, baseline.sourceBuildingId || "home")
      .then((rows) => {
        if (!cancelled) setHistoricalHealth({ status: "ready", findings: summariseHistoricalHealth(rows) });
      })
      .catch(() => {
        if (!cancelled) setHistoricalHealth({ status: "unavailable", findings: [] });
      });
    return () => { cancelled = true; };
  }, [baseline.buildingId, baseline.sourceBuildingId]);
  const historicalFlags = historicalHealth.findings.filter((finding) => finding.redDays > 0);
  const airFlags = historicalFlags.filter((finding) => finding.field !== "internal_temp");
  const temperatureFlags = historicalFlags.filter((finding) => finding.field === "internal_temp");

  const loadOwnerExport = async () => {
    if (!baseline.buildingId) throw new Error("Save this home profile before viewing its readings.");
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("Sign in again to view these readings.");
    const { data: payload, error } = await supabase.rpc("wbp_owner_baseline_export", { p_building_record_id: baseline.buildingId });
    if (error) throw new Error(error.message || "Readings unavailable.");
    if (payload?.buildingRecordId?.toLowerCase() !== baseline.buildingId.toLowerCase() || payload.shareable !== false) {
      throw new Error("These readings could not be verified.");
    }
    return payload;
  };

  const downloadReport = async () => {
    setExportError("");
    setDownloadLoading(true);
    try {
      const payload = ownerExport || await loadOwnerExport();
      setOwnerExport(payload);
      const file = new Blob([buildBaselineReportHtml({ ...baseline, historicalHealth }, payload)], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = "wbp-baseline-report.html";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setExportError(error.message || "Report unavailable.");
    } finally {
      setDownloadLoading(false);
    }
  };

  return <section className="-mx-4 border-t border-gray-300 bg-white px-4 py-6 text-gray-900 sm:px-8" aria-label="Baseline report">
    <h2 className="text-lg font-bold">Baseline report</h2>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <div className={`border-l-4 p-4 ${!hasEui ? "border-gray-400 bg-gray-100" : aboveTarget ? "border-amber-600 bg-amber-50" : "border-emerald-700 bg-emerald-50"}`}>
        <h3 className="text-sm font-semibold">Energy EUI</h3>
        <p className="mt-1 text-2xl font-bold">{hasEui ? eui.toFixed(1) : "Pending"} <span className="text-sm font-normal">{hasEui ? "kWh/m²/year" : ""}</span></p>
        {hasEui && Number.isFinite(target) && target > 0 ? <p className="mt-2 text-sm">{aboveTarget ? "Above" : "At or below"} WBP’s {target.toFixed(0)} kWh/m²/year planning target.</p> : null}
      </div>
      <div className={`border-l-4 p-4 ${!Number.isFinite(baseline.healthScore) ? "border-gray-400 bg-gray-100" : baseline.healthScore < 60 ? "border-red-700 bg-red-50" : baseline.healthScore < 80 ? "border-amber-600 bg-amber-50" : "border-emerald-700 bg-emerald-50"}`}>
        <h3 className="text-sm font-semibold">Health score</h3>
        <p className="mt-1 text-2xl font-bold">{Number.isFinite(baseline.healthScore) ? Math.round(baseline.healthScore) : "Pending"}<span className="text-sm font-normal">{Number.isFinite(baseline.healthScore) ? "/100" : ""}</span></p>
        <ul className="mt-2 space-y-1 text-sm">{historicalFlags.slice(0, 3).map((finding) => <li key={finding.field}>{finding.label}: {finding.redDays} of {finding.observedDays} observed days in the red band</li>)}{historicalHealth.status === "loading" ? <li>Checking past readings...</li> : null}{historicalHealth.status === "unavailable" ? <li>Historical readings unavailable</li> : null}{historicalHealth.status === "ready" && !historicalFlags.length ? <li>No red-band daily averages found in available history.</li> : null}</ul>
      </div>
    </div>
    <button type="button" onClick={downloadReport} disabled={downloadLoading} className="mt-4 border border-emerald-700 px-4 py-2 text-sm font-semibold text-emerald-900 disabled:opacity-50">{downloadLoading ? "Preparing report..." : "Download detailed report"}</button>
    {exportError ? <p role="alert" className="mt-2 text-sm text-red-800">{exportError}</p> : null}
    <div className="mt-5 grid gap-2 sm:grid-cols-2">
      <button type="button" onClick={() => setOpenPanel("retrofit")} className="border border-emerald-700 bg-white px-4 py-3 text-left text-sm font-semibold text-emerald-950 hover:bg-emerald-50">Retrofit options</button>
      <button type="button" onClick={() => setOpenPanel("sale")} className="border border-emerald-700 bg-white px-4 py-3 text-left text-sm font-semibold text-emerald-950 hover:bg-emerald-50">Sell baseline data</button>
    </div>

    {openPanel === "retrofit" ? <DetailSurface modal title="Retrofit options" onClose={() => setOpenPanel(null)}>
      <div className="space-y-5 px-4 py-5 text-sm sm:px-6">
        <div><h2 className="font-bold">A sensible starting point</h2><p className="mt-1 text-gray-700">Use the readings to decide what to investigate, then check the home in person before choosing works. Slider savings are provisional until the baseline is checked against typical local weather.</p></div>
        <ol className="space-y-3 border-y border-gray-200 py-4">
          {airFlags.length ? <li><strong>1. Check ventilation and moisture</strong><p className="text-gray-700">Historical red-band daily averages in {Array.from(new Set(airFlags.map((flag) => flag.label.split(" ")[0]))).join(" and ")} make ventilation, sources and controls worth reviewing.</p></li> : <li><strong>1. Review ventilation</strong><p className="text-gray-700">Check airflow and moisture before changing insulation or airtightness.</p></li>}
          {temperatureFlags.length || aboveTarget ? <li><strong>2. Survey heat loss and comfort</strong><p className="text-gray-700">{temperatureFlags.length ? "Historical temperature averages entered the red band. " : ""}{aboveTarget ? "Energy use is above the planning target. " : ""}Assess the fabric, draughts and heating controls together.</p></li> : <li><strong>2. Check fabric and heating</strong><p className="text-gray-700">A survey can identify practical improvements without assuming that a major retrofit is needed.</p></li>}
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
