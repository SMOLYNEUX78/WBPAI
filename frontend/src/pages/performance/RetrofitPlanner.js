import React, { useState } from "react";
import { getAnnualBenefitBreakdown, getRetrofitOption, projectRetrofit } from "./retrofitEconomics";

const FUNDING = [
  { name: "Warm Homes: Local Grant", href: "https://www.gov.uk/apply-warm-homes-local-grant", note: "England: council-approved insulation and possibly windows or doors; amount follows eligibility and a survey." },
  { name: "Boiler Upgrade Scheme", href: "https://www.gov.uk/apply-boiler-upgrade-scheme/what-you-can-get", note: "England and Wales: £2,500–£7,500 for eligible heat pumps replacing fossil heating; not a general boiler grant." },
];
const SUFFOLK_LOAN = { name: "Suffolk Warm Homes Loan", href: "https://www.suffolk.gov.uk/council-and-democracy/council-news/energy-efficiency-loans-available-for-suffolk-residents", note: "£2,000–£15,000 loan, subject to availability and approval; repayable, not a grant." };
const isSuffolkCouncil = (value) => /^(?:East Suffolk|West Suffolk|Mid Suffolk|Babergh|Ipswich)(?:\s|$)/i.test(String(value || "").trim());

const formatGbp = (value) => `${value < 0 ? "-" : ""}£${Math.round(Math.abs(value)).toLocaleString("en-GB")}`;

export default function RetrofitPlanner({ ready, embedded = false, postcode, localAuthority, annualEui, area, electricityDailyKwh, gasDailyKwh, billReview, originalTeam = {}, DetailSurface }) {
  const [worksScope, setWorksScope] = useState(0);
  const [packOpen, setPackOpen] = useState(false);
  const [annualPremium, setAnnualPremium] = useState("");
  const option = getRetrofitOption(worksScope);
  const projection = projectRetrofit({ option, annualEui, area, electricityDailyKwh, gasDailyKwh, billReview });
  const annualBenefit = getAnnualBenefitBreakdown(projection.scenarios[1], annualPremium);
  const lowBenefit = getAnnualBenefitBreakdown(projection.scenarios[0], annualPremium);
  const highBenefit = getAnnualBenefitBreakdown(projection.scenarios[2], annualPremium);
  const benefitTotals = lowBenefit && highBenefit ? [lowBenefit.total, highBenefit.total].sort((a, b) => a - b) : null;
  const potentialAnnualCost = benefitTotals ? Math.max(0, -benefitTotals[0]) : 0;
  const suffolkProperty = isSuffolkCouncil(localAuthority);
  const fundingRoutes = suffolkProperty ? [...FUNDING, SUFFOLK_LOAN] : FUNDING;
  const positivePartsTotal = annualBenefit?.parts.reduce((sum, part) => sum + Math.max(0, part.value), 0) ?? 0;
  let piePosition = 0;
  const pieStops = positivePartsTotal > 0 ? annualBenefit.parts.map((part) => {
    const start = piePosition;
    piePosition += Math.max(0, part.value) / positivePartsTotal * 100;
    return `${part.colour} ${start}% ${piePosition}%`;
  }).join(", ") : "#e5e7eb 0% 100%";

  return (
    <section className={`wbp-retrofit-planner${embedded ? " wbp-retrofit-planner--embedded" : ""}`} aria-label="Retrofit planning">
      {!embedded ? <h2 className="text-lg font-bold">Do we need a retrofit?</h2> : null}
      {ready && !embedded ? <p className="wbp-retrofit-decision">Potential case to explore. Confirm the winter baseline, survey findings and quotes before deciding.</p> : null}
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
                <p>Potential annual value</p>
                <strong>{benefitTotals ? `${formatGbp(Math.max(0, benefitTotals[0]))}–${formatGbp(Math.max(0, benefitTotals[1]))}/yr` : "Pending baseline"}</strong>
                <p className="wbp-retrofit-cost"><b>Estimated works cost</b><br />{projection.costRangeGbp ? `${formatGbp(projection.costRangeGbp[0])}–${formatGbp(projection.costRangeGbp[1])}` : "Floor area needed"}</p>
                {potentialAnnualCost > 0 ? <span>Possible net annual cost: up to {formatGbp(potentialAnnualCost)}/yr under these assumptions.</span> : null}
                <span>Bill savings plus possible carbon, data and insurance value</span>
              </div>
              <div className="wbp-retrofit-benefit-pie" role="img" aria-label={annualBenefit ? `Annual benefit split: ${annualBenefit.parts.map((part) => `${part.label} ${formatGbp(part.value)}`).join(", ")}` : "Annual benefit split pending baseline"} style={{ background: `conic-gradient(${pieStops})` }}><span /></div>
              <div className="wbp-retrofit-benefit-key">
                <strong>Planning split · {annualBenefit ? `${formatGbp(Math.abs(annualBenefit.total))}/yr${annualBenefit.total < 0 ? " net cost" : ""}` : "pending"}</strong>
                {annualBenefit?.parts.map((part) => <div key={part.label}><i style={{ backgroundColor: part.colour }} /><span>{part.label}</span><strong>{formatGbp(part.value)}</strong></div>)}
                {annualBenefit?.energyCostIncrease > 0 ? <small>Energy cost increase: {formatGbp(annualBenefit.energyCostIncrease)}/yr, deducted from total.</small> : null}
                <label className="wbp-retrofit-premium">Current annual buildings insurance premium (£)
                  <input type="number" min="0" max="100000" step="1" inputMode="decimal" value={annualPremium} onChange={(event) => setAnnualPremium(event.target.value)} placeholder="Enter your annual premium" />
                </label>
              </div>
            </div>
            <p className="wbp-retrofit-outcome">{projection.scenarios[1].energySavedKwh === null ? "Energy saving pending" : `${Math.round(projection.scenarios[1].energySavedKwh).toLocaleString("en-GB")} kWh/yr energy saved`} · {projection.scenarios[1].carbonSavedTonnes === null ? "Carbon saving pending" : `${projection.scenarios[1].carbonSavedTonnes.toFixed(2)} tCO₂e/yr carbon saved`} · {projection.targetEui === null ? "Target EUI pending" : `Target EUI ${projection.targetEui.toFixed(1)} kWh/m²/yr`}</p>
            <p className="wbp-retrofit-caveat">Indicative comparison only. Winter baseline and survey still needed; carbon, data licensing and insurance income is not secured. Data licensing is included in the pie but is independent of the retrofit result. The EnerPHit endpoint uses CC's illustrative EUI target, not a certified design. Bill and carbon savings hold the current fuel mix; heating changes need a separate design.</p>
            {!embedded ? <div className="wbp-retrofit-actions"><button type="button" onClick={() => setPackOpen(true)}>View retrofit pack</button></div> : null}
            {embedded ? <div className="wbp-retrofit-next-steps">
              <div><h3>Funding avenues{localAuthority ? ` · ${localAuthority}` : ""}</h3>{postcode ? <p>Property postcode: {postcode}</p> : null}<p>Possible routes to check against the proposed measures and household eligibility. No award is assumed or deducted from the works cost.</p><ul>{fundingRoutes.map((source) => <li key={source.name}><a href={source.href} target="_blank" rel="noreferrer">{source.name}</a><span>{source.note}</span></li>)}</ul></div>
              <div><h3>Recommended design and build routes</h3><p>These names are from this home's original project record, not verified retrofit recommendations. Check availability and suitability before commissioning.</p><ul>
                <li><strong>Design</strong>{originalTeam.architect ? (originalTeam.architectProfileRef ? <a href={`/workspace/design-profile/${encodeURIComponent(originalTeam.architectProfileRef)}`}>{originalTeam.architect}</a> : <span>{originalTeam.architect}</span>) : <span>Not recorded</span>}</li>
                <li><strong>Build</strong>{originalTeam.builder ? (originalTeam.builderProfileRef ? <a href={`/workspace/build-profile/${encodeURIComponent(originalTeam.builderProfileRef)}`}>{originalTeam.builder}</a> : <span>{originalTeam.builder}</span>) : <span>Not recorded</span>}</li>
              </ul></div>
            </div> : null}
          </div>
        </div>
      ) : <p className="wbp-retrofit-locked">The retrofit menu unlocks when the measured baseline reaches 100% confidence.</p>}
      {packOpen ? <DetailSurface modal title={`${option.name} plan`} onClose={() => setPackOpen(false)}>
        <div className="wbp-retrofit-pack">
          <p>Planning target: {projection.reductionPercent === null ? "pending baseline" : `${projection.reductionPercent.toFixed(1)}% lower total EUI`}. Commission a whole-home assessment to validate measures, costs and comfort before procurement. An EnerPHit claim requires a separate PHPP design and certification review against the <a href="https://passivehouse.com/en/home/building-certification/" target="_blank" rel="noreferrer">Passive House Institute criteria</a>.</p>
          <p>Annual energy saving: {projection.energySavedKwh !== null ? `${Math.round(projection.energySavedKwh).toLocaleString("en-GB")} kWh` : "pending"}. Installation cost needs a property survey and itemised quotes; carbon and data income are not secured.</p>
          <h3>Funding to check</h3>
          <ul>{fundingRoutes.map((source) => <li key={source.name}><a href={source.href} target="_blank" rel="noreferrer">{source.name}</a><span>{source.note}</span></li>)}</ul>
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
