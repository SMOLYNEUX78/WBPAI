import React, { useState } from "react";

const OPTIONS = [
  { id: "fabric", name: "Fabric first", reduction: 15, measures: "Survey heat loss, insulation, airtightness and ventilation together." },
  { id: "heat", name: "Fabric + clean heat", reduction: 30, measures: "Improve the fabric, then size low-carbon heating against the reduced heat load." },
  { id: "whole", name: "Whole-home retrofit", reduction: 45, measures: "Coordinate fabric, ventilation, heating and controls in one staged design." },
];

const FUNDING = [
  { name: "Warm Homes: Local Grant", href: "https://www.gov.uk/apply-warm-homes-local-grant", note: "Private homes; income and official energy-certificate eligibility apply." },
  { name: "Boiler Upgrade Scheme", href: "https://www.gov.uk/apply-boiler-upgrade-scheme/check-if-youre-eligible", note: "For eligible low-carbon heating; an MCS installer checks the property." },
  { name: "Suffolk home energy support", href: "https://www.suffolk.gov.uk/", note: "Check current county and district schemes before applying." },
];

export default function RetrofitPlanner({ ready, annualEui, area, DetailSurface }) {
  const [selected, setSelected] = useState("fabric");
  const [packOpen, setPackOpen] = useState(false);
  const option = OPTIONS.find((item) => item.id === selected);
  const validEui = Number.isFinite(annualEui) && annualEui > 0;
  const validArea = Number.isFinite(area) && area > 0;
  const targetEui = validEui ? annualEui * (1 - option.reduction / 100) : null;
  const annualKwhDifference = validEui && validArea ? (annualEui - targetEui) * area : null;

  return (
    <section className="wbp-retrofit-planner" aria-label="Retrofit planning">
      <h2 className="text-lg font-bold">Retrofit options</h2>
      {ready ? (
        <div className="wbp-retrofit-content">
          <div className="wbp-retrofit-options" role="group" aria-label="Retrofit options">
            {OPTIONS.map((item) => (
              <button key={item.id} type="button" aria-pressed={item.id === selected} className={item.id === selected ? "wbp-retrofit-option wbp-retrofit-option--selected" : "wbp-retrofit-option"} onClick={() => setSelected(item.id)}>
                <strong>{item.name}</strong><span>Planning target: {item.reduction}% lower EUI</span>
              </button>
            ))}
          </div>
          <div className="wbp-retrofit-forecast">
            <p><strong>{option.name}</strong> · {option.measures}</p>
            <dl>
              <div><dt>Baseline EUI</dt><dd>{validEui ? `${annualEui.toFixed(1)} kWh/m²/yr` : "Awaiting usable EUI"}</dd></div>
              <div><dt>Illustrative target</dt><dd>{targetEui !== null ? `${targetEui.toFixed(1)} kWh/m²/yr` : "Needs baseline EUI"}</dd></div>
              <div><dt>Indicative energy difference</dt><dd>{annualKwhDifference !== null ? `${Math.round(annualKwhDifference).toLocaleString()} kWh/yr` : "Needs measured floor area"}</dd></div>
              <div><dt>Carbon income</dt><dd>£0 secured · post-works verification required</dd></div>
              <div><dt>Data income</dt><dd>£0 contracted · up to £444/yr prototype assumption</dd></div>
            </dl>
            <p className="wbp-retrofit-caveat">Targets are scenario assumptions, not an assessed design, forecast credit issuance or funding award. The data figure assumes three annual licences at current prototype reference values.</p>
            <button type="button" onClick={() => setPackOpen(true)}>View retrofit pack</button>
          </div>
        </div>
      ) : <p className="wbp-retrofit-locked">The retrofit menu unlocks when the measured baseline reaches 100% confidence.</p>}
      {packOpen ? <DetailSurface modal title={`${option.name} plan`} onClose={() => setPackOpen(false)}>
        <div className="wbp-retrofit-pack">
          <p>Planning target: {option.reduction}% lower EUI. Commission a whole-home assessment to validate measures, costs and comfort before procurement.</p>
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
