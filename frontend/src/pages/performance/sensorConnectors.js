const CONNECTOR_CATALOG = [
  {
    manufacturer: "dyson",
    models: [/\bpure cool (?:link|formaldehyde)\b/i, /\bTP0[29]\b/i],
    route: "network",
    name: "Dyson home-network collector",
  },
];

export const connectionForSensor = (sensor) => {
  const manufacturer = String(sensor?.manufacturer || "").trim().toLowerCase();
  const model = String(sensor?.model || "").trim();
  if (!manufacturer || !model) return null;
  return CONNECTOR_CATALOG.find((entry) => manufacturer === entry.manufacturer
    && entry.models.some((pattern) => pattern.test(model))) || null;
};
