function shouldMirrorIntervalCorrection(previous, incoming, observedAt, now = Date.now()) {
  const timestamp = Date.parse(observedAt);
  return Number.isFinite(previous) && Number.isFinite(incoming) &&
    Math.abs(previous - incoming) > 0.000001 &&
    Number.isFinite(timestamp) && timestamp >= now - 48 * 60 * 60 * 1000 &&
    timestamp <= now + 5 * 60 * 1000;
}

module.exports = { shouldMirrorIntervalCorrection };
