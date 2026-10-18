import React, { useState } from "react";
import { getAnnualBenefitBreakdown, getRetrofitOption, projectRetrofit } from "./retrofitEconomics";

const FUNDING = [
  { name: "Warm Homes: Local Grant", href: "https://www.gov.uk/apply-warm-homes-local-grant", note: "England: council-approved insulation and possibly windows or doors; amount follows eligibility and a survey." },
  { name: "Boiler Upgrade Scheme", href: "https://www.gov.uk/apply-boiler-upgrade-scheme/what-you-can-get", note: "England and Wales: £2,500–£7,500 for eligible heat pumps replacing fossil heating; not a general boiler grant." },
];
const SUFFOLK_LOAN = { name: "Suffolk Warm Homes Loan", href: "https://www.suffolk.gov.uk/council-and-democracy/council-news/energy-efficiency-loans-available-for-suffolk-residents", note: "£2,000–£15,000 loan, subject to availability and approval; repayable, not a grant." };
const isSuffolkCouncil = (value) => /^(?:East Suffolk|West Suffolk|Mid Suffolk|Babergh|Ipswich)(?:\s|$)/i.test(String(value || "").trim());

const formatGbp = (value) => `${value < 0 ? "-" : ""}£${Math.round(Math.abs(value)).toLocaleString("en-GB")}`;

export default function RetrofitPlanner({ ready, embedded = false, postcode, localAuthority, annualEui, area, electricityDailyKwh, gasDailyKwh, gasHeatingDailyKwh, gasDhwDailyKwh, billReview, originalTeam = {}, DetailSurface }) {
  const [worksScope, setWorksScope] = useState(0);
  const [packOpen, setPackOpen] = useState(false);
  const [annualPremium, setAnnualPremium] = useState("");
  const [heatingMode, setHeatingMode] = useState("gas");
  const [renewables, setRenewables] = useState(false);
  const [specialistTariff, setSpecialistTariff] = useState(false);
  const [solarSelfUseInput, setSolarSelfUseInput] = useState("");
  const [heatingShareInput, setHeatingShareInput] = useState(() => Number.isFinite(gasHeatingDailyKwh) && gasHeatingDailyKwh > 0 && gasDailyKwh > 0
    ? String(Math.round(Math.min(1, gasHeatingDailyKwh / gasDailyKwh) * 100)) : "");
  const [heatPumpSpfInput, setHeatPumpSpfInput] = useState("3.1");
  const [projectedElectricityRateInput, setProjectedElectricityRateInput] = useState("");
  const gasHeatingShare = heatingShareInput === "" ? null : Number(heatingShareInput) / 100;
  const heatPumpSpf = heatPumpSpfInput === "" ? null : Number(heatPumpSpfInput);
  const gasHotWaterShare = Number.isFinite(gasDhwDailyKwh) && gasDhwDailyKwh > 0 && gasDailyKwh > 0 ? Math.min(1, gasDhwDailyKwh / gasDailyKwh) : 0;
  const option = getRetrofitOption(worksScope);
  const projection = projectRetrofit({ option, annualEui, area, electricityDailyKwh, gasDailyKwh, gasHeatingShare, gasHotWaterShare, heatPumpSpf,
    improvedElectricityRatePence: specialistTariff && projectedElectricityRateInput !== "" ? Number(projectedElectricityRateInput) : null,
    renewableSelfConsumedKwh: renewables && solarSelfUseInput !== "" ? Number(solarSelfUseInput) : 0,
    billReview, allElectric: heatingMode === "heat-pump" });
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
            <div className="wbp-retrofit-choice-grid" role="group" aria-label="Heating system">
              <button type="button" aria-pressed={heatingMode === "gas"} onClick={() => setHeatingMode("gas")}>Gas boiler</button>
              <button type="button" aria-pressed={heatingMode === "heat-pump"} onClick={() => setHeatingMode("heat-pump")}>Heat pump</button>
            </div>
            <div className="wbp-retrofit-choice-grid" role="group" aria-label="Bill-saving options">
              <button type="button" aria-pressed={renewables} onClick={() => setRenewables((value) => !value)}>Renewables</button>
              <button type="button" aria-pressed={specialistTariff} onClick={() => setSpecialistTariff((value) => !value)}>Specialist tariff</button>
            </div>
            {heatingMode === "heat-pump" ? <div className="grid gap-3 sm:grid-cols-2">
              <label>Space heating share of gas (%)
                <input type="number" min="0" max="100" step="1" inputMode="numeric" value={heatingShareInput} onChange={(event) => setHeatingShareInput(event.target.value)} placeholder="Enter an estimate" />
              </label>
              <label>Heat pump seasonal efficiency (SPF)
                <input type="number" min="1.1" max="6" step="0.1" inputMode="decimal" value={heatPumpSpfInput} onChange={(event) => setHeatPumpSpfInput(event.target.value)} />
              </label>
            </div> : null}
            {renewables ? <label>Solar electricity used at home (kWh/year)
              <input type="number" min="0" step="1" inputMode="numeric" value={solarSelfUseInput} onChange={(event) => setSolarSelfUseInput(event.target.value)} placeholder="Enter a system estimate" />
            </label> : null}
            {specialistTariff ? <label>Quoted effective electricity rate (p/kWh)
              <input type="number" min="0" max="100" step="0.01" inputMode="decimal" value={projectedElectricityRateInput} onChange={(event) => setProjectedElectricityRateInput(event.target.value)} placeholder="Enter a quoted rate" />
            </label> : null}
            {heatingMode === "heat-pump" ? <p className="text-xs text-gray-600">{projection.spaceHeatingEuiShare === null ? "Enter a gas heating share to model the switch." : `Estimated space heating: ${(projection.spaceHeatingEuiShare * 100).toFixed(0)}% of overall EUI.`} The gas split is provisional. Heat-pump conversion phases in at the deep-retrofit end of the slider; gas standing charge is removed only if gas is fully disconnected.</p> : null}
          </div>
          <div className="wbp-retrofit-forecast">
            <p><strong>{option.name}</strong> · {heatingMode === "gas" && worksScope > 75 ? "Deep fabric pathway with the gas boiler retained in this bill comparison; EnerPHit certification would need a separate design review." : option.measures}</p>
            <p className="wbp-retrofit-bill-result"><strong>{projection.billSavedGbp === null ? "Bill comparison pending" : projection.billSavedGbp >= 0 ? `Estimated bill saving ${formatGbp(projection.billSavedGbp)}/yr` : `Estimated bill increase ${formatGbp(-projection.billSavedGbp)}/yr`}</strong></p>
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
            <p className="text-xs text-gray-600">Bill comparison uses {projection.usingBillElectricityRate ? "your electricity rate" : "a reference electricity rate"} and {projection.usingBillGasRate ? "your gas rate" : "a reference gas rate"}{projection.usingProjectedElectricityRate ? ", with your entered tariff rate after works" : " before and after works"}. {projection.renewableOffsetKwh > 0 ? `Solar self-use offsets ${Math.round(projection.renewableOffsetKwh).toLocaleString("en-GB")} kWh of grid electricity; export income is excluded. ` : ""}{projection.gasDisconnected ? `Gas standing charge avoided: ${formatGbp(projection.avoidedGasStandingGbp)}/yr; electricity standing charge unchanged.` : "Standing charges unchanged until gas is disconnected."}</p>
            <p className="wbp-retrofit-caveat">Indicative comparison only. Winter baseline and survey still needed; carbon, data licensing and insurance income is not secured. Data licensing is included in the pie but is independent of the retrofit result. The EnerPHit endpoint uses CC's illustrative demand proxy, not a certified design. Heating changes need a separate design.</p>
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
