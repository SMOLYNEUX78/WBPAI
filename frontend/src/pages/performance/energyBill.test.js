import { normaliseBillReview, parseEnergyBillText } from "./energyBill";

test("extracts separate electricity and gas details from bill sections", () => {
  expect(parseEnergyBillText(`Supplier: Example Energy
Electricity
Tariff: Fixed Saver
MPAN 12 3456 7890 123
Unit rate 24.50 p/kWh
Standing charge 51.2 p/day
Gas
Tariff: Gas Saver
MPRN 1234567890
Unit rate 6.75p per kWh
Standing charge 29.8p/day`))
    .toEqual(expect.objectContaining({
      supplier: "Example Energy", electricityTariff: "Fixed Saver", gasTariff: "Gas Saver",
      mpan: "1234567890123", mprn: "1234567890",
      electricityUnitRatePence: "24.50", electricityStandingChargePence: "51.2",
      gasUnitRatePence: "6.75", gasStandingChargePence: "29.8",
    }));
});

test("supports legacy confirmed fields without inventing gas prices", () => {
  expect(normaliseBillReview({ tariff: "Old plan", unitRatePence: "24.5" })).toEqual(expect.objectContaining({
    electricityTariff: "Old plan", electricityUnitRatePence: "24.5", gasUnitRatePence: "",
  }));
});

test("returns empty fields for unreadable scans", () => {
  expect(Object.values(parseEnergyBillText("scanned image without selectable text")).every((value) => value === "")).toBe(true);
});
