export const readDeviceScan = (text) => {
  const report = JSON.parse(text);
  if (!report || !Array.isArray(report.candidates) || typeof report.scannedAt !== "string") {
    throw new Error("This is not a WBP tablet scan report.");
  }
  const tabletAddresses = new Set(report.tabletAddresses || []);
  const candidates = report.candidates.slice(0, 256).filter((candidate) =>
    typeof candidate.address === "string" && /^\d{1,3}(\.\d{1,3}){3}$/.test(candidate.address))
    .map((candidate) => {
      const signals = Array.isArray(candidate.signals) ? candidate.signals.slice(0, 20).map((signal) => ({
        method: String(signal?.method || "unknown").slice(0, 24),
        detail: String(signal?.detail || "").slice(0, 240),
      })) : [];
      const details = signals.map((signal) => String(signal.detail || "")).join(" ").toLowerCase();
      const kind = tabletAddresses.has(candidate.address) ? "This tablet"
        : details.includes("internetgatewaydevice") ? "Router or gateway"
          : /mediarenderer|spotify-connect|_undok\./.test(details) ? "Audio device"
            : details.includes("port 1883") ? "MQTT service; device unconfirmed"
              : "Unidentified network device";
      return { address: candidate.address, kind, signals };
    });
  const configuredDevices = Array.isArray(report.configuredDevices) ? report.configuredDevices.slice(0, 32)
    .filter((device) => typeof device?.name === "string" && typeof device?.address === "string")
    .map((device) => ({ name: device.name, address: device.address, connector: String(device.connector || ""),
      serial: String(device.serial || ""), readingType: String(device.readingType || "") })) : [];
  return { scannedAt: report.scannedAt, candidates, configuredDevices };
};

export const normaliseSerial = (value) => String(value || "").replace(/[^a-z0-9]/gi, "").toUpperCase();

export const suggestDeviceCandidates = (instrument, scan) => {
  if (!instrument || !scan?.candidates) return [];
  const room = String(instrument.location || "").toLowerCase();
  const isDyson = /dyson/i.test(instrument.manufacturer || "");
  const labelSerial = normaliseSerial(instrument.serialNumber || instrument.labelCode);
  return scan.candidates.filter((candidate) => !["This tablet", "Router or gateway", "Audio device"].includes(candidate.kind))
    .map((candidate) => {
      const configured = scan.configuredDevices?.find((device) => device.address === candidate.address);
      const configuredRoom = String(configured?.name || "").toLowerCase().replaceAll("_", " ");
      const roomHint = configuredRoom && room && (room.includes(configuredRoom) || configuredRoom.includes(room));
      const connectorHint = isDyson && configured?.connector === "dyson";
      const serialMatch = Boolean(connectorHint && labelSerial && normaliseSerial(configured?.serial) === labelSerial);
      return { ...candidate, configured, serialMatch, suggested: Boolean(serialMatch || (roomHint && connectorHint)), compatible: Boolean(connectorHint) };
    }).sort((a, b) => Number(b.serialMatch) - Number(a.serialMatch) || Number(b.suggested) - Number(a.suggested) || Number(b.compatible) - Number(a.compatible));
};
