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

test("does not invent a tariff from the supplied Good Energy information page", () => {
  const result = parseEnergyBillText(`Thank you for being part of Good Energy.
We're working towards 100% renewable energy every single day.
Simple green ways to pay for your bill.
Your average electricity use during this bill period was 4.19 kWh/day.
Your average gas use during this bill period was 3.47 kWh/day.
Good Energy Registered address`);
  expect(result.supplier).toBe("Good Energy");
  expect(result.electricityTariff).toBe("");
  expect(result.gasTariff).toBe("");
  expect(result.mpan).toBe("");
  expect(result.mprn).toBe("");
});

test("reads the two-column Good Energy charges page OCR", () => {
  expect(parseEnergyBillText(`Electricity Supply number S 1012905988160 Prices do not include VAT
Good Energy Fix Jan27 - End date: 31 January 2027 Tariff name Good Energy Fix Jan27
Energy Unit rate 20.61p/kWh
Standing charge 53.62p/day
Gas Meter Point Reference: 3019419002
Good Energy Fix Jan27 - End date: 31 January 2027 Tariff name Good Energy Fix Jan27
Unit rate 5.00p/kWh
Standing charge 32.26p/day`)).toEqual(expect.objectContaining({
    supplier: "Good Energy", electricityTariff: "Good Energy Fix Jan27", gasTariff: "Good Energy Fix Jan27",
    mpan: "1012905988160", mprn: "3019419002",
    electricityUnitRatePence: "20.61", electricityStandingChargePence: "53.62",
    gasUnitRatePence: "5.00", gasStandingChargePence: "32.26",
  }));
});
