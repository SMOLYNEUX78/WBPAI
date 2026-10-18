import React, { useEffect, useState } from "react";
import supabase from "../../supabaseClient";
import { DATA_LICENCE_REFERENCE_GBP_PER_YEAR } from "./retrofitEconomics";
import RetrofitPlanner from "./RetrofitPlanner";
import { buildBuyerSampleTemplate, buildOwnerBaselinePackage } from "./baselinePackages";
import { fetchHistoricalHealthDays, readHistoricalHealthSnapshot, summariseHistoricalHealth, writeHistoricalHealthSnapshot } from "./historicalHealth";

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
const formatHealthMeasurement = (finding) => {
  const digits = finding.unit === "°C" || finding.unit === "%" ? 1 : 0;
  const format = (value) => Number(value).toFixed(digits);
  if (finding.redDays > 0 && Number.isFinite(finding.redMin) && Number.isFinite(finding.redMax)) {
    return `${format(finding.redMin)}${finding.redMin === finding.redMax ? "" : `–${format(finding.redMax)}`} ${finding.unit}`;
  }
  return Number.isFinite(finding.observedAverage) ? `${format(finding.observedAverage)} ${finding.unit}` : "Pending";
};
const ConcernRow = ({ label, measurement, detail, tone = "red", heading = false, plain = false }) => {
  const Label = heading ? "h4" : "span";
  return <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,auto)] items-start gap-x-3 gap-y-1 text-sm">
  <Label className={plain ? "min-w-0 py-1 font-semibold" : `min-w-0 border-l-4 px-2 py-1 font-semibold ${tone === "red" ? "border-red-700 bg-red-50 text-red-900" : tone === "amber" ? "border-amber-600 bg-amber-50 text-amber-900" : tone === "green" ? "border-emerald-700 bg-emerald-50 text-emerald-900" : "border-gray-400 bg-gray-100 text-gray-900"}`}>{label}</Label>
  <strong className="min-w-0 py-1 text-right text-sm font-semibold break-words">{measurement || "Pending"}</strong>
  {detail ? <span className="col-span-2 text-xs text-gray-700">{detail}</span> : null}
</div>;
};

export default function BaselineDataPanel({ DetailSurface, onOpenDetailedReport, baseline = {} }) {
  const [openPanel, setOpenPanel] = useState(null);
  const [historicalHealth, setHistoricalHealth] = useState(() => readHistoricalHealthSnapshot(baseline.buildingId, baseline.sourceBuildingId || "home") || readHistoricalHealthSnapshot(baseline.propertyRecordId, baseline.sourceBuildingId || "home") || { status: "loading", findings: [] });
  const [historyRetry, setHistoryRetry] = useState(0);
  const [historyError, setHistoryError] = useState(false);
  const [packageError, setPackageError] = useState("");
  const [ownerPackageLoading, setOwnerPackageLoading] = useState(false);
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
    const sourceBuildingId = baseline.sourceBuildingId || "home";
    const snapshot = readHistoricalHealthSnapshot(baseline.buildingId, sourceBuildingId) || readHistoricalHealthSnapshot(baseline.propertyRecordId, sourceBuildingId);
    if (snapshot) setHistoricalHealth(snapshot);
    else setHistoricalHealth({ status: "loading", findings: [] });
    setHistoryError(false);
    if (snapshot?.date === new Date().toISOString().slice(0, 10) && historyRetry === 0) return undefined;
    fetchHistoricalHealthDays(supabase, sourceBuildingId)
      .then((rows) => {
        if (!cancelled) {
          const findings = summariseHistoricalHealth(rows);
          writeHistoricalHealthSnapshot(baseline.buildingId, sourceBuildingId, findings);
          setHistoricalHealth({ status: "ready", findings, date: new Date().toISOString().slice(0, 10) });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setHistoryError(true);
          if (!snapshot) setHistoricalHealth({ status: "unavailable", findings: [] });
          console.error("Historical health readings could not be refreshed", error);
        }
      });
    return () => { cancelled = true; };
  }, [baseline.buildingId, baseline.propertyRecordId, baseline.sourceBuildingId, historyRetry]);
  const historicalFlags = historicalHealth.findings.filter((finding) => finding.redDays > 0);
  const otherHistoricalFlags = historicalFlags.filter((finding) => !PRIMARY_HEALTH_FIELDS.some((item) => item.field === finding.field));
  const fabricConcerns = (baseline.performanceConcerns || []).filter((concern) => FABRIC_CONCERN_KEYS.has(concern.key));
  const otherPerformanceConcerns = (baseline.performanceConcerns || []).filter((concern) => !FABRIC_CONCERN_KEYS.has(concern.key));
  const downloadPackage = (filename, content) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const downloadOwnerPackage = async () => {
    setPackageError("");
    setOwnerPackageLoading(true);
    try {
      if (!baseline.propertyRecordId) throw new Error("Save this home profile before preparing its evidence pack.");
      const { data: payload, error } = await supabase.rpc("wbp_owner_baseline_export", { p_building_record_id: baseline.propertyRecordId });
      if (error) throw error;
      if (payload?.shareable !== false || payload?.buildingRecordId?.toLowerCase() !== baseline.propertyRecordId.toLowerCase()) {
        throw new Error("The owner-only readings could not be verified.");
      }
      downloadPackage("wbp-owner-baseline-evidence.json", buildOwnerBaselinePackage(baseline, payload, historicalHealth));
    } catch (error) {
      setPackageError(error.message || "Evidence pack unavailable.");
    } finally {
      setOwnerPackageLoading(false);
    }
  };

  return <section className="wbp-baseline-report -mx-4 border-t border-gray-300 bg-white px-4 py-4 text-gray-900 sm:px-8" aria-label="Baseline report: issues found">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-base font-bold">Baseline report: issues found</h2>
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" onClick={onOpenDetailedReport} className="border border-emerald-800 px-2 py-1.5 text-xs font-semibold text-emerald-900 hover:bg-emerald-50">Detailed report</button>
      </div>
    </div>
    <div className="wbp-baseline-scores mt-3 grid gap-3 sm:grid-cols-2">
      <div className={`border p-4 ${!hasEui ? "border-gray-300 bg-gray-100" : aboveTarget ? "border-amber-400 bg-amber-50" : "border-emerald-400 bg-emerald-50"}`}>
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-base font-bold">Energy</h3>
          <span className="text-sm font-bold">{Number.isFinite(baseline.energyScore) ? `${Math.round(baseline.energyScore)}/100` : "Pending"}</span>
        </div>
        <div className="mt-4">
          <ConcernRow label="EUI" heading plain measurement={hasEui ? `${eui.toFixed(1)} kWh/m²/year` : "Pending"} detail={hasEui && Number.isFinite(target) && target > 0 ? `${aboveTarget ? "Above" : "At or below"} WBP’s ${target.toFixed(0)} kWh/m²/year planning target.` : null} />
        </div>
        {fabricConcerns.length > 0 ? <div className="mt-4 space-y-2" aria-label="Fabric">
          <h4 className="text-sm font-bold">Fabric</h4>
          {fabricConcerns.map((concern) => <ConcernRow key={concern.key} plain={!['hdd', 'heat-exclusion'].includes(concern.key)} label={concern.key === "heat-exclusion" ? "Heat exclusion" : concern.label} measurement={concern.measurement || concern.detail} detail={concern.key === "hdd" ? "Higher energy use than expected for the cold weather." : concern.key === "heat-exclusion" ? `On hot days, the home was ${concern.detail || concern.explanation || "not consistently cooler than outside"}.` : concern.explanation} />)}
        </div> : null}
      </div>
      <div className={`border p-4 ${!Number.isFinite(baseline.healthScore) ? "border-gray-300 bg-gray-100" : baseline.healthScore < 60 ? "border-red-400 bg-red-50" : baseline.healthScore < 80 ? "border-amber-400 bg-amber-50" : "border-emerald-400 bg-emerald-50"}`}>
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-base font-bold">Health</h3>
          <span className="text-sm font-bold">{Number.isFinite(baseline.healthScore) ? `${Math.round(baseline.healthScore)}/100` : "Pending"}</span>
        </div>
        <div className="mt-4">
        {historicalHealth.status === "ready" ? <div className="space-y-2 text-sm">
          {historyError ? <p role="status" className="text-amber-800">Showing the last saved readings. <button type="button" className="underline" onClick={() => setHistoryRetry((value) => value + 1)}>Retry</button></p> : null}
          {PRIMARY_HEALTH_FIELDS.map(({ field, label }) => {
            const finding = historicalHealth.findings.find((item) => item.field === field);
            return finding && (field !== "upstairs_humidity" || finding.redDays > 0) ? <ConcernRow key={field} plain={finding.redDays === 0} label={label} measurement={formatHealthMeasurement(finding)} detail={`${finding.redDays} of ${finding.observedDays} observed days in the red${finding.redDays > 0 ? "; range of red-day daily averages" : "; overall daily average shown"}`} /> : null;
          })}
          {otherHistoricalFlags.map((finding) => <ConcernRow key={finding.field} label={finding.label} measurement={formatHealthMeasurement(finding)} detail={`${finding.redDays} of ${finding.observedDays} observed days in the red; range of red-day daily averages`} />)}
          {!historicalHealth.findings.length ? <p>Historical sensor readings unavailable</p> : null}
        </div> : <p className="mt-2 text-sm">{historicalHealth.status === "loading" ? "Checking past readings..." : <>Historical readings unavailable. <button type="button" className="underline" onClick={() => setHistoryRetry((value) => value + 1)}>Retry</button></>}</p>}
        </div>
      </div>
    </div>
    {otherPerformanceConcerns.length > 0 ? <div className="mt-4 space-y-2" aria-label="Other areas to review">
      {otherPerformanceConcerns.map((concern) => <ConcernRow key={concern.key} label={concern.label} tone={concern.status === "poor" ? "red" : "amber"} measurement={concern.measurement || concern.detail} detail={concern.explanation} />)}
    </div> : null}
    <div className="wbp-baseline-options mt-7 border-t border-gray-200 pt-5">
      <h3 className="mb-3 text-base font-bold">Options</h3>
      <button type="button" onClick={() => setOpenPanel("retrofit")} className="wbp-baseline-option group relative flex min-h-44 w-full items-end overflow-hidden border border-emerald-900 bg-emerald-950 p-5 text-left text-white sm:min-h-52 sm:p-7" style={{ backgroundImage: "linear-gradient(90deg, rgba(9, 43, 34, .8), rgba(9, 43, 34, .12) 75%), url('/images/retrofit-options.png')", backgroundSize: "cover", backgroundPosition: "center" }}><span className="relative text-xl font-bold drop-shadow sm:text-2xl">Explore retrofit options <span aria-hidden="true">→</span></span></button>
      <button type="button" onClick={() => setOpenPanel("sale")} className="wbp-baseline-option wbp-baseline-sale-option group mt-3 flex min-h-32 w-full items-center overflow-hidden border border-gray-300 bg-gray-100 text-left text-gray-900 hover:border-emerald-700">
        <img src="/images/bridgewood-baseline.png" alt="" className="wbp-baseline-sale-house" />
        <span aria-hidden="true" className="wbp-baseline-sale-flow"><i /><i /><i /></span>
        <span aria-hidden="true" className="wbp-baseline-sale-report"><i /><i /><i /><i /></span>
        <span aria-hidden="true" className="wbp-baseline-sale-flow wbp-baseline-sale-flow--out"><i /><i /><i /></span>
        <span aria-hidden="true" className="wbp-baseline-sale-buyers"><i /><i /><i /></span>
        <span className="wbp-baseline-sale-label"><span>Sell baseline data</span><span aria-hidden="true">→</span></span>
      </button>
    </div>

    {openPanel === "retrofit" ? <DetailSurface modal title="Explore Retrofit Options" onClose={() => setOpenPanel(null)}>
      <div className="px-4 py-5 text-sm sm:px-6">
        <RetrofitPlanner ready embedded postcode={baseline.postcode} localAuthority={baseline.localAuthority} annualEui={baseline.annualEui} area={area} electricityDailyKwh={baseline.electricityDailyKwh} gasDailyKwh={baseline.gasDailyKwh} gasHeatingDailyKwh={baseline.gasHeatingDailyKwh} gasDhwDailyKwh={baseline.gasDhwDailyKwh} billReview={baseline.billReview} originalTeam={baseline.originalTeam} DetailSurface={DetailSurface} />
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
        <div className="grid gap-3 border-t border-gray-200 pt-4 sm:grid-cols-2">
          <button type="button" disabled={ownerPackageLoading} onClick={downloadOwnerPackage} className="border border-emerald-800 px-3 py-2 text-left font-semibold text-emerald-900 disabled:opacity-50">{ownerPackageLoading ? "Preparing private pack..." : "Download private owner pack"}</button>
          <button type="button" onClick={() => downloadPackage("wbp-buyer-sample-template.json", buildBuyerSampleTemplate())} className="border border-gray-400 px-3 py-2 text-left font-semibold text-gray-900">Download buyer sample template</button>
        </div>
        {packageError ? <p role="alert" className="text-red-700">{packageError}</p> : null}
        <p className="text-xs text-gray-600">The buyer template contains no home readings. Neither download shares data or starts a sale.</p>
        <p className="border-t border-gray-200 pt-4 text-gray-700">WBP would check the data, find a suitable buyer and show you the exact use and payment before asking you to agree. Nothing is shared automatically. Data licensing is separate from retrofit savings and carbon credits.</p>
      </div>
    </DetailSurface> : null}
  </section>;
}
