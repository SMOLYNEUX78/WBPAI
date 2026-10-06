function sanitiseScan(report) {
  return {
    scannedAt: report.scannedAt,
    tabletAddresses: (report.tabletAddresses || []).slice(0, 8),
    configuredDevices: (report.configuredDevices || []).slice(0, 32).map((device) => ({
      name: String(device.name || "").slice(0, 64),
      address: String(device.address || "").slice(0, 45),
      connector: String(device.connector || "").slice(0, 24),
      serial: String(device.serial || "").slice(0, 80),
      readingType: String(device.readingType || "").slice(0, 80),
    })),
    candidates: (report.candidates || []).slice(0, 128).map((candidate) => ({
      address: String(candidate.address || "").slice(0, 45),
      signals: (candidate.signals || []).slice(0, 6).map((signal) => ({
        method: String(signal.method || "unknown").slice(0, 24),
        detail: String(signal.detail || "").slice(0, 120),
      })),
    })),
    truncated: (report.candidates || []).length > 128,
    lanProbe: report.lanProbe || "",
    note: report.note || "",
  };
}

module.exports = { sanitiseScan };
