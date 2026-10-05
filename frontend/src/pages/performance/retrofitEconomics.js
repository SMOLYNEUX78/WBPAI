export const RETROFIT_OPTIONS = [
  { id: "fabric", name: "Fabric first", reduction: 15, fixedCost: [4000, 9000], areaCost: [40, 90], measures: "Survey heat loss, insulation, airtightness and ventilation together." },
  { id: "heat", name: "Fabric + clean heat", reduction: 30, fixedCost: [12000, 18000], areaCost: [100, 200], measures: "Improve the fabric, then size low-carbon heating against the reduced heat load." },
  { id: "whole", name: "Whole-home retrofit", reduction: 45, fixedCost: [18000, 28000], areaCost: [270, 470], measures: "Coordinate fabric, ventilation, heating and controls in one staged design." },
];

export function getRetrofitOption(scope) {
  const position = Math.max(0, Math.min(100, Number(scope) || 0));
  const lower = position < 50 ? RETROFIT_OPTIONS[0] : RETROFIT_OPTIONS[1];
  const upper = position < 50 ? RETROFIT_OPTIONS[1] : RETROFIT_OPTIONS[2];
  const fraction = (position % 50) / 50;
  if (position === 100) return RETROFIT_OPTIONS[2];
  const blend = (a, b) => a + (b - a) * fraction;
  return {
    name: position === 0 ? lower.name : position === 50 ? lower.name : "Staged retrofit",
    reduction: blend(lower.reduction, upper.reduction),
    fixedCost: lower.fixedCost.map((value, index) => blend(value, upper.fixedCost[index])),
    areaCost: lower.areaCost.map((value, index) => blend(value, upper.areaCost[index])),
    measures: position < 50 ? "Scale fabric, airtightness and ventilation works before adding clean heat." : "Add clean heat and progressively extend to whole-home measures.",
  };
}

const OFGEM_OCT_2026_PENCE = { electricity: 26.32, gas: 7.97 };
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
    { label: "Energy bills", value: scenario.billSavedGbp, colour: "#047857" },
    { label: "Carbon", value: scenario.carbonValueGbp, colour: "#2563eb" },
    { label: "Data licences", value: scenario.dataIncome, colour: "#d97706" },
    { label: "Insurance", value: insuranceSaving ?? 0, colour: "#be123c" },
  ];
  return { parts, total: parts.reduce((sum, part) => sum + part.value, 0), insuranceIncluded: insuranceSaving !== null };
}

const validRate = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed < 100 ? parsed : fallback;
};

export function projectRetrofit({ option, annualEui, area, electricityDailyKwh, gasDailyKwh, billReview = {}, energyPriceChangePercent = 0, carbonPriceChangePercent = 0 }) {
  const validArea = Number.isFinite(area) && area > 0;
  const validEui = Number.isFinite(annualEui) && annualEui > 0;
  const energySavedKwh = validArea && validEui ? annualEui * area * option.reduction / 100 : null;
  const hasFuelSplit = Number.isFinite(electricityDailyKwh) && electricityDailyKwh >= 0
    && Number.isFinite(gasDailyKwh) && gasDailyKwh >= 0
    && electricityDailyKwh + gasDailyKwh > 0;
  const electricityShare = hasFuelSplit ? electricityDailyKwh / (electricityDailyKwh + gasDailyKwh) : null;
  const gasShare = hasFuelSplit ? 1 - electricityShare : null;
  const electricitySavedKwh = energySavedKwh !== null && hasFuelSplit ? energySavedKwh * electricityShare : null;
  const gasSavedKwh = energySavedKwh !== null && hasFuelSplit ? energySavedKwh * gasShare : null;
  const electricityRate = validRate(billReview.electricityUnitRatePence, OFGEM_OCT_2026_PENCE.electricity);
  const gasRate = validRate(billReview.gasUnitRatePence, OFGEM_OCT_2026_PENCE.gas);
  const billSavedGbp = hasFuelSplit && energySavedKwh !== null
    ? (electricitySavedKwh * electricityRate + gasSavedKwh * gasRate) / 100 : null;
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
    targetEui: validEui ? annualEui * (1 - option.reduction / 100) : null,
    energySavedKwh,
    billSavedGbp,
    carbonSavedTonnes,
    carbonReferenceGbp: carbonSavedTonnes === null ? null : carbonSavedTonnes * CARBON_REFERENCE_GBP_PER_TONNE,
    costRangeGbp,
    scenarios,
    usingBillElectricityRate: electricityRate !== OFGEM_OCT_2026_PENCE.electricity,
    usingBillGasRate: gasRate !== OFGEM_OCT_2026_PENCE.gas,
  };
}
