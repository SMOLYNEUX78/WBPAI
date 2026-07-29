const { createClient } = require("@supabase/supabase-js");
const cron = require("node-cron");
require("dotenv").config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const BUILDING_ID = process.env.CARBON_SAVINGS_BUILDING_ID || "home";
const SCENARIO = process.env.CARBON_SAVINGS_SCENARIO || "enerphit-certified";
const INTERNAL_AREA_M2 = Number(process.env.CARBON_SAVINGS_AREA_M2 || 99.2);
const ENERPHIT_EUI_KWH_M2_YEAR = Number(
  process.env.ENERPHIT_EUI_KWH_M2_YEAR ||
    process.env.PASSIVHAUS_EUI_KWH_M2_YEAR ||
    25
);
const IMPROVED_DAILY_ELECTRICITY_KWH = Number(
  process.env.IMPROVED_DAILY_ELECTRICITY_KWH ||
    (INTERNAL_AREA_M2 * ENERPHIT_EUI_KWH_M2_YEAR) / 365
);
const ELECTRICITY_KGCO2E_PER_KWH = Number(
  process.env.ELECTRICITY_KGCO2E_PER_KWH || 0.20705
);
const GAS_KGCO2E_PER_KWH = Number(process.env.GAS_KGCO2E_PER_KWH || 0.18254);
const ELECTRICITY_PRICE_GBP_PER_KWH = Number(
  process.env.ELECTRICITY_PRICE_GBP_PER_KWH || 0.245
);
const GAS_PRICE_GBP_PER_KWH = Number(process.env.GAS_PRICE_GBP_PER_KWH || 0.06);
const FROM_DATE = process.env.CARBON_SAVINGS_FROM || "2020-01-01";
const TO_DATE = process.env.CARBON_SAVINGS_TO;
const DRY_RUN = process.env.CARBON_SAVINGS_DRY_RUN === "true";
const RUN_SCHEDULE =
  process.argv.includes("--schedule") || process.env.CARBON_SAVINGS_SCHEDULE === "true";
const CRON_SCHEDULE = process.env.CARBON_SAVINGS_CRON || "*/15 * * * *";
const PAGE_SIZE = Number(process.env.CARBON_SAVINGS_PAGE_SIZE || 1000);
const MAX_PAGES = Number(process.env.CARBON_SAVINGS_MAX_PAGES || 200);
const CALCULATION_VERSION = "enerphit-certified-v2";
const ENERGY_VALUE_METHOD = "saved_kwh_x_measured_baseline_blended_tariff";
let supportsExtendedSavingsColumns = true;

function parseDate(value, label) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label} is not a valid date: ${value}`);
  }

  return date;
}

function dateKey(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function chunkRows(rows, size) {
  const chunks = [];

  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }

  return chunks;
}

async function fetchEnergyRows(fromDate, toDate) {
  const rows = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("EnergyReadings")
      .select("timestamp, created_at, fuel_type, reading_type, usage_kwh, power_kw")
      .eq("building_id", BUILDING_ID)
      .in("reading_type", ["daily_total", "interval_30m", "instant_power"])
      .or("usage_kwh.not.is.null,power_kw.not.is.null")
      .gte("timestamp", fromDate.toISOString())
      .lte("timestamp", toDate.toISOString())
      .order("timestamp", { ascending: true })
      .order("created_at", { ascending: true })
      .range(from, to);

    if (error) {
      throw error;
    }

    rows.push(...(data || []));

    if (!data || data.length < PAGE_SIZE) {
      break;
    }
  }

  return rows;
}

function buildMeasuredEnergy(rows) {
  const intervalDays = new Set();
  const days = {};
  const measuredIntervalBuckets = new Set();
  const intervalBuckets = new Map();
  const intervalEnergy = {};
  const dailyFallbackEnergy = {};
  const intervalKey = (timestamp) => {
    const date = new Date(timestamp);

    if (Number.isNaN(date.getTime())) {
      return null;
    }

    date.setUTCMinutes(date.getUTCMinutes() < 30 ? 0 : 30, 0, 0);
    return date.toISOString();
  };

  rows
    .filter((row) => row.reading_type === "interval_30m")
    .forEach((row) => {
      const day = dateKey(row.timestamp);
      const interval = intervalKey(row.timestamp);
      const fuelType = row.fuel_type || "unknown";
      const usageKwh = Number(row.usage_kwh);

      if (!day || !interval || !Number.isFinite(usageKwh)) {
        return;
      }

      const bucketKey = `${fuelType}:${interval}`;
      const existing = intervalBuckets.get(bucketKey);

      if (!existing || usageKwh > existing.usageKwh) {
        intervalBuckets.set(bucketKey, { day, fuelType, usageKwh, timestamp: interval });
      }
    });

  intervalBuckets.forEach(({ day, fuelType, usageKwh, timestamp }, bucketKey) => {
    intervalDays.add(`${fuelType}:${day}`);
    measuredIntervalBuckets.add(bucketKey);
    days[day] = days[day] || {};
    days[day][fuelType] = (days[day][fuelType] || 0) + usageKwh;
    intervalEnergy[timestamp] = intervalEnergy[timestamp] || {};
    intervalEnergy[timestamp][fuelType] =
      (intervalEnergy[timestamp][fuelType] || 0) + usageKwh;
  });

  const instantRowsByFuel = rows
    .filter((row) => row.reading_type === "instant_power")
    .reduce((groups, row) => {
      const fuelType = row.fuel_type || "unknown";
      groups[fuelType] = groups[fuelType] || [];
      groups[fuelType].push(row);
      return groups;
    }, {});

  Object.entries(instantRowsByFuel).forEach(([fuelType, rowsForFuel]) => {
    rowsForFuel
      .slice()
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      .forEach((row, index, sortedRows) => {
        if (index === 0) {
          return;
        }

        const previousRow = sortedRows[index - 1];
        const previousTimestamp = new Date(previousRow.timestamp);
        const timestamp = new Date(row.timestamp);
        const elapsedHours = (timestamp - previousTimestamp) / 3600000;
        const previousPowerKw = Number(previousRow.power_kw);
        const powerKw = Number(row.power_kw);

        if (
          !Number.isFinite(elapsedHours) ||
          elapsedHours <= 0 ||
          elapsedHours > 0.25 ||
          !Number.isFinite(previousPowerKw) ||
          !Number.isFinite(powerKw)
        ) {
          return;
        }

        const interval = intervalKey(row.timestamp);
        const day = dateKey(row.timestamp);

        if (!day || !interval || measuredIntervalBuckets.has(`${fuelType}:${interval}`)) {
          return;
        }

        const usageKwh = ((previousPowerKw + powerKw) / 2) * elapsedHours;

        if (!Number.isFinite(usageKwh) || usageKwh <= 0) {
          return;
        }

        intervalDays.add(`${fuelType}:${day}`);
        days[day] = days[day] || {};
        days[day][fuelType] = (days[day][fuelType] || 0) + usageKwh;
        intervalEnergy[interval] = intervalEnergy[interval] || {};
        intervalEnergy[interval][fuelType] =
          (intervalEnergy[interval][fuelType] || 0) + usageKwh;
      });
  });

  rows
    .filter((row) => row.reading_type === "daily_total")
    .forEach((row) => {
      const day = dateKey(row.timestamp);
      const fuelType = row.fuel_type || "unknown";
      const usageKwh = Number(row.usage_kwh);

      if (!day || !Number.isFinite(usageKwh) || intervalDays.has(`${fuelType}:${day}`)) {
        return;
      }

      days[day] = days[day] || {};
      days[day][fuelType] = Math.max(days[day][fuelType] || 0, usageKwh);
      dailyFallbackEnergy[day] = dailyFallbackEnergy[day] || {};
      dailyFallbackEnergy[day][fuelType] = Math.max(
        dailyFallbackEnergy[day][fuelType] || 0,
        usageKwh
      );
    });

  return { dailyEnergy: days, intervalEnergy, dailyFallbackEnergy };
}

function carbonForEnergy({ electricityKwh, gasKwh }) {
  return (
    electricityKwh * ELECTRICITY_KGCO2E_PER_KWH +
    gasKwh * GAS_KGCO2E_PER_KWH
  );
}

function energyCostForEnergy({ electricityKwh, gasKwh }) {
  return (
    electricityKwh * ELECTRICITY_PRICE_GBP_PER_KWH +
    gasKwh * GAS_PRICE_GBP_PER_KWH
  );
}

function valuePhysicalEnergySaved({ savedKwh, baselineTotalKwh, measuredEnergyCost }) {
  if (
    !Number.isFinite(savedKwh) ||
    savedKwh <= 0 ||
    !Number.isFinite(baselineTotalKwh) ||
    baselineTotalKwh <= 0 ||
    !Number.isFinite(measuredEnergyCost)
  ) {
    return 0;
  }

  return savedKwh * (measuredEnergyCost / baselineTotalKwh);
}

function projectionFactorForDay(savingDate, toDate) {
  const today = toDate.toISOString().slice(0, 10);

  if (savingDate !== today) {
    return 1;
  }

  const startOfToday = new Date(`${today}T00:00:00.000Z`);
  return Math.min(1, Math.max(0, (toDate - startOfToday) / 86400000));
}

function buildCarbonSavingRows(dailyEnergy, toDate) {
  return Object.entries(dailyEnergy)
    .map(([savingDate, fuels]) => {
      const baselineElectricityKwh = Number(fuels.electricity || 0);
      const baselineGasKwh = Number(fuels.gas || 0);
      const baselineTotalKwh = baselineElectricityKwh + baselineGasKwh;

      if (baselineTotalKwh <= 0) {
        return null;
      }

      const projectionFactor = projectionFactorForDay(savingDate, toDate);
      const improvedElectricityKwh =
        IMPROVED_DAILY_ELECTRICITY_KWH * projectionFactor;
      const improvedGasKwh = 0;
      const improvedTotalKwh = improvedElectricityKwh + improvedGasKwh;
      const baselineKgCo2e = carbonForEnergy({
        electricityKwh: baselineElectricityKwh,
        gasKwh: baselineGasKwh,
      });
      const improvedKgCo2e = carbonForEnergy({
        electricityKwh: improvedElectricityKwh,
        gasKwh: improvedGasKwh,
      });
      const savedKgCo2e = Math.max(0, baselineKgCo2e - improvedKgCo2e);
      const savedKwh = Math.max(0, baselineTotalKwh - improvedTotalKwh);
      const baselineEnergyCostGbp = energyCostForEnergy({
        electricityKwh: baselineElectricityKwh,
        gasKwh: baselineGasKwh,
      });
      const energyCostSavedGbp = valuePhysicalEnergySaved({
        savedKwh,
        baselineTotalKwh,
        measuredEnergyCost: baselineEnergyCostGbp,
      });

      return {
        building_id: BUILDING_ID,
        saving_date: savingDate,
        scenario: SCENARIO,
        baseline_electricity_kwh: baselineElectricityKwh,
        baseline_gas_kwh: baselineGasKwh,
        baseline_total_kwh: baselineTotalKwh,
        improved_electricity_kwh: improvedElectricityKwh,
        improved_gas_kwh: improvedGasKwh,
        improved_total_kwh: improvedTotalKwh,
        baseline_kgco2e: baselineKgCo2e,
        improved_kgco2e: improvedKgCo2e,
        saved_kgco2e: savedKgCo2e,
        saved_kwh: savedKwh,
        energy_cost_saved_gbp: energyCostSavedGbp,
        carbon_credits: savedKgCo2e / 1000,
        source: "carbon-savings-calculator",
        calculation_version: CALCULATION_VERSION,
        raw_payload: {
          electricityKgCo2ePerKwh: ELECTRICITY_KGCO2E_PER_KWH,
          gasKgCo2ePerKwh: GAS_KGCO2E_PER_KWH,
          electricityPriceGbpPerKwh: ELECTRICITY_PRICE_GBP_PER_KWH,
          gasPriceGbpPerKwh: GAS_PRICE_GBP_PER_KWH,
          energyValueMethod: ENERGY_VALUE_METHOD,
          internalAreaM2: INTERNAL_AREA_M2,
          enerphitEuiKwhM2Year: ENERPHIT_EUI_KWH_M2_YEAR,
          improvedDailyElectricityKwh: IMPROVED_DAILY_ELECTRICITY_KWH,
          projectionFactor,
          note:
            "Daily saving = measured baseline operational emissions - projected EnerPHit certified operational emissions.",
        },
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.saving_date.localeCompare(b.saving_date));
}

function savingRowForMeasuredEnergy({
  savingDate,
  timestamp,
  electricityKwh,
  gasKwh,
  improvedElectricityKwh,
  projectionFactor,
  basis,
}) {
  const baselineTotalKwh = electricityKwh + gasKwh;

  if (baselineTotalKwh <= 0) {
    return null;
  }

  const improvedGasKwh = 0;
  const improvedTotalKwh = improvedElectricityKwh + improvedGasKwh;
  const baselineKgCo2e = carbonForEnergy({ electricityKwh, gasKwh });
  const improvedKgCo2e = carbonForEnergy({
    electricityKwh: improvedElectricityKwh,
    gasKwh: improvedGasKwh,
  });
  const savedKgCo2e = Math.max(0, baselineKgCo2e - improvedKgCo2e);
  const savedKwh = Math.max(0, baselineTotalKwh - improvedTotalKwh);
  const baselineEnergyCostGbp = energyCostForEnergy({ electricityKwh, gasKwh });
  const energyCostSavedGbp = valuePhysicalEnergySaved({
    savedKwh,
    baselineTotalKwh,
    measuredEnergyCost: baselineEnergyCostGbp,
  });

  return {
    timestamp,
    saving_date: savingDate,
    saved_kgco2e: savedKgCo2e,
    saved_kwh: savedKwh,
    energy_cost_saved_gbp: energyCostSavedGbp,
    carbon_credits: savedKgCo2e / 1000,
    raw_payload: {
      basis,
      projectionFactor,
      baseline_electricity_kwh: electricityKwh,
      baseline_gas_kwh: gasKwh,
      improved_electricity_kwh: improvedElectricityKwh,
      improved_gas_kwh: improvedGasKwh,
    },
  };
}

function buildAccruedSavingRows({ intervalEnergy, dailyFallbackEnergy, toDate }) {
  const improvedIntervalElectricityKwh = IMPROVED_DAILY_ELECTRICITY_KWH / 48;
  const intervalRows = Object.entries(intervalEnergy)
    .map(([timestamp, fuels]) => {
      const savingDate = dateKey(timestamp);

      if (!savingDate) {
        return null;
      }

      return savingRowForMeasuredEnergy({
        savingDate,
        timestamp,
        electricityKwh: Number(fuels.electricity || 0),
        gasKwh: Number(fuels.gas || 0),
        improvedElectricityKwh: improvedIntervalElectricityKwh,
        projectionFactor: 1 / 48,
        basis: "interval_30m_accrual",
      });
    })
    .filter(Boolean);

  const fallbackRows = Object.entries(dailyFallbackEnergy)
    .map(([savingDate, fuels]) => {
      const projectionFactor = projectionFactorForDay(savingDate, toDate);

      return savingRowForMeasuredEnergy({
        savingDate,
        timestamp: `${savingDate}T00:00:00.000Z`,
        electricityKwh: Number(fuels.electricity || 0),
        gasKwh: Number(fuels.gas || 0),
        improvedElectricityKwh: IMPROVED_DAILY_ELECTRICITY_KWH * projectionFactor,
        projectionFactor,
        basis: "daily_total_fallback",
      });
    })
    .filter(Boolean);

  return [...intervalRows, ...fallbackRows].sort((a, b) => {
    const dateCompare = a.saving_date.localeCompare(b.saving_date);

    if (dateCompare !== 0) {
      return dateCompare;
    }

    return String(a.timestamp || "").localeCompare(String(b.timestamp || ""));
  });
}

function withoutExtendedSavingsColumns(rows) {
  return rows.map(({ saved_kwh, energy_cost_saved_gbp, ...row }) => row);
}

function isMissingExtendedSavingsColumn(error) {
  return (
    /saved_kwh|energy_cost_saved_gbp/i.test(error.message || "") ||
    /saved_kwh|energy_cost_saved_gbp/i.test(error.details || "") ||
    error.code === "PGRST204"
  );
}

function isMissingCarbonSavingsTable(error) {
  return (
    /CarbonSavingsDaily/i.test(error.message || "") ||
    /CarbonSavingsDaily/i.test(error.details || "") ||
    error.code === "42P01" ||
    error.code === "PGRST205"
  );
}

function isMissingCarbonSavingsSummaryTable(error) {
  return (
    /CarbonSavingsSummary/i.test(error.message || "") ||
    /CarbonSavingsSummary/i.test(error.details || "") ||
    error.code === "42P01" ||
    error.code === "PGRST205"
  );
}

async function upsertCarbonSavings(rows) {
  if (rows.length === 0) {
    return false;
  }

  for (const batch of chunkRows(rows, 500)) {
    const uploadRows = supportsExtendedSavingsColumns
      ? batch
      : withoutExtendedSavingsColumns(batch);
    const { error } = await supabase
      .from("CarbonSavingsDaily")
      .upsert(uploadRows, { onConflict: "building_id,saving_date,scenario" });

    if (error) {
      if (isMissingCarbonSavingsTable(error)) {
        console.warn(
          `CarbonSavingsDaily table is unavailable via API (${error.message}); calculated daily evidence will retry on the next run.`
        );
        return false;
      }

      if (supportsExtendedSavingsColumns && isMissingExtendedSavingsColumn(error)) {
        supportsExtendedSavingsColumns = false;
        console.warn(
          "CarbonSavingsDaily is missing saved_kwh/energy_cost_saved_gbp columns; retrying without them."
        );
        const retry = await supabase
          .from("CarbonSavingsDaily")
          .upsert(withoutExtendedSavingsColumns(batch), {
            onConflict: "building_id,saving_date,scenario",
          });

        if (!retry.error) {
          continue;
        }

        throw retry.error;
      }

      throw error;
    }
  }

  return true;
}

async function upsertCarbonSavingsSummary({ rows, toDate }) {
  const summaryRows = rows
    .filter((row) => row.saving_date || dateKey(row.timestamp))
    .slice()
    .sort((a, b) => {
      const dateCompare = String(a.saving_date || dateKey(a.timestamp)).localeCompare(
        String(b.saving_date || dateKey(b.timestamp))
      );

      if (dateCompare !== 0) {
        return dateCompare;
      }

      return String(a.timestamp || "").localeCompare(String(b.timestamp || ""));
    });

  const rowDate = (row) => row?.saving_date || dateKey(row?.timestamp);
  const totalSavedKgCo2e = summaryRows.reduce(
    (sum, row) => sum + row.saved_kgco2e,
    0
  );
  const totalSavedKwh = summaryRows.reduce((sum, row) => sum + row.saved_kwh, 0);
  const totalEnergyCostSavedGbp = summaryRows.reduce(
    (sum, row) => sum + row.energy_cost_saved_gbp,
    0
  );
  const totalCarbonCredits = summaryRows.reduce(
    (sum, row) => sum + row.carbon_credits,
    0
  );
  const latest = summaryRows[summaryRows.length - 1] || null;
  const first = summaryRows[0] || null;
  const uniqueMeteredDays = new Set(summaryRows.map(rowDate).filter(Boolean)).size;

  const summaryRow = {
    building_id: BUILDING_ID,
    scenario: SCENARIO,
    from_date: rowDate(first) || null,
    to_date: rowDate(latest) || null,
    calculated_at: toDate.toISOString(),
    daily_rows: uniqueMeteredDays,
    total_saved_kgco2e: totalSavedKgCo2e,
    total_saved_kwh: totalSavedKwh,
    total_energy_cost_saved_gbp: totalEnergyCostSavedGbp,
    carbon_credits: totalCarbonCredits,
    latest_date: rowDate(latest) || null,
    latest_saved_kgco2e: latest?.saved_kgco2e ?? null,
    latest_saved_kwh: latest?.saved_kwh ?? null,
    latest_energy_cost_saved_gbp: latest?.energy_cost_saved_gbp ?? null,
    source: "carbon-savings-calculator",
    calculation_version: CALCULATION_VERSION,
    raw_payload: {
      internalAreaM2: INTERNAL_AREA_M2,
      enerphitEuiKwhM2Year: ENERPHIT_EUI_KWH_M2_YEAR,
      improvedDailyElectricityKwh: IMPROVED_DAILY_ELECTRICITY_KWH,
      electricityKgCo2ePerKwh: ELECTRICITY_KGCO2E_PER_KWH,
      gasKgCo2ePerKwh: GAS_KGCO2E_PER_KWH,
      electricityPriceGbpPerKwh: ELECTRICITY_PRICE_GBP_PER_KWH,
      gasPriceGbpPerKwh: GAS_PRICE_GBP_PER_KWH,
      energyValueMethod: ENERGY_VALUE_METHOD,
      summaryAggregation: "interval_accrued_plus_daily_fallback",
      summaryRows: summaryRows.length,
      meteredDays: uniqueMeteredDays,
      note:
        "Summary row for dashboard display; daily evidence rows remain in CarbonSavingsDaily where the table exists.",
    },
  };

  const { error } = await supabase
    .from("CarbonSavingsSummary")
    .upsert(summaryRow, { onConflict: "building_id,scenario" });

  if (error) {
    if (isMissingCarbonSavingsSummaryTable(error)) {
      console.warn(
        `CarbonSavingsSummary table is unavailable via API (${error.message}); summary upsert will retry on the next run.`
      );
      return false;
    }

    throw error;
  }

  return true;
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error("Supabase environment variables are missing.");
  }

  const fromDate = parseDate(FROM_DATE, "CARBON_SAVINGS_FROM");
  const toDate = parseDate(TO_DATE || new Date().toISOString(), "CARBON_SAVINGS_TO");
  const energyRows = await fetchEnergyRows(fromDate, toDate);
  const measuredEnergy = buildMeasuredEnergy(energyRows);
  const { dailyEnergy, intervalEnergy, dailyFallbackEnergy } = measuredEnergy;
  const carbonRows = buildCarbonSavingRows(dailyEnergy, toDate);
  const accruedRows = buildAccruedSavingRows({
    intervalEnergy,
    dailyFallbackEnergy,
    toDate,
  });
  const summaryRows = accruedRows.length ? accruedRows : carbonRows;
  const totalSavedKgCo2e = summaryRows.reduce(
    (sum, row) => sum + row.saved_kgco2e,
    0
  );
  const totalSavedKwh = summaryRows.reduce((sum, row) => sum + row.saved_kwh, 0);
  const totalEnergyCostSavedGbp = summaryRows.reduce(
    (sum, row) => sum + row.energy_cost_saved_gbp,
    0
  );

  const persisted = DRY_RUN ? false : await upsertCarbonSavings(carbonRows);
  const summaryPersisted = DRY_RUN
    ? false
    : await upsertCarbonSavingsSummary({ rows: summaryRows, toDate });

  console.log(
    `${persisted ? "Upserted" : "Calculated"} ${carbonRows.length} carbon saving day(s) for ${BUILDING_ID}.`
  );
  console.log(
    `${summaryPersisted ? "Upserted" : "Calculated"} carbon savings summary for ${BUILDING_ID} from ${
      accruedRows.length ? "interval accrued data" : "daily evidence rows"
    }.`
  );
  console.log(
    `Total saved: ${totalSavedKgCo2e.toFixed(3)} kgCO2e / ${(totalSavedKgCo2e / 1000).toFixed(6)} WBP-C candidate credits.`
  );
  console.log(
    `Energy saved: ${totalSavedKwh.toFixed(3)} kWh / GBP ${totalEnergyCostSavedGbp.toFixed(2)} candidate avoided cost.`
  );

  if (carbonRows.length) {
    const latest = carbonRows[carbonRows.length - 1];
    console.log(
      `Latest ${latest.saving_date}: baseline ${latest.baseline_kgco2e.toFixed(3)} kgCO2e, improved ${latest.improved_kgco2e.toFixed(3)} kgCO2e, saved ${latest.saved_kgco2e.toFixed(3)} kgCO2e.`
    );
  }
}

if (require.main === module) {
  if (RUN_SCHEDULE) {
    console.log(`Starting carbon savings scheduler: ${CRON_SCHEDULE}`);
    main().catch((error) => {
      console.error("Initial carbon savings calculation failed:", error.message);
    });
    cron.schedule(CRON_SCHEDULE, () => {
      main().catch((error) => {
        console.error("Scheduled carbon savings calculation failed:", error.message);
      });
    });
  } else {
    main().catch((error) => {
      console.error("Carbon savings calculation failed:", error.message);
      process.exit(1);
    });
  }
}

module.exports = { calculateCarbonSavings: main };
