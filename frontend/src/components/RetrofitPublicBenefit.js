import React, { useState } from "react";

const CACHE_KEY = "wbp-public-benefit:v1";
const DEFAULTS = {
  healthCost: 100, reduction: 50, confidence: 25, years: 5,
  discount: 3.5, peakKw: 0, availabilityHours: 0,
  activationHours: 0, availabilityRate: 0, utilisationRate: 0,
};
const fields = [
  ["healthCost", "Housing-attributable healthcare cost (£/year)", 0, 100000, 1],
  ["reduction", "Assumed healthcare cost reduction (%)", 0, 100, 1],
  ["confidence", "Evidence confidence adjustment (%)", 0, 100, 1],
  ["peakKw", "Deliverable peak electricity reduction (kW)", 0, 10000, 0.1],
  ["availabilityHours", "Contracted availability (hours/year)", 0, 8760, 1],
  ["activationHours", "Expected activation (hours/year)", 0, 8760, 1],
  ["availabilityRate", "Availability payment (£/MW/hour)", 0, 100000, 0.01],
  ["utilisationRate", "Utilisation payment (£/MWh)", 0, 100000, 0.01],
  ["years", "Investment horizon (years)", 1, 30, 1],
  ["discount", "Annual discount rate (%)", 0, 100, 0.1],
];

export function calculatePublicBenefit(input) {
  const values = Object.fromEntries(fields.map(([key, , min, max]) => {
    const number = Number(input[key]);
    return [key, Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : min];
  }));
  const adjustment = values.confidence / 100;
  const health = values.healthCost * values.reduction / 100 * adjustment;
  const grid = values.peakKw / 1000 * (
    values.availabilityHours * values.availabilityRate +
    values.activationHours * values.utilisationRate
  ) * adjustment;
  let factor = 0;
  for (let year = 1; year <= Math.floor(values.years); year += 1) {
    factor += 1 / Math.pow(1 + values.discount / 100, year);
  }
  return { health, grid, healthInvestment: health * factor, gridInvestment: grid * factor };
}

function loadAssumptions() {
  try {
    const stored = JSON.parse(localStorage.getItem(CACHE_KEY));
    return { ...DEFAULTS, ...(stored && typeof stored === "object" ? stored : {}) };
  } catch {
    return DEFAULTS;
  }
}

const money = (value) => new Intl.NumberFormat("en-GB", {
  style: "currency", currency: "GBP", maximumFractionDigits: 2,
}).format(value);

export default function RetrofitPublicBenefit() {
  const [assumptions, setAssumptions] = useState(loadAssumptions);
  const benefit = calculatePublicBenefit(assumptions);
  const update = (key, value) => {
    const next = { ...assumptions, [key]: value };
    setAssumptions(next);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch { /* Storage may be unavailable. */ }
  };

  return (
    <section className="mt-4 border-t border-gray-200 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Retrofit Public Benefit</h3>
        <span className="text-xs text-amber-700">Illustrative / not committed funding</span>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold">Health investment case</h4>
          <p className="mt-1 text-xl font-bold break-words">{money(benefit.healthInvestment)}</p>
          <p className="text-xs text-gray-600">{money(benefit.health)}/year avoided healthcare cost</p>
          <p className="mt-1 text-xs text-amber-700">Nominal assumptions; property-level health evidence pending</p>
        </div>
        <div className="min-w-0">
          <h4 className="text-sm font-semibold">Grid flexibility investment case</h4>
          <p className="mt-1 text-xl font-bold break-words">{benefit.grid > 0 ? money(benefit.gridInvestment) : "Pending peak-demand case"}</p>
          <p className="text-xs text-gray-600">{money(benefit.grid)}/year modelled flexibility revenue</p>
          <p className="mt-1 text-xs text-amber-700">Local eligibility and contract required</p>
        </div>
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-medium">Assumptions and evidence</summary>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {fields.map(([key, label, min, max, step]) => (
            <label key={key} className="min-w-0 text-xs text-gray-700">
              {label}
              <input type="number" min={min} max={max} step={step}
                value={assumptions[key]} onChange={(event) => update(key, event.target.value)}
                className="mt-1 block w-full min-w-0 rounded border border-gray-300 bg-white p-2 text-sm" />
            </label>
          ))}
        </div>
        <p className="mt-3 text-xs text-gray-600">
          Health: annual housing-attributable cost × assumed reduction × confidence adjustment.
          Grid: kW / 1,000 × (availability hours × availability rate + activation hours × utilisation rate) × confidence adjustment.
          Investment values discount annual benefits over the selected horizon; they are not grants or an infrastructure valuation.
        </p>
        <p className="mt-2 text-xs text-gray-600">
          The £100 health cost, 50% reduction, 25% confidence and 3.5% discount are editable modelling assumptions, not NHS tariffs.
          No monetary value is inferred from the IAQ score, and no waiting-list reduction is claimed.
          Electrification can increase electricity peaks despite reducing gas use.
        </p>
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-blue-700">
          <a href="https://bregroup.com/news/bre-report-finds-poor-housing-is-costing-nhs-1.4bn-a-year" target="_blank" rel="noreferrer">BRE housing and NHS evidence (2021)</a>
          <a href="https://dso.ukpowernetworks.co.uk/flexibility" target="_blank" rel="noreferrer">UK Power Networks flexibility</a>
          <a href="https://dso.nationalgrid.co.uk/flexibility-markets/earnings-and-use-cases" target="_blank" rel="noreferrer">National Grid DSO valuation examples</a>
        </div>
      </details>
    </section>
  );
}
