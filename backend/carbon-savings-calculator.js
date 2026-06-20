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
const CRON_SCHEDULE = process.env.CARBON_SAVINGS_CRON || "15 0 * * *";
const PAGE_SIZE = Number(process.env.CARBON_SAVINGS_PAGE_SIZE || 1000);
const MAX_PAGES = Number(process.env.CARBON_SAVINGS_MAX_PAGES || 100);
let supportsCarbonSavingsTable = true;
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
      .select("timestamp, created_at, fuel_type, reading_type, usage_kwh")
      .eq("building_id", BUILDING_ID)
      .in("reading_type", ["daily_total", "interval_30m"])
      .not("usage_kwh", "is", null)
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

function buildMeasuredDailyEnergy(rows) {
  const intervalDays = new Set();
  const days = {};

  rows
    .filter((row) => row.reading_type === "interval_30m")
    .forEach((row) => {
      const day = dateKey(row.timestamp);
      const fuelType = row.fuel_type || "unknown";
      const usageKwh = Number(row.usage_kwh);

      if (!day || !Number.isFinite(usageKwh)) {
        return;
      }

      intervalDays.add(`${fuelType}:${day}`);
      days[day] = days[day] || {};
      days[day][fuelType] = (days[day][fuelType] || 0) + usageKwh;
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
    });

  return days;
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
      const improvedEnergyCostGbp = energyCostForEnergy({
        electricityKwh: improvedElectricityKwh,
        gasKwh: improvedGasKwh,
      });
      const energyCostSavedGbp = Math.max(
        0,
        baselineEnergyCostGbp - improvedEnergyCostGbp
      );

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
        calculation_version: "enerphit-certified-v1",
        raw_payload: {
          electricityKgCo2ePerKwh: ELECTRICITY_KGCO2E_PER_KWH,
          gasKgCo2ePerKwh: GAS_KGCO2E_PER_KWH,
          electricityPriceGbpPerKwh: ELECTRICITY_PRICE_GBP_PER_KWH,
          gasPriceGbpPerKwh: GAS_PRICE_GBP_PER_KWH,
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

async function upsertCarbonSavings(rows) {
  if (!supportsCarbonSavingsTable || rows.length === 0) {
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
        supportsCarbonSavingsTable = false;
        console.warn(
          "CarbonSavingsDaily table is unavailable; calculated savings will remain live-only until the evidence table is created."
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

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error("Supabase environment variables are missing.");
  }

  const fromDate = parseDate(FROM_DATE, "CARBON_SAVINGS_FROM");
  const toDate = parseDate(TO_DATE || new Date().toISOString(), "CARBON_SAVINGS_TO");
  const energyRows = await fetchEnergyRows(fromDate, toDate);
  const dailyEnergy = buildMeasuredDailyEnergy(energyRows);
  const carbonRows = buildCarbonSavingRows(dailyEnergy, toDate);
  const totalSavedKgCo2e = carbonRows.reduce(
    (sum, row) => sum + row.saved_kgco2e,
    0
  );
  const totalSavedKwh = carbonRows.reduce((sum, row) => sum + row.saved_kwh, 0);
  const totalEnergyCostSavedGbp = carbonRows.reduce(
    (sum, row) => sum + row.energy_cost_saved_gbp,
    0
  );

  const persisted = DRY_RUN ? false : await upsertCarbonSavings(carbonRows);

  console.log(
    `${persisted ? "Upserted" : "Calculated"} ${carbonRows.length} carbon saving day(s) for ${BUILDING_ID}.`
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
