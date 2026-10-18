export const RETROFIT_OPTIONS = [
  { id: "fabric", name: "Fabric first", reduction: 15, fixedCost: [4000, 9000], areaCost: [40, 90], measures: "Survey heat loss, insulation, airtightness and ventilation together." },
  { id: "heat", name: "Fabric + clean heat", reduction: 30, fixedCost: [12000, 18000], areaCost: [100, 200], measures: "Improve the fabric, then size low-carbon heating against the reduced heat load." },
  { id: "whole", name: "Whole-home retrofit", reduction: 35, fixedCost: [18000, 28000], areaCost: [270, 470], measures: "Coordinate fabric, ventilation, heating and controls in one staged design." },
  { id: "enerphit", name: "EnerPHit design pathway", reduction: 35, fixedCost: [25000, 40000], areaCost: [300, 600], measures: "Explore a deep fabric retrofit and heat-pump space heating with PHPP design and independent certification review." },
];

// Shared with the CC prototype: total metered EUI is an illustration, not the EnerPHit heating-demand criterion.
export const CC_CANDIDATE_PROFILE = { annualEui: 25, electricityDailyKwh: 6.8, gasDailyKwh: 0 };

export function getRetrofitOption(scope) {
  const position = Math.max(0, Math.min(100, Number(scope) || 0));
  const [lower, upper, fraction] = position < 50
    ? [RETROFIT_OPTIONS[0], RETROFIT_OPTIONS[1], position / 50]
    : position < 75
      ? [RETROFIT_OPTIONS[1], RETROFIT_OPTIONS[2], (position - 50) / 25]
      : [RETROFIT_OPTIONS[2], RETROFIT_OPTIONS[3], (position - 75) / 25];
  if (position === 100) return { ...RETROFIT_OPTIONS[3], enerphitProgress: 1 };
  const blend = (a, b) => a + (b - a) * fraction;
  return {
    name: position === 0 || position === 50 || position === 75 ? lower.name : "Staged retrofit",
    reduction: blend(lower.reduction, upper.reduction),
    fixedCost: lower.fixedCost.map((value, index) => blend(value, upper.fixedCost[index])),
    areaCost: lower.areaCost.map((value, index) => blend(value, upper.areaCost[index])),
    enerphitProgress: position > 75 ? fraction : 0,
    measures: position < 50 ? "Scale fabric, airtightness and ventilation works before adding clean heat." : position < 75 ? "Add clean heat and progressively extend to whole-home measures." : "Explore a heat-pump space-heating scenario; PHPP and certification remain unverified.",
  };
}

const OFGEM_OCT_2026_PENCE = { electricity: 26.32, gas: 7.97, gasStanding: 29.68 };
const DESNZ_2026_KG_CO2E_PER_KWH = { electricity: 0.13096, gas: 0.18231 };
export const DATA_LICENCE_REFERENCE_GBP_PER_YEAR = 144 + 120 + 180;
export const CARBON_REFERENCE_GBP_PER_TONNE = 65;
export const RETROFIT_SCENARIOS = [
  { id: "low", label: "Conservative", savingsFactor: 0.5, carbonPrice: 0, dataIncome: 0, insuranceDiscount: 0 },
  { id: "central", label: "Planning", savingsFactor: 1, carbonPrice: 65, dataIncome: DATA_LICENCE_REFERENCE_GBP_PER_YEAR / 2, insuranceDiscount: 0.05 },
  { id: "high", label: "Upside", savingsFactor: 1.25, carbonPrice: 150, dataIncome: DATA_LICENCE_REFERENCE_GBP_PER_YEAR, insuranceDiscount: 0.1 },
];

export function projectInsuranceSaving(premium, discount) {
  const amount = Number(premium);
  return Number.isFinite(amount) && amount > 0 && amount <= 100000 ? amount * discount : null;
}

export function getAnnualBenefitBreakdown(scenario, annualPremium) {
  const insuranceSaving = projectInsuranceSaving(annualPremium, scenario.insuranceDiscount);
  if (scenario.billSavedGbp === null || scenario.carbonValueGbp === null) return null;
  const parts = [
    { label: "Energy bills", value: Math.max(0, scenario.billSavedGbp), colour: "#047857" },
    { label: "Carbon", value: scenario.carbonValueGbp, colour: "#2563eb" },
    { label: "Data licences", value: scenario.dataIncome, colour: "#d97706" },
    { label: "Insurance", value: insuranceSaving ?? 0, colour: "#be123c" },
  ];
  const energyCostIncrease = Math.max(0, -scenario.billSavedGbp);
  return { parts, total: parts.reduce((sum, part) => sum + part.value, 0) - energyCostIncrease, energyCostIncrease, insuranceIncluded: insuranceSaving !== null };
}

export const billUnitRatePence = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed < 100 ? parsed : null;
};

export function energyBillImpactGbp({ baselineElectricityKwh, baselineGasKwh, improvedElectricityKwh, improvedGasKwh = 0, electricityRatePence, gasRatePence }) {
  return ((baselineElectricityKwh - improvedElectricityKwh) * electricityRatePence
    + (baselineGasKwh - improvedGasKwh) * gasRatePence) / 100;
}

export function repriceCarbonSummary(summary, billReview = {}) {
  let raw = summary?.raw_payload || {};
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { return null; }
  }
  const quantityKeys = ["baselineElectricityKwh", "baselineGasKwh", "improvedElectricityKwh", "improvedGasKwh"];
  if (!quantityKeys.every((key) => Object.prototype.hasOwnProperty.call(raw, key))) return null;
  const quantities = quantityKeys.map((key) => Number(raw[key]));
  const electricityBillRate = billUnitRatePence(billReview.electricityUnitRatePence);
  const gasBillRate = billUnitRatePence(billReview.gasUnitRatePence);
  if (quantities.some((value) => !Number.isFinite(value) || value < 0) || (!electricityBillRate && !gasBillRate)) return null;
  const electricityRatePence = electricityBillRate ?? Number(raw.electricityPriceGbpPerKwh) * 100;
  const gasRatePence = gasBillRate ?? Number(raw.gasPriceGbpPerKwh) * 100;
  if (![electricityRatePence, gasRatePence].every((value) => Number.isFinite(value) && value > 0)) return null;
  return {
    valueGbp: energyBillImpactGbp({
      baselineElectricityKwh: quantities[0], baselineGasKwh: quantities[1],
      improvedElectricityKwh: quantities[2], improvedGasKwh: quantities[3],
      electricityRatePence, gasRatePence,
    }),
    electricityFromBill: electricityBillRate !== null,
    gasFromBill: gasBillRate !== null,
  };
}

export function projectRetrofit({ option, annualEui, area, electricityDailyKwh, gasDailyKwh, gasHeatingShare = null, gasHotWaterShare = 0, heatPumpSpf = 3.1, improvedElectricityRatePence = null, renewableSelfConsumedKwh = 0, billReview = {}, energyPriceChangePercent = 0, carbonPriceChangePercent = 0, allElectric = false }) {
  const validArea = Number.isFinite(area) && area > 0;
  const validEui = Number.isFinite(annualEui) && annualEui > 0;
  const progress = option.enerphitProgress || 0;
  const demandProxyEui = validEui
    ? annualEui * (1 - option.reduction / 100) * (1 - progress) + Math.min(annualEui * (1 - option.reduction / 100), CC_CANDIDATE_PROFILE.annualEui) * progress
    : null;
  const baselineKwh = validArea && validEui ? annualEui * area : null;
  const demandProxyKwh = demandProxyEui !== null && validArea ? demandProxyEui * area : null;
  const hasFuelSplit = Number.isFinite(electricityDailyKwh) && electricityDailyKwh >= 0
    && Number.isFinite(gasDailyKwh) && gasDailyKwh >= 0
    && electricityDailyKwh + gasDailyKwh > 0;
  const electricityShare = hasFuelSplit ? electricityDailyKwh / (electricityDailyKwh + gasDailyKwh) : null;
  const gasShare = hasFuelSplit ? 1 - electricityShare : null;
  const validHeatingShare = Number.isFinite(gasHeatingShare) && gasHeatingShare >= 0 && gasHeatingShare <= 1;
  const validSpf = Number.isFinite(heatPumpSpf) && heatPumpSpf > 1 && heatPumpSpf <= 6;
  const modelFuelSwitch = allElectric && validHeatingShare && validSpf;
  const hotWaterShare = Number.isFinite(gasHotWaterShare) ? Math.max(0, Math.min(gasHotWaterShare, 1 - (validHeatingShare ? gasHeatingShare : 0))) : 0;
  const switchedGasKwh = demandProxyKwh !== null && hasFuelSplit && modelFuelSwitch ? demandProxyKwh * gasShare : 0;
  const switchedHeatingGasKwh = switchedGasKwh * gasHeatingShare;
  const switchedHotWaterGasKwh = switchedGasKwh * hotWaterShare;
  const switchedOtherGasKwh = switchedGasKwh - switchedHeatingGasKwh - switchedHotWaterGasKwh;
  const improvedElectricityKwh = demandProxyKwh !== null && hasFuelSplit
    ? demandProxyKwh * electricityShare + switchedHeatingGasKwh * 0.85 / (validSpf ? heatPumpSpf : 1)
      + switchedHotWaterGasKwh * 0.85 / 2.5 + switchedOtherGasKwh : null;
  const improvedGasKwh = demandProxyKwh !== null && hasFuelSplit
    ? demandProxyKwh * gasShare - switchedGasKwh : null;
  const targetKwh = improvedElectricityKwh !== null ? improvedElectricityKwh + improvedGasKwh : demandProxyKwh;
  const targetEui = targetKwh !== null && validArea ? targetKwh / area : null;
  const energySavedKwh = baselineKwh !== null && targetKwh !== null ? baselineKwh - targetKwh : null;
  const electricitySavedKwh = improvedElectricityKwh !== null ? baselineKwh * electricityShare - improvedElectricityKwh : null;
  const gasSavedKwh = improvedGasKwh !== null ? baselineKwh * gasShare - improvedGasKwh : null;
  const electricityBillRate = billUnitRatePence(billReview.electricityUnitRatePence);
  const gasBillRate = billUnitRatePence(billReview.gasUnitRatePence);
  const electricityRate = electricityBillRate ?? OFGEM_OCT_2026_PENCE.electricity;
  const gasRate = gasBillRate ?? OFGEM_OCT_2026_PENCE.gas;
  const improvedElectricityRate = billUnitRatePence(improvedElectricityRatePence) ?? electricityRate;
  const renewableOffsetKwh = improvedElectricityKwh === null || !Number.isFinite(renewableSelfConsumedKwh)
    ? 0 : Math.min(improvedElectricityKwh, Math.max(0, renewableSelfConsumedKwh));
  const gasStandingRate = billUnitRatePence(billReview.gasStandingChargePence) ?? OFGEM_OCT_2026_PENCE.gasStanding;
  const gasDisconnected = modelFuelSwitch && hasFuelSplit && gasDailyKwh > 0 && improvedGasKwh < 1e-9;
  const avoidedGasStandingGbp = gasDisconnected ? gasStandingRate * 365 / 100 : 0;
  const billSavedGbp = hasFuelSplit && energySavedKwh !== null
    ? (baselineKwh * electricityShare * electricityRate + baselineKwh * gasShare * gasRate
      - (improvedElectricityKwh - renewableOffsetKwh) * improvedElectricityRate - improvedGasKwh * gasRate) / 100 + avoidedGasStandingGbp : null;
  const carbonSavedTonnes = hasFuelSplit && energySavedKwh !== null
    ? (electricitySavedKwh * DESNZ_2026_KG_CO2E_PER_KWH.electricity + gasSavedKwh * DESNZ_2026_KG_CO2E_PER_KWH.gas) / 1000 : null;
  const costRangeGbp = validArea ? option.fixedCost.map((fixed, index) => fixed + area * option.areaCost[index]) : null;
  const scenarios = RETROFIT_SCENARIOS.map((scenario, index) => ({
    ...scenario,
    carbonPrice: Math.max(0, scenario.carbonPrice * (1 + carbonPriceChangePercent / 100)),
    costGbp: costRangeGbp ? [costRangeGbp[1], (costRangeGbp[0] + costRangeGbp[1]) / 2, costRangeGbp[0]][index] : null,
    energySavedKwh: energySavedKwh === null ? null : energySavedKwh * scenario.savingsFactor,
    billSavedGbp: billSavedGbp === null ? null : billSavedGbp * scenario.savingsFactor * (1 + energyPriceChangePercent / 100),
    carbonSavedTonnes: carbonSavedTonnes === null ? null : carbonSavedTonnes * scenario.savingsFactor,
    carbonValueGbp: carbonSavedTonnes === null ? null : carbonSavedTonnes * scenario.savingsFactor * Math.max(0, scenario.carbonPrice * (1 + carbonPriceChangePercent / 100)),
  }));

  return {
    targetEui,
    reductionPercent: validEui ? (1 - targetEui / annualEui) * 100 : null,
    energySavedKwh,
    billSavedGbp,
    carbonSavedTonnes,
    carbonReferenceGbp: carbonSavedTonnes === null ? null : carbonSavedTonnes * CARBON_REFERENCE_GBP_PER_TONNE,
    costRangeGbp,
    scenarios,
    usingBillElectricityRate: electricityBillRate !== null,
    usingBillGasRate: gasBillRate !== null,
    spaceHeatingEuiShare: hasFuelSplit && validHeatingShare ? gasShare * gasHeatingShare : null,
    heatPumpModelled: modelFuelSwitch,
    gasDisconnected,
    avoidedGasStandingGbp,
    renewableOffsetKwh,
    usingProjectedElectricityRate: billUnitRatePence(improvedElectricityRatePence) !== null,
    hotWaterShare,
  };
}
