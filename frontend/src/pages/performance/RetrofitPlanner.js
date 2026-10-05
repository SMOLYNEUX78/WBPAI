import React, { useState } from "react";
import { CARBON_REFERENCE_GBP_PER_TONNE, DATA_LICENCE_REFERENCE_GBP_PER_YEAR, projectRetrofit, RETROFIT_OPTIONS } from "./retrofitEconomics";

const FUNDING = [
  { name: "Warm Homes: Local Grant", href: "https://www.gov.uk/apply-warm-homes-local-grant", note: "Private homes; income and official energy-certificate eligibility apply." },
  { name: "Boiler Upgrade Scheme", href: "https://www.gov.uk/apply-boiler-upgrade-scheme/check-if-youre-eligible", note: "For eligible low-carbon heating; an MCS installer checks the property." },
  { name: "Suffolk home energy support", href: "https://www.suffolk.gov.uk/", note: "Check current county and district schemes before applying." },
];

const formatGbp = (value) => `£${Math.round(value).toLocaleString("en-GB")}`;

export default function RetrofitPlanner({ ready, annualEui, area, electricityDailyKwh, gasDailyKwh, billReview, DetailSurface }) {
  const [selected, setSelected] = useState("fabric");
  const [packOpen, setPackOpen] = useState(false);
  const option = RETROFIT_OPTIONS.find((item) => item.id === selected);
  const projection = projectRetrofit({ option, annualEui, area, electricityDailyKwh, gasDailyKwh, billReview });
  const costRange = projection.costRangeGbp;

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
            <dl>
              <div><dt>Installed retrofit cost</dt><dd>{costRange ? `${formatGbp(costRange[0])}–${formatGbp(costRange[1])}` : "Needs floor area"}</dd><small>{costRange ? `Midpoint ${formatGbp((costRange[0] + costRange[1]) / 2)} · before grants` : ""}</small></div>
              <div><dt>Annual energy saved</dt><dd>{projection.energySavedKwh !== null ? `${Math.round(projection.energySavedKwh).toLocaleString("en-GB")} kWh` : "Needs baseline EUI and area"}</dd><small>{projection.targetEui !== null ? `Target EUI ${projection.targetEui.toFixed(1)} kWh/m²/yr` : ""}</small></div>
              <div><dt>Annual bill saving</dt><dd>{projection.billSavedGbp !== null ? `${formatGbp(projection.billSavedGbp)}/yr` : "Needs metered fuel split"}</dd><small>Unit rates only; standing charges unchanged</small></div>
              <div><dt>Potential carbon value</dt><dd>{projection.carbonReferenceGbp !== null ? `${formatGbp(projection.carbonReferenceGbp)}/yr` : "Needs metered fuel split"}</dd><small>{projection.carbonSavedTonnes !== null ? `${projection.carbonSavedTonnes.toFixed(2)} tCO₂e/yr proxy · £0 issued` : "No issued credits"}</small></div>
              <div><dt>Potential data licences</dt><dd>£0–{formatGbp(DATA_LICENCE_REFERENCE_GBP_PER_YEAR)}/yr</dd><small>£0 contracted; buyer and consent needed</small></div>
            </dl>
            <p className="wbp-retrofit-caveat">Planning assumptions, not a survey or quote. The energy, bill and carbon proxies hold today’s fuel mix constant, so they do not model heat-pump electricity demand or rebound. Carbon uses the 2026 UK factors and an illustrative {formatGbp(CARBON_REFERENCE_GBP_PER_TONNE)}/t reference, not a credit price or sale. Data assumes three annual licences; no buyer is contracted.</p>
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
        </div>
      </DetailSurface> : null}
    </section>
  );
}
