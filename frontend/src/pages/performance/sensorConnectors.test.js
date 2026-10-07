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

test("recognises a Milesight model in a longer label or manufacturer field", () => {
  expect(connectionForSensor({ manufacturer: "Milesight IoT", model: "AM300 Series", serialNumber: "24e1611234567890" })).toMatchObject({ route: "feed", ready: false });
  expect(connectionForSensor({ manufacturer: "Milesight AM300", model: "", serialNumber: "24e1611234567890" })).toMatchObject({ route: "feed", ready: false });
  expect(connectionForSensor({ manufacturer: "Milesight", model: "AM300" }).steps).toHaveLength(3);
});

test.each([
  ["Milesight", "AM300", "feed"],
  ["Milesight", "AM307L", "feed"],
  ["Aranet", "Aranet4", "bluetooth"],
  ["Netatmo", "Smart Indoor Air Quality Monitor", "api"],
])("recognises %s %s without claiming a live connector", (manufacturer, model, route) => {
  expect(connectionForSensor({ manufacturer, model })).toMatchObject({ route, ready: false });
});

test.each(["ONE", "Open Air", "I-9PSL-DE", "O-1PST"])("selects the AirGradient local connector for %s", (model) => {
  expect(connectionForSensor({ manufacturer: "AirGradient", model })).toMatchObject({ route: "network", ready: true });
});
