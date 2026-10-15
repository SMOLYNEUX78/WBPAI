import { calculateModelledWalletBalance } from "./dataWallet";

test("adds modelled data and carbon value", () => {
  const balance = calculateModelledWalletBalance({
    recordedDays: 182.5,
    savedKgCo2e: 250,
    carbonCredits: null,
    annualDataValue: 744,
    carbonPricePerTonne: 65,
  });

  expect(balance).toEqual({ data: 372, carbon: 16.25, total: 388.25 });
});

test("keeps the total pending when carbon evidence is missing", () => {
  const balance = calculateModelledWalletBalance({
    recordedDays: 205,
    savedKgCo2e: null,
    carbonCredits: null,
    annualDataValue: 744,
    carbonPricePerTonne: 65,
  });

  expect(balance.data).toBeGreaterThan(0);
  expect(balance.carbon).toBeNull();
  expect(balance.total).toBeNull();
});

test("uses carbon credits when saved mass is unavailable", () => {
  const balance = calculateModelledWalletBalance({
    recordedDays: 0,
    savedKgCo2e: null,
    carbonCredits: 0.5,
    annualDataValue: 744,
    carbonPricePerTonne: 65,
  });

  expect(balance).toEqual({ data: 0, carbon: 32.5, total: 32.5 });
});
