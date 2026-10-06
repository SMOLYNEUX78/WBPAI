function sanitiseScan(report) {
  return {
    scannedAt: report.scannedAt,
    tabletAddresses: (report.tabletAddresses || []).slice(0, 8),
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
