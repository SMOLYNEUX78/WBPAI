import { calculatePublicBenefit } from "./RetrofitPublicBenefit";

const assumptions = {
  healthCost: 100, reduction: 50, confidence: 25, years: 5, discount: 0,
  peakKw: 1, availabilityHours: 100, activationHours: 10,
  availabilityRate: 20, utilisationRate: 100,
};

test("converts kW to MW and discounts confidence separately from the health score", () => {
  const result = calculatePublicBenefit(assumptions);
  expect(result.health).toBe(12.5);
  expect(result.grid).toBe(0.75);
  expect(result.healthInvestment).toBe(62.5);
  expect(result.gridInvestment).toBe(3.75);
});

test("no peak reduction gives no grid value; discount lowers present value", () => {
  const result = calculatePublicBenefit({ ...assumptions, peakKw: 0, discount: 3.5 });
  expect(result.grid).toBe(0);
  expect(result.healthInvestment).toBeLessThan(62.5);
});

test("invalid and negative values cannot create negative benefits", () => {
  const result = calculatePublicBenefit({ ...assumptions, healthCost: -100, peakKw: "bad" });
  expect(result.health).toBe(0);
  expect(result.grid).toBe(0);
});
