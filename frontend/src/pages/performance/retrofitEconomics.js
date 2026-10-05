export const RETROFIT_OPTIONS = [
  { id: "fabric", name: "Fabric first", reduction: 15, fixedCost: [4000, 9000], areaCost: [40, 90], measures: "Survey heat loss, insulation, airtightness and ventilation together." },
  { id: "heat", name: "Fabric + clean heat", reduction: 30, fixedCost: [12000, 18000], areaCost: [100, 200], measures: "Improve the fabric, then size low-carbon heating against the reduced heat load." },
  { id: "whole", name: "Whole-home retrofit", reduction: 45, fixedCost: [18000, 28000], areaCost: [270, 470], measures: "Coordinate fabric, ventilation, heating and controls in one staged design." },
];

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

const validRate = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed < 100 ? parsed : fallback;
};

export function projectRetrofit({ option, annualEui, area, electricityDailyKwh, gasDailyKwh, billReview = {} }) {
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
    costGbp: costRangeGbp ? [costRangeGbp[1], (costRangeGbp[0] + costRangeGbp[1]) / 2, costRangeGbp[0]][index] : null,
    energySavedKwh: energySavedKwh === null ? null : energySavedKwh * scenario.savingsFactor,
    billSavedGbp: billSavedGbp === null ? null : billSavedGbp * scenario.savingsFactor,
    carbonSavedTonnes: carbonSavedTonnes === null ? null : carbonSavedTonnes * scenario.savingsFactor,
    carbonValueGbp: carbonSavedTonnes === null ? null : carbonSavedTonnes * scenario.savingsFactor * scenario.carbonPrice,
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
