import { projectInsuranceSaving, projectRetrofit, RETROFIT_OPTIONS } from "./retrofitEconomics";

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
});
