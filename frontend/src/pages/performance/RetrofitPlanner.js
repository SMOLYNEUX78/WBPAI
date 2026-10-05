import React, { useState } from "react";
import { getAnnualBenefitBreakdown, projectInsuranceSaving, projectRetrofit, RETROFIT_OPTIONS } from "./retrofitEconomics";

const FUNDING = [
  { name: "Warm Homes: Local Grant", href: "https://www.gov.uk/apply-warm-homes-local-grant", note: "Private homes; income and official energy-certificate eligibility apply." },
  { name: "Boiler Upgrade Scheme", href: "https://www.gov.uk/apply-boiler-upgrade-scheme/check-if-youre-eligible", note: "For eligible low-carbon heating; an MCS installer checks the property." },
  { name: "Suffolk home energy support", href: "https://www.suffolk.gov.uk/", note: "Check current county and district schemes before applying." },
];

const formatGbp = (value) => `£${Math.round(value).toLocaleString("en-GB")}`;

export default function RetrofitPlanner({ ready, annualEui, area, electricityDailyKwh, gasDailyKwh, billReview, DetailSurface }) {
  const [selected, setSelected] = useState("fabric");
  const [packOpen, setPackOpen] = useState(false);
  const [annualPremium, setAnnualPremium] = useState("");
  const [selectedScenario, setSelectedScenario] = useState("central");
  const option = RETROFIT_OPTIONS.find((item) => item.id === selected);
  const projection = projectRetrofit({ option, annualEui, area, electricityDailyKwh, gasDailyKwh, billReview });
  const costRange = projection.costRangeGbp;
  const activeScenario = projection.scenarios.find((scenario) => scenario.id === selectedScenario);
  const annualBenefit = getAnnualBenefitBreakdown(activeScenario, annualPremium);
  let piePosition = 0;
  const pieStops = annualBenefit?.total > 0 ? annualBenefit.parts.map((part) => {
    const start = piePosition;
    piePosition += part.value / annualBenefit.total * 100;
    return `${part.colour} ${start}% ${piePosition}%`;
  }).join(", ") : "#e5e7eb 0% 100%";

  return (
    <section className="wbp-retrofit-planner" aria-label="Retrofit planning">
      <h2 className="text-lg font-bold">Retrofit options</h2>
      {ready ? (
        <div className="wbp-retrofit-content">
          <div className="wbp-retrofit-options" role="group" aria-label="Retrofit options">
            {RETROFIT_OPTIONS.map((item) => (
              <button key={item.id} type="button" aria-pressed={item.id === selected} className={item.id === selected ? "wbp-retrofit-option wbp-retrofit-option--selected" : "wbp-retrofit-option"} onClick={() => setSelected(item.id)}>
                <strong>{item.name}</strong><span>Planning target: {item.reduction}% lower EUI</span>
              </button>
            ))}
          </div>
          <div className="wbp-retrofit-forecast">
            <p><strong>{option.name}</strong> · {option.measures}</p>
            <p>{projection.targetEui !== null ? `Target EUI ${projection.targetEui.toFixed(1)} kWh/m²/yr` : "Target EUI pending baseline"}</p>
            <label className="wbp-retrofit-premium">Current annual buildings insurance premium, optional (£)
              <input type="number" min="0" max="100000" step="1" inputMode="decimal" value={annualPremium} onChange={(event) => setAnnualPremium(event.target.value)} placeholder="Enter premium to compare quotes" />
            </label>
            <div className="wbp-retrofit-benefit" aria-label="Potential annual benefit breakdown">
              <div className="wbp-retrofit-benefit-main">
                <p>Potential annual benefit</p>
                <strong>{annualBenefit ? `${formatGbp(annualBenefit.total)}/yr` : "Pending baseline"}</strong>
                <span>{activeScenario.label} scenario · not secured income</span>
                <span>Installed cost: {activeScenario.costGbp === null ? "pending area" : formatGbp(activeScenario.costGbp)} before grants</span>
                <div className="wbp-retrofit-benefit-switch" role="group" aria-label="Annual benefit scenario">
                  {projection.scenarios.map((scenario) => <button key={scenario.id} type="button" aria-pressed={scenario.id === selectedScenario} onClick={() => setSelectedScenario(scenario.id)}>{scenario.label}</button>)}
                </div>
              </div>
              <div className="wbp-retrofit-benefit-pie" role="img" aria-label={annualBenefit ? `Annual benefit split: ${annualBenefit.parts.map((part) => `${part.label} ${formatGbp(part.value)}`).join(", ")}` : "Annual benefit split pending baseline"} style={{ background: `conic-gradient(${pieStops})` }}><span /></div>
              <div className="wbp-retrofit-benefit-key">
                {annualBenefit?.parts.map((part) => <div key={part.label}><i style={{ backgroundColor: part.colour }} /><span>{part.label}</span><strong>{formatGbp(part.value)}</strong></div>)}
                {annualBenefit && !annualBenefit.insuranceIncluded ? <small>Insurance excluded until a premium is entered.</small> : null}
              </div>
            </div>
            <div className="wbp-retrofit-scenarios" role="table" aria-label="Retrofit cost and annual value scenarios">
              <div className="wbp-retrofit-scenario-labels" role="row"><span role="columnheader">Scenario</span>{projection.scenarios.map((scenario) => <strong role="columnheader" key={scenario.id}>{scenario.label}</strong>)}</div>
              {[
                ["Installed cost", (s) => s.costGbp === null ? "Needs floor area" : formatGbp(s.costGbp)],
                ["Energy saved /yr", (s) => s.energySavedKwh === null ? "Pending" : `${Math.round(s.energySavedKwh).toLocaleString("en-GB")} kWh`],
                ["Bill saving /yr", (s) => s.billSavedGbp === null ? "Pending" : formatGbp(s.billSavedGbp)],
                ["Carbon saved /yr", (s) => s.carbonSavedTonnes === null ? "Pending" : `${s.carbonSavedTonnes.toFixed(2)} tCO₂e`],
                ["Carbon price /t", (s) => s.carbonPrice ? formatGbp(s.carbonPrice) : "No sale"],
                ["Carbon value /yr", (s) => s.carbonValueGbp === null ? "Pending" : formatGbp(s.carbonValueGbp)],
                ["Data licences /yr", (s) => formatGbp(s.dataIncome)],
                ["Insurance /yr", (s) => { const saving = projectInsuranceSaving(annualPremium, s.insuranceDiscount); return saving === null ? "Enter premium" : `${formatGbp(saving)} (${Math.round(s.insuranceDiscount * 100)}%)`; }],
              ].map(([label, render]) => <div role="row" key={label}><span role="rowheader">{label}</span>{projection.scenarios.map((scenario) => <span role="cell" key={scenario.id}>{render(scenario)}</span>)}</div>)}
            </div>
            <p className="wbp-retrofit-caveat">Illustrative scenarios, not quotes or offers. Savings are 50%, 100% and 125% of the selected planning target; winter baseline is incomplete. Carbon prices of £0, £65 and £150/t and data income of £0, £222 and £444/yr are assumptions, not market bids. Insurance at 0%, 5% and 10% is quote sensitivity only: no insurer has agreed a discount, and energy efficiency alone does not establish lower claims risk. £0 credits issued and £0 licences contracted. Bill and carbon proxies hold today’s fuel mix constant, so they do not model heat-pump electricity demand or rebound. Costs exclude grants.</p>
            <p className="wbp-retrofit-sources">Cost ranges are WBP planning allowances informed by <a href="https://energysavingtrust.org.uk/retrofitting-the-uks-housing-stock-to-reach-net-zero/" target="_blank" rel="noreferrer">Energy Saving Trust measures</a>; fallback unit rates use <a href="https://www.ofgem.gov.uk/your-energy-supply/your-energy-bill/energy-price-cap-unit-rates-and-standing-charges" target="_blank" rel="noreferrer">Ofgem’s October 2026 averages</a>. Carbon factors: <a href="https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2026" target="_blank" rel="noreferrer">DESNZ 2026</a>.</p>
            <button type="button" onClick={() => setPackOpen(true)}>View retrofit pack</button>
          </div>
        </div>
      ) : <p className="wbp-retrofit-locked">The retrofit menu unlocks when the measured baseline reaches 100% confidence.</p>}
      {packOpen ? <DetailSurface modal title={`${option.name} plan`} onClose={() => setPackOpen(false)}>
        <div className="wbp-retrofit-pack">
          <p>Planning target: {option.reduction}% lower EUI. Commission a whole-home assessment to validate measures, costs and comfort before procurement.</p>
          <p>Indicative installed cost: {costRange ? `${formatGbp(costRange[0])}–${formatGbp(costRange[1])}` : "awaiting floor area"}, before grants. Annual energy saving: {projection.energySavedKwh !== null ? `${Math.round(projection.energySavedKwh).toLocaleString("en-GB")} kWh` : "pending"}. Carbon and data income are not secured.</p>
          <h3>Funding to check</h3>
          <ul>{FUNDING.map((source) => <li key={source.name}><a href={source.href} target="_blank" rel="noreferrer">{source.name}</a><span>{source.note}</span></li>)}</ul>
          <h3>Design and build</h3>
          <p>No WBP design or build profile has a verified, measured retrofit outcome for this property yet. Listed accounts must not be treated as proven delivery partners until their project attribution and before/after results are checked.</p>
          <h3>Evidence to commission</h3>
          <p>Whole-home survey, measured floor area, proposed specification, moisture and ventilation review, itemised quotes, funding eligibility, and a post-works monitoring plan.</p>
          <h3>Insurance review</h3>
          <p>Compare actual renewal quotes after works. Provide an insurer-approved risk pack covering verified installations, warranties, maintenance, any leak detection or flood-resilience measures, and relevant claims history. Do not share occupant health readings by default. A lower premium, excess or improved cover is possible only if an insurer confirms it.</p>
        </div>
      </DetailSurface> : null}
    </section>
  );
}
