import { parseStockCsv } from "./stockImport";

test("parses quoted addresses and preserves proposed organisations", () => {
  expect(parseStockCsv('uprn,address,legal_owner_name,tenure,design_organisation\n123,"1 High Street, Ipswich",Council,secure tenancy,Studio A\n'))
    .toEqual([{ uprn: "123", address: "1 High Street, Ipswich", legal_owner_name: "Council", tenure: "secure tenancy", design_organisation: "Studio A" }]);
});

test("rejects duplicate homes", () => {
  expect(() => parseStockCsv("uprn,address,legal_owner_name,tenure\n123,1 High Street,Council,rented\n123,2 High Street,Council,rented"))
    .toThrow(/duplicate UPRN/);
});
