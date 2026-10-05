export const RETROFIT_OPTIONS = [
  { id: "fabric", name: "Fabric first", reduction: 15, fixedCost: [4000, 9000], areaCost: [40, 90], measures: "Survey heat loss, insulation, airtightness and ventilation together." },
  { id: "heat", name: "Fabric + clean heat", reduction: 30, fixedCost: [12000, 18000], areaCost: [100, 200], measures: "Improve the fabric, then size low-carbon heating against the reduced heat load." },
  { id: "whole", name: "Whole-home retrofit", reduction: 45, fixedCost: [18000, 28000], areaCost: [270, 470], measures: "Coordinate fabric, ventilation, heating and controls in one staged design." },
];

const OFGEM_OCT_2026_PENCE = { electricity: 26.32, gas: 7.97 };
const DESNZ_2026_KG_CO2E_PER_KWH = { electricity: 0.13096, gas: 0.18231 };
export const DATA_LICENCE_REFERENCE_GBP_PER_YEAR = 144 + 120 + 180;
export const CARBON_REFERENCE_GBP_PER_TONNE = 65;

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

  return {
    targetEui: validEui ? annualEui * (1 - option.reduction / 100) : null,
    energySavedKwh,
    billSavedGbp,
    carbonSavedTonnes,
    carbonReferenceGbp: carbonSavedTonnes === null ? null : carbonSavedTonnes * CARBON_REFERENCE_GBP_PER_TONNE,
    costRangeGbp,
    usingBillElectricityRate: electricityRate !== OFGEM_OCT_2026_PENCE.electricity,
    usingBillGasRate: gasRate !== OFGEM_OCT_2026_PENCE.gas,
  };
}
