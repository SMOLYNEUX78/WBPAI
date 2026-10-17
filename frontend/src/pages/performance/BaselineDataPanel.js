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
const PRIMARY_HEALTH_FIELDS = [
  { field: "internal_temp", label: "Temperature" },
  { field: "downstairs_humidity", label: "Downstairs humidity" },
  { field: "upstairs_humidity", label: "Upstairs humidity" },
];
const FABRIC_CONCERN_KEYS = new Set(["hdd", "htc", "night-cooldown", "heat-exclusion"]);
const ConcernRow = ({ label, detail, tone = "red" }) => <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
  <span className={`inline-block min-w-36 border-l-4 px-2 py-1 font-semibold ${tone === "red" ? "border-red-700 bg-red-50 text-red-900" : tone === "amber" ? "border-amber-600 bg-amber-50 text-amber-900" : "border-emerald-700 bg-emerald-50 text-emerald-900"}`}>{label}</span>
  <span>{detail}</span>
</div>;

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
  const otherHistoricalFlags = historicalFlags.filter((finding) => !PRIMARY_HEALTH_FIELDS.some((item) => item.field === finding.field));
  const fabricConcerns = (baseline.performanceConcerns || []).filter((concern) => FABRIC_CONCERN_KEYS.has(concern.key));
  const otherPerformanceConcerns = (baseline.performanceConcerns || []).filter((concern) => !FABRIC_CONCERN_KEYS.has(concern.key));

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
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-lg font-bold">Baseline report</h2>
      <button type="button" onClick={downloadReport} disabled={downloadLoading} className="shrink-0 border border-emerald-800 px-3 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-50 disabled:cursor-wait">{downloadLoading ? "Preparing report..." : "Detailed report"}</button>
    </div>
    <div className="mt-4 grid gap-6 sm:grid-cols-2">
      <div className={`border-l-4 p-4 ${!hasEui ? "border-gray-400 bg-gray-100" : aboveTarget ? "border-amber-600 bg-amber-50" : "border-emerald-700 bg-emerald-50"}`}>
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-base font-bold">Energy</h3>
          <span className="text-lg font-bold">{Number.isFinite(baseline.energyScore) ? `${Math.round(baseline.energyScore)}/100` : "Pending"}</span>
        </div>
        <div className="mt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h4 className="text-sm font-semibold">EUI</h4>
            <p className="text-lg font-bold">{hasEui ? eui.toFixed(1) : "Pending"} <span className="text-sm font-normal">{hasEui ? "kWh/m²/year" : ""}</span></p>
          </div>
          {hasEui && Number.isFinite(target) && target > 0 ? <p className="mt-2 text-sm">{aboveTarget ? "Above" : "At or below"} WBP’s {target.toFixed(0)} kWh/m²/year planning target.</p> : null}
        </div>
        {fabricConcerns.length > 0 ? <div className="mt-4 space-y-2" aria-label="Fabric">
          <h4 className="text-sm font-bold">Fabric</h4>
          {fabricConcerns.map((concern) => <ConcernRow key={concern.key} label={concern.label} tone={concern.status === "poor" ? "red" : "amber"} detail={concern.detail} />)}
        </div> : null}
      </div>
      <div className={`border-l-4 p-4 ${!Number.isFinite(baseline.healthScore) ? "border-gray-400 bg-gray-100" : baseline.healthScore < 60 ? "border-red-700 bg-red-50" : baseline.healthScore < 80 ? "border-amber-600 bg-amber-50" : "border-emerald-700 bg-emerald-50"}`}>
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-base font-bold">Health</h3>
          <span className="text-lg font-bold">{Number.isFinite(baseline.healthScore) ? `${Math.round(baseline.healthScore)}/100` : "Pending"}</span>
        </div>
        <div className="mt-4">
        {historicalHealth.status === "ready" ? <div className="space-y-2 text-sm">
          {PRIMARY_HEALTH_FIELDS.map(({ field, label }) => {
            const finding = historicalHealth.findings.find((item) => item.field === field);
            return finding && (field !== "upstairs_humidity" || finding.redDays > 0) ? <ConcernRow key={field} label={label} tone={finding.redDays > 0 ? "red" : "green"} detail={`${finding.redDays} of ${finding.observedDays} observed days in the red`} /> : null;
          })}
          {otherHistoricalFlags.map((finding) => <ConcernRow key={finding.field} label={finding.label} detail={`${finding.redDays} of ${finding.observedDays} observed days in the red`} />)}
          {!historicalHealth.findings.length ? <p>Historical sensor readings unavailable</p> : null}
        </div> : <p className="mt-2 text-sm">{historicalHealth.status === "loading" ? "Checking past readings..." : "Historical readings unavailable"}</p>}
        </div>
      </div>
    </div>
    {(otherPerformanceConcerns.length > 0 || baseline.redReadings?.length > 0) ? <div className="mt-4 space-y-2" aria-label="Other areas to review">
      {otherPerformanceConcerns.map((concern) => <ConcernRow key={concern.key} label={concern.label} tone={concern.status === "poor" ? "red" : "amber"} detail={concern.detail} />)}
      {baseline.redReadings?.map((reading) => <ConcernRow key={reading.key} label={`${reading.label} recently`} detail={`${reading.value} ${reading.unit}`} />)}
    </div> : null}
    {exportError ? <p role="alert" className="mt-2 text-right text-sm text-red-800">{exportError}</p> : null}
    <div className="mt-7 border-t border-gray-200 pt-5">
      <h3 className="mb-3 text-base font-bold">Options</h3>
      <button type="button" onClick={() => setOpenPanel("retrofit")} className="group relative flex min-h-44 w-full items-end overflow-hidden border border-emerald-900 bg-emerald-950 p-5 text-left text-white sm:min-h-52 sm:p-7" style={{ backgroundImage: "linear-gradient(90deg, rgba(9, 43, 34, .8), rgba(9, 43, 34, .12) 75%), url('/images/retrofit-options.png')", backgroundSize: "cover", backgroundPosition: "center" }}><span className="relative text-xl font-bold drop-shadow sm:text-2xl">Explore retrofit options <span aria-hidden="true">→</span></span></button>
      <button type="button" onClick={() => setOpenPanel("sale")} className="mt-3 flex min-h-32 w-full items-end justify-between gap-4 border border-emerald-800 bg-emerald-50 px-5 py-5 text-left text-xl font-bold text-emerald-950 hover:bg-emerald-100 sm:px-7 sm:text-2xl"><span>Sell baseline data</span><span aria-hidden="true">→</span></button>
    </div>

    {openPanel === "retrofit" ? <DetailSurface modal title="Explore Retrofit Options" onClose={() => setOpenPanel(null)}>
      <div className="px-4 py-5 text-sm sm:px-6">
        <RetrofitPlanner ready embedded postcode={baseline.postcode} localAuthority={baseline.localAuthority} annualEui={baseline.annualEui} area={area} electricityDailyKwh={baseline.electricityDailyKwh} gasDailyKwh={baseline.gasDailyKwh} billReview={baseline.billReview} originalTeam={baseline.originalTeam} DetailSurface={DetailSurface} />
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
