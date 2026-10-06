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
  return { scannedAt: report.scannedAt, candidates };
};
