import { getAnnualBenefitBreakdown, getRetrofitOption, projectInsuranceSaving, projectRetrofit, RETROFIT_OPTIONS } from "./retrofitEconomics";

test("interpolates works scope between package anchors", () => {
  expect(getRetrofitOption(0).reduction).toBe(15);
  expect(getRetrofitOption(25).reduction).toBe(22.5);
  expect(getRetrofitOption(50).reduction).toBe(30);
  expect(getRetrofitOption(100).reduction).toBe(45);
  expect(getRetrofitOption(25).fixedCost).toEqual([8000, 13500]);
});

test("insurance sensitivity requires a premium and never assumes a confirmed discount", () => {
  expect(projectInsuranceSaving("", 0.1)).toBeNull();
  expect(projectInsuranceSaving("500", 0)).toBe(0);
  expect(projectInsuranceSaving("500", 0.05)).toBe(25);
  expect(projectInsuranceSaving("500", 0.1)).toBe(50);
});

test("scales installed cost with floor area and retrofit scope", () => {
  const inputs = { annualEui: 120, area: 100, electricityDailyKwh: 5, gasDailyKwh: 15 };
  expect(projectRetrofit({ ...inputs, option: RETROFIT_OPTIONS[0] }).costRangeGbp).toEqual([8000, 18000]);
  expect(projectRetrofit({ ...inputs, option: RETROFIT_OPTIONS[2] }).costRangeGbp).toEqual([45000, 75000]);
  expect(projectRetrofit({ ...inputs, area: 150, option: RETROFIT_OPTIONS[0] }).costRangeGbp).toEqual([10000, 22500]);
});

test("uses measured fuel shares and bill rates for conditional annual values", () => {
  const result = projectRetrofit({
    option: RETROFIT_OPTIONS[1], annualEui: 120, area: 100,
    electricityDailyKwh: 5, gasDailyKwh: 15,
    billReview: { electricityUnitRatePence: "25", gasUnitRatePence: "8" },
  });
  expect(result.energySavedKwh).toBe(3600);
  expect(result.billSavedGbp).toBe(441);
  expect(result.carbonSavedTonnes).toBeCloseTo(0.610101);
  expect(result.carbonReferenceGbp).toBeCloseTo(39.656565);
  expect(result.scenarios.map((scenario) => scenario.carbonPrice)).toEqual([0, 65, 150]);
  expect(result.scenarios.map((scenario) => scenario.carbonValueGbp)).toEqual([
    0, result.carbonSavedTonnes * 65, result.carbonSavedTonnes * 1.25 * 150,
  ]);
});

test("does not invent fuel-dependent earnings without a metered split", () => {
  const result = projectRetrofit({ option: RETROFIT_OPTIONS[0], annualEui: 120, area: 100 });
  expect(result.energySavedKwh).toBe(1800);
  expect(result.billSavedGbp).toBeNull();
  expect(result.carbonReferenceGbp).toBeNull();
  expect(getAnnualBenefitBreakdown(result.scenarios[1], "500")).toBeNull();
});

test("annual benefit sums distinct components and excludes unknown insurance", () => {
  const scenario = { billSavedGbp: 300, carbonValueGbp: 40, dataIncome: 222, insuranceDiscount: 0.05 };
  expect(getAnnualBenefitBreakdown(scenario, "")).toMatchObject({ total: 562, insuranceIncluded: false });
  expect(getAnnualBenefitBreakdown(scenario, "500")).toMatchObject({ total: 587, insuranceIncluded: true });
});

test("price stress changes money values without changing energy or carbon tonnes", () => {
  const inputs = { option: getRetrofitOption(50), annualEui: 120, area: 100, electricityDailyKwh: 5, gasDailyKwh: 15 };
  const base = projectRetrofit(inputs).scenarios[1];
  const stressed = projectRetrofit({ ...inputs, energyPriceChangePercent: 50, carbonPriceChangePercent: 100 }).scenarios[1];
  expect(stressed.energySavedKwh).toBe(base.energySavedKwh);
  expect(stressed.carbonSavedTonnes).toBe(base.carbonSavedTonnes);
  expect(stressed.billSavedGbp).toBeCloseTo(base.billSavedGbp * 1.5);
  expect(stressed.carbonValueGbp).toBeCloseTo(base.carbonValueGbp * 2);
});
