const fields = [
  "hddEnergyKwh", "hddTotal", "hddDays", "comfortHddDays",
  "htcSumWk", "htcDays", "htcDeltaC", "nightHtcSumWk", "nightCount",
  "nightTauSumHours", "nightCoolingSumCPerHour", "nightSamples",
  "hotBufferC", "hotHours",
  "overheatedHours", "downRainyRh", "downRainyHours", "downDryRh",
  "downDryHours", "upRainyRh", "upRainyHours", "upDryRh", "upDryHours",
];

const rainArea = (totals, prefix, monthCount) => {
  const rainySamples = totals[`${prefix}RainyHours`];
  const drySamples = totals[`${prefix}DryHours`];
  const averageRainyRh = rainySamples ? totals[`${prefix}RainyRh`] / rainySamples : null;
  const averageDryRh = drySamples ? totals[`${prefix}DryRh`] / drySamples : null;
  return {
    rainySamples,
    drySamples,
    averageRainyRh,
    averageDryRh,
    rhUplift: averageRainyRh !== null && averageDryRh !== null
      ? averageRainyRh - averageDryRh : null,
    correlation: null,
    windowDays: null,
    monthCount,
    status: rainySamples >= 3 && drySamples >= 3 ? "ready" : "collecting",
  };
};

export const mergeMonthlyHlaRows = (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const totals = Object.fromEntries(fields.map((field) => [field, 0]));
  rows.forEach((row) => {
    fields.forEach((field) => {
      const value = Number(row.summary?.[field]);
      if (Number.isFinite(value)) totals[field] += value;
    });
  });
  const months = rows.filter((row) => row.summary?.sourceReadings === undefined
    || Number(row.summary.sourceReadings) > 0)
    .map((row) => row.month_start).filter(Boolean).sort();
  const downstairs = rainArea(totals, "down", months.length);
  const upstairs = rainArea(totals, "up", months.length);
  const hddIntensity = totals.hddTotal > 0 ? totals.hddEnergyKwh / totals.hddTotal : null;
  return {
    coverage: months.length
      ? { from: months[0], through: months[months.length - 1], months: months.length }
      : null,
    heatLossSummary: {
      kwhPerHdd: hddIntensity,
      weatherNormalisedEui: null,
      htcEstimate: totals.htcDays ? totals.htcSumWk / totals.htcDays : null,
      hddDays: totals.hddDays,
      hddTotal: totals.hddTotal,
      htcSamples: totals.htcDays,
      htcDeltaTotal: totals.htcDeltaC,
      nightCooldownHtc: totals.nightCount ? totals.nightHtcSumWk / totals.nightCount : null,
      nightCooldownTauHours: totals.nightCount
        ? totals.nightTauSumHours / totals.nightCount : null,
      nightCooldownRateCPerHour: totals.nightCount
        ? totals.nightCoolingSumCPerHour / totals.nightCount : null,
      nightCooldownNights: totals.nightCount,
      nightCooldownSamples: totals.nightSamples,
      hddSource: "monthly-snapshots",
      hlaConfidence: "indicative",
      hddConfidence: "indicative",
      htcConfidence: "indicative",
      comfortHddDays: totals.comfortHddDays,
      averageInternalTemp: null,
    },
    heatExclusionSummary: {
      averageBuffer: totals.hotHours ? totals.hotBufferC / totals.hotHours : null,
      sampleCount: totals.hotHours,
      overheatingShare: totals.hotHours ? totals.overheatedHours / totals.hotHours : null,
      hotThreshold: 24,
    },
    rainHumiditySummary: {
      ...downstairs,
      area: "downstairs",
      downstairs,
      upstairs,
      areas: { downstairs, upstairs },
    },
  };
};
