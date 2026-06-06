import React, { useEffect, useMemo, useRef, useState } from "react";
import AnalogGauge from "../../components/AnalogGauge";
import supabase from "../../supabaseClient";

const DEFAULT_MATTERPORT_URL = "https://my.matterport.com/show/?m=zHm8SwWeHiN";

const BUILDINGS = [
  {
    id: "home",
    name: "Home",
    subtitle: "Home smart meter, CAD and MQTT collector",
    defaultMatterportUrl: "https://my.matterport.com/show/?m=8A48K5upwWN",
    latitude: 52.0945,
    longitude: 1.30488,
    estimatedInternalArea: 99.2,
    targetEui: 35,
    nationalAverageEui: 150,
    legacyUnscopedData: false,
  },
  {
    id: "museum",
    name: "Museum",
    subtitle: "CAD monitor, smart meter and IAQ tablet collector",
    defaultMatterportUrl: DEFAULT_MATTERPORT_URL,
    latitude: 52.0901,
    longitude: -1.321,
    estimatedInternalArea: 145,
    targetEui: 65,
    nationalAverageEui: 200,
    legacyUnscopedData: true,
  },
];

const extractMatterportModelId = (value) => {
  if (!value) {
    return "";
  }

  const trimmedValue = value.trim();

  if (/^[a-zA-Z0-9]{11}$/.test(trimmedValue)) {
    return trimmedValue;
  }

  try {
    const parsedUrl = new URL(trimmedValue);
    return parsedUrl.searchParams.get("m") || "";
  } catch (error) {
    return "";
  }
};

const normalizeMatterportUrl = (value) => {
  const modelId = extractMatterportModelId(value);

  if (!modelId) {
    return "";
  }

  return `https://my.matterport.com/show/?m=${modelId}`;
};

const buildMatterportEmbedUrl = (value) => {
  const modelId = extractMatterportModelId(value);

  if (!modelId) {
    return "";
  }

  return `https://my.matterport.com/show/?m=${modelId}&play=1&qs=1&brand=0&mls=2`;
};

const createEmptyMatterportMetadata = (statusText, building = {}) => ({
  address: statusText,
  latitude: building.latitude ?? "--",
  longitude: building.longitude ?? "--",
  internalArea: "--",
  source: "Matterport SDK / API pending",
});

const getEstimatedInternalArea = (modelId, building) => {
  if (modelId === "zHm8SwWeHiN") {
    return 145;
  }

  return building.estimatedInternalArea;
};

const normaliseHeader = (value) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const parseCsvLine = (line) => {
  const cells = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"' && quoted && nextChar === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current.trim());
  return cells;
};

const parseCsv = (text) => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return [];
  }

  const headers = parseCsvLine(lines[0]).map(normaliseHeader);

  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return headers.reduce((row, header, index) => {
      row[header] = cells[index] ?? "";
      return row;
    }, {});
  });
};

const firstValue = (row, keys) => {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== "") {
      return row[key];
    }
  }

  return "";
};

const numberValue = (row, keys) => {
  const value = Number(String(firstValue(row, keys)).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(value) ? value : null;
};

const dateKeyFromRow = (row) => {
  const rawDate = firstValue(row, [
    "date",
    "day",
    "timestamp",
    "time",
    "start_date",
    "period_start",
    "billing_period_start",
  ]);
  const parsedDate = new Date(rawDate);

  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return parsedDate.toISOString().slice(0, 10);
};

const analyseHistoricalRows = (rows, area) => {
  const dailyTotals = {};
  let hddTotal = 0;
  let hddEnergyTotal = 0;
  let htcTotal = 0;
  let htcSamples = 0;

  rows.forEach((row) => {
    const day = dateKeyFromRow(row);
    if (!day) {
      return;
    }

    const fuelType = normaliseHeader(
      firstValue(row, ["fuel_type", "fuel", "meter_type", "utility"])
    );
    const electricityKwh =
      numberValue(row, ["electricity_kwh", "electricity", "import_kwh"]) ??
      (fuelType.includes("electric")
        ? numberValue(row, ["usage_kwh", "kwh", "energy_kwh", "consumption_kwh"])
        : null);
    const gasKwh =
      numberValue(row, ["gas_kwh", "gas"]) ??
      (fuelType.includes("gas")
        ? numberValue(row, ["usage_kwh", "kwh", "energy_kwh", "consumption_kwh"])
        : null);
    const hdd = numberValue(row, [
      "hdd",
      "heating_degree_days",
      "degree_days",
      "hdd_15_5",
    ]);
    const indoorTemp = numberValue(row, [
      "internal_temp",
      "temperature_inside",
      "inside_temp",
      "indoor_temp",
    ]);
    const outdoorTemp = numberValue(row, [
      "external_temp",
      "temperature_outside",
      "outside_temp",
      "outdoor_temp",
    ]);

    if (!dailyTotals[day]) {
      dailyTotals[day] = { electricity: 0, gas: 0 };
    }

    if (Number.isFinite(electricityKwh)) {
      dailyTotals[day].electricity += electricityKwh;
    }

    if (Number.isFinite(gasKwh)) {
      dailyTotals[day].gas += gasKwh;
    }

    const totalKwh =
      (Number.isFinite(electricityKwh) ? electricityKwh : 0) +
      (Number.isFinite(gasKwh) ? gasKwh : 0);

    if (Number.isFinite(hdd) && hdd > 0 && totalKwh > 0) {
      hddTotal += hdd;
      hddEnergyTotal += totalKwh;
    }

    if (
      Number.isFinite(indoorTemp) &&
      Number.isFinite(outdoorTemp) &&
      indoorTemp > outdoorTemp &&
      totalKwh > 0
    ) {
      const averagePowerWatts = (totalKwh * 1000) / 24;
      htcTotal += averagePowerWatts / (indoorTemp - outdoorTemp);
      htcSamples += 1;
    }
  });

  const days = Object.values(dailyTotals);
  const electricityDailyAverage = days.length
    ? days.reduce((sum, day) => sum + day.electricity, 0) / days.length
    : null;
  const gasDailyAverage = days.length
    ? days.reduce((sum, day) => sum + day.gas, 0) / days.length
    : null;
  const totalDailyAverage =
    Number.isFinite(electricityDailyAverage) || Number.isFinite(gasDailyAverage)
      ? (electricityDailyAverage || 0) + (gasDailyAverage || 0)
      : null;
  const annualisedEui =
    Number.isFinite(totalDailyAverage) && Number.isFinite(area) && area > 0
      ? (totalDailyAverage * 365) / area
      : null;

  return {
    rowCount: rows.length,
    dayCount: days.length,
    electricityDailyAverage,
    gasDailyAverage,
    totalDailyAverage,
    annualisedEui,
    kwhPerHdd: hddTotal > 0 ? hddEnergyTotal / hddTotal : null,
    htcEstimate: htcSamples > 0 ? htcTotal / htcSamples : null,
    htcSamples,
  };
};

const BuildingDashboardPanel = ({ building }) => {
  const [matterportInput, setMatterportInput] = useState(() => {
    return (
      localStorage.getItem(`${building.id}:matterportModelInput`) ||
      building.defaultMatterportUrl
    );
  });
  const [manualMatterportData, setManualMatterportData] = useState(() => {
    const savedData = localStorage.getItem(`${building.id}:matterportManualData`);

    if (savedData) {
      try {
        return JSON.parse(savedData);
      } catch (error) {
        return {};
      }
    }

    return {};
  });
  const [matterportMetadata, setMatterportMetadata] = useState(() =>
    createEmptyMatterportMetadata(
      "Connect Matterport SDK / API to load geodata",
      building
    )
  );

  const [sensorData, setSensorData] = useState({
    internalTemp: null,
    externalTemp: null,
    humidity: null,
    co2: null,
    vocs: null,
    pm25: null,
  });

  const [performanceValue, setPerformanceValue] = useState(null);
  const [historicalPerformance, setHistoricalPerformance] = useState(null);
  const [carbonCredits] = useState(0);
  const [energySummary, setEnergySummary] = useState({
    electricityDailyAverage: null,
    electricityTodayKwh: 0,
    gasDailyAverage: null,
    gasTodayKwh: 0,
    totalDailyAverage: null,
    electricityPowerKw: 0,
    hasGasData: false,
  });

  const [performanceBreakdown, setPerformanceBreakdown] = useState({
    health: null,
    energy: null,
    resilience: null,
    iaq: null,
    comfort: null,
    humidity: null,
  });
  const [historicalImport, setHistoricalImport] = useState({
    fileName: "",
    summary: null,
    error: "",
  });

  const matterportModelId = useMemo(
    () => extractMatterportModelId(matterportInput),
    [matterportInput]
  );
  const matterportShareUrl = useMemo(
    () => normalizeMatterportUrl(matterportInput),
    [matterportInput]
  );
  const matterportEmbedUrl = useMemo(
    () => buildMatterportEmbedUrl(matterportInput),
    [matterportInput]
  );

  useEffect(() => {
    if (!matterportModelId) {
      setMatterportMetadata(
        {
          ...createEmptyMatterportMetadata("Paste a Matterport URL or ID", building),
          ...manualMatterportData,
        }
      );
      return;
    }

    setMatterportMetadata({
      ...createEmptyMatterportMetadata(
        "Model connected, geodata awaiting SDK / API",
        building
      ),
      internalArea: getEstimatedInternalArea(matterportModelId, building),
      ...manualMatterportData,
    });
  }, [building, matterportModelId, manualMatterportData]);

  const applyBuildingScope = (query) => {
    if (building.legacyUnscopedData) {
      return query;
    }

    return query.eq("building_id", building.id);
  };

  const getValidValues = (rows, key) =>
    rows
      .map((row) => Number(row[key]))
      .filter((value) => !Number.isNaN(value) && value !== 0);

  const average = (values) =>
    values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0;

  const formatNumber = (value, digits = 4) =>
    Number.isFinite(value) ? value.toFixed(digits) : "No Data";

  const formatScore = (value) =>
    Number.isFinite(value) ? `${value.toFixed(0)}/100` : "Pending";

  const formatMeasurement = (value, digits = 1) =>
    Number.isFinite(value) ? value.toFixed(digits) : "No Data";

  const percentageWithin = (values, predicate) => {
    if (!values.length) {
      return 0;
    }

    const matches = values.filter(predicate).length;
    return matches / values.length;
  };

  const averageScore = (scores) => {
    const validScores = scores.filter((score) => Number.isFinite(score));

    return validScores.length
      ? validScores.reduce((sum, score) => sum + score, 0) / validScores.length
      : null;
  };

  const clampScore = (value) => Math.max(0, Math.min(100, value));

  const linearScore = (value, bands) => {
    for (const band of bands) {
      if (value <= band.max) {
        const span = band.max - band.min;

        if (span <= 0) {
          return band.endScore;
        }

        const progress = (value - band.min) / span;
        return clampScore(
          band.startScore + (band.endScore - band.startScore) * progress
        );
      }
    }

    return bands[bands.length - 1].endScore;
  };

  const calculateIAQScore = ({ co2Values, pm25Values, vocValues }) => {
    const co2Score = co2Values.length
      ? average(
          co2Values.map((value) =>
            linearScore(value, [
              { min: 0, max: 800, startScore: 100, endScore: 100 },
              { min: 800, max: 1000, startScore: 100, endScore: 90 },
              { min: 1000, max: 1500, startScore: 90, endScore: 45 },
              { min: 1500, max: 2500, startScore: 45, endScore: 0 },
            ])
          )
        )
      : null;

    const pm25Score = pm25Values.length
      ? average(
          pm25Values.map((value) =>
            linearScore(value, [
              { min: 0, max: 5, startScore: 100, endScore: 100 },
              { min: 5, max: 12, startScore: 100, endScore: 85 },
              { min: 12, max: 35, startScore: 85, endScore: 30 },
              { min: 35, max: 75, startScore: 30, endScore: 0 },
            ])
          )
        )
      : null;

    const vocScore = vocValues.length
      ? average(
          vocValues.map((value) =>
            linearScore(value, [
              { min: 0, max: 200, startScore: 100, endScore: 100 },
              { min: 200, max: 500, startScore: 100, endScore: 55 },
              { min: 500, max: 1000, startScore: 55, endScore: 0 },
            ])
          )
        )
      : null;

    return averageScore([co2Score, pm25Score, vocScore]);
  };

  const calculateComfortScore = ({ internalTempValues }) => {
    if (!internalTempValues.length) {
      return null;
    }

    return average(
      internalTempValues.map((value) => {
        if (value >= 20 && value <= 24) {
          return 100;
        }

        if (value < 20) {
          return linearScore(value, [
            { min: -10, max: 12, startScore: 0, endScore: 0 },
            { min: 12, max: 16, startScore: 0, endScore: 45 },
            { min: 16, max: 18, startScore: 45, endScore: 75 },
            { min: 18, max: 20, startScore: 75, endScore: 100 },
          ]);
        }

        return linearScore(value, [
          { min: 24, max: 25, startScore: 100, endScore: 85 },
          { min: 25, max: 28, startScore: 85, endScore: 40 },
          { min: 28, max: 35, startScore: 40, endScore: 0 },
        ]);
      })
    );
  };

  const calculateHumidityScore = (humidityValues) => {
    if (!humidityValues.length) {
      return null;
    }

    return average(
      humidityValues.map((value) => {
        if (value >= 40 && value <= 60) {
          return 100;
        }

        if (value < 40) {
          return linearScore(value, [
            { min: 0, max: 25, startScore: 0, endScore: 0 },
            { min: 25, max: 30, startScore: 0, endScore: 45 },
            { min: 30, max: 40, startScore: 45, endScore: 100 },
          ]);
        }

        return linearScore(value, [
          { min: 60, max: 65, startScore: 100, endScore: 75 },
          { min: 65, max: 70, startScore: 75, endScore: 35 },
          { min: 70, max: 90, startScore: 35, endScore: 0 },
        ]);
      })
    );
  };

  const calculateSeasonalResilienceScore = (rows) => {
    const hotRows = rows.filter((row) => {
      const inside = Number(row.temperature_inside);
      const outside = Number(row.temperature_outside);

      return !Number.isNaN(inside) && !Number.isNaN(outside) && inside !== 0 && outside >= 24;
    });

    const coldRows = rows.filter((row) => {
      const inside = Number(row.temperature_inside);
      const outside = Number(row.temperature_outside);

      return !Number.isNaN(inside) && !Number.isNaN(outside) && inside !== 0 && outside <= 10;
    });

    const hotScore = hotRows.length
      ? Math.max(
          0,
          Math.min(
            100,
            percentageWithin(
              hotRows,
              (row) => Number(row.temperature_inside) <= Number(row.temperature_outside) - 2
            ) * 100 -
              percentageWithin(
                hotRows,
                (row) => Number(row.temperature_inside) >= 28
              ) * 40
          )
        )
      : 100;

    const coldScore = coldRows.length
      ? Math.max(
          0,
          Math.min(
            100,
            percentageWithin(coldRows, (row) => Number(row.temperature_inside) >= 18) * 100 -
              percentageWithin(coldRows, (row) => Number(row.temperature_inside) < 16) * 40
          )
        )
      : 100;

    return Math.round((hotScore + coldScore) / 2);
  };

  const calculateOverallPerformanceScore = ({ health, energy, resilience }) => {
    if (!Number.isFinite(health) || !Number.isFinite(energy)) {
      return null;
    }

    const indoorEnvironment = averageScore([health, resilience]);

    if (!Number.isFinite(indoorEnvironment)) {
      return null;
    }

    return Math.round(Math.min(energy, indoorEnvironment));
  };

  const calculateEnergyScore = (annualEui, targetEui, nationalAverageEui) => {
    if (
      !Number.isFinite(annualEui) ||
      !Number.isFinite(targetEui) ||
      !Number.isFinite(nationalAverageEui) ||
      targetEui <= 0 ||
      nationalAverageEui <= targetEui
    ) {
      return null;
    }

    if (annualEui <= 0) {
      return 100;
    }

    if (annualEui <= targetEui) {
      return 85 + (1 - annualEui / targetEui) * 15;
    }

    if (annualEui <= nationalAverageEui) {
      const targetToAverage =
        (annualEui - targetEui) / (nationalAverageEui - targetEui);
      return 50 + (1 - targetToAverage) * 35;
    }

    return Math.max(
      0,
      50 * (1 - (annualEui - nationalAverageEui) / nationalAverageEui)
    );
  };

  const fetchEnergyDailyTotals = async ({ beforeToday }) => {
    const todayKey = new Date().toISOString().slice(0, 10);
    const todayStart = `${todayKey}T00:00:00+00:00`;
    const pageSize = 1000;
    const maxPages = 20;
    const allRows = [];

    for (let page = 0; page < maxPages; page += 1) {
      let query = supabase
        .from("EnergyReadings")
        .select("timestamp, fuel_type, usage_kwh")
        .eq("building_id", building.id)
        .eq("reading_type", "daily_total")
        .order("timestamp", { ascending: false })
        .order("created_at", { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      query = beforeToday
        ? query.lt("timestamp", todayStart)
        : query.gte("timestamp", todayStart);

      const { data, error } = await query;

      if (error) {
        throw error;
      }

      if (!data || data.length === 0) {
        break;
      }

      allRows.push(...data);

      if (data.length < pageSize) {
        break;
      }
    }

    return allRows;
  };

  const fetchLongTermAverage = async () => {
    try {
      const [completedDailyData, todayDailyData] = await Promise.all([
        fetchEnergyDailyTotals({ beforeToday: true }),
        fetchEnergyDailyTotals({ beforeToday: false }),
      ]);

      const { data: latestElectricPowerRows, error: powerError } =
        await supabase
          .from("EnergyReadings")
          .select("power_kw")
          .eq("building_id", building.id)
          .eq("fuel_type", "electricity")
          .eq("reading_type", "instant_power")
          .not("power_kw", "is", null)
          .order("timestamp", { ascending: false })
          .limit(1);

      if (powerError) throw powerError;

      const completedRows = completedDailyData || [];
      const todayRows = todayDailyData || [];
      const rows = [...completedRows, ...todayRows];
      const latestElectricPower = latestElectricPowerRows?.[0];

      if (rows.length > 0 || latestElectricPower) {
        const completedDailyTotalsByFuel = completedRows.reduce((totals, row) => {
          const usageKwh = Number(row.usage_kwh);
          if (!Number.isFinite(usageKwh)) {
            return totals;
          }

          const day = new Date(row.timestamp).toISOString().slice(0, 10);
          const key = `${row.fuel_type}:${day}`;
          totals[key] = Math.max(totals[key] || 0, usageKwh);
          return totals;
        }, {});

        const todayDailyTotalsByFuel = todayRows.reduce((totals, row) => {
          const usageKwh = Number(row.usage_kwh);
          if (!Number.isFinite(usageKwh)) {
            return totals;
          }

          totals[row.fuel_type] = Math.max(totals[row.fuel_type] || 0, usageKwh);
          return totals;
        }, {});

        const dailyValues = (fuelType) =>
          Object.entries(completedDailyTotalsByFuel)
            .filter(([key]) => key.startsWith(`${fuelType}:`))
            .map(([, value]) => value);

        const averageDailyUsage = (fuelType) => {
          const completedDays = dailyValues(fuelType);

          if (completedDays.length > 0) {
            return average(completedDays);
          }

          return null;
        };

        const latestDailyTotal = (fuelType) => {
          return todayDailyTotalsByFuel[fuelType] || 0;
        };

        const electricityDailyAverage = averageDailyUsage("electricity");
        const gasDailyAverage = averageDailyUsage("gas");
        const availableDailyAverages = [
          electricityDailyAverage,
          gasDailyAverage,
        ].filter((value) => Number.isFinite(value));
        const totalDailyAverage = availableDailyAverages.length
          ? availableDailyAverages.reduce((sum, value) => sum + value, 0)
          : null;
        const electricityTodayKwh = latestDailyTotal("electricity");
        const gasTodayKwh = latestDailyTotal("gas");
        const hasGasData = rows.some((row) => row.fuel_type === "gas");

        setEnergySummary({
          electricityDailyAverage,
          electricityTodayKwh,
          gasDailyAverage,
          gasTodayKwh,
          totalDailyAverage,
          electricityPowerKw: latestElectricPower
            ? Number(latestElectricPower.power_kw)
            : 0,
          hasGasData,
        });
        setHistoricalPerformance(totalDailyAverage);
        return;
      }

      if (!building.legacyUnscopedData) {
        setEnergySummary({
          electricityDailyAverage: null,
          electricityTodayKwh: 0,
          gasDailyAverage: null,
          gasTodayKwh: 0,
          totalDailyAverage: null,
          electricityPowerKw: 0,
          hasGasData: false,
        });
        setHistoricalPerformance(null);
        return;
      }

      const { data: legacyData, error: legacyError } = await applyBuildingScope(
        supabase
        .from("DailyEnergyTotals")
        .select("total_energy_kwh")
      );

      if (legacyError) throw legacyError;

      const validEntries = legacyData.filter(
        (row) => row.total_energy_kwh !== null
      );

      if (validEntries.length > 0) {
        const total = validEntries.reduce(
          (sum, row) => sum + row.total_energy_kwh,
          0
        );

        const electricityDailyAverage = total / validEntries.length;

        setEnergySummary({
          electricityDailyAverage,
          electricityTodayKwh: 0,
          gasDailyAverage: 0,
          gasTodayKwh: 0,
          totalDailyAverage: electricityDailyAverage,
          electricityPowerKw: 0,
          hasGasData: false,
        });
        setHistoricalPerformance(electricityDailyAverage);
      }
    } catch (err) {
      console.error("Error fetching historical performance:", err.message);
    }
  };

  const fetchExternalTemp = async () => {
    try {
      const { data, error } = await applyBuildingScope(
        supabase
        .from("Readings")
        .select("temperature_outside")
        .not("temperature_outside", "is", null)
        .order("timestamp", { ascending: false })
        .limit(1)
      ).single();

      if (error) throw error;

      setSensorData((prev) => ({
        ...prev,
        externalTemp: Number.isFinite(Number(data?.temperature_outside))
          ? Number(data.temperature_outside)
          : null,
      }));
    } catch (err) {
      console.error("Error fetching external temp:", err.message);
    }
  };

  const fetchIAQData = async () => {
    try {
      const { data, error } = await applyBuildingScope(
        supabase
        .from("Readings")
        .select("temperature_inside, humidity, co2, vocs, pm25")
        .or(
          "temperature_inside.not.is.null,humidity.not.is.null,co2.not.is.null,vocs.not.is.null,pm25.not.is.null"
        )
        .order("timestamp", { ascending: false })
        .limit(1)
      ).single();

      if (error) throw error;
      if (!data) return;

      setSensorData((prev) => ({
        ...prev,
        internalTemp: Number.isFinite(Number(data.temperature_inside))
          ? Number(data.temperature_inside)
          : null,
        humidity: Number.isFinite(Number(data.humidity))
          ? Number(data.humidity)
          : null,
        co2: Number.isFinite(Number(data.co2)) ? Number(data.co2) : null,
        vocs: Number.isFinite(Number(data.vocs)) ? Number(data.vocs) : null,
        pm25: Number.isFinite(Number(data.pm25)) ? Number(data.pm25) : null,
      }));
    } catch (err) {
      console.error("Error fetching IAQ data:", err.message);
    }
  };

  const fetchLongTermBuildingPerformance = async () => {
    try {
      const { data, error } = await applyBuildingScope(
        supabase
        .from("Readings")
        .select(
          "temperature_inside, temperature_outside, humidity, co2, vocs, pm25, timestamp"
        )
      );

      if (error) throw error;
      if (!data || data.length === 0) return;

      const internalTempValues = getValidValues(data, "temperature_inside");
      const humidityValues = getValidValues(data, "humidity");
      const co2Values = getValidValues(data, "co2");
      const vocValues = getValidValues(data, "vocs");
      const pm25Values = getValidValues(data, "pm25");

      const calculatedIAQScore = calculateIAQScore({
        co2Values,
        vocValues,
        pm25Values,
      });

      const calculatedComfortScore = calculateComfortScore({
        internalTempValues,
      });

      const humidityStabilityScore = calculateHumidityScore(humidityValues);
      const calculatedHealthScore = averageScore([
        calculatedIAQScore,
        calculatedComfortScore,
        humidityStabilityScore,
      ]);
      const resilienceScore = calculateSeasonalResilienceScore(data);

      const estimatedArea =
        matterportMetadata.internalArea !== "--"
          ? Number(matterportMetadata.internalArea)
          : 145;
      const annualEnergyUse = Number.isFinite(historicalPerformance)
        ? historicalPerformance * 365
        : null;
      const annualEui =
        Number.isFinite(annualEnergyUse) && estimatedArea
          ? annualEnergyUse / estimatedArea
          : null;

      const calculatedEnergyScore = calculateEnergyScore(
        annualEui,
        building.targetEui,
        building.nationalAverageEui
      );

      const buildingPerformanceIndex = calculateOverallPerformanceScore({
        health: calculatedHealthScore,
        energy: calculatedEnergyScore,
        resilience: resilienceScore,
      });

      setPerformanceBreakdown({
        health: calculatedHealthScore,
        energy: calculatedEnergyScore,
        resilience: resilienceScore,
        iaq: calculatedIAQScore,
        comfort: calculatedComfortScore,
        humidity: humidityStabilityScore,
      });

      setPerformanceValue(buildingPerformanceIndex);
    } catch (err) {
      console.error(
        "Error calculating long-term building performance:",
        err.message
      );
    }
  };

  useEffect(() => {
    fetchLongTermAverage();
    fetchExternalTemp();
    fetchIAQData();
    // Building switch refresh only; polling effect below handles continuing updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [building.id]);

  useEffect(() => {
    fetchLongTermBuildingPerformance();

    const interval = setInterval(() => {
      fetchLongTermAverage();
      fetchIAQData();
      fetchExternalTemp();
      fetchLongTermBuildingPerformance();
    }, 60000);

    return () => clearInterval(interval);
    // The interval should reset only when the selected building or area source changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [building.id, historicalPerformance, matterportMetadata.internalArea]);

  const handleMatterportInputChange = (e) => {
    const nextValue = e.target.value;
    setMatterportInput(nextValue);
    localStorage.setItem(`${building.id}:matterportModelInput`, nextValue);
  };

  const handleManualMatterportDataChange = (field, value) => {
    const numericFields = ["internalArea", "latitude", "longitude"];
    const nextData = {
      ...manualMatterportData,
      [field]: numericFields.includes(field) && value !== "" ? Number(value) : value,
      source: "Matterport model with manual fallback data",
    };

    setManualMatterportData(nextData);
    localStorage.setItem(
      `${building.id}:matterportManualData`,
      JSON.stringify(nextData)
    );
  };

  const handleHistoricalImport = async (event) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const rows = parseCsv(text);
      const area = Number(matterportMetadata.internalArea);
      const summary = analyseHistoricalRows(rows, area);

      setHistoricalImport({
        fileName: file.name,
        summary,
        error: "",
      });
    } catch (error) {
      setHistoricalImport({
        fileName: file.name,
        summary: null,
        error: error.message,
      });
    }
  };

  return (
    <div className="min-h-screen bg-white p-4 flex flex-col space-y-6">
      <div className="bg-gray-100 p-4 rounded shadow">
        <h2 className="text-lg font-bold mb-3">Building Input</h2>

        <div className="grid gap-3 grid-cols-[minmax(0,1fr)_minmax(0,0.88fr)] sm:gap-5 sm:grid-cols-[minmax(0,1fr)_320px] md:grid-cols-[minmax(0,1fr)_360px] items-start">
          <div className="space-y-3 sm:space-y-4 min-w-0">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="bg-white rounded border p-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">
                  Address
                </p>
                <p className="font-semibold text-sm mt-1">
                  {matterportMetadata.address}
                </p>
              </div>

              <div className="bg-white rounded border p-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">
                  Coordinates
                </p>
                <p className="font-semibold text-sm mt-1">
                  {matterportMetadata.latitude}, {matterportMetadata.longitude}
                </p>
              </div>

              <div className="bg-white rounded border p-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">
                  Internal Area
                </p>
                <p className="font-semibold text-sm mt-1">
                  {matterportMetadata.internalArea !== "--"
                    ? `${matterportMetadata.internalArea} m2`
                    : "Pending"}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Temporary estimate from embedded model
                </p>
              </div>
            </div>

          </div>

          <div className="space-y-2 min-w-0 overflow-hidden bg-white rounded border p-2.5 sm:p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold text-xs min-[390px]:text-sm sm:text-base">
                Matterport Data
              </h3>

              {matterportShareUrl ? (
                <a
                  className="text-blue-700 text-[10px] min-[390px]:text-xs sm:text-sm underline text-right leading-tight"
                  href={matterportShareUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in Matterport
                </a>
              ) : null}
            </div>

            <details className="border rounded">
              <summary className="cursor-pointer px-2 py-2 font-semibold text-[10px] min-[390px]:text-xs sm:text-sm">
                SDK / API Options
              </summary>
              <div className="px-2 pb-2 space-y-2 text-[10px] min-[390px]:text-xs sm:text-sm">
                <input
                  type="text"
                  className="border p-2 w-full"
                  value={matterportInput}
                  onChange={handleMatterportInputChange}
                  placeholder="Paste Matterport URL or model ID"
                />

                <div className="border rounded p-2 bg-gray-50 break-all">
                  <strong>Model ID:</strong>{" "}
                  {matterportModelId || "No valid Matterport model ID yet"}
                </div>

                <div className="border rounded p-2 bg-gray-50 break-all">
                  <strong>Model URL:</strong>{" "}
                  {matterportShareUrl || "No valid Matterport URL yet"}
                </div>
              </div>
            </details>

            <details className="border rounded">
              <summary className="cursor-pointer px-2 py-2 font-semibold text-[10px] min-[390px]:text-xs sm:text-sm">
                Address / GIA / Coordinates
              </summary>
              <div className="px-2 pb-2 grid gap-2 text-[10px] min-[390px]:text-xs sm:text-sm">
                <input
                  type="text"
                  className="border p-2 w-full"
                  value={manualMatterportData.address || ""}
                  onChange={(event) =>
                    handleManualMatterportDataChange("address", event.target.value)
                  }
                  placeholder="Address from model or manual fallback"
                />
                <input
                  type="number"
                  className="border p-2 w-full"
                  value={manualMatterportData.internalArea || ""}
                  onChange={(event) =>
                    handleManualMatterportDataChange(
                      "internalArea",
                      event.target.value
                    )
                  }
                  placeholder="Internal area m2"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    className="border p-2 w-full"
                    value={manualMatterportData.latitude || ""}
                    onChange={(event) =>
                      handleManualMatterportDataChange(
                        "latitude",
                        event.target.value
                      )
                    }
                    placeholder="Latitude"
                  />
                  <input
                    type="number"
                    className="border p-2 w-full"
                    value={manualMatterportData.longitude || ""}
                    onChange={(event) =>
                      handleManualMatterportDataChange(
                        "longitude",
                        event.target.value
                      )
                    }
                    placeholder="Longitude"
                  />
                </div>
                <p className="text-gray-600">
                  Auto-fill needs Matterport API access for the model. These
                  fields are used as the dashboard fallback.
                </p>
              </div>
            </details>

            {matterportEmbedUrl ? (
              <iframe
                title="Matterport model"
                src={matterportEmbedUrl}
                className="w-full h-[150px] min-[390px]:h-[180px] sm:h-[280px] border rounded bg-white"
                allow="fullscreen; xr-spatial-tracking; vr"
              />
            ) : (
              <div className="w-full h-[150px] min-[390px]:h-[180px] sm:h-[280px] border rounded bg-white flex items-center justify-center text-gray-500 text-[10px] min-[390px]:text-xs sm:text-sm p-2 sm:p-6 text-center">
                Paste a Matterport model URL or ID to load the 3D scan here.
              </div>
            )}

          </div>
        </div>
      </div>

      <div className="bg-gray-100 p-4 rounded shadow">
        <h2 className="text-lg font-bold mb-3">Performance</h2>

        <div className="grid gap-3 grid-cols-[minmax(0,1fr)_minmax(0,0.88fr)] sm:gap-5 sm:grid-cols-[minmax(0,1fr)_320px] items-start">
          <div className="bg-white rounded border p-2.5 sm:p-4 min-w-0">
            <div className="flex justify-center">
              <AnalogGauge
                value={performanceValue}
                historicalValue={historicalPerformance}
              />
            </div>

            <div className="mt-2 sm:mt-4 space-y-0.5 sm:space-y-1 text-[10px] min-[390px]:text-xs sm:text-sm leading-tight">
              <p>
                <strong>Health:</strong> {formatScore(performanceBreakdown.health)}
              </p>
              <p>
                <strong>Energy:</strong> {formatScore(performanceBreakdown.energy)}
              </p>
            </div>

            <div className="mt-3 sm:mt-4 border-t pt-3 space-y-2 text-[10px] min-[390px]:text-xs sm:text-sm leading-tight">
              <h3 className="font-semibold">Historical Evidence</h3>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={handleHistoricalImport}
                className="block w-full text-[10px] min-[390px]:text-xs"
              />
              <p className="text-gray-600">
                CSV from supplier bills, smart-meter exports or DegreeDays.net.
              </p>
              {historicalImport.error ? (
                <p className="text-red-700">{historicalImport.error}</p>
              ) : null}
            </div>
          </div>

          <div className="bg-white rounded border p-2.5 sm:p-4 min-w-0 overflow-hidden">
            <h3 className="text-xs min-[390px]:text-sm sm:text-base font-semibold mb-1.5 sm:mb-3">
              Live Data
            </h3>

            <div className="space-y-2 min-[390px]:space-y-3 sm:space-y-6 text-[10px] min-[390px]:text-xs sm:text-sm leading-tight">
              <div className="space-y-0.5 break-words">
                <p>
                  <strong>Annualised EUI:</strong>{" "}
                  {Number.isFinite(historicalPerformance) &&
                  matterportMetadata.internalArea !== "--"
                    ? (
                        (historicalPerformance * 365) /
                        Number(matterportMetadata.internalArea)
                      ).toFixed(4)
                    : "No Data"}{" "}
                  kWh/m2/yr
                </p>
              </div>

              <div className="space-y-0.5 break-words">
                <h4 className="font-semibold">Electricity</h4>
                <p>
                  <strong>Daily Average:</strong>{" "}
                  {formatNumber(energySummary.electricityDailyAverage)}{" "}
                  kWh
                </p>
                <p>
                  <strong>Today so far:</strong>{" "}
                  {formatNumber(energySummary.electricityTodayKwh)}{" "}
                  kWh
                </p>
                <p>
                  <strong>Live:</strong>{" "}
                  {formatNumber(energySummary.electricityPowerKw, 3)}{" "}
                  kW
                </p>
              </div>

              {energySummary.hasGasData ? (
                <div className="space-y-0.5 break-words">
                  <h4 className="font-semibold">Gas</h4>
                  <p>
                    <strong>Daily Average:</strong>{" "}
                    {formatNumber(energySummary.gasDailyAverage)}{" "}
                    kWh
                  </p>
                  <p>
                    <strong>Today so far:</strong>{" "}
                    {formatNumber(energySummary.gasTodayKwh)}{" "}
                    kWh
                  </p>
                </div>
              ) : null}

              <div className="space-y-0.5 break-words">
                <p>
                  <strong>Internal Temp:</strong>{" "}
                  {formatMeasurement(sensorData.internalTemp)} deg C
                </p>
                <p>
                  <strong>External Temp:</strong>{" "}
                  {formatMeasurement(sensorData.externalTemp)} deg C
                </p>
              </div>

              <div className="space-y-0.5 break-words">
                <p>
                  <strong>Humidity:</strong>{" "}
                  {formatMeasurement(sensorData.humidity)}%
                </p>
                <p>
                  <strong>CO2:</strong> {formatMeasurement(sensorData.co2)} ppm
                </p>
                <p>
                  <strong>VOCs:</strong> {formatMeasurement(sensorData.vocs)} ppb
                </p>
                <p>
                  <strong>PM2.5:</strong> {formatMeasurement(sensorData.pm25)} ug/m3
                </p>
              </div>

              {historicalImport.summary ? (
                <div className="space-y-0.5 break-words">
                  <h4 className="font-semibold">Imported History</h4>
                  <p>
                    <strong>File:</strong> {historicalImport.fileName}
                  </p>
                  <p>
                    <strong>Rows / Days:</strong>{" "}
                    {historicalImport.summary.rowCount} /{" "}
                    {historicalImport.summary.dayCount}
                  </p>
                  <p>
                    <strong>Imported EUI:</strong>{" "}
                    {formatNumber(historicalImport.summary.annualisedEui)}{" "}
                    kWh/m2/yr
                  </p>
                  <p>
                    <strong>HDD Intensity:</strong>{" "}
                    {formatNumber(historicalImport.summary.kwhPerHdd, 3)}{" "}
                    kWh/HDD
                  </p>
                  <p>
                    <strong>HTC Estimate:</strong>{" "}
                    {formatNumber(historicalImport.summary.htcEstimate, 1)} W/K
                  </p>
                  <p>
                    <strong>NILMTK:</strong> ready for labelled/high-resolution
                    disaggregation inputs
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-gray-100 p-4 rounded shadow">
        <h2 className="text-lg font-bold">Digital Carbon Credits</h2>

        <p>
          <strong>{carbonCredits}</strong> DCC
        </p>

        <button className="bg-red-500 text-white px-4 py-2 w-32 rounded">
          SELL CREDITS
        </button>
      </div>
    </div>
  );
};

const BuildingDashboard = () => {
  const homeIndex = BUILDINGS.findIndex((building) => building.id === "home");
  const [activeIndex, setActiveIndex] = useState(homeIndex >= 0 ? homeIndex : 0);
  const touchStartX = useRef(null);
  const [dragOffset, setDragOffset] = useState(0);

  const activeBuilding = BUILDINGS[activeIndex];

  const goToBuilding = (nextIndex) => {
    const wrappedIndex = (nextIndex + BUILDINGS.length) % BUILDINGS.length;
    setActiveIndex(wrappedIndex);
  };

  const handleTouchStart = (event) => {
    touchStartX.current = event.touches[0].clientX;
    setDragOffset(0);
  };

  const handleTouchMove = (event) => {
    if (touchStartX.current === null) {
      return;
    }

    const touchX = event.touches[0].clientX;
    const deltaX = touchX - touchStartX.current;
    setDragOffset(Math.max(-140, Math.min(140, deltaX)));
  };

  const handleTouchEnd = (event) => {
    if (touchStartX.current === null) {
      return;
    }

    const touchEndX = event.changedTouches[0].clientX;
    const deltaX = touchEndX - touchStartX.current;
    touchStartX.current = null;
    setDragOffset(0);

    if (Math.abs(deltaX) < 60) {
      return;
    }

    goToBuilding(activeIndex + (deltaX < 0 ? 1 : -1));
  };

  return (
    <div
      className="min-h-screen bg-white"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div className="sticky top-0 z-20 bg-white border-b px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex gap-2">
            {BUILDINGS.map((building, index) => (
              <button
                key={building.id}
                type="button"
                className={`px-4 py-2 rounded border text-sm font-semibold ${
                  activeBuilding.id === building.id
                    ? "bg-black text-white border-black"
                    : "bg-white text-black border-gray-300"
                }`}
                onClick={() => goToBuilding(index)}
              >
                {building.name}
              </button>
            ))}
          </div>

          <p className="text-xs text-gray-500 hidden sm:block">
            Swipe left or right to switch buildings
          </p>
        </div>
      </div>

      <div className="overflow-hidden">
        <div
          className="flex"
          style={{
            width: `${BUILDINGS.length * 100}%`,
            transform: `translateX(calc(${-activeIndex * (100 / BUILDINGS.length)}% + ${dragOffset}px))`,
            transition: dragOffset ? "none" : "transform 280ms ease-out",
          }}
        >
          {BUILDINGS.map((building) => (
            <div
              key={building.id}
              style={{ width: `${100 / BUILDINGS.length}%` }}
            >
              <BuildingDashboardPanel building={building} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default BuildingDashboard;














