export const calculateModelledWalletBalance = ({ recordedDays, savedKgCo2e, carbonCredits, annualDataValue, carbonPricePerTonne }) => {
  const data = Number.isFinite(recordedDays) && recordedDays >= 0
    ? (recordedDays / 365) * annualDataValue
    : null;
  const carbonTonnes = Number.isFinite(savedKgCo2e)
    ? savedKgCo2e / 1000
    : carbonCredits;
  const carbon = Number.isFinite(carbonTonnes)
    ? Math.max(0, carbonTonnes) * carbonPricePerTonne
    : null;

  return { data, carbon, total: data !== null && carbon !== null ? data + carbon : null };
};
