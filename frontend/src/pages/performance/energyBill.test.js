import { parseEnergyBillText } from "./energyBill";

test("extracts labelled bill identifiers and tariff prices", () => {
  expect(parseEnergyBillText("Supplier: Example Energy Tariff: Fixed Saver Account 123 Electricity MPAN 1234567890123 Unit rate 24.50 p/kWh Standing charge 51.2 p/day"))
    .toEqual(expect.objectContaining({
      supplier: "Example Energy", tariff: "Fixed Saver", mpan: "1234567890123",
      unitRatePence: "24.50", standingChargePence: "51.2",
    }));
});

test("returns empty fields for unreadable scans", () => {
  expect(Object.values(parseEnergyBillText("scanned image without selectable text")).every((value) => value === "")).toBe(true);
});
