const CONNECTOR_CATALOG = [
  {
    id: "dyson",
    manufacturer: /\bdyson\b/i,
    models: [/\bpure cool (?:link|formaldehyde)\b/i, /\bTP0[29]\b/i],
    route: "network",
    name: "Dyson home-network collector",
    ready: true,
    nextStep: "Match this device with the paired tablet's network scan.",
  },
  {
    id: "milesight",
    manufacturer: /\bmilesight\b/i,
    models: [/\bAM3\d\d(?:L)?\b/i],
    route: "feed",
    name: "LoRaWAN gateway or network-server feed",
    ready: false,
    nextStep: "This sensor needs a LoRaWAN gateway. It cannot send readings straight to your tablet or home Wi-Fi.",
    steps: [
      "Add the sensor to a Milesight gateway and Milesight IoT Cloud account.",
      "Check that readings appear in the Milesight app.",
      "Keep this device registered here. WBP import is not available yet; no gateway password or device key is needed in this form.",
    ],
    guideUrl: "https://www.milesight.com/getting-start/en/am300-series-quick-start-guide.html",
    guideLabel: "Open Milesight AM300 setup guide",
  },
  {
    id: "airgradient",
    manufacturer: /\bairgradient\b/i,
    models: [/\b(?:ONE|Open Air)\b/i, /\bI-9PSL(?:-DE)?\b/i, /\bO-1PST\b/i],
    route: "network",
    name: "Local Wi-Fi API",
    ready: true,
    nextStep: "Connect the monitor to the same Wi-Fi as your paired tablet, then test a local reading below. No AirGradient API token is needed.",
  },
  {
    id: "aranet",
    manufacturer: /\baranet\b/i,
    models: [/\bAranet4\b/i],
    route: "bluetooth",
    name: "Bluetooth reading connector",
    ready: false,
    nextStep: "Keep the tablet within Bluetooth range. WBP still needs an Aranet4 reader; Bluetooth discovery alone does not import measurements.",
  },
  {
    id: "netatmo",
    manufacturer: /\bnetatmo\b/i,
    models: [/\b(?:Smart Indoor Air Quality Monitor|Healthy Home Coach)\b/i],
    route: "api",
    name: "Manufacturer account API",
    ready: false,
    nextStep: "Authorise a Netatmo account once WBP supports its API. No account credentials should be entered in this form.",
  },
];

export const connectionForSensor = (sensor) => {
  const manufacturer = String(sensor?.manufacturer || "").trim();
  const model = String(sensor?.model || "").trim();
  const identity = `${manufacturer} ${model}`;
  if (!manufacturer) return null;
  return CONNECTOR_CATALOG.find((entry) => entry.manufacturer.test(manufacturer)
    && entry.models.some((pattern) => pattern.test(identity))) || null;
};
