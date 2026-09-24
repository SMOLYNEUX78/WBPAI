import { fillMissingWeeklyEnergy } from "./weeklyEnergyFallback";

test("fills an absent energy series from compact daily history without replacing measured fuel", () => {
  const trend = [
    { dayIndex: 0, electricity: null, gas: 0.5 },
    { dayIndex: 0, electricity: null, gas: 0.7 },
    { dayIndex: 1, electricity: null, gas: null },
  ];
  const daily = [
    { saving_date: "2026-09-07", baseline_electricity_kwh: 2.4, baseline_gas_kwh: 4 },
    { saving_date: "2026-09-14", baseline_electricity_kwh: 4.8, baseline_gas_kwh: 5 },
  ];
  const result = fillMissingWeeklyEnergy(trend, daily, 0.25, 0.75);
  expect(result[0].electricity).toBeCloseTo(0.15);
  expect(result[0].electricityRegulated).toBeCloseTo(0.0375);
  expect(result[0].electricityDailyEstimated).toBe(true);
  expect(result[1].gas).toBe(0.7);
  expect(result[2].electricity).toBeNull();
});
