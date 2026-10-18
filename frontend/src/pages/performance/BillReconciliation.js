import React, { useEffect, useState } from "react";
import supabase from "../../supabaseClient";

export const assessBillPeriod = (period, data) => {
  if (data.beforeMeterCutover) return { label: "Older meter excluded", detail: "This bill starts before the recorded meter change." };
  if (Number(data.missingIntervals) > 0 || Number(data.extraIntervals) > 0 || Number(data.duplicateIntervals) > 0) {
    return { label: "Needs attention", detail: "Some half-hour readings are missing or duplicated." };
  }
  if (period.startKind === "estimated" || period.endKind === "estimated") {
    return { label: "Estimated bill", detail: "The meter data is complete, but this bill cannot verify its usage." };
  }
  const low = Number(data.coreKwh);
  const high = low + Number(data.startDayKwh) + Number(data.endDayKwh);
  const billed = Number(period.billedKwh);
  if (![low, high, billed].every(Number.isFinite)) return { label: "Needs attention", detail: "Check the bill's energy-used value." };
  const margin = Math.max(0.2, billed * 0.002);
  return billed >= low - margin && billed <= high + margin
    ? { label: "Usage consistent", detail: `${billed.toFixed(1)} kWh billed; ${low.toFixed(1)}–${high.toFixed(1)} kWh possible without exact reading times. Meter identity is not independently verified.` }
    : { label: "Needs review", detail: `${billed.toFixed(1)} kWh billed; ${low.toFixed(1)}–${high.toFixed(1)} kWh possible. Check meter, dates and units.` };
};

const validPeriod = (period) => ["electricity", "gas"].includes(period.fuel)
  && /^\d{4}-\d{2}-\d{2}$/.test(period.startDate || "")
  && /^\d{4}-\d{2}-\d{2}$/.test(period.endDate || "")
  && period.startDate < period.endDate && Number.isFinite(Number(period.billedKwh))
  && String(period.billedKwh).trim() !== "";

export default function BillReconciliation({ recordId, periods = [] }) {
  const [results, setResults] = useState([]);
  const periodKey = JSON.stringify(periods);
  useEffect(() => {
    let cancelled = false;
    const currentPeriods = JSON.parse(periodKey);
    if (!recordId || !currentPeriods.length) { setResults([]); return undefined; }
    setResults(currentPeriods.map(() => ({ label: "Checking...", detail: "" })));
    const timer = setTimeout(() => Promise.all(currentPeriods.map(async (period) => {
      if (!validPeriod(period)) return { label: "Enter bill details", detail: "Check fuel, dates and energy used." };
      const { data, error } = await supabase.rpc("wbp_owner_bill_reconciliation", {
        p_building_record_id: recordId, p_fuel_type: period.fuel,
        p_start_date: period.startDate, p_end_date: period.endDate,
      });
      if (error || !data) return { label: "Check unavailable", detail: "The private energy check could not run. No result has been verified." };
      return assessBillPeriod(period, data);
    })).then((next) => { if (!cancelled) setResults(next); }), 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [recordId, periodKey]);
  if (!periods.length) return <p className="text-xs text-gray-600">No dated bill readings checked yet.</p>;
  return <div className="space-y-2" aria-label="Energy bill checks">{periods.map((period, index) => <div key={`${period.meter || period.fuel}-${period.startDate}-${index}`} className="border-l-4 border-emerald-700 bg-gray-50 p-2 text-xs">
    <strong className="capitalize">{period.fuel || "Meter"}: {results[index]?.label || "Checking..."}</strong>
    <p className="text-gray-700">{period.startDate || "Start date"} to {period.endDate || "End date"} · {period.meter || "Meter number not recorded"}</p>
    {results[index]?.detail ? <p className="mt-1 text-gray-700">{results[index].detail}</p> : null}
  </div>)}</div>;
}
