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
const LETI_RETROFIT_EUI = 50;
const formatHealthMeasurement = (finding) => {
  const digits = finding.unit === "°C" || finding.unit === "%" ? 1 : 0;
  const format = (value) => Number(value).toFixed(digits);
  if (finding.redDays > 0 && Number.isFinite(finding.redMin) && Number.isFinite(finding.redMax)) {
    return `${format(finding.redMin)}${finding.redMin === finding.redMax ? "" : `–${format(finding.redMax)}`} ${finding.unit}`;
  }
  return Number.isFinite(finding.observedAverage) ? `${format(finding.observedAverage)} ${finding.unit}` : "Pending";
};
const fabricExplanation = (concern) => {
  if (concern.key === "hdd") {
    const period = Number(concern.evidenceDays) > 0 ? `Across ${concern.evidenceDays} colder days, ` : "";
    return concern.abovePlanningThreshold === false
      ? `${period}the home was not consistently warm. These readings cannot tell us why on their own.`
      : `${period}the home used more energy than our weather-adjusted guide suggests. This also includes hot water and appliances, so it does not prove heat is escaping.`;
  }
  if (concern.key === "heat-exclusion") {
    const hours = Number(concern.sampleHours);
    const hotThreshold = Number(concern.hotThreshold) || 24;
    const comparison = concern.detail || "less cool than expected";
    if (!Number.isFinite(hours) || hours <= 0) return `On hot days, the rooms were ${comparison}.`;
    const overheatedHours = concern.overheatedHours != null && Number.isFinite(Number(concern.overheatedHours))
      ? Number(concern.overheatedHours)
      : concern.overheatingShare != null && Number.isFinite(Number(concern.overheatingShare))
      ? Math.round(Number(concern.overheatingShare) * hours)
      : null;
    return `When it was ${hotThreshold}°C or hotter outside, the rooms averaged ${comparison} across ${hours} matched hours${overheatedHours === null ? "." : `; they reached 28°C or more for ${overheatedHours} of those hours.`}`;
  }
  return concern.explanation;
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
  const hasEui = Number.isFinite(eui) && eui > 0;
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
  const fabricConcerns = (baseline.performanceConcerns || []).filter((concern) => FABRIC_CONCERN_KEYS.has(concern.key));
  const otherPerformanceConcerns = (baseline.performanceConcerns || []).filter((concern) => !FABRIC_CONCERN_KEYS.has(concern.key));
  const temperatureFinding = historicalHealth.findings.find((finding) => finding.field === "internal_temp");
  const summerHeatFinding = fabricConcerns.find((concern) => concern.key === "heat-exclusion");
  const temperatureDetail = [
    temperatureFinding?.redDays > 0 ? `Room temperatures were outside the preferred range on ${temperatureFinding.redDays} of ${temperatureFinding.observedDays} monitored days.` : null,
    summerHeatFinding ? fabricExplanation(summerHeatFinding) : null,
  ].filter(Boolean).join(" ");
  const concernItems = [
    ...(temperatureDetail ? [{ key: "temperature", label: "Temperature", measurement: temperatureFinding?.redDays > 0 ? formatHealthMeasurement(temperatureFinding) : summerHeatFinding?.measurement || "Hot-weather concern", detail: temperatureDetail, tone: "red" }] : []),
    ...historicalFlags.filter((finding) => finding.field !== "internal_temp").map((finding) => ({
      key: finding.field, label: PRIMARY_HEALTH_FIELDS.find((item) => item.field === finding.field)?.label || finding.label,
      measurement: formatHealthMeasurement(finding), tone: "red",
      detail: `${finding.redDays} of ${finding.observedDays} monitored days were outside the preferred range.${finding.field.includes("humidity") ? " Damp air can increase the chance of condensation and mould." : " The figure shows the range of daily averages on those days."}`,
    })),
    ...fabricConcerns.filter((concern) => concern.key !== "heat-exclusion").map((concern) => ({
      key: concern.key, label: concern.key === "hdd" ? "Energy on cold days" : concern.label,
      measurement: concern.measurement || concern.detail, detail: fabricExplanation(concern), tone: concern.status === "poor" ? "red" : "amber",
    })),
    ...otherPerformanceConcerns.map((concern) => ({
      key: concern.key, label: concern.label, measurement: concern.measurement || concern.detail,
      detail: concern.explanation, tone: concern.status === "poor" ? "red" : "amber",
    })),
  ];
  const scores = [baseline.energyScore, baseline.healthScore].filter(Number.isFinite);
  const lowestScore = scores.length ? Math.min(...scores) : null;
  const reportTone = lowestScore === null ? "border-gray-300 bg-gray-50" : lowestScore < 60 ? "border-red-400 bg-red-50" : lowestScore < 80 ? "border-amber-400 bg-amber-50" : "border-emerald-400 bg-emerald-50";
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
    <div className={`wbp-baseline-summary border p-4 sm:p-5 ${reportTone}`} role="region" aria-label="Baseline findings" tabIndex={0}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-base font-bold">Baseline report: issues found</h2>
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" onClick={onOpenDetailedReport} className="border border-emerald-800 px-2 py-1.5 text-xs font-semibold text-emerald-900 hover:bg-emerald-50">Detailed report</button>
      </div>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Performance scores">
      <div className={`flex items-center gap-2 border px-3 py-1.5 text-sm ${!Number.isFinite(baseline.energyScore) ? "border-gray-300 bg-gray-100" : baseline.energyScore < 60 ? "border-red-400 bg-red-50" : baseline.energyScore < 80 ? "border-amber-400 bg-amber-50" : "border-emerald-400 bg-emerald-50"}`}><strong>Energy</strong><span>{Number.isFinite(baseline.energyScore) ? `${Math.round(baseline.energyScore)}/100` : "Pending"}</span></div>
      <div className={`flex items-center gap-2 border px-3 py-1.5 text-sm ${!Number.isFinite(baseline.healthScore) ? "border-gray-300 bg-gray-100" : baseline.healthScore < 60 ? "border-red-400 bg-red-50" : baseline.healthScore < 80 ? "border-amber-400 bg-amber-50" : "border-emerald-400 bg-emerald-50"}`}><strong>Health</strong><span>{Number.isFinite(baseline.healthScore) ? `${Math.round(baseline.healthScore)}/100` : "Pending"}</span></div>
    </div>
    <div className="mt-3 border-t border-gray-900/10 pt-3">
      <ConcernRow label="Energy use per square metre" heading plain measurement={hasEui ? `${eui.toFixed(1)} kWh/m²/year` : "Pending"} detail={hasEui ? `If this rate continued for a year, that is ${eui > LETI_RETROFIT_EUI ? "above" : "below"} LETI's 50 kWh/m²/year best-practice retrofit design target. This is an estimate from the readings, not a formal retrofit rating.` : "We need more energy readings to estimate this."} />
    </div>
    <div className="mt-4 space-y-3" aria-label="Key findings">
      {concernItems.map((concern) => <div key={concern.key} className="border-t border-gray-900/10 pt-3"><ConcernRow {...concern} /></div>)}
      {historicalHealth.status === "ready" && !historicalHealth.findings.length ? <p className="text-sm">Past room readings are not available yet.</p> : null}
      {historicalHealth.status !== "ready" ? <p className="text-sm">{historicalHealth.status === "loading" ? "Checking past room readings..." : <>Past room readings are unavailable. <button type="button" className="underline" onClick={() => setHistoryRetry((value) => value + 1)}>Retry</button></>}</p> : null}
      {historyError ? <p role="status" className="text-sm text-amber-800">Showing the last saved readings. <button type="button" className="underline" onClick={() => setHistoryRetry((value) => value + 1)}>Retry</button></p> : null}
    </div>
    </div>
    <div className="wbp-baseline-options mt-7 border-t border-gray-200 pt-5">
      <h3 className="mb-3 text-base font-bold">Options</h3>
      <button type="button" onClick={() => setOpenPanel("retrofit")} className="wbp-baseline-option group relative flex min-h-44 w-full items-end overflow-hidden border border-emerald-900 bg-emerald-950 p-5 text-left text-white sm:min-h-52 sm:p-7" style={{ backgroundImage: "linear-gradient(90deg, rgba(9, 43, 34, .8), rgba(9, 43, 34, .12) 75%), url('/images/retrofit-options.png')", backgroundSize: "cover", backgroundPosition: "center" }}><span className="relative text-xl font-bold drop-shadow sm:text-2xl">Explore retrofit options <span aria-hidden="true">→</span></span></button>
      <button type="button" onClick={() => setOpenPanel("sale")} className="wbp-baseline-option wbp-baseline-sale-option group mt-3 flex min-h-32 w-full items-center overflow-hidden border border-gray-300 bg-gray-100 text-left text-gray-900 hover:border-emerald-700">
        <span className="wbp-baseline-sale-label">
          <span>Sell baseline data <span aria-hidden="true">→</span></span>
        </span>
        <span aria-hidden="true" className="wbp-baseline-sale-data"><i /><i /><i /></span>
        <span aria-hidden="true" className="wbp-baseline-sale-buyers"><i /><i /><i /></span>
        <span aria-hidden="true" className="wbp-baseline-sale-flow wbp-baseline-sale-flow--out"><i /><i /><i /></span>
        <span aria-hidden="true" className="wbp-baseline-sale-report"><i /><i /><i /><i /></span>
        <span aria-hidden="true" className="wbp-baseline-sale-flow"><i /><i /><i /></span>
        <img src="/images/bridgewood-baseline.png" alt="" className="wbp-baseline-sale-house" />
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
