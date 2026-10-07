import { connectionForSensor } from "./sensorConnectors";

test.each(["Pure Cool Link", "TP02", "Pure Cool Formaldehyde", "TP09"])(
  "selects the supported network connector for Dyson %s", (model) => {
    expect(connectionForSensor({ manufacturer: "Dyson", model })).toMatchObject({ route: "network" });
  }
);

test("does not infer a connector from a brand or an unknown model", () => {
  expect(connectionForSensor({ manufacturer: "Dyson", model: "" })).toBeNull();
  expect(connectionForSensor({ manufacturer: "Dyson", model: "Unknown" })).toBeNull();
  expect(connectionForSensor({ manufacturer: "Other", model: "TP02" })).toBeNull();
});
