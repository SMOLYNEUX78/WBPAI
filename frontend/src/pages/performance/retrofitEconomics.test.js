import { CC_CANDIDATE_PROFILE, getAnnualBenefitBreakdown, getRetrofitOption, projectInsuranceSaving, projectRetrofit, RETROFIT_OPTIONS } from "./retrofitEconomics";

test("interpolates works scope between package anchors", () => {
  expect(getRetrofitOption(0).reduction).toBe(15);
  expect(getRetrofitOption(25).reduction).toBe(22.5);
  expect(getRetrofitOption(50).reduction).toBe(30);
  expect(getRetrofitOption(75).reduction).toBe(35);
  expect(getRetrofitOption(100).name).toBe("EnerPHit design pathway");
  expect(getRetrofitOption(25).fixedCost).toEqual([8000, 13500]);
});

test("far-right pathway uses the shared CC all-electric candidate, not a percentage-only fuel mix", () => {
  const annualEui = 41.47;
  const area = 99.2;
  const result = projectRetrofit({
    option: getRetrofitOption(100), annualEui, area, allElectric: true,
    electricityDailyKwh: 5, gasDailyKwh: 7,
    billReview: { electricityUnitRatePence: 25, gasUnitRatePence: 8 },
  });
  expect(result.targetEui).toBe(CC_CANDIDATE_PROFILE.annualEui);
  expect(result.energySavedKwh).toBeCloseTo((annualEui - 25) * area);
  const baselineKwh = annualEui * area;
  expect(result.billSavedGbp).toBeCloseTo((baselineKwh * (5 / 12) * 25 + baselineKwh * (7 / 12) * 8 - 25 * area * 25) / 100);
  expect(result.costRangeGbp).toEqual([54760, 99520]);
});

test("increasing scope never reverses EUI or bill savings with a consistent fuel assumption", () => {
  for (const annualEui of [20, 35, 41.47, 120]) {
    let previous;
    for (let scope = 0; scope <= 100; scope += 1) {
      const result = projectRetrofit({ option: getRetrofitOption(scope), annualEui, area: 99.2, electricityDailyKwh: 5, gasDailyKwh: 7 });
      if (previous) {
        expect(result.targetEui).toBeLessThanOrEqual(previous.targetEui + 1e-9);
        expect(result.billSavedGbp).toBeGreaterThanOrEqual(previous.billSavedGbp - 1e-9);
      }
      previous = result;
    }
  }
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
  const extraCost = getAnnualBenefitBreakdown({ ...scenario, billSavedGbp: -50 }, "");
  expect(extraCost).toMatchObject({ total: 212, energyCostIncrease: 50 });
  expect(extraCost.parts[0].value).toBe(0);
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
