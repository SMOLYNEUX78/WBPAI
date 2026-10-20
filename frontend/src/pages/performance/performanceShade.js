const STOPS = [
  [0, [239, 107, 112]],
  [24, [244, 154, 98]],
  [48, [245, 204, 91]],
  [72, [167, 207, 117]],
  [100, [56, 201, 120]],
];

export const performanceShade = (score) => {
  if (!Number.isFinite(score)) return null;
  const value = Math.max(0, Math.min(100, score));
  const upperIndex = STOPS.findIndex(([position]) => position >= value);
  if (upperIndex === 0) return `rgb(${STOPS[0][1].join(", ")})`;
  const [start, from] = STOPS[upperIndex - 1];
  const [end, to] = STOPS[upperIndex];
  const fraction = (value - start) / (end - start);
  return `rgb(${from.map((channel, index) => Math.round(channel + (to[index] - channel) * fraction)).join(", ")})`;
};
