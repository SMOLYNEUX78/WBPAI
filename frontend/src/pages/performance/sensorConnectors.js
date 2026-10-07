const CONNECTOR_CATALOG = [
  {
    manufacturer: "dyson",
    models: [/\bpure cool (?:link|formaldehyde)\b/i, /\bTP0[29]\b/i],
    route: "network",
    name: "Dyson home-network collector",
    ready: true,
    nextStep: "Match this device with the paired tablet's network scan.",
  },
  {
    manufacturer: "milesight",
    models: [/\bAM3\d\d(?:L)?\b/i],
    route: "feed",
    name: "LoRaWAN gateway or network-server feed",
    ready: false,
    nextStep: "Register the Device EUI with a LoRaWAN network server, then authorise its decoded uplinks for WBP. A Device EUI alone cannot provide readings.",
  },
  {
    manufacturer: "airgradient",
    models: [/\b(?:ONE|Open Air)\b/i],
    route: "network",
    name: "Local API or MQTT feed",
    ready: false,
    nextStep: "Connect the monitor to Wi-Fi. WBP still needs an AirGradient reader before it can import local API or MQTT measurements.",
  },
  {
    manufacturer: "aranet",
    models: [/\bAranet4\b/i],
    route: "bluetooth",
    name: "Bluetooth reading connector",
    ready: false,
    nextStep: "Keep the tablet within Bluetooth range. WBP still needs an Aranet4 reader; Bluetooth discovery alone does not import measurements.",
  },
  {
    manufacturer: "netatmo",
    models: [/\b(?:Smart Indoor Air Quality Monitor|Healthy Home Coach)\b/i],
    route: "api",
    name: "Manufacturer account API",
    ready: false,
    nextStep: "Authorise a Netatmo account once WBP supports its API. No account credentials should be entered in this form.",
  },
];

export const connectionForSensor = (sensor) => {
  const manufacturer = String(sensor?.manufacturer || "").trim().toLowerCase();
  const model = String(sensor?.model || "").trim();
  if (!manufacturer || !model) return null;
  return CONNECTOR_CATALOG.find((entry) => manufacturer === entry.manufacturer
    && entry.models.some((pattern) => pattern.test(model))) || null;
};
