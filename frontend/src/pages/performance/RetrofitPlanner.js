import React, { useState } from "react";
import { getAnnualBenefitBreakdown, getRetrofitOption, projectInsuranceSaving, projectRetrofit } from "./retrofitEconomics";

const FUNDING = [
  { name: "Warm Homes: Local Grant", href: "https://www.gov.uk/apply-warm-homes-local-grant", note: "Private homes; income and official energy-certificate eligibility apply." },
  { name: "Boiler Upgrade Scheme", href: "https://www.gov.uk/apply-boiler-upgrade-scheme/check-if-youre-eligible", note: "For eligible low-carbon heating; an MCS installer checks the property." },
  { name: "Suffolk home energy support", href: "https://www.suffolk.gov.uk/", note: "Check current county and district schemes before applying." },
];

const formatGbp = (value) => `${value < 0 ? "-" : ""}£${Math.round(Math.abs(value)).toLocaleString("en-GB")}`;

export default function RetrofitPlanner({ ready, annualEui, area, electricityDailyKwh, gasDailyKwh, billReview, DetailSurface }) {
  const [worksScope, setWorksScope] = useState(0);
  const [energyPriceChange, setEnergyPriceChange] = useState(0);
  const [carbonPriceChange, setCarbonPriceChange] = useState(0);
  const [packOpen, setPackOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [annualPremium, setAnnualPremium] = useState("");
  const option = getRetrofitOption(worksScope);
  const projection = projectRetrofit({ option, annualEui, area, electricityDailyKwh, gasDailyKwh, billReview, energyPriceChangePercent: energyPriceChange, carbonPriceChangePercent: carbonPriceChange });
  const costRange = projection.costRangeGbp;
  const annualBenefit = getAnnualBenefitBreakdown(projection.scenarios[1], annualPremium);
  const lowBenefit = getAnnualBenefitBreakdown(projection.scenarios[0], annualPremium);
  const highBenefit = getAnnualBenefitBreakdown(projection.scenarios[2], annualPremium);
  let piePosition = 0;
  const pieStops = annualBenefit?.total > 0 ? annualBenefit.parts.map((part) => {
    const start = piePosition;
    piePosition += part.value / annualBenefit.total * 100;
    return `${part.colour} ${start}% ${piePosition}%`;
  }).join(", ") : "#e5e7eb 0% 100%";

  return (
    <section className="wbp-retrofit-planner" aria-label="Retrofit planning">
      <h2 className="text-lg font-bold">Do we need a retrofit?</h2>
      {ready ? <p className="wbp-retrofit-decision">Potential case to explore. Confirm the winter baseline, survey findings and quotes before deciding.</p> : null}
      {ready ? (
        <div className="wbp-retrofit-content">
          <div className="wbp-retrofit-controls wbp-retrofit-controls--main">
            <label>Extent of works <strong>{projection.reductionPercent === null ? "Target pending baseline" : `${Math.round(projection.reductionPercent)}% lower EUI target`}</strong>
              <input type="range" min="0" max="100" step="1" value={worksScope} onChange={(event) => setWorksScope(Number(event.target.value))} aria-label="Extent of retrofit works" />
              <span className="wbp-retrofit-range-labels"><span>Fabric first</span><span>Clean heat</span><span>Whole-home</span><span>EnerPHit pathway</span></span>
            </label>
          </div>
          <div className="wbp-retrofit-forecast">
            <p><strong>{option.name}</strong> · {option.measures}</p>
            <div className="wbp-retrofit-benefit" aria-label="Potential annual benefit breakdown">
              <div className="wbp-retrofit-benefit-main">
                <p>Estimated installed cost</p>
                <strong>{costRange ? `${formatGbp(costRange[0])}–${formatGbp(costRange[1])}` : "Needs floor area"}</strong>
                <p>Potential annual benefit</p>
                <strong>{lowBenefit && highBenefit ? `${formatGbp(lowBenefit.total)}–${formatGbp(highBenefit.total)}/yr` : "Pending baseline"}</strong>
                <span>Bill saving plus possible carbon, data and insurance value</span>
              </div>
              <div className="wbp-retrofit-benefit-pie" role="img" aria-label={annualBenefit ? `Annual benefit split: ${annualBenefit.parts.map((part) => `${part.label} ${formatGbp(part.value)}`).join(", ")}` : "Annual benefit split pending baseline"} style={{ background: `conic-gradient(${pieStops})` }}><span /></div>
              <div className="wbp-retrofit-benefit-key">
                <strong>Planning split · {annualBenefit ? `${formatGbp(annualBenefit.total)}/yr` : "pending"}</strong>
                {annualBenefit?.parts.map((part) => <div key={part.label}><i style={{ backgroundColor: part.colour }} /><span>{part.label}</span><strong>{formatGbp(part.value)}</strong></div>)}
                {annualBenefit?.energyCostIncrease > 0 ? <small>Energy cost increase: {formatGbp(annualBenefit.energyCostIncrease)}/yr, deducted from total.</small> : null}
                {annualBenefit && !annualBenefit.insuranceIncluded ? <small>Insurance excluded until a premium is entered.</small> : null}
              </div>
            </div>
            <p className="wbp-retrofit-outcome">{projection.scenarios[1].energySavedKwh === null ? "Energy saving pending" : `${Math.round(projection.scenarios[1].energySavedKwh).toLocaleString("en-GB")} kWh/yr energy saved`} · {projection.scenarios[1].carbonSavedTonnes === null ? "Carbon saving pending" : `${projection.scenarios[1].carbonSavedTonnes.toFixed(2)} tCO₂e/yr carbon saved`} · {projection.targetEui === null ? "Target EUI pending" : `Target EUI ${projection.targetEui.toFixed(1)} kWh/m²/yr`}</p>
            <p className="wbp-retrofit-caveat">Indicative comparison only. Winter baseline and survey still needed; carbon, data and insurance income is not secured. The EnerPHit endpoint uses CC's illustrative all-electric profile, not a certified design.</p>
            <div className="wbp-retrofit-actions"><button type="button" onClick={() => setAdjustOpen(true)}>Adjust assumptions</button><button type="button" onClick={() => setPackOpen(true)}>View retrofit pack</button></div>
          </div>
        </div>
      ) : <p className="wbp-retrofit-locked">The retrofit menu unlocks when the measured baseline reaches 100% confidence.</p>}
      {adjustOpen ? <DetailSurface modal title="Adjust assumptions" onClose={() => setAdjustOpen(false)}>
        <div className="wbp-retrofit-assumptions">
          <div className="wbp-retrofit-controls">
            <label>Energy unit price change <strong>{energyPriceChange > 0 ? "+" : ""}{energyPriceChange}%</strong>
              <input type="range" min="-20" max="100" step="5" value={energyPriceChange} onChange={(event) => setEnergyPriceChange(Number(event.target.value))} aria-label="Energy unit price change" />
              <span className="wbp-retrofit-range-labels"><span>-20%</span><span>Today</span><span>+100%</span></span>
            </label>
            <label>Carbon price change <strong>{carbonPriceChange > 0 ? "+" : ""}{carbonPriceChange}%</strong>
              <input type="range" min="-50" max="200" step="10" value={carbonPriceChange} onChange={(event) => setCarbonPriceChange(Number(event.target.value))} aria-label="Carbon price change" />
              <span className="wbp-retrofit-range-labels"><span>-50%</span><span>Reference</span><span>+200%</span></span>
            </label>
          </div>
          <label className="wbp-retrofit-premium">Current annual buildings insurance premium, optional (£)
            <input type="number" min="0" max="100000" step="1" inputMode="decimal" value={annualPremium} onChange={(event) => setAnnualPremium(event.target.value)} placeholder="Enter premium to compare quotes" />
          </label>
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
            <p className="wbp-retrofit-caveat">Illustrative scenarios, not quotes or offers. Works targets and costs interpolate between example packages; a survey and itemised quotes are required. The EnerPHit endpoint uses the CC prototype's 25 kWh/m²/yr total EUI and all-electric assumption; this is not the EnerPHit heating-demand criterion or a PHPP result. Energy and carbon price sliders are stress tests, not forecasts. Savings are 50%, 100% and 125% of the selected planning target; winter baseline is incomplete. Carbon reference prices start at £0, £65 and £150/t; data income at £0, £222 and £444/yr. No market bids, issued credits or contracted licences. Insurance at 0%, 5% and 10% is quote sensitivity only; no insurer has agreed a discount. Intermediate options hold today's fuel mix; the final pathway models a switch to electricity but not heat-pump efficiency or rebound. Costs exclude grants.</p>
            <p className="wbp-retrofit-sources">Cost ranges are WBP planning allowances informed by <a href="https://energysavingtrust.org.uk/retrofitting-the-uks-housing-stock-to-reach-net-zero/" target="_blank" rel="noreferrer">Energy Saving Trust measures</a>; fallback unit rates use <a href="https://www.ofgem.gov.uk/your-energy-supply/your-energy-bill/energy-price-cap-unit-rates-and-standing-charges" target="_blank" rel="noreferrer">Ofgem’s October 2026 averages</a>. Carbon factors: <a href="https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2026" target="_blank" rel="noreferrer">DESNZ 2026</a>.</p>
        </div>
      </DetailSurface> : null}
      {packOpen ? <DetailSurface modal title={`${option.name} plan`} onClose={() => setPackOpen(false)}>
        <div className="wbp-retrofit-pack">
          <p>Planning target: {projection.reductionPercent === null ? "pending baseline" : `${projection.reductionPercent.toFixed(1)}% lower total EUI`}. Commission a whole-home assessment to validate measures, costs and comfort before procurement. An EnerPHit claim requires a separate PHPP design and certification review against the <a href="https://passivehouse.com/en/home/building-certification/" target="_blank" rel="noreferrer">Passive House Institute criteria</a>.</p>
          <p>Indicative installed cost: {costRange ? `${formatGbp(costRange[0])}–${formatGbp(costRange[1])}` : "awaiting floor area"}, before grants. Annual energy saving: {projection.energySavedKwh !== null ? `${Math.round(projection.energySavedKwh).toLocaleString("en-GB")} kWh` : "pending"}. Carbon and data income are not secured.</p>
          <h3>Funding to check</h3>
          <ul>{FUNDING.map((source) => <li key={source.name}><a href={source.href} target="_blank" rel="noreferrer">{source.name}</a><span>{source.note}</span></li>)}</ul>
          <h3>Design and build</h3>
          <p>No WBP design or build profile has a verified, measured retrofit outcome for this property yet. Listed accounts must not be treated as proven delivery partners until their project attribution and before/after results are checked.</p>
          <h3>Evidence to commission</h3>
          <p>Whole-home survey, measured floor area, proposed specification, moisture and ventilation review, itemised quotes, funding eligibility, and a post-works monitoring plan.</p>
          <h3>Insurance review</h3>
          <p>Compare actual renewal quotes after works. Provide an insurer-approved risk pack covering verified installations, warranties, maintenance, any leak detection or flood-resilience measures, and relevant claims history. Do not share occupant health readings by default. A lower premium, excess or improved cover is possible only if an insurer confirms it.</p>
          <h3>Further value to validate</h3>
          <p>Check grant eligibility, avoided maintenance and damage, comfort and health outcomes, grid flexibility, and any property-value effect separately. None is included in the annual benefit total without property-specific evidence or a buyer. Do not count the same energy or carbon saving twice.</p>
        </div>
      </DetailSurface> : null}
    </section>
  );
}
