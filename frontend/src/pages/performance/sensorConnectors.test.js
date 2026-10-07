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

test.each([
  ["Milesight", "AM300", "feed"],
  ["Milesight", "AM307L", "feed"],
  ["AirGradient", "ONE", "network"],
  ["AirGradient", "Open Air", "network"],
  ["Aranet", "Aranet4", "bluetooth"],
  ["Netatmo", "Smart Indoor Air Quality Monitor", "api"],
])("recognises %s %s without claiming a live connector", (manufacturer, model, route) => {
  expect(connectionForSensor({ manufacturer, model })).toMatchObject({ route, ready: false });
});
