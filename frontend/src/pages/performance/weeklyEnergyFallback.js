export const fillMissingWeeklyEnergy = (trend, dailyRows, electricRegulatedFraction, gasRegulatedFraction) => {
  const fuels = [
    { key: "electricity", fraction: electricRegulatedFraction },
    { key: "gas", fraction: gasRegulatedFraction },
  ];

  return fuels.reduce((rows, { key, fraction }) => {
    if (rows.some((point) => Number(point[key]) > 0)) return rows;

    const byDay = Array.from({ length: 7 }, () => []);
    dailyRows.forEach((day) => {
      const date = new Date(`${day.saving_date}T00:00:00Z`);
      const value = Number(day[`baseline_${key}_kwh`]);
      if (!Number.isNaN(date.getTime()) && Number.isFinite(value) && value >= 0) {
        byDay[(date.getUTCDay() + 6) % 7].push(value / 24);
      }
    });

    return rows.map((point) => {
      const samples = byDay[point.dayIndex] || [];
      if (!samples.length) return point;
      const hourlyAverage = samples.reduce((sum, value) => sum + value, 0) / samples.length;
      return {
        ...point,
        [key]: hourlyAverage,
        [`${key}Regulated`]: hourlyAverage * fraction,
        [`${key}Unregulated`]: hourlyAverage * (1 - fraction),
        [`${key}DailyEstimated`]: true,
      };
    });
  }, trend);
};
