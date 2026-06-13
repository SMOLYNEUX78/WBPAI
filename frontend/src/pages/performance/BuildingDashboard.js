import React, { useEffect, useMemo, useRef, useState } from "react";
import AnalogGauge from "../../components/AnalogGauge";
import supabase from "../../supabaseClient";

const DEFAULT_MATTERPORT_URL = "https://my.matterport.com/show/?m=zHm8SwWeHiN";
const HDD_BASE_TEMP_C = 15.5;
const FALLBACK_CARBON_PRICE_GBP_PER_TONNE = 65;

const HOME_BUILDING = {
  id: "home",
  name: "Home",
  subtitle: "Home smart meter, CAD and MQTT collector",
  address: "14 Bridgewood Rd, Woodbridge, Suffolk IP12 4HA",
  defaultMatterportUrl: "https://my.matterport.com/show/?m=8A48K5upwWN",
  latitude: 52.0945,
  longitude: 1.30488,
  estimatedInternalArea: 99.2,
  targetEui: 35,
  nationalAverageEui: 150,
  legacyUnscopedData: false,
  regulatedElectricFraction: 0.35,
  showGas: true,
};

const BUILDINGS = [
  {
    ...HOME_BUILDING,
    id: "cc",
    name: "CC",
    subtitle: "Carbon credit token workspace",
    dataSourceId: "home",
  },
  HOME_BUILDING,
  {
    id: "museum",
    name: "Museum",
    subtitle: "CAD monitor, smart meter and IAQ tablet collector",
    address: "Woodbridge Tide Mill Museum, Tide Mill Way IP12 1BY",
    defaultMatterportUrl: DEFAULT_MATTERPORT_URL,
    latitude: 52.0901,
    longitude: -1.321,
    estimatedInternalArea: 145,
    targetEui: 65,
    nationalAverageEui: 200,
    legacyUnscopedData: false,
    heatingSystem: "none",
    regulatedElectricFraction: 0.05,
    showGas: false,
  },
  {
    id: "new",
    name: "New",
    subtitle: "New building setup",
    setupOnly: true,
    defaultMatterportUrl: "",
    latitude: "",
    longitude: "",
    estimatedInternalArea: "",
    targetEui: 65,
    nationalAverageEui: 200,
    legacyUnscopedData: false,
    regulatedElectricFraction: 0.35,
    showGas: true,
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

  return `https://my.matterport.com/show/?m=${modelId}&play=1&brand=0`;
};

const createEmptyMatterportMetadata = (statusText, building = {}) => ({
  address: building.address || statusText,
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

const BuildingDashboardPanel = ({ building }) => {
  const dataSourceBuildingId = building.dataSourceId || building.id;
  const isCarbonCreditTab = building.id === "cc";
  const [deepDivePanel, setDeepDivePanel] = useState(null);
  const [standardDeepDiveOpen, setStandardDeepDiveOpen] = useState(true);
  const deepDiveOpen = Boolean(deepDivePanel);

  useEffect(() => {
    if (!isCarbonCreditTab) {
      setStandardDeepDiveOpen(true);
    }
  }, [building.id, isCarbonCreditTab]);
  const matterportInput = useMemo(() => {
    return (
      localStorage.getItem(`${dataSourceBuildingId}:matterportModelInput`) ||
      building.defaultMatterportUrl
    );
  }, [dataSourceBuildingId, building.defaultMatterportUrl]);
  const manualMatterportData = useMemo(() => {
    const savedData = localStorage.getItem(`${dataSourceBuildingId}:matterportManualData`);

    if (savedData) {
      try {
        return JSON.parse(savedData);
      } catch (error) {
        return {};
      }
    }

    return {};
  }, [dataSourceBuildingId]);
  const [matterportMetadata, setMatterportMetadata] = useState(() =>
    createEmptyMatterportMetadata(
      "Connect Matterport SDK / API to load geodata",
      building
    )
  );

  const defaultSensorData = {
    internalTemp: null,
    externalTemp: null,
    humidity: null,
    co2: null,
    vocs: null,
    pm25: null,
    pm10: null,
    hcho: null,
    no2: null,
  };
  const readCachedDashboardState = (key, fallback) => {
    try {
      const cachedValue = localStorage.getItem(key);
      return cachedValue ? JSON.parse(cachedValue) : fallback;
    } catch (error) {
      return fallback;
    }
  };
  const [sensorData, setSensorData] = useState(() =>
    readCachedDashboardState(`${dataSourceBuildingId}:latestIaq`, defaultSensorData)
  );
  const [roomIaqData, setRoomIaqData] = useState(() =>
    readCachedDashboardState(`${dataSourceBuildingId}:roomIaq`, [])
  );
  const supportsExtendedIaqColumns = useRef(true);

  const [performanceValue, setPerformanceValue] = useState(null);
  const [historicalPerformance, setHistoricalPerformance] = useState(null);
  const [carbonCredits, setCarbonCredits] = useState(0);
  const [carbonSavingsSummary, setCarbonSavingsSummary] = useState({
    latestDate: null,
    latestSavedKgCo2e: null,
    totalSavedKgCo2e: null,
  });
  const [carbonMarketPrice, setCarbonMarketPrice] = useState({
    gbpPerTonne: FALLBACK_CARBON_PRICE_GBP_PER_TONNE,
    source: "Estimated UK/EU carbon allowance price",
    updatedAt: null,
    live: false,
  });
  const [energySummary, setEnergySummary] = useState({
    electricityDailyAverage: null,
    electricityTodayKwh: 0,
    gasDailyAverage: null,
    gasTodayKwh: 0,
    totalDailyAverage: null,
    electricityPowerKw: 0,
    hasGasData: false,
    gasBaseloadDaily: null,
    gasHeatingDaily: null,
    gasAnomalyDaily: null,
    gasDhwDaily: null,
    gasUnregulatedDaily: null,
    gasDhwWindows: [],
    gasDecompositionConfidence: "Pending gas data",
  });

  const [performanceBreakdown, setPerformanceBreakdown] = useState({
    health: null,
    energy: null,
    resilience: null,
    iaq: null,
    comfort: null,
    humidity: null,
  });
  const [heatLossSummary, setHeatLossSummary] = useState({
    kwhPerHdd: null,
    weatherNormalisedEui: null,
    htcEstimate: null,
    hddDays: 0,
    htcSamples: 0,
    hddSource: "current",
    averageInternalTemp: null,
    comfortHddDays: 0,
    flatlineIndoorTemp: false,
    filteredInsideReadings: 0,
  });
  const [weeklyTrendData, setWeeklyTrendData] = useState([]);
  const [selectedTrendMetricKeys, setSelectedTrendMetricKeys] = useState([]);
  const [hoveredTrendSlot, setHoveredTrendSlot] = useState(null);

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
          address: building.address || manualMatterportData.address,
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
      address: building.address || manualMatterportData.address,
    });
  }, [building, matterportModelId, manualMatterportData]);

  const applyBuildingScope = (query) => {
    if (building.legacyUnscopedData) {
      return query;
    }

    return query.eq("building_id", dataSourceBuildingId);
  };

  const buildIaqSelect = ({ includeTimestamp = false, includeReadingType = false, includeExtended = true } = {}) => {
    const columns = [
      "temperature_inside",
      "temperature_outside",
      "humidity",
      "co2",
      "vocs",
      "pm25",
    ];

    if (includeExtended && supportsExtendedIaqColumns.current) {
      columns.push("pm10", "hcho", "no2");
    }

    if (includeTimestamp) {
      columns.push("timestamp");
    }

    if (includeReadingType) {
      columns.push("reading_type");
    }

    return columns.join(", ");
  };

  const fetchScopedIaqRows = async ({
    includeTimestamp = false,
    includeReadingType = false,
    limit,
    orderDescending = false,
    readingTypes,
    rangeFrom,
    rangeTo,
  } = {}) => {
    const runQuery = async (includeExtended) => {
      const valueColumns = [
        "temperature_inside",
        "humidity",
        "co2",
        "vocs",
        "pm25",
        ...(includeExtended && supportsExtendedIaqColumns.current
          ? ["pm10", "hcho", "no2"]
          : []),
      ];
      let query = applyBuildingScope(
        supabase
          .from("Readings")
          .select(
            buildIaqSelect({
              includeTimestamp,
              includeReadingType,
              includeExtended,
            })
          )
          .or(valueColumns.map((column) => `${column}.not.is.null`).join(","))
      );

      if (readingTypes?.length) {
        query = query.in("reading_type", readingTypes);
      }

      if (orderDescending) {
        query = query.order("timestamp", { ascending: false });
      }

      if (limit) {
        query = query.limit(limit);
      }

      if (Number.isInteger(rangeFrom) && Number.isInteger(rangeTo)) {
        query = query.range(rangeFrom, rangeTo);
      }

      return query;
    };

    let result = await runQuery(true);

    if (
      result.error &&
      supportsExtendedIaqColumns.current &&
      /pm10|hcho|no2|schema cache/i.test(result.error.message || "")
    ) {
      supportsExtendedIaqColumns.current = false;
      result = await runQuery(false);
    }

    return result;
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

  const formatCurrency = (value, currency = "GBP") =>
    Number.isFinite(value)
      ? new Intl.NumberFormat("en-GB", {
          style: "currency",
          currency,
          maximumFractionDigits: value >= 10 ? 2 : 4,
        }).format(value)
      : "Pending";

  const formatScore = (value) =>
    Number.isFinite(value) ? `${value.toFixed(0)}/100` : "Pending";

  const formatMeasurement = (value, digits = 1) =>
    Number.isFinite(value) ? value.toFixed(digits) : "No Data";

  const normaliseRoomLabel = (readingType) => {
    const roomKey = String(readingType || "").replace(/^dyson:/, "");

    if (roomKey === "living_room" || roomKey === "downstairs") {
      return "Downstairs";
    }

    if (roomKey === "upstairs") {
      return "Upstairs";
    }

    return roomKey
      .split("_")
      .filter(Boolean)
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
      .join(" ");
  };

  const numericOrNull = (value) => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
  };

  const averageNullableValues = (values) => {
    const finiteValues = values.filter((value) => Number.isFinite(value));

    if (finiteValues.length === 0) {
      return null;
    }

    return finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length;
  };

  const percentile = (values, percentileValue) => {
    const sortedValues = values
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b);

    if (sortedValues.length === 0) {
      return null;
    }

    const index = Math.min(
      sortedValues.length - 1,
      Math.max(0, Math.floor((percentileValue / 100) * sortedValues.length))
    );
    return sortedValues[index];
  };

  const tailAwareScore = (values, scoreValue, tailPercentile, tailWeight = 0.45) => {
    if (!values.length) {
      return null;
    }

    const typicalScore = average(values.map(scoreValue));
    const tailValue = percentile(values, tailPercentile);
    const tailScore = Number.isFinite(tailValue) ? scoreValue(tailValue) : null;

    if (!Number.isFinite(tailScore)) {
      return typicalScore;
    }

    return typicalScore * (1 - tailWeight) + tailScore * tailWeight;
  };

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

  const calculateIAQScore = ({
    co2Values,
    pm25Values,
    pm10Values = [],
    vocValues,
    hchoValues = [],
    no2Values = [],
  }) => {
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

    const pm10Score = pm10Values.length
      ? average(
          pm10Values.map((value) =>
            linearScore(value, [
              { min: 0, max: 15, startScore: 100, endScore: 100 },
              { min: 15, max: 45, startScore: 100, endScore: 55 },
              { min: 45, max: 100, startScore: 55, endScore: 0 },
            ])
          )
        )
      : null;

    const hchoScore = hchoValues.length
      ? average(
          hchoValues.map((value) =>
            linearScore(value, [
              { min: 0, max: 9, startScore: 100, endScore: 100 },
              { min: 9, max: 80, startScore: 100, endScore: 50 },
              { min: 80, max: 200, startScore: 50, endScore: 0 },
            ])
          )
      )
      : null;

    const no2Score = no2Values.length
      ? average(
          no2Values.map((value) =>
            linearScore(value, [
              { min: 0, max: 20, startScore: 100, endScore: 100 },
              { min: 20, max: 100, startScore: 100, endScore: 45 },
              { min: 100, max: 200, startScore: 45, endScore: 0 },
            ])
          )
        )
      : null;

    return averageScore([
      co2Score,
      pm25Score,
      pm10Score,
      vocScore,
      hchoScore,
      no2Score,
    ]);
  };

  const calculateComfortScore = ({ internalTempValues }) => {
    if (!internalTempValues.length) {
      return null;
    }

    const scoreTemperature = (value) => {
      if (value >= 20 && value <= 24) {
        return 100;
      }

      if (value < 20) {
        return linearScore(value, [
          { min: -10, max: 12, startScore: 0, endScore: 0 },
          { min: 12, max: 16, startScore: 0, endScore: 35 },
          { min: 16, max: 18, startScore: 35, endScore: 70 },
          { min: 18, max: 20, startScore: 70, endScore: 100 },
        ]);
      }

      return linearScore(value, [
        { min: 24, max: 25, startScore: 100, endScore: 85 },
        { min: 25, max: 28, startScore: 85, endScore: 40 },
        { min: 28, max: 35, startScore: 40, endScore: 0 },
      ]);
    };

    return tailAwareScore(internalTempValues, scoreTemperature, 10, 0.35);
  };

  const calculateHumidityScore = (humidityValues) => {
    if (!humidityValues.length) {
      return null;
    }

    const scoreHumidity = (value) => {
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
        { min: 60, max: 65, startScore: 100, endScore: 65 },
        { min: 65, max: 70, startScore: 65, endScore: 20 },
        { min: 70, max: 90, startScore: 20, endScore: 0 },
      ]);
    };

    return tailAwareScore(humidityValues, scoreHumidity, 90, 0.35);
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

  const calculateIeqPenaltyFactor = ({ iaq, comfort, humidity, resilience }) => {
    const ieqComponentScores = [iaq, comfort, humidity, resilience].filter((score) =>
      Number.isFinite(score)
    );

    if (ieqComponentScores.length === 0) {
      return null;
    }

    const weakestScore = Math.min(...ieqComponentScores);
    const blendedScore = average(ieqComponentScores) * 0.7 + weakestScore * 0.3;
    const guardedScore =
      weakestScore < 35 ? Math.min(blendedScore, weakestScore + 25) : blendedScore;

    return clampScore(guardedScore) / 100;
  };

  const calculateGlobalIeqEnergyIndex = ({ energy, ieqPenaltyFactor }) => {
    if (!Number.isFinite(energy) || !Number.isFinite(ieqPenaltyFactor)) {
      return null;
    }

    return Math.round(clampScore(energy * ieqPenaltyFactor));
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
        .select("timestamp, fuel_type, usage_kwh, raw_payload, source")
        .eq("building_id", dataSourceBuildingId)
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

  const fetchGasIntervalRows = async () => {
    const { data, error } = await supabase
      .from("EnergyReadings")
      .select("timestamp, usage_kwh")
      .eq("building_id", dataSourceBuildingId)
      .eq("fuel_type", "gas")
      .eq("reading_type", "interval_30m")
      .not("usage_kwh", "is", null)
      .order("timestamp", { ascending: false })
      .limit(3000);

    if (error) {
      throw error;
    }

    return data || [];
  };

  const fetchLongTermAverage = async () => {
    try {
      const [completedDailyData, todayDailyData, gasIntervalData] = await Promise.all([
        fetchEnergyDailyTotals({ beforeToday: true }),
        fetchEnergyDailyTotals({ beforeToday: false }),
        fetchGasIntervalRows(),
      ]);

      const { data: latestElectricPowerRows, error: powerError } =
        await supabase
          .from("EnergyReadings")
          .select("power_kw")
          .eq("building_id", dataSourceBuildingId)
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
        const completedDailyTotalsByDay = completedRows.reduce((totals, row) => {
          const usageKwh = Number(row.usage_kwh);
          if (!Number.isFinite(usageKwh)) {
            return totals;
          }

          const day = new Date(row.timestamp).toISOString().slice(0, 10);
          const fuelType = row.fuel_type || "unknown";
          totals[day] = totals[day] || { fuels: {}, hdd: null };
          totals[day].fuels[fuelType] = Math.max(
            totals[day].fuels[fuelType] || 0,
            usageKwh
          );

          const hdd = Number(row.raw_payload?.hdd);
          if (Number.isFinite(hdd)) {
            totals[day].hdd = hdd;
          }

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
        const gasDayRows = Object.values(completedDailyTotalsByDay)
          .map((day) => ({
            gas: Number(day.fuels.gas),
            hdd: Number(day.hdd),
          }))
          .filter((day) => Number.isFinite(day.gas));
        const gasValues = gasDayRows.map((day) => day.gas);
        const gasIntervalRows = (gasIntervalData || [])
          .map((row) => ({
            timestamp: row.timestamp,
            usage: Number(row.usage_kwh),
          }))
          .filter((row) => Number.isFinite(row.usage) && row.usage > 0);
        const gasIntervalsByDay = gasIntervalRows.reduce((days, row) => {
          const date = new Date(row.timestamp);
          const dayKey = date.toISOString().slice(0, 10);
          const slot = date.getUTCHours() * 2 + Math.floor(date.getUTCMinutes() / 30);
          days[dayKey] = days[dayKey] || [];
          days[dayKey].push({ ...row, slot });
          return days;
        }, {});
        const gasIntervalDayCount = Object.keys(gasIntervalsByDay).length;
        const morningEveningSlotStats = gasIntervalRows.reduce((slots, row) => {
          const date = new Date(row.timestamp);
          const hour = date.getUTCHours();
          const minute = date.getUTCMinutes();
          const slot = hour * 2 + Math.floor(minute / 30);
          const inLikelyDhwWindow =
            (hour >= 5 && hour <= 9) || (hour >= 16 && hour <= 21);

          if (!inLikelyDhwWindow) {
            return slots;
          }

          slots[slot] = slots[slot] || { total: 0, days: new Set(), hour, minute };
          slots[slot].total += row.usage;
          slots[slot].days.add(date.toISOString().slice(0, 10));
          return slots;
        }, {});
        const recurringDhwSlots = Object.entries(morningEveningSlotStats)
          .filter(([, slot]) => {
            if (gasIntervalDayCount < 3) {
              return false;
            }
            return slot.days.size / gasIntervalDayCount >= 0.25;
          })
          .map(([slotKey, slot]) => ({
            slot: Number(slotKey),
            averageDailyKwh: slot.total / Math.max(1, gasIntervalDayCount),
            label: `${String(slot.hour).padStart(2, "0")}:${String(
              slot.minute
            ).padStart(2, "0")}`,
          }));
        const gasDhwDailyFromSchedule = recurringDhwSlots.length
          ? recurringDhwSlots.reduce((sum, slot) => sum + slot.averageDailyKwh, 0)
          : null;
        const sortedGasValues = [...gasValues].sort((a, b) => a - b);
        const baseloadSampleSize = sortedGasValues.length
          ? Math.max(1, Math.ceil(sortedGasValues.length * 0.3))
          : 0;
        const gasBaseloadDaily = baseloadSampleSize
          ? average(sortedGasValues.slice(0, baseloadSampleSize))
          : null;
        const gasDaysWithHdd = gasDayRows.filter(
          (day) => Number.isFinite(day.hdd) && day.hdd > 0.5
        );
        const hasWeatherGasSample = gasDaysWithHdd.length >= 7;
        const gasHeatingDaily =
          Number.isFinite(gasBaseloadDaily) && hasWeatherGasSample
            ? average(
                gasDayRows.map((day) =>
                  Number.isFinite(day.hdd) && day.hdd > 0.5
                    ? Math.max(0, day.gas - gasBaseloadDaily)
                    : 0
                )
              )
            : 0;
        const gasAnomalyDaily = Number.isFinite(gasBaseloadDaily)
          ? average(
              gasDayRows.map((day) => {
                const warmWeather =
                  !Number.isFinite(day.hdd) || day.hdd <= 0.5;
                const spikeThreshold = Math.max(
                  gasBaseloadDaily * 2.5,
                  gasBaseloadDaily + 3
                );
                return warmWeather && day.gas > spikeThreshold
                  ? day.gas - gasBaseloadDaily
                  : 0;
              })
            )
          : null;
        const gasDhwDaily = Number.isFinite(gasDhwDailyFromSchedule)
          ? Math.min(
              gasDhwDailyFromSchedule,
              Number.isFinite(gasBaseloadDaily)
                ? gasBaseloadDaily + (gasAnomalyDaily || 0)
                : gasDhwDailyFromSchedule
            )
          : gasBaseloadDaily;
        const gasUnregulatedDaily =
          Number.isFinite(gasDhwDaily) && Number.isFinite(gasBaseloadDaily)
            ? Math.max(0, gasBaseloadDaily - gasDhwDaily)
            : null;
        const gasDecompositionConfidence = hasGasData
          ? recurringDhwSlots.length
            ? "DHW schedule + HDD decomposition"
            : hasWeatherGasSample
            ? "Baseload + HDD decomposition"
            : "Summer baseload estimate / needs winter HDD data"
          : "No gas data";

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
          gasBaseloadDaily,
          gasHeatingDaily,
          gasAnomalyDaily,
          gasDhwDaily,
          gasUnregulatedDaily,
          gasDhwWindows: recurringDhwSlots.map((slot) => slot.label),
          gasDecompositionConfidence,
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
          gasBaseloadDaily: null,
          gasHeatingDaily: null,
          gasAnomalyDaily: null,
          gasDhwDaily: null,
          gasUnregulatedDaily: null,
          gasDhwWindows: [],
          gasDecompositionConfidence: "Pending gas data",
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
          gasBaseloadDaily: null,
          gasHeatingDaily: null,
          gasAnomalyDaily: null,
          gasDhwDaily: null,
          gasUnregulatedDaily: null,
          gasDhwWindows: [],
          gasDecompositionConfidence: "No gas data",
        });
        setHistoricalPerformance(electricityDailyAverage);
      }
    } catch (err) {
      console.error("Error fetching historical performance:", err.message);
    }
  };

  const fetchHeatLossSummary = async () => {
    try {
      const area = Number(matterportMetadata.internalArea);
      const completedRows = await fetchEnergyDailyTotals({ beforeToday: true });
      const { data: temperatureRows, error: temperatureError } =
        await applyBuildingScope(
          supabase
            .from("Readings")
            .select("timestamp, temperature_inside, temperature_outside")
            .order("timestamp", { ascending: true })
            .limit(5000)
        );

      if (temperatureError) throw temperatureError;

      const dailyEnergy = completedRows.reduce((totals, row) => {
        const usageKwh = Number(row.usage_kwh);

        if (!Number.isFinite(usageKwh)) {
          return totals;
        }

        const day = new Date(row.timestamp).toISOString().slice(0, 10);
        const fuelType = row.fuel_type || "unknown";
        totals[day] = totals[day] || { fuels: {}, hdd: null, usesLegacy: false };
        totals[day].fuels[fuelType] = Math.max(
          totals[day].fuels[fuelType] || 0,
          usageKwh
        );

        const rowHdd = Number(row.raw_payload?.hdd);
        if (Number.isFinite(rowHdd)) {
          totals[day].hdd = rowHdd;
        }

        if (row.source?.startsWith("legacy-readings-")) {
          totals[day].usesLegacy = true;
        }

        return totals;
      }, {});

      const dailyTemperatures = (temperatureRows || []).reduce((totals, row) => {
        const day = new Date(row.timestamp).toISOString().slice(0, 10);
        totals[day] = totals[day] || { inside: [], outside: [] };

        const inside = Number(row.temperature_inside);
        const outside = Number(row.temperature_outside);

        const isKnownStuckMuseumInsideReading =
          dataSourceBuildingId === "museum" && Math.abs(inside - 17.6) < 0.05;

        if (
          Number.isFinite(inside) &&
          inside !== 0 &&
          !isKnownStuckMuseumInsideReading
        ) {
          totals[day].inside.push(inside);
        }

        if (Number.isFinite(outside) && outside !== 0) {
          totals[day].outside.push(outside);
        }

        return totals;
      }, {});

      let hddTotal = 0;
      let hddEnergyTotal = 0;
      let htcTotal = 0;
      let hddDays = 0;
      let htcSamples = 0;
      let comfortHddDays = 0;
      const hlaInsideAverages = [];
      let filteredInsideReadings = 0;

      let usesLegacyMuseumEnergy = false;

      Object.entries(dailyEnergy).forEach(([day, dayEnergy]) => {
        const totalKwh = Object.values(dayEnergy.fuels).reduce(
          (sum, value) => sum + value,
          0
        );
        const temperatures = dailyTemperatures[day];
        const outsideAverage = temperatures?.outside.length
          ? average(temperatures.outside)
          : null;
        const insideAverage = temperatures?.inside.length
          ? average(temperatures.inside)
          : null;

        const hdd = Number.isFinite(dayEnergy.hdd)
          ? dayEnergy.hdd
          : Number.isFinite(outsideAverage)
          ? Math.max(0, HDD_BASE_TEMP_C - outsideAverage)
          : null;

        if (Number.isFinite(hdd) && hdd > 0 && totalKwh > 0) {
          hddTotal += hdd;
          hddEnergyTotal += totalKwh;
          hddDays += 1;

          if (Number.isFinite(insideAverage)) {
            hlaInsideAverages.push(insideAverage);
            if (insideAverage >= 18) {
              comfortHddDays += 1;
            }
          }
        }

        if (dayEnergy.usesLegacy) {
          usesLegacyMuseumEnergy = true;
        }

        if (
          Number.isFinite(insideAverage) &&
          Number.isFinite(outsideAverage) &&
          insideAverage > outsideAverage &&
          totalKwh > 0
        ) {
          const averagePowerWatts = (totalKwh * 1000) / 24;
          htcTotal += averagePowerWatts / (insideAverage - outsideAverage);
          htcSamples += 1;
        }
      });
      if (dataSourceBuildingId === "museum") {
        filteredInsideReadings = (temperatureRows || []).filter((row) => {
          const inside = Number(row.temperature_inside);
          return Number.isFinite(inside) && Math.abs(inside - 17.6) < 0.05;
        }).length;
      }

      const currentKwhPerHdd = hddTotal > 0 ? hddEnergyTotal / hddTotal : null;
      const currentAnnualHddEstimate =
        hddDays > 0 ? (hddTotal / hddDays) * 365 : null;
      const currentWeatherNormalisedEui =
        Number.isFinite(currentKwhPerHdd) &&
        Number.isFinite(currentAnnualHddEstimate) &&
        Number.isFinite(area) &&
        area > 0
          ? (currentKwhPerHdd * currentAnnualHddEstimate) / area
          : null;
      const hddSummary = {
        kwhPerHdd: currentKwhPerHdd,
        weatherNormalisedEui: currentWeatherNormalisedEui,
        hddDays,
        hddSource: usesLegacyMuseumEnergy ? "legacy" : "current",
      };
      const flatlineIndoorTemp = false;

      setHeatLossSummary({
        kwhPerHdd: hddSummary.kwhPerHdd,
        weatherNormalisedEui: hddSummary.weatherNormalisedEui,
        htcEstimate: htcSamples > 0 ? htcTotal / htcSamples : null,
        hddDays: hddSummary.hddDays || 0,
        htcSamples,
        hddSource: hddSummary.hddSource || "current",
        averageInternalTemp: hlaInsideAverages.length
          ? average(hlaInsideAverages)
          : null,
        comfortHddDays,
        flatlineIndoorTemp,
        filteredInsideReadings,
      });
    } catch (err) {
      console.error("Error fetching heat loss summary:", err.message);
      setHeatLossSummary({
        kwhPerHdd: null,
        weatherNormalisedEui: null,
        htcEstimate: null,
        hddDays: 0,
        htcSamples: 0,
        hddSource: "current",
        averageInternalTemp: null,
        comfortHddDays: 0,
        flatlineIndoorTemp: false,
        filteredInsideReadings: 0,
      });
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

      setSensorData((prev) => {
        const nextSensorData = {
          ...prev,
          externalTemp: Number.isFinite(Number(data?.temperature_outside))
            ? Number(data.temperature_outside)
            : null,
        };
        localStorage.setItem(
          `${dataSourceBuildingId}:latestIaq`,
          JSON.stringify(nextSensorData)
        );
        return nextSensorData;
      });
    } catch (err) {
      console.error("Error fetching external temp:", err.message);
    }
  };

  const fetchIAQData = async () => {
    try {
      const dysonReadingTypes =
        dataSourceBuildingId === "home"
          ? [
              "dyson:whole_home",
              "dyson:upstairs",
              "dyson:living_room",
              "dyson:downstairs",
            ]
          : null;
      const { data, error } = await fetchScopedIaqRows({
        includeReadingType: true,
        limit: dataSourceBuildingId === "home" ? 60 : 30,
        orderDescending: true,
        readingTypes: dysonReadingTypes,
      });

      if (error) throw error;
      if (!data || data.length === 0) return;

      const dysonRows = data.filter((row) =>
        String(row.reading_type || "").startsWith("dyson:")
      );
      const wholeHomeRow =
        dysonRows.find((row) => row.reading_type === "dyson:whole_home") ||
        null;
      const roomRows = dysonRows
        .filter((row) => row.reading_type !== "dyson:whole_home")
        .reduce((rooms, row) => {
          if (!row.reading_type || rooms.some((room) => room.key === row.reading_type)) {
            return rooms;
          }

          rooms.push({
            key: row.reading_type,
            label: normaliseRoomLabel(row.reading_type),
            internalTemp: numericOrNull(row.temperature_inside),
            humidity: numericOrNull(row.humidity),
            co2: numericOrNull(row.co2),
            vocs: numericOrNull(row.vocs),
            pm25: numericOrNull(row.pm25),
            pm10: numericOrNull(row.pm10),
            hcho: numericOrNull(row.hcho),
            no2: numericOrNull(row.no2),
          });
          return rooms;
        }, [])
        .sort((a, b) => {
          const order = { Upstairs: 0, Downstairs: 1 };
          return (order[a.label] ?? 10) - (order[b.label] ?? 10);
        });

      const fallbackIaqRow = data[0];
      const sourceRow = wholeHomeRow || fallbackIaqRow;
      const combinedFromRooms =
        !wholeHomeRow && roomRows.length > 0
          ? {
              temperature_inside: averageNullableValues(
                roomRows.map((row) => row.internalTemp)
              ),
              humidity: averageNullableValues(roomRows.map((row) => row.humidity)),
              co2: averageNullableValues(roomRows.map((row) => row.co2)),
              vocs: averageNullableValues(roomRows.map((row) => row.vocs)),
              pm25: averageNullableValues(roomRows.map((row) => row.pm25)),
              pm10: averageNullableValues(roomRows.map((row) => row.pm10)),
              hcho: averageNullableValues(roomRows.map((row) => row.hcho)),
              no2: averageNullableValues(roomRows.map((row) => row.no2)),
            }
          : null;

      setRoomIaqData(roomRows);
      localStorage.setItem(`${dataSourceBuildingId}:roomIaq`, JSON.stringify(roomRows));

      setSensorData((prev) => {
        const nextSensorData = {
          ...prev,
          internalTemp: numericOrNull(
            combinedFromRooms?.temperature_inside ?? sourceRow.temperature_inside
          ),
          humidity: numericOrNull(combinedFromRooms?.humidity ?? sourceRow.humidity),
          co2: numericOrNull(combinedFromRooms?.co2 ?? sourceRow.co2),
          vocs: numericOrNull(combinedFromRooms?.vocs ?? sourceRow.vocs),
          pm25: numericOrNull(combinedFromRooms?.pm25 ?? sourceRow.pm25),
          pm10: numericOrNull(combinedFromRooms?.pm10 ?? sourceRow.pm10),
          hcho: numericOrNull(combinedFromRooms?.hcho ?? sourceRow.hcho),
          no2: numericOrNull(combinedFromRooms?.no2 ?? sourceRow.no2),
        };
        localStorage.setItem(
          `${dataSourceBuildingId}:latestIaq`,
          JSON.stringify(nextSensorData)
        );
        return nextSensorData;
      });
    } catch (err) {
      console.error("Error fetching IAQ data:", err.message);
    }
  };

  const fetchLongTermBuildingPerformance = async () => {
    try {
      const { data, error } = await fetchScopedIaqRows({
        includeTimestamp: true,
        includeReadingType: true,
      });

      if (error) throw error;
      if (!data || data.length === 0) return;

      const ieqRows = data.map((row) => {
        if (
          dataSourceBuildingId === "home" &&
          row.reading_type === "dyson:living_room"
        ) {
          return {
            ...row,
            co2: null,
            vocs: null,
            pm25: null,
            pm10: null,
            hcho: null,
            no2: null,
          };
        }

        return row;
      });

      const internalTempValues = getValidValues(ieqRows, "temperature_inside");
      const humidityValues = getValidValues(ieqRows, "humidity");
      const co2Values = getValidValues(ieqRows, "co2");
      const vocValues = getValidValues(ieqRows, "vocs");
      const pm25Values = getValidValues(ieqRows, "pm25");
      const pm10Values = getValidValues(ieqRows, "pm10");
      const hchoValues = getValidValues(ieqRows, "hcho");
      const no2Values = getValidValues(ieqRows, "no2");

      const calculatedIAQScore = calculateIAQScore({
        co2Values,
        vocValues,
        pm25Values,
        pm10Values,
        hchoValues,
        no2Values,
      });

      const calculatedComfortScore = calculateComfortScore({
        internalTempValues,
      });

      const humidityStabilityScore = calculateHumidityScore(humidityValues);
      const resilienceScore = calculateSeasonalResilienceScore(ieqRows);
      const ieqPenaltyFactor = calculateIeqPenaltyFactor({
        iaq: calculatedIAQScore,
        comfort: calculatedComfortScore,
        humidity: humidityStabilityScore,
        resilience: resilienceScore,
      });
      const calculatedHealthScore = Number.isFinite(ieqPenaltyFactor)
        ? ieqPenaltyFactor * 100
        : null;

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

      const annualEuiScore = calculateEnergyScore(
        annualEui,
        building.targetEui,
        building.nationalAverageEui
      );
      const weatherNormalisedEuiScore = calculateEnergyScore(
        heatLossSummary.weatherNormalisedEui,
        building.targetEui,
        building.nationalAverageEui
      );
      const calculatedEnergyScore = averageScore([
        annualEuiScore,
        weatherNormalisedEuiScore,
      ]);

      const buildingPerformanceIndex = calculateGlobalIeqEnergyIndex({
        energy: calculatedEnergyScore,
        ieqPenaltyFactor,
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

  const fetchWeeklyPerformanceTrend = async () => {
    try {
      const pageSize = 1000;
      const maxTrendPages = 100;

      const fetchEnergyIntervalRows = async () => {
        const rows = [];

        for (let page = 0; page < maxTrendPages; page += 1) {
          const from = page * pageSize;
          const to = from + pageSize - 1;
          const { data, error } = await supabase
            .from("EnergyReadings")
            .select("timestamp, created_at, fuel_type, reading_type, usage_kwh")
            .eq("building_id", dataSourceBuildingId)
            .in("reading_type", ["interval_30m", "daily_total"])
            .not("usage_kwh", "is", null)
            .order("timestamp", { ascending: false })
            .order("created_at", { ascending: false })
            .range(from, to);

          if (error) throw error;

          rows.push(...(data || []));

          if (!data || data.length < pageSize) {
            break;
          }
        }

        return rows;
      };

      const fetchIaqTrendRows = async () => {
        const rows = [];

        for (let page = 0; page < maxTrendPages; page += 1) {
          const from = page * pageSize;
          const to = from + pageSize - 1;
          const result = await fetchScopedIaqRows({
            includeTimestamp: true,
            includeReadingType: true,
            orderDescending: true,
            rangeFrom: from,
            rangeTo: to,
          });

          if (result.error) throw result.error;

          rows.push(...(result.data || []));

          if (!result.data || result.data.length < pageSize) {
            break;
          }
        }

        return rows;
      };

      const [energyIntervalRows, iaqTrendRows] = await Promise.all([
        fetchEnergyIntervalRows(),
        fetchIaqTrendRows(),
      ]);

      const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      const weeklyBuckets = Array.from({ length: 168 }, (_, slot) => {
        const dayIndex = Math.floor(slot / 24);
        const hour = slot % 24;
        return {
          slot,
          dayIndex,
          hour,
          label: `${weekdayLabels[dayIndex]} ${String(hour).padStart(2, "0")}:00`,
          dayLabel: weekdayLabels[dayIndex],
          hourLabel: `${String(hour).padStart(2, "0")}:00`,
          electricity: [],
          electricityRegulated: [],
          electricityUnregulated: [],
          gas: [],
          gasRegulated: [],
          gasUnregulated: [],
          internalTemp: [],
          externalTemp: [],
          humidity: [],
          pm25: [],
          vocs: [],
        };
      });

      const getWeeklySlot = (timestamp) => {
        const date = new Date(timestamp);

        if (Number.isNaN(date.getTime())) {
          return null;
        }

        const dayIndex = (date.getUTCDay() + 6) % 7;
        return dayIndex * 24 + date.getUTCHours();
      };
      const getWeeklyDayStartSlot = (timestamp) => {
        const date = new Date(timestamp);

        if (Number.isNaN(date.getTime())) {
          return null;
        }

        const dayIndex = (date.getUTCDay() + 6) % 7;
        return dayIndex * 24;
      };

      const electricRegulatedFractionForTrend =
        building.regulatedElectricFraction ?? (energySummary.hasGasData ? 0.15 : 0.35);
      const gasDailyAverageForTrend = Number(energySummary.gasDailyAverage);
      const gasRegulatedDailyForTrend =
        (Number.isFinite(energySummary.gasHeatingDaily)
          ? energySummary.gasHeatingDaily
          : 0) +
        (Number.isFinite(energySummary.gasDhwDaily) ? energySummary.gasDhwDaily : 0);
      const gasRegulatedFractionForTrend =
        Number.isFinite(gasDailyAverageForTrend) && gasDailyAverageForTrend > 0
          ? clampScore((gasRegulatedDailyForTrend / gasDailyAverageForTrend) * 100) / 100
          : 1;

      const intervalEnergyDays = new Set(
        (energyIntervalRows || [])
          .filter((row) => row.reading_type === "interval_30m")
          .map((row) => {
            const date = new Date(row.timestamp);
            if (Number.isNaN(date.getTime())) {
              return null;
            }

            return `${row.fuel_type}:${date.toISOString().slice(0, 10)}`;
          })
          .filter(Boolean)
      );
      const pushEnergyUsage = (slot, fuelType, usageKwh) => {
        if (slot === null || !weeklyBuckets[slot] || !Number.isFinite(usageKwh)) {
          return;
        }

        if (fuelType === "electricity") {
          weeklyBuckets[slot].electricity.push(usageKwh);
          weeklyBuckets[slot].electricityRegulated.push(
            usageKwh * electricRegulatedFractionForTrend
          );
          weeklyBuckets[slot].electricityUnregulated.push(
            usageKwh * (1 - electricRegulatedFractionForTrend)
          );
        }

        if (fuelType === "gas") {
          weeklyBuckets[slot].gas.push(usageKwh);
          weeklyBuckets[slot].gasRegulated.push(
            usageKwh * gasRegulatedFractionForTrend
          );
          weeklyBuckets[slot].gasUnregulated.push(
            usageKwh * (1 - gasRegulatedFractionForTrend)
          );
        }
      };

      (energyIntervalRows || [])
        .filter((row) => row.reading_type === "interval_30m")
        .forEach((row) => {
        const slot = getWeeklySlot(row.timestamp);
        const usageKwh = Number(row.usage_kwh);

        if (slot === null || !weeklyBuckets[slot] || !Number.isFinite(usageKwh)) {
          return;
        }

        pushEnergyUsage(slot, row.fuel_type, usageKwh);
      });

      const dailyTotalsByFuelDay = (energyIntervalRows || [])
        .filter((row) => row.reading_type === "daily_total")
        .reduce((groups, row) => {
          const date = new Date(row.timestamp);

          if (Number.isNaN(date.getTime())) {
            return groups;
          }

          const dayKey = `${row.fuel_type}:${date.toISOString().slice(0, 10)}`;

          if (intervalEnergyDays.has(dayKey)) {
            return groups;
          }

          groups[dayKey] = groups[dayKey] || [];
          groups[dayKey].push(row);
          return groups;
        }, {});

      Object.values(dailyTotalsByFuelDay).forEach((rows) => {
        const sortedRows = [...rows].sort(
          (a, b) =>
            new Date(a.created_at || a.timestamp) -
            new Date(b.created_at || b.timestamp)
        );
        let derivedIntervals = 0;
        const rowsByHour = sortedRows.reduce((groups, row) => {
          const slot = getWeeklySlot(row.created_at || row.timestamp);

          if (slot === null) {
            return groups;
          }

          groups[slot] = groups[slot] || [];
          groups[slot].push(row);
          return groups;
        }, {});

        Object.entries(rowsByHour).forEach(([slotKey, hourRows]) => {
          if (hourRows.length < 2) {
            return;
          }

          const firstRow = hourRows[0];
          const lastRow = hourRows[hourRows.length - 1];
          const firstValue = Number(firstRow.usage_kwh);
          const lastValue = Number(lastRow.usage_kwh);
          const firstTime = new Date(firstRow.created_at || firstRow.timestamp);
          const lastTime = new Date(lastRow.created_at || lastRow.timestamp);
          const elapsedHours =
            (lastTime.getTime() - firstTime.getTime()) / (1000 * 60 * 60);
          const deltaKwh = lastValue - firstValue;

          if (
            !Number.isFinite(deltaKwh) ||
            !Number.isFinite(elapsedHours) ||
            elapsedHours < 0.25 ||
            deltaKwh < 0
          ) {
            return;
          }

          const hourlyKwh = deltaKwh / elapsedHours;
          pushEnergyUsage(
            Number(slotKey),
            lastRow.fuel_type,
            hourlyKwh / 2
          );
          derivedIntervals += 1;
        });

        if (derivedIntervals > 0) {
          return;
        }

        const latestRow = sortedRows[sortedRows.length - 1];
        const usageKwh = Number(latestRow?.usage_kwh);
        const dayStartSlot = getWeeklyDayStartSlot(latestRow?.timestamp);
        const halfHourlyEquivalentKwh = usageKwh / 48;

        if (!Number.isFinite(halfHourlyEquivalentKwh)) {
          return;
        }

        for (let hourOffset = 0; hourOffset < 24; hourOffset += 1) {
          pushEnergyUsage(
            dayStartSlot === null ? null : dayStartSlot + hourOffset,
            latestRow.fuel_type,
            halfHourlyEquivalentKwh
          );
        }
      });

      iaqTrendRows.forEach((row) => {
        const slot = getWeeklySlot(row.timestamp);

        if (slot === null || !weeklyBuckets[slot]) {
          return;
        }

        const pushMetric = (key, value) => {
          const numericValue = Number(value);
          if (Number.isFinite(numericValue) && numericValue !== 0) {
            weeklyBuckets[slot][key].push(numericValue);
          }
        };

        pushMetric("internalTemp", row.temperature_inside);
        pushMetric("externalTemp", row.temperature_outside);
        pushMetric("humidity", row.humidity);
        pushMetric("pm25", row.pm25);
        pushMetric("vocs", row.vocs);
      });

      const averagedWeeklyTrend = weeklyBuckets.map((bucket) => ({
        slot: bucket.slot,
        dayIndex: bucket.dayIndex,
        hour: bucket.hour,
        label: bucket.label,
        dayLabel: bucket.dayLabel,
        hourLabel: bucket.hourLabel,
        electricity: bucket.electricity.length
          ? average(bucket.electricity) * 2
          : null,
        electricityRegulated: bucket.electricityRegulated.length
          ? average(bucket.electricityRegulated) * 2
          : null,
        electricityUnregulated: bucket.electricityUnregulated.length
          ? average(bucket.electricityUnregulated) * 2
          : null,
        gas: bucket.gas.length ? average(bucket.gas) * 2 : null,
        gasRegulated: bucket.gasRegulated.length
          ? average(bucket.gasRegulated) * 2
          : null,
        gasUnregulated: bucket.gasUnregulated.length
          ? average(bucket.gasUnregulated) * 2
          : null,
        internalTemp: bucket.internalTemp.length
          ? average(bucket.internalTemp)
          : null,
        externalTemp: bucket.externalTemp.length
          ? average(bucket.externalTemp)
          : null,
        humidity: bucket.humidity.length ? average(bucket.humidity) : null,
        pm25: bucket.pm25.length ? average(bucket.pm25) : null,
        vocs: bucket.vocs.length ? average(bucket.vocs) : null,
      }));

      setWeeklyTrendData(averagedWeeklyTrend);
    } catch (err) {
      console.error("Error fetching weekly performance trend:", err.message);
      setWeeklyTrendData([]);
    }
  };

  const fetchCarbonSavingsSummary = async () => {
    if (!isCarbonCreditTab) {
      return;
    }

    const buildCarbonSavingsFromEnergyRows = async () => {
      const pageSize = 1000;
      const maxPages = 100;
      const energyRows = [];

      for (let page = 0; page < maxPages; page += 1) {
        const { data, error } = await supabase
          .from("EnergyReadings")
          .select("timestamp, created_at, fuel_type, reading_type, usage_kwh")
          .eq("building_id", dataSourceBuildingId)
          .in("reading_type", ["daily_total", "interval_30m"])
          .not("usage_kwh", "is", null)
          .gte("timestamp", "2020-01-01")
          .lte("timestamp", new Date().toISOString())
          .order("timestamp", { ascending: true })
          .order("created_at", { ascending: true })
          .range(page * pageSize, (page + 1) * pageSize - 1);

        if (error) {
          throw error;
        }

        energyRows.push(...(data || []));

        if (!data || data.length < pageSize) {
          break;
        }
      }

      const intervalDays = new Set();
      const dailyEnergy = {};
      const dayKey = (timestamp) => new Date(timestamp).toISOString().slice(0, 10);

      energyRows
        .filter((row) => row.reading_type === "interval_30m")
        .forEach((row) => {
          const day = dayKey(row.timestamp);
          const fuelType = row.fuel_type || "unknown";
          const usageKwh = Number(row.usage_kwh);

          if (!Number.isFinite(usageKwh)) {
            return;
          }

          intervalDays.add(`${fuelType}:${day}`);
          dailyEnergy[day] = dailyEnergy[day] || {};
          dailyEnergy[day][fuelType] = (dailyEnergy[day][fuelType] || 0) + usageKwh;
        });

      energyRows
        .filter((row) => row.reading_type === "daily_total")
        .forEach((row) => {
          const day = dayKey(row.timestamp);
          const fuelType = row.fuel_type || "unknown";
          const usageKwh = Number(row.usage_kwh);

          if (!Number.isFinite(usageKwh) || intervalDays.has(`${fuelType}:${day}`)) {
            return;
          }

          dailyEnergy[day] = dailyEnergy[day] || {};
          dailyEnergy[day][fuelType] = Math.max(
            dailyEnergy[day][fuelType] || 0,
            usageKwh
          );
        });

      const electricityKgCo2ePerKwh = 0.20705;
      const gasKgCo2ePerKwh = 0.18254;
      const area = Number(matterportMetadata.internalArea);
      const improvedDailyElectricityKwh =
        ((Number.isFinite(area) && area > 0
          ? area
          : building.estimatedInternalArea || 99.2) *
          projectedPerformanceDeepDive.annualEui) /
        365;
      const improvedDailyKgCo2e =
        improvedDailyElectricityKwh * electricityKgCo2ePerKwh;

      const rows = Object.entries(dailyEnergy)
        .map(([savingDate, fuels]) => {
          const electricityKwh = Number(fuels.electricity || 0);
          const gasKwh = Number(fuels.gas || 0);
          const baselineKgCo2e =
            electricityKwh * electricityKgCo2ePerKwh + gasKwh * gasKgCo2ePerKwh;
          const savedKgCo2e = Math.max(0, baselineKgCo2e - improvedDailyKgCo2e);

          return {
            saving_date: savingDate,
            saved_kgco2e: savedKgCo2e,
            carbon_credits: savedKgCo2e / 1000,
          };
        })
        .sort((a, b) => b.saving_date.localeCompare(a.saving_date));

      return rows;
    };

    try {
      const { data, error } = await supabase
        .from("CarbonSavingsDaily")
        .select("saving_date, saved_kgco2e, carbon_credits")
        .eq("building_id", dataSourceBuildingId)
        .eq("scenario", "passivhaus-net-zero")
        .order("saving_date", { ascending: false })
        .limit(365);

      if (error) {
        throw error;
      }

      const rows = data || [];
      const totalSavedKgCo2e = rows.reduce(
        (sum, row) => sum + (Number(row.saved_kgco2e) || 0),
        0
      );
      const totalCredits = rows.reduce(
        (sum, row) => sum + (Number(row.carbon_credits) || 0),
        0
      );
      const latest = rows[0] || null;

      setCarbonCredits(totalCredits);
      setCarbonSavingsSummary({
        latestDate: latest?.saving_date || null,
        latestSavedKgCo2e: latest ? Number(latest.saved_kgco2e) : null,
        totalSavedKgCo2e,
      });
    } catch (err) {
      console.warn("Carbon savings table unavailable; calculating from EnergyReadings:", err.message);
      try {
        const rows = await buildCarbonSavingsFromEnergyRows();
        const totalSavedKgCo2e = rows.reduce(
          (sum, row) => sum + (Number(row.saved_kgco2e) || 0),
          0
        );
        const totalCredits = rows.reduce(
          (sum, row) => sum + (Number(row.carbon_credits) || 0),
          0
        );
        const latest = rows[0] || null;

        setCarbonCredits(totalCredits);
        setCarbonSavingsSummary({
          latestDate: latest?.saving_date || null,
          latestSavedKgCo2e: latest ? Number(latest.saved_kgco2e) : null,
          totalSavedKgCo2e,
        });
      } catch (fallbackErr) {
        console.warn("Carbon savings fallback unavailable:", fallbackErr.message);
      }
    }
  };

  const fetchCarbonMarketPrice = async () => {
    if (!isCarbonCreditTab) {
      return;
    }

    const carbonPriceUrls = [
      "https://api.tradingeconomics.com/markets/commodity/carbon?c=guest:guest",
      `https://api.allorigins.win/raw?url=${encodeURIComponent(
        "https://api.tradingeconomics.com/markets/commodity/carbon?c=guest:guest"
      )}`,
    ];

    const fetchJsonWithTimeout = async (url) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return await response.json();
      } finally {
        clearTimeout(timeout);
      }
    };

    const extractCarbonPrice = (payload) => {
      const records = Array.isArray(payload) ? payload : [payload];
      const record =
        records.find((item) =>
          /carbon|emission|eua|allowance/i.test(
            `${item?.Symbol || ""} ${item?.Name || ""} ${item?.Commodity || ""}`
          )
        ) || records[0];

      if (!record || typeof record !== "object") {
        return null;
      }

      const value = [
        record.Last,
        record.Price,
        record.Close,
        record.close,
        record.last,
        record.value,
      ]
        .map((candidate) => Number(candidate))
        .find((candidate) => Number.isFinite(candidate) && candidate > 0);

      if (!Number.isFinite(value)) {
        return null;
      }

      return {
        value,
        currency: String(record.Currency || record.currency || "EUR").toUpperCase(),
        updatedAt:
          record.Date ||
          record.LastUpdate ||
          record.LastUpdateDate ||
          new Date().toISOString(),
      };
    };

    const convertToGbp = async ({ value, currency }) => {
      if (currency === "GBP") {
        return value;
      }

      const fxPayload = await fetchJsonWithTimeout(
        `https://open.er-api.com/v6/latest/${currency}`
      );
      const gbpRate = Number(fxPayload?.rates?.GBP);

      if (!Number.isFinite(gbpRate) || gbpRate <= 0) {
        throw new Error(`No GBP exchange rate for ${currency}`);
      }

      return value * gbpRate;
    };

    for (const url of carbonPriceUrls) {
      try {
        const payload = await fetchJsonWithTimeout(url);
        const price = extractCarbonPrice(payload);

        if (!price) {
          throw new Error("No carbon price in response");
        }

        const gbpPerTonne = await convertToGbp(price);

        setCarbonMarketPrice({
          gbpPerTonne,
          source: "Trading Economics carbon allowances",
          updatedAt: price.updatedAt,
          live: true,
        });
        return;
      } catch (err) {
        console.warn("Carbon market price feed unavailable:", err.message);
      }
    }

    setCarbonMarketPrice((currentPrice) => ({
      ...currentPrice,
      gbpPerTonne:
        Number.isFinite(currentPrice.gbpPerTonne) && currentPrice.gbpPerTonne > 0
          ? currentPrice.gbpPerTonne
          : FALLBACK_CARBON_PRICE_GBP_PER_TONNE,
      live: false,
      source: "Estimated UK/EU carbon allowance price",
      updatedAt: currentPrice.updatedAt || new Date().toISOString(),
    }));
  };

  useEffect(() => {
    fetchLongTermAverage();
    fetchHeatLossSummary();
    fetchExternalTemp();
    fetchIAQData();
    fetchWeeklyPerformanceTrend();
    fetchCarbonSavingsSummary();
    fetchCarbonMarketPrice();
    // Building switch refresh only; polling effect below handles continuing updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSourceBuildingId]);

  useEffect(() => {
    fetchLongTermBuildingPerformance();

    const interval = setInterval(() => {
      fetchLongTermAverage();
      fetchIAQData();
      fetchExternalTemp();
      fetchLongTermBuildingPerformance();
      fetchWeeklyPerformanceTrend();
      fetchCarbonSavingsSummary();
      fetchCarbonMarketPrice();
    }, 60000);

    return () => clearInterval(interval);
    // The interval should reset only when the selected building or area source changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    dataSourceBuildingId,
    historicalPerformance,
    matterportMetadata.internalArea,
    heatLossSummary.weatherNormalisedEui,
  ]);

  const estimatedElectricityDailyKwh = Number.isFinite(
    energySummary.electricityDailyAverage
  )
    ? energySummary.electricityDailyAverage
    : 0;
  const shouldShowGas = building.showGas !== false;
  const estimatedGasDailyKwh =
    shouldShowGas && Number.isFinite(energySummary.gasDailyAverage)
      ? energySummary.gasDailyAverage
      : 0;
  const estimatedTotalDailyKwh = estimatedElectricityDailyKwh + estimatedGasDailyKwh;
  const regulatedElectricFraction =
    building.regulatedElectricFraction ?? (energySummary.hasGasData ? 0.15 : 0.35);
  const gasHeatingDailyKwh =
    shouldShowGas && Number.isFinite(energySummary.gasHeatingDaily)
      ? energySummary.gasHeatingDaily
      : 0;
  const gasDhwDailyKwh =
    shouldShowGas && Number.isFinite(energySummary.gasDhwDaily)
      ? energySummary.gasDhwDaily
      : 0;
  const gasBaseloadDailyKwh =
    shouldShowGas && Number.isFinite(energySummary.gasBaseloadDaily)
      ? energySummary.gasBaseloadDaily
      : null;
  const gasUnregulatedDailyKwh =
    shouldShowGas && Number.isFinite(energySummary.gasUnregulatedDaily)
      ? energySummary.gasUnregulatedDaily
      : null;
  const gasAnomalyDailyKwh =
    shouldShowGas && Number.isFinite(energySummary.gasAnomalyDaily)
      ? energySummary.gasAnomalyDaily
      : null;
  const regulatedDailyKwh = estimatedTotalDailyKwh
    ? Math.min(
        estimatedTotalDailyKwh,
        gasDhwDailyKwh +
          gasHeatingDailyKwh +
          estimatedElectricityDailyKwh * regulatedElectricFraction
      )
    : null;
  const unregulatedDailyKwh = Number.isFinite(regulatedDailyKwh)
    ? Math.max(0, estimatedTotalDailyKwh - regulatedDailyKwh)
    : null;
  const regulatedEnergyShare =
    Number.isFinite(regulatedDailyKwh) && estimatedTotalDailyKwh > 0
      ? (regulatedDailyKwh / estimatedTotalDailyKwh) * 100
      : null;
  const regulatedSplitConfidence = Number.isFinite(regulatedDailyKwh)
    ? building.heatingSystem === "none"
      ? "Estimate / no heating system; needs submetered data"
      : energySummary.hasGasData
      ? energySummary.gasDecompositionConfidence
      : heatLossSummary.hddDays >= 30 || heatLossSummary.hddSource === "legacy"
      ? "Electric estimate"
      : "Estimate / needs seasonal/submetered data"
    : "Pending energy data";
  const dashboardArea = Number(matterportMetadata.internalArea);
  const hddIntensityPerM2 =
    Number.isFinite(heatLossSummary.kwhPerHdd) &&
    Number.isFinite(dashboardArea) &&
    dashboardArea > 0
      ? heatLossSummary.kwhPerHdd / dashboardArea
      : null;
  const htcPerM2 =
    Number.isFinite(heatLossSummary.htcEstimate) &&
    Number.isFinite(dashboardArea) &&
    dashboardArea > 0
      ? heatLossSummary.htcEstimate / dashboardArea
      : null;
  const annualHddEstimate =
    Number.isFinite(heatLossSummary.weatherNormalisedEui) &&
    Number.isFinite(hddIntensityPerM2) &&
    hddIntensityPerM2 > 0
      ? heatLossSummary.weatherNormalisedEui / hddIntensityPerM2
      : null;
  const targetHddIntensity =
    Number.isFinite(annualHddEstimate) && annualHddEstimate > 0
      ? building.targetEui / annualHddEstimate
      : 0.0075;
  const nationalAverageHddIntensity =
    Number.isFinite(annualHddEstimate) && annualHddEstimate > 0
      ? building.nationalAverageEui / annualHddEstimate
      : 0.075;
  const hddComfortCoverage =
    heatLossSummary.hddDays > 0
      ? heatLossSummary.comfortHddDays / heatLossSummary.hddDays
      : null;
  const hasMatureHddComfortSample =
    heatLossSummary.hddDays >= 14 || heatLossSummary.hddSource === "legacy";
  const liveComfortMaintained =
    Number.isFinite(sensorData.internalTemp) &&
    sensorData.internalTemp >= 18 &&
    (!Number.isFinite(sensorData.externalTemp) ||
      sensorData.externalTemp <= HDD_BASE_TEMP_C);
  const historicHddComfortQualified =
    building.heatingSystem !== "none" &&
    Number.isFinite(hddComfortCoverage) &&
    hddComfortCoverage >= 0.7 &&
    Number.isFinite(heatLossSummary.averageInternalTemp) &&
    heatLossSummary.averageInternalTemp >= 18;
  const hddComfortQualified =
    historicHddComfortQualified ||
    (!hasMatureHddComfortSample && liveComfortMaintained);
  const hddDataCaveat =
    building.heatingSystem === "none"
      ? "Low energy / unheated"
      : heatLossSummary.flatlineIndoorTemp
      ? "Check indoor sensor"
      : !hasMatureHddComfortSample && liveComfortMaintained
      ? "Early HDD sample / live comfort maintained"
      : Number.isFinite(hddComfortCoverage) && !hddComfortQualified
      ? "Comfort not maintained"
      : "";
  const heatLossStatusClass = (status) => {
    if (status === "good") return "text-emerald-700";
    if (status === "warning") return "text-amber-700";
    if (status === "poor") return "text-red-700";
    return "text-gray-500";
  };
  const heatLossStatusDotClass = (status) => {
    if (status === "good") return "bg-emerald-500";
    if (status === "warning") return "bg-amber-500";
    if (status === "poor") return "bg-red-500";
    return "bg-gray-300";
  };
  const rawHddStatus = Number.isFinite(hddIntensityPerM2)
    ? hddIntensityPerM2 <= targetHddIntensity
      ? "good"
      : hddIntensityPerM2 <= nationalAverageHddIntensity
      ? "warning"
      : "poor"
    : "pending";
  const hddStatus =
    rawHddStatus === "good" && !hddComfortQualified ? "warning" : rawHddStatus;
  const rawHtcStatus = Number.isFinite(htcPerM2)
    ? htcPerM2 <= 1.5
      ? "good"
      : htcPerM2 <= 3
      ? "warning"
      : "poor"
    : "pending";
  const htcStatus = heatLossSummary.flatlineIndoorTemp ? "pending" : rawHtcStatus;
  const HeatLossStatusDot = ({ status }) => (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${heatLossStatusDotClass(
        status
      )}`}
      aria-hidden="true"
    />
  );
  const hasConfirmedArea = matterportMetadata.internalArea !== "--";
  const hasEnergyBaseline = Number.isFinite(historicalPerformance);
  const hasWeatherNormalisedBaseline =
    Number.isFinite(heatLossSummary.weatherNormalisedEui) ||
    Number.isFinite(heatLossSummary.kwhPerHdd);
  const hasLiveIaqFeed =
    Number.isFinite(sensorData.internalTemp) ||
    Number.isFinite(sensorData.humidity) ||
    roomIaqData.length > 0;
  const carbonEvidenceSteps = [
    { label: "Energy baseline", complete: hasEnergyBaseline },
    { label: "GIA confirmed", complete: hasConfirmedArea },
    { label: "HDD normalised", complete: hasWeatherNormalisedBaseline },
    { label: "Live IAQ active", complete: hasLiveIaqFeed },
    { label: "Cold-season comfort", complete: heatLossSummary.htcSamples >= 30 },
    { label: "Warm-season comfort", complete: false },
    { label: "Post-improvement period", complete: false },
    { label: "Credit evidence ready", complete: false },
  ].map((step) =>
    isCarbonCreditTab
      ? { ...step, complete: true }
      : step
  );
  const carbonEvidenceCompleteCount = carbonEvidenceSteps.filter(
    (step) => step.complete
  ).length;
  const carbonEvidenceProgress = Math.round(
    (carbonEvidenceCompleteCount / carbonEvidenceSteps.length) * 100
  );
  const nextCarbonEvidenceStep = carbonEvidenceSteps.find(
    (step) => !step.complete
  );
  const carbonTokenUnlocked =
    isCarbonCreditTab || carbonEvidenceSteps.every((step) => step.complete);
  const carbonSavedTonnes = Number.isFinite(
    carbonSavingsSummary.totalSavedKgCo2e
  )
    ? carbonSavingsSummary.totalSavedKgCo2e / 1000
    : null;
  const carbonMarketValue =
    Number.isFinite(carbonSavedTonnes) &&
    Number.isFinite(carbonMarketPrice.gbpPerTonne)
      ? carbonSavedTonnes * carbonMarketPrice.gbpPerTonne
      : null;
  const trendMetrics = [
    {
      key: "electricity",
      label: "Electricity",
      unit: "kWh",
      color: "#2563eb",
      energyStatus: true,
    },
    {
      key: "gas",
      label: "Gas",
      unit: "kWh",
      color: "#dc2626",
      energyStatus: true,
    },
    {
      key: "internalTemp",
      label: "Internal",
      unit: "deg C",
      color: "#059669",
      displayRange: { min: 10, max: 30 },
      healthyLimits: [
        { value: 18, label: "18 min" },
        { value: 24, label: "24 max" },
      ],
      healthBands: [
        { min: 24, max: 30, color: "#fee2e2", label: "Warm risk" },
        { min: 22, max: 24, color: "#dcfce7", label: "Healthy" },
        { min: 18, max: 22, color: "#dcfce7", label: "Healthy" },
        { min: 16, max: 18, color: "#fef3c7", label: "Cool" },
        { min: 10, max: 16, color: "#fee2e2", label: "Cold risk" },
      ],
    },
    {
      key: "externalTemp",
      label: "External",
      unit: "deg C",
      color: "#0891b2",
      displayRange: { min: -5, max: 35 },
    },
    {
      key: "humidity",
      label: "Humidity",
      unit: "%",
      color: "#7c3aed",
      displayRange: { min: 20, max: 90 },
      healthyLimits: [
        { value: 40, label: "40 min" },
        { value: 60, label: "60 max" },
      ],
      healthBands: [
        { min: 70, max: 90, color: "#fee2e2", label: "High RH risk" },
        { min: 60, max: 70, color: "#fef3c7", label: "High RH" },
        { min: 40, max: 60, color: "#dcfce7", label: "Healthy" },
        { min: 30, max: 40, color: "#fef3c7", label: "Low RH" },
        { min: 20, max: 30, color: "#fee2e2", label: "Low RH risk" },
      ],
    },
    {
      key: "pm25",
      label: "PM2.5",
      unit: "ug/m3",
      color: "#ea580c",
      displayRange: { min: 0, max: 75 },
      healthyLimits: [{ value: 12, label: "PM2.5 norm" }],
      healthBands: [
        { min: 35, max: 75, color: "#fee2e2", label: "Unhealthy" },
        { min: 12, max: 35, color: "#fef3c7", label: "Elevated" },
        { min: 0, max: 12, color: "#dcfce7", label: "Healthy" },
      ],
    },
    {
      key: "vocs",
      label: "VOCs",
      unit: "ppb",
      color: "#be123c",
      displayRange: { min: 0, max: 1000 },
      healthyLimits: [{ value: 200, label: "VOC norm" }],
      healthBands: [
        { min: 500, max: 1000, color: "#fee2e2", label: "Unhealthy" },
        { min: 200, max: 500, color: "#fef3c7", label: "Elevated" },
        { min: 0, max: 200, color: "#dcfce7", label: "Healthy" },
      ],
    },
  ];
  const activeTrendMetrics = trendMetrics.filter((metric) =>
    weeklyTrendData.some((day) => Number.isFinite(day[metric.key]))
  );
  const trendMetricGroups = [
    {
      key: "energy",
      label: "Energy",
      metricKeys: ["electricity", "gas"],
    },
    {
      key: "health",
      label: "Health",
      metricKeys: ["internalTemp", "externalTemp", "humidity", "pm25", "vocs"],
    },
  ];
  const activeTrendMetricKeys = activeTrendMetrics.map((metric) => metric.key);
  const activeTrendMetricGroups = trendMetricGroups
    .map((group) => ({
      ...group,
      metricKeys: group.metricKeys.filter((key) =>
        activeTrendMetricKeys.includes(key)
      ),
    }))
    .filter((group) => group.metricKeys.length > 0);
  const selectedTrendMetricGroupKey =
    selectedTrendMetricKeys.length > 0
      ? activeTrendMetricGroups.find(
          (group) =>
            group.metricKeys.length === selectedTrendMetricKeys.length &&
            group.metricKeys.every((key) => selectedTrendMetricKeys.includes(key))
        )?.key
      : "";
  const selectedActiveTrendMetrics = selectedTrendMetricKeys.length
    ? activeTrendMetrics.filter((metric) =>
        selectedTrendMetricKeys.includes(metric.key)
      )
    : activeTrendMetrics;
  const visibleTrendMetrics = selectedActiveTrendMetrics.length
    ? selectedActiveTrendMetrics
    : activeTrendMetrics;
  const toggleTrendMetric = (metricKey) => {
    setSelectedTrendMetricKeys((currentKeys) => {
      const activeKeys = activeTrendMetrics.map((metric) => metric.key);
      const cleanedKeys = currentKeys.filter((key) => activeKeys.includes(key));

      if (cleanedKeys.length === 0) {
        return [metricKey];
      }

      if (cleanedKeys.includes(metricKey)) {
        return cleanedKeys.length === 1
          ? []
          : cleanedKeys.filter((key) => key !== metricKey);
      }

      return [...cleanedKeys, metricKey];
    });
  };
  const selectTrendMetricGroup = (metricKeys) => {
    setSelectedTrendMetricKeys(
      metricKeys.filter((key) => activeTrendMetricKeys.includes(key))
    );
  };
  const chartWidth = 980;
  const chartHeight = 340;
  const chartPadding = {
    top: 18,
    right: 18,
    bottom: 44,
    left: 54,
  };
  const plotWidth = chartWidth - chartPadding.left - chartPadding.right;
  const plotHeight = chartHeight - chartPadding.top - chartPadding.bottom;
  const buildMetricRanges = (_data, metrics) =>
    metrics.reduce((ranges, metric) => {
      ranges[metric.key] = { min: 0, max: 100 };
      return ranges;
    }, {});
  const metricRanges = buildMetricRanges(weeklyTrendData, visibleTrendMetrics);
  const rawMetricRanges = activeTrendMetrics.reduce((ranges, metric) => {
    const values = weeklyTrendData
      .map((point) => point[metric.key])
      .filter((value) => Number.isFinite(value));
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 1;
    ranges[metric.key] = { min, max: max === min ? max + 1 : max };
    return ranges;
  }, {});
  const hoveredTrendPoint = Number.isInteger(hoveredTrendSlot)
    ? weeklyTrendData[hoveredTrendSlot]
    : null;
  const hoveredTrendX =
    hoveredTrendPoint && weeklyTrendData.length > 1
      ? chartPadding.left +
        (hoveredTrendPoint.slot / (weeklyTrendData.length - 1)) * plotWidth
      : null;
  const trendY = (range, value) => {
    if (!range || !Number.isFinite(value)) {
      return null;
    }

    const normalised = (value - range.min) / (range.max - range.min);
    return chartPadding.top + (1 - normalised) * plotHeight;
  };
  const formatDeviationScore = (score) => {
    if (!Number.isFinite(score)) {
      return "";
    }

    const deviation = Math.round(score - 50);
    return deviation > 0 ? `+${deviation}` : `${deviation}`;
  };
  const trendHealthScore = (metric, value) => {
    if (!Number.isFinite(value)) {
      return null;
    }

    if (metric.key === "internalTemp") {
      if (value >= 18 && value <= 24) {
        return linearScore(value, [
          { min: 18, max: 20, startScore: 30, endScore: 50 },
          { min: 20, max: 24, startScore: 50, endScore: 70 },
        ]);
      }
      if (value < 18) {
        return linearScore(value, [
          { min: 10, max: 16, startScore: 0, endScore: 15 },
          { min: 16, max: 18, startScore: 15, endScore: 30 },
        ]);
      }
      return linearScore(value, [
        { min: 24, max: 26, startScore: 70, endScore: 85 },
        { min: 26, max: 30, startScore: 85, endScore: 100 },
      ]);
    }

    if (metric.key === "externalTemp") {
      if (value >= 10 && value <= 24) {
        return linearScore(value, [
          { min: 10, max: 24, startScore: 30, endScore: 70 },
        ]);
      }
      if (value < 10) {
        return linearScore(value, [
          { min: -5, max: 4, startScore: 0, endScore: 15 },
          { min: 4, max: 10, startScore: 15, endScore: 30 },
        ]);
      }
      return linearScore(value, [
        { min: 24, max: 28, startScore: 70, endScore: 85 },
        { min: 28, max: 35, startScore: 85, endScore: 100 },
      ]);
    }

    if (metric.key === "humidity") {
      if (value >= 40 && value <= 60) {
        return linearScore(value, [
          { min: 40, max: 60, startScore: 30, endScore: 70 },
        ]);
      }
      if (value < 40) {
        return linearScore(value, [
          { min: 20, max: 30, startScore: 0, endScore: 15 },
          { min: 30, max: 40, startScore: 15, endScore: 30 },
        ]);
      }
      return linearScore(value, [
        { min: 60, max: 70, startScore: 70, endScore: 85 },
        { min: 70, max: 90, startScore: 85, endScore: 100 },
      ]);
    }

    if (metric.key === "pm25") {
      if (value <= 12) return 50;
      return linearScore(value, [
        { min: 12, max: 35, startScore: 70, endScore: 85 },
        { min: 35, max: 75, startScore: 85, endScore: 100 },
      ]);
    }

    if (metric.key === "vocs") {
      if (value <= 200) return 50;
      return linearScore(value, [
        { min: 200, max: 500, startScore: 70, endScore: 85 },
        { min: 500, max: 1000, startScore: 85, endScore: 100 },
      ]);
    }

    const range = rawMetricRanges[metric.key];
    if (!range) {
      return null;
    }

    const normalised = (value - range.min) / (range.max - range.min);
    if (metric.energyStatus) {
      return linearScore(normalised, [
        { min: 0, max: 0.35, startScore: 30, endScore: 70 },
        { min: 0.35, max: 0.7, startScore: 70, endScore: 85 },
        { min: 0.7, max: 1, startScore: 85, endScore: 100 },
      ]);
    }

    return clampScore(100 - normalised * 100);
  };
  const updateHoveredTrendSlot = (event) => {
    if (!weeklyTrendData.length) {
      return;
    }

    if (event.pointerType === "touch") {
      event.preventDefault();
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    const svgX = ((event.clientX - bounds.left) / bounds.width) * chartWidth;
    const plotX = Math.max(
      0,
      Math.min(plotWidth, svgX - chartPadding.left)
    );
    const nextSlot = Math.round((plotX / plotWidth) * (weeklyTrendData.length - 1));

    setHoveredTrendSlot(nextSlot);
  };
  const clearHoveredTrendSlot = (event) => {
    if (event.pointerType !== "touch") {
      setHoveredTrendSlot(null);
    }
  };
  const trendPoint = (data, ranges, pointData, metric, index) => {
    const rawValue = pointData[metric.key];
    const value = trendHealthScore(metric, rawValue);
    const range = ranges[metric.key];

    if (!Number.isFinite(value) || !range) {
      return null;
    }

    const x =
      chartPadding.left +
      (data.length > 1 ? (index / (data.length - 1)) * plotWidth : plotWidth / 2);
    const y = trendY(range, value);

    if (!Number.isFinite(y)) {
      return null;
    }

    return { x, y, value };
  };
  const trendPath = (data, ranges, metric) => {
    const points = data
      .map((pointData, index) => trendPoint(data, ranges, pointData, metric, index))
      .filter(Boolean);

    return points
      .map((point, index) =>
        `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`
      )
      .join(" ");
  };
  const averageMetricValue = (data, metric) => {
    const values = data
      .map((day) => day[metric.key])
      .filter((value) => Number.isFinite(value));
    return values.length ? average(values) : null;
  };
  const hoveredTrendMetric = hoveredTrendPoint
    ? visibleTrendMetrics.find((metric) =>
        Number.isFinite(hoveredTrendPoint[metric.key])
      )
    : null;
  const hoveredTrendY =
    hoveredTrendMetric && hoveredTrendPoint
      ? trendY(
          metricRanges[hoveredTrendMetric.key],
          trendHealthScore(
            hoveredTrendMetric,
            hoveredTrendPoint[hoveredTrendMetric.key]
          )
        )
      : null;
  const passivhausPerformance = {
    health: 96,
    energy: 98,
    value: 97,
  };
  const isNewPerformanceDeepDive =
    isCarbonCreditTab && deepDivePanel === "new";
  const projectedPerformanceDeepDive = {
    annualEui: 15,
    electricityDailyAverage: 4.1,
    gasDailyAverage: 0,
    regulatedDailyKwh: 2.6,
    unregulatedDailyKwh: 1.5,
    regulatedEnergyShare: 63,
    splitConfidence: "Projected all-electric net zero ready profile",
    internalTemp: 20.5,
    externalTemp: sensorData.externalTemp,
    humidity: 45,
    vocs: 20,
    pm25: 1,
    pm10: 3,
    hcho: 2,
    no2: 4,
    weatherNormalisedEui: 15,
    kwhPerHdd: 1.8,
    htcEstimate: 88,
    hddDays: 365,
    htcSamples: 90,
    hddSource: "Projected PHPP / retrofit model",
    comfortNote: "20.5 deg C target internal temp / continuous comfort assumed",
  };
  const displayedAnnualEui = isNewPerformanceDeepDive
    ? projectedPerformanceDeepDive.annualEui
    : Number.isFinite(historicalPerformance) &&
      matterportMetadata.internalArea !== "--"
    ? (historicalPerformance * 365) / Number(matterportMetadata.internalArea)
    : null;
  const displayedElectricityDailyAverage = isNewPerformanceDeepDive
    ? projectedPerformanceDeepDive.electricityDailyAverage
    : energySummary.electricityDailyAverage;
  const displayedGasDailyAverage = isNewPerformanceDeepDive
    ? projectedPerformanceDeepDive.gasDailyAverage
    : energySummary.gasDailyAverage;
  const displayedRegulatedDailyKwh = isNewPerformanceDeepDive
    ? projectedPerformanceDeepDive.regulatedDailyKwh
    : regulatedDailyKwh;
  const displayedUnregulatedDailyKwh = isNewPerformanceDeepDive
    ? projectedPerformanceDeepDive.unregulatedDailyKwh
    : unregulatedDailyKwh;
  const displayedRegulatedEnergyShare = isNewPerformanceDeepDive
    ? projectedPerformanceDeepDive.regulatedEnergyShare
    : regulatedEnergyShare;
  const displayedSplitConfidence = isNewPerformanceDeepDive
    ? projectedPerformanceDeepDive.splitConfidence
    : regulatedSplitConfidence;
  const displayedSensorData = isNewPerformanceDeepDive
    ? {
        ...sensorData,
        internalTemp: projectedPerformanceDeepDive.internalTemp,
        externalTemp: projectedPerformanceDeepDive.externalTemp,
        humidity: projectedPerformanceDeepDive.humidity,
        vocs: projectedPerformanceDeepDive.vocs,
        pm25: projectedPerformanceDeepDive.pm25,
        pm10: projectedPerformanceDeepDive.pm10,
        hcho: projectedPerformanceDeepDive.hcho,
        no2: projectedPerformanceDeepDive.no2,
      }
    : sensorData;
  const displayedHeatLossSummary = isNewPerformanceDeepDive
    ? {
        ...heatLossSummary,
        weatherNormalisedEui: projectedPerformanceDeepDive.weatherNormalisedEui,
        kwhPerHdd: projectedPerformanceDeepDive.kwhPerHdd,
        htcEstimate: projectedPerformanceDeepDive.htcEstimate,
        hddDays: projectedPerformanceDeepDive.hddDays,
        htcSamples: projectedPerformanceDeepDive.htcSamples,
        hddSource: "projected",
        averageInternalTemp: projectedPerformanceDeepDive.internalTemp,
        flatlineIndoorTemp: false,
        filteredInsideReadings: 0,
      }
    : heatLossSummary;
  const displayedHddStatus = isNewPerformanceDeepDive ? "good" : hddStatus;
  const displayedHtcStatus = isNewPerformanceDeepDive ? "good" : htcStatus;
  const shouldShowDeepDive = isCarbonCreditTab
    ? deepDiveOpen
    : standardDeepDiveOpen;
  const toggleDeepDivePanel = (panelKey) => {
    setDeepDivePanel((currentPanel) =>
      currentPanel === panelKey ? null : panelKey
    );
  };
  const renderPerformanceCard = ({
    title,
    healthScore,
    energyScore,
    gaugeValue,
    diveKey,
    compact = false,
    tone = "default",
    statusLabel,
    activeBandOnly = false,
    showStandardDeepDiveToggle = false,
  }) => (
    <div
      className={`flex min-w-0 flex-col rounded border p-2.5 sm:p-4 ${
        tone === "primary"
          ? "border-emerald-200 bg-emerald-50/60"
          : tone === "locked"
          ? "border-gray-200 bg-gray-50"
          : "bg-white"
      }`}
    >
      {title ? (
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3
            className={`text-[10px] font-semibold uppercase tracking-wide sm:text-xs ${
              tone === "primary" ? "text-emerald-800" : "text-gray-500"
            }`}
          >
            {title}
          </h3>
        </div>
      ) : null}
      <div
        className={
          showStandardDeepDiveToggle
            ? "grid min-h-0 flex-1 grid-cols-[minmax(112px,0.95fr)_minmax(0,1.65fr)] items-start gap-2 sm:gap-5"
            : "flex min-h-0 flex-1 flex-col"
        }
      >
        <div
          className={`space-y-1 leading-tight ${
            compact
              ? "text-[10px] min-[390px]:text-xs sm:text-sm"
              : "text-xs sm:text-sm"
          }`}
        >
          <p>
            <strong>Health:</strong> {formatScore(healthScore)}
          </p>
          <p>
            <strong>Energy:</strong> {formatScore(energyScore)}
          </p>
        </div>

        <div
          className={`flex min-w-0 flex-1 ${
            showStandardDeepDiveToggle
              ? "min-h-[130px] items-start justify-center pt-0 sm:min-h-[185px]"
              : compact
              ? "min-h-[118px] items-center justify-center pt-2 sm:min-h-[142px]"
              : "min-h-[160px] items-start justify-end pt-2 pr-0 sm:min-h-[220px] sm:pr-6"
          }`}
        >
          <AnalogGauge
            value={gaugeValue}
            historicalValue={historicalPerformance}
            activeBandOnly={activeBandOnly}
            className={
              showStandardDeepDiveToggle
                ? "h-auto w-[250px] max-w-full min-[390px]:w-[285px] sm:w-[420px] lg:w-[500px]"
                : compact
                ? "h-auto w-[150px] max-w-full min-[390px]:w-[170px] sm:w-[200px]"
                : "h-auto w-[220px] max-w-full min-[390px]:w-[255px] sm:w-[320px]"
            }
          />
        </div>
      </div>
      {isCarbonCreditTab && diveKey ? (
        <div className="mt-3 flex flex-col items-start gap-2 border-t border-gray-100 pt-2">
          {statusLabel ? (
            <span
              className={`whitespace-nowrap rounded border px-2 py-0.5 text-[8px] font-semibold uppercase tracking-wide ${
                tone === "primary"
                  ? "border-emerald-300 bg-white text-emerald-800"
                  : "border-gray-300 bg-white text-gray-600"
              }`}
            >
              {statusLabel}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => toggleDeepDivePanel(diveKey)}
            className="text-left text-[10px] font-semibold text-gray-700 underline decoration-gray-300 underline-offset-2 transition hover:text-black sm:text-xs"
            aria-expanded={deepDivePanel === diveKey}
          >
            {deepDivePanel === diveKey ? "Hide deep dive" : "Deep Dive"}
          </button>
        </div>
      ) : showStandardDeepDiveToggle ? (
        <div className="mt-3 flex justify-start border-t border-gray-100 pt-2">
          <button
            type="button"
            onClick={() => setStandardDeepDiveOpen((isOpen) => !isOpen)}
            className="text-left text-[10px] font-semibold text-gray-700 underline decoration-gray-300 underline-offset-2 transition hover:text-black sm:text-xs"
            aria-expanded={standardDeepDiveOpen}
          >
            {standardDeepDiveOpen ? "Hide deep dive" : "Deep Dive"}
          </button>
        </div>
      ) : null}
    </div>
  );
  return (
    <div className="min-h-screen bg-white p-4 flex flex-col space-y-6">
      <div className="bg-gray-100 p-4 rounded shadow">
        <h2 className="text-lg font-bold mb-3">Building Input</h2>

        <div className="grid grid-cols-[minmax(112px,0.95fr)_minmax(0,1.65fr)] sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2 sm:gap-5 items-stretch">
          <div className="min-w-0 self-stretch">
            <div className="grid grid-cols-1 grid-rows-3 gap-1.5 sm:gap-3 h-full">
              <div className="bg-white rounded border p-1.5 min-[390px]:p-2 sm:p-3 min-w-0 overflow-hidden flex flex-col justify-center">
                <p className="text-[8px] min-[390px]:text-[9px] sm:text-xs uppercase tracking-normal sm:tracking-wide text-gray-500 leading-none">
                  Address
                </p>
                <p className="font-semibold text-[clamp(8px,2.4vw,10px)] sm:text-sm mt-1 leading-tight break-words max-h-full overflow-hidden">
                  {matterportMetadata.address}
                </p>
              </div>

              <div className="bg-white rounded border p-1.5 min-[390px]:p-2 sm:p-3 min-w-0 overflow-hidden flex flex-col justify-center">
                <p className="text-[8px] min-[390px]:text-[9px] sm:text-xs uppercase tracking-normal sm:tracking-wide text-gray-500 leading-none">
                  <span className="sm:hidden">Coords</span>
                  <span className="hidden sm:inline">Coordinates</span>
                </p>
                <p className="font-semibold text-[clamp(8px,2.4vw,10px)] sm:text-sm mt-1 leading-tight break-words max-h-full overflow-hidden">
                  {matterportMetadata.latitude}, {matterportMetadata.longitude}
                </p>
              </div>

              <div className="bg-white rounded border p-1.5 min-[390px]:p-2 sm:p-3 min-w-0 overflow-hidden flex flex-col justify-center">
                <p className="text-[8px] min-[390px]:text-[9px] sm:text-xs uppercase tracking-normal sm:tracking-wide text-gray-500 leading-none">
                  <span className="sm:hidden">Area</span>
                  <span className="hidden sm:inline">Internal Area</span>
                </p>
                <p className="font-semibold text-[clamp(8px,2.4vw,10px)] sm:text-sm mt-1 leading-tight">
                  {matterportMetadata.internalArea !== "--"
                    ? `${matterportMetadata.internalArea} m2`
                    : "Pending"}
                </p>
              </div>
            </div>

          </div>

          <div className="space-y-1.5 min-w-0 bg-white rounded border p-1.5 sm:p-2 h-full">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold text-xs min-[390px]:text-sm sm:text-base">
                3D Model
              </h3>

              {matterportShareUrl ? (
                <div className="flex justify-end text-right">
                  <a
                    className="text-blue-700 text-[10px] min-[390px]:text-xs sm:text-sm underline leading-tight"
                    href={matterportShareUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open
                  </a>
                </div>
              ) : null}
            </div>

            {matterportEmbedUrl ? (
              <iframe
                title="Matterport model"
                src={matterportEmbedUrl}
                className="w-full h-[190px] min-[390px]:h-[220px] sm:h-[250px] border rounded bg-white"
                allow="autoplay; fullscreen; xr-spatial-tracking; accelerometer; gyroscope; vr"
                allowFullScreen
              />
            ) : (
              <div className="w-full h-[190px] min-[390px]:h-[220px] sm:h-[250px] border rounded bg-white flex items-center justify-center text-gray-500 text-[10px] min-[390px]:text-xs sm:text-sm p-2 sm:p-6 text-center">
                3D model pending.
              </div>
            )}

          </div>
        </div>
      </div>

      <div className="bg-gray-100 p-4 rounded shadow">
        <h2 className="text-lg font-bold mb-3">Performance</h2>

        <div className="space-y-3 sm:space-y-5">
          {isCarbonCreditTab ? (
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3">
              {renderPerformanceCard({
                title: "Baseline",
                healthScore: performanceBreakdown.health,
                energyScore: performanceBreakdown.energy,
                gaugeValue: performanceValue,
                diveKey: "baseline",
                compact: true,
                tone: "locked",
                statusLabel: "Locked in",
                activeBandOnly: true,
              })}
              {renderPerformanceCard({
                title: "New Performance",
                healthScore: passivhausPerformance.health,
                energyScore: passivhausPerformance.energy,
                gaugeValue: passivhausPerformance.value,
                diveKey: "new",
                tone: "primary",
                statusLabel: "Passivhaus style",
              })}
            </div>
          ) : (
            renderPerformanceCard({
              healthScore: performanceBreakdown.health,
              energyScore: performanceBreakdown.energy,
              gaugeValue: performanceValue,
              showStandardDeepDiveToggle: true,
            })
          )}

          {!shouldShowDeepDive ? null : (
          <div className="bg-white rounded border p-2.5 sm:p-4 min-w-0 overflow-hidden">
            {isCarbonCreditTab ? (
              <div className="mb-3 border-b border-gray-100 pb-2 text-xs text-gray-600">
                <h3 className="font-semibold text-gray-900">
                  {deepDivePanel === "new"
                    ? "New Passivhaus Performance Deep Dive"
                    : "Baseline Performance Deep Dive"}
                </h3>
                <p>
                  {deepDivePanel === "new"
                    ? "Projected post-upgrade view using passivhaus-style comfort and energy performance."
                    : "Measured current building view from the live Home data baseline."}
                </p>
              </div>
            ) : null}
            <div className="grid grid-cols-3 gap-2 sm:gap-5 text-[10px] min-[390px]:text-xs sm:text-sm leading-tight">
              <div className="space-y-2 sm:space-y-3 break-words min-w-0">
                <h3 className="font-semibold mb-2 sm:mb-3">Energy</h3>
                <p>
                  <strong>Annualised EUI</strong>
                  <br />
                  {Number.isFinite(displayedAnnualEui)
                    ? displayedAnnualEui.toFixed(4)
                    : "No Data"}
                  <br />
                  kWh/m2/yr
                </p>
                <p>
                  <strong>Electricity</strong>
                  <br />
                  Daily Average
                  <br />
                  {formatNumber(displayedElectricityDailyAverage)}{" "}
                  kWh
                </p>

                {isNewPerformanceDeepDive ? (
                  <p>
                    <strong>Gas</strong>
                    <br />
                    Daily Average
                    <br />
                    {formatNumber(displayedGasDailyAverage)} kWh
                  </p>
                ) : shouldShowGas && energySummary.hasGasData ? (
                  <p>
                    <strong>Gas</strong>
                    <br />
                    Daily Average
                    <br />
                    {formatNumber(energySummary.gasDailyAverage)}{" "}
                    kWh
                  </p>
                ) : shouldShowGas ? (
                  <p>
                    <strong>Gas</strong>
                    <br />
                    Daily Average
                    <br />
                    No Data
                  </p>

                ) : null}
                <div className="border-t border-gray-200 pt-2 space-y-1">
                  <p>
                    <strong>Regulated:</strong>{" "}
                    {Number.isFinite(displayedRegulatedDailyKwh)
                      ? `${formatNumber(displayedRegulatedDailyKwh)} kWh/day`
                      : "No Data"}
                  </p>
                  <p>
                    <strong>Unregulated:</strong>{" "}
                    {Number.isFinite(displayedUnregulatedDailyKwh)
                      ? `${formatNumber(displayedUnregulatedDailyKwh)} kWh/day`
                      : "No Data"}
                  </p>
                  <p>
                    <strong>Regulated Share:</strong>{" "}
                    {Number.isFinite(displayedRegulatedEnergyShare)
                      ? `${formatNumber(displayedRegulatedEnergyShare, 0)}%`
                      : "No Data"}
                  </p>
                  <p className="text-gray-600">
                    {displayedSplitConfidence}
                  </p>
                  {isNewPerformanceDeepDive ? (
                    <div className="pt-2 mt-2 border-t border-gray-200 space-y-1">
                      <p>
                        <strong>Fabric:</strong> Passivhaus-style retrofit envelope
                      </p>
                      <p>
                        <strong>Heat Source:</strong> Heat pump + solar-ready electric load
                      </p>
                      <p>
                        <strong>Gas Heating:</strong> 0.0000 kWh/day
                      </p>
                    </div>
                  ) : shouldShowGas && energySummary.hasGasData ? (
                    <div className="pt-2 mt-2 border-t border-gray-200 space-y-1">
                      <p>
                        <strong>Gas Baseload:</strong>{" "}
                        {Number.isFinite(gasBaseloadDailyKwh)
                          ? `${formatNumber(gasBaseloadDailyKwh)} kWh/day`
                          : "No Data"}
                      </p>
                      <p>
                        <strong>Gas DHW:</strong>{" "}
                        {Number.isFinite(gasDhwDailyKwh)
                          ? `${formatNumber(gasDhwDailyKwh)} kWh/day`
                          : "No Data"}
                      </p>
                      <p>
                        <strong>Gas Heating:</strong>{" "}
                        {Number.isFinite(gasHeatingDailyKwh)
                          ? `${formatNumber(gasHeatingDailyKwh)} kWh/day`
                          : "No Data"}
                      </p>
                      {Number.isFinite(gasUnregulatedDailyKwh) &&
                      gasUnregulatedDailyKwh > 0 ? (
                        <p>
                          <strong>Gas Unregulated:</strong>{" "}
                          {formatNumber(gasUnregulatedDailyKwh)} kWh/day
                        </p>
                      ) : null}
                      {Number.isFinite(gasAnomalyDailyKwh) &&
                      gasAnomalyDailyKwh > 0 ? (
                        <p>
                          <strong>Gas Events:</strong>{" "}
                          {formatNumber(gasAnomalyDailyKwh)} kWh/day
                        </p>
                      ) : null}
                      {energySummary.gasDhwWindows?.length ? (
                        <p className="text-gray-600">
                          DHW windows: {energySummary.gasDhwWindows.join(", ")}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="space-y-0.5 break-words min-w-0">
                <h3 className="font-semibold mb-2 sm:mb-3">IAQ</h3>
                <div className="space-y-0.5">
                  <p>
                    <strong>Internal Temp:</strong>{" "}
                    {formatMeasurement(displayedSensorData.internalTemp)} deg C
                  </p>
                  <p>
                    <strong>External Temp:</strong>{" "}
                    {formatMeasurement(displayedSensorData.externalTemp)} deg C
                  </p>
                </div>

                <div className="pt-2 mt-2 border-t border-gray-200 space-y-0.5">
                  <p>
                    <strong>Humidity:</strong>{" "}
                    {formatMeasurement(displayedSensorData.humidity)}%
                  </p>
                  {dataSourceBuildingId !== "home" ? (
                    <p>
                      <strong>CO2:</strong> {formatMeasurement(displayedSensorData.co2)} ppm
                    </p>
                  ) : null}
                  <p>
                    <strong>VOCs:</strong> {formatMeasurement(displayedSensorData.vocs)} ppb
                  </p>
                  <p>
                    <strong>PM2.5:</strong> {formatMeasurement(displayedSensorData.pm25)} ug/m3
                  </p>
                  {Number.isFinite(displayedSensorData.pm10) ? (
                    <p>
                      <strong>PM10:</strong> {formatMeasurement(displayedSensorData.pm10)} ug/m3
                    </p>
                  ) : null}
                  {Number.isFinite(displayedSensorData.hcho) ? (
                    <p>
                      <strong>HCHO:</strong> {formatMeasurement(displayedSensorData.hcho)} ppb
                    </p>
                  ) : null}
                  {Number.isFinite(displayedSensorData.no2) ? (
                    <p>
                      <strong>NO2:</strong> {formatMeasurement(displayedSensorData.no2)} ppb
                    </p>
                  ) : null}
                </div>
                {isNewPerformanceDeepDive ? (
                  <div className="pt-3 mt-3 border-t border-gray-200 space-y-0.5">
                    <p>
                      <strong>Ventilation:</strong> MVHR with filtered supply
                    </p>
                    <p>
                      <strong>Overheating:</strong> Summer bypass + shading assumed
                    </p>
                    <p>
                      <strong>IAQ:</strong> Low-emission finishes and continuous extract
                    </p>
                  </div>
                ) : roomIaqData.length > 0 ? (
                  <div className="pt-3 mt-3 border-t border-gray-200 space-y-2">
                    {roomIaqData.map((room, roomIndex) => {
                      const comfortOnlyRoom = room.label === "Downstairs";
                      const roomMetrics = [
                        {
                          label: "Temp",
                          value: room.internalTemp,
                          unit: "deg C",
                        },
                        { label: "RH", value: room.humidity, unit: "%" },
                        ...(comfortOnlyRoom
                          ? []
                          : [
                              { label: "VOC", value: room.vocs, unit: "ppb" },
                              { label: "PM2.5", value: room.pm25, unit: "ug/m3" },
                              { label: "PM10", value: room.pm10, unit: "ug/m3" },
                              { label: "HCHO", value: room.hcho, unit: "ppb" },
                              { label: "NO2", value: room.no2, unit: "ppb" },
                            ]),
                      ].filter((metric) => Number.isFinite(metric.value));

                      return (
                        <div
                          key={room.key}
                          className={`min-w-0 ${
                            roomIndex > 0 ? "border-t border-gray-200 pt-2" : ""
                          }`}
                        >
                          <p className="font-semibold text-gray-800">{room.label}</p>

                          {roomMetrics.length ? (
                            <div className="mt-1 space-y-0.5">
                              {roomMetrics.map((metric) => (
                                <p key={metric.label}>
                                  <strong>
                                    {metric.label}
                                    :
                                  </strong>{" "}
                                  {formatMeasurement(metric.value)} {metric.unit}
                                </p>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-gray-600">No IAQ data</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>

              <div className="space-y-2 sm:space-y-3 break-words min-w-0">
                <h3 className="font-semibold mb-2 sm:mb-3">HLA</h3>
                <div className="space-y-0.5">
                  <p>
                    <strong>Weather-normalised EUI:</strong>{" "}
                    {Number.isFinite(displayedHeatLossSummary.weatherNormalisedEui)
                      ? `${formatNumber(
                          displayedHeatLossSummary.weatherNormalisedEui
                        )} kWh/m2/yr`
                      : "Pending"}
                  </p>
                  <p className={heatLossStatusClass(displayedHddStatus)}>
                    <HeatLossStatusDot status={displayedHddStatus} />{" "}
                    <strong>HDD Intensity:</strong>{" "}
                    {Number.isFinite(displayedHeatLossSummary.kwhPerHdd)
                      ? `${formatNumber(displayedHeatLossSummary.kwhPerHdd, 3)} kWh/HDD`
                      : "Pending completed energy + HDD data"}
                    {!isNewPerformanceDeepDive && hddDataCaveat
                      ? ` (${hddDataCaveat})`
                      : ""}
                  </p>
                  <p className={heatLossStatusClass(displayedHtcStatus)}>
                    <HeatLossStatusDot status={displayedHtcStatus} />{" "}
                    <strong>HTC Estimate:</strong>{" "}
                    {Number.isFinite(displayedHeatLossSummary.htcEstimate)
                      ? `${formatNumber(displayedHeatLossSummary.htcEstimate, 1)} W/K`
                      : "Pending energy + indoor/outdoor temperature overlap"}
                  </p>
                  <p className="pt-2 mt-2 border-t border-gray-200">
                    <strong>HDD / HTC Days:</strong>{" "}
                    {displayedHeatLossSummary.hddDays || 0} /{" "}
                    {displayedHeatLossSummary.htcSamples || 0}
                  </p>
                  <p className="pt-2 mt-2 border-t border-gray-200">
                    <strong>HDD Source:</strong>{" "}
                    {isNewPerformanceDeepDive
                      ? projectedPerformanceDeepDive.hddSource
                      : heatLossSummary.hddSource === "legacy"
                      ? "Legacy museum daily totals"
                      : "Current building data"}
                  </p>
                  {isNewPerformanceDeepDive ? (
                    <p className="text-xs text-gray-600">
                      HLA comfort check: {projectedPerformanceDeepDive.comfortNote}
                    </p>
                  ) : Number.isFinite(heatLossSummary.averageInternalTemp) ||
                  heatLossSummary.flatlineIndoorTemp ? (
                    <p className="text-xs text-gray-600">
                      HLA comfort check:{" "}
                      {Number.isFinite(heatLossSummary.averageInternalTemp)
                        ? `${formatMeasurement(
                            heatLossSummary.averageInternalTemp
                          )} deg C average internal temp`
                        : "No valid internal temperature average"}
                      {heatLossSummary.flatlineIndoorTemp
                        ? " / possible stuck indoor sensor"
                        : ""}
                      {heatLossSummary.filteredInsideReadings > 0
                        ? ` / ignored ${heatLossSummary.filteredInsideReadings} stale 17.6 deg C readings`
                        : ""}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
          )}
        </div>

        {!shouldShowDeepDive ? null : (
        <div className="mt-4 bg-white rounded border p-3 sm:p-4 space-y-3 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold">Seasonal Performance Trends</h3>
              <p className="text-xs text-gray-600">
                Summer chart: historical weekly hourly averages, Monday to Sunday
              </p>
            </div>
            <div className="flex flex-wrap gap-1 text-xs">
              {["Summer", "Autumn", "Winter", "Spring"].map((season) => (
                <span
                  key={season}
                  className={`rounded border px-2 py-1 ${
                    season === "Summer"
                      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                      : "border-gray-200 bg-gray-50 text-gray-500"
                  }`}
                >
                  {season}
                </span>
              ))}
            </div>
          </div>

          {activeTrendMetrics.length > 0 ? (
            <>
              <div className="flex flex-wrap gap-2 text-xs">
                {activeTrendMetricGroups.map((group) => {
                  const groupSelected = selectedTrendMetricGroupKey === group.key;

                  return (
                    <button
                      type="button"
                      key={group.key}
                      onClick={() => selectTrendMetricGroup(group.metricKeys)}
                      className={`rounded border px-3 py-1.5 font-semibold transition ${
                        groupSelected
                          ? "border-blue-600 bg-blue-600 text-white"
                          : "border-gray-300 bg-white text-gray-700"
                      }`}
                    >
                      {group.label}
                    </button>
                  );
                })}
              </div>

              <div className="w-full overflow-x-auto">
                <svg
                  viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                  className="w-full h-auto"
                  preserveAspectRatio="xMidYMid meet"
                  role="img"
                  aria-label="Historical weekly hourly performance trend chart"
                  onPointerMove={updateHoveredTrendSlot}
                  onPointerDown={updateHoveredTrendSlot}
                  onPointerLeave={clearHoveredTrendSlot}
                  style={{ touchAction: "none" }}
                >
                  {[
                    { min: 85, max: 100, color: "#fecaca", label: "+ BAD" },
                    { min: 70, max: 85, color: "#fde68a", label: "+ RISK" },
                    { min: 30, max: 70, color: "#bbf7d0", label: "0 OK" },
                    { min: 15, max: 30, color: "#fde68a", label: "- RISK" },
                    { min: 0, max: 15, color: "#fecaca", label: "- BAD" },
                  ].map((band) => {
                    const yTop = trendY({ min: 0, max: 100 }, band.max);
                    const yBottom = trendY({ min: 0, max: 100 }, band.min);

                    return (
                      <g key={band.label}>
                        <rect
                          x={chartPadding.left}
                          y={Math.min(yTop, yBottom)}
                          width={plotWidth}
                          height={Math.abs(yBottom - yTop)}
                          fill={band.color}
                          opacity="0.34"
                        />
                        <rect
                          x={chartPadding.left}
                          y={Math.min(yTop, yBottom)}
                          width={plotWidth}
                          height={Math.abs(yBottom - yTop)}
                          fill="none"
                          stroke="#ffffff"
                          strokeWidth="1.5"
                          opacity="0.62"
                        />
                        <text
                          x={chartPadding.left + 8}
                          y={Math.min(yTop, yBottom) + 17}
                          fontSize="10"
                          fontWeight="700"
                          fill="#111827"
                          opacity="0.4"
                        >
                          {band.label}
                        </text>
                      </g>
                    );
                  })}
                  {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
                    const y = chartPadding.top + tick * plotHeight;
                    return (
                      <line
                        key={tick}
                        x1={chartPadding.left}
                        x2={chartWidth - chartPadding.right}
                        y1={y}
                        y2={y}
                        stroke="#e5e7eb"
                        strokeWidth="1"
                      />
                    );
                  })}
                  {weeklyTrendData
                    .filter((point) => point.hour === 0)
                    .map((point) => {
                      const x =
                        chartPadding.left +
                        (point.slot / (weeklyTrendData.length - 1)) * plotWidth;
                      return (
                        <line
                          key={`day-line-${point.dayLabel}`}
                          x1={x}
                          x2={x}
                          y1={chartPadding.top}
                          y2={chartPadding.top + plotHeight}
                          stroke="#d1d5db"
                          strokeWidth="1"
                        />
                      );
                    })}
                  {weeklyTrendData
                    .filter((point) => point.hour % 6 === 0)
                    .map((point) => {
                      const x =
                        chartPadding.left +
                        (point.slot / (weeklyTrendData.length - 1)) * plotWidth;
                      return (
                        <line
                          key={`hour-line-${point.slot}`}
                          x1={x}
                          x2={x}
                          y1={chartPadding.top}
                          y2={chartPadding.top + plotHeight}
                          stroke="#f3f4f6"
                          strokeWidth="1"
                        />
                      );
                    })}
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
                    (dayLabel, dayIndex) => {
                      const midpointSlot = dayIndex * 24 + 11.5;
                      const x =
                        chartPadding.left +
                        (midpointSlot / (weeklyTrendData.length - 1)) * plotWidth;
                      return (
                        <text
                          key={dayLabel}
                          x={x}
                          y={chartHeight - 14}
                          textAnchor="middle"
                          fontSize="11"
                          fill="#4b5563"
                        >
                          {dayLabel}
                        </text>
                      );
                    }
                  )}
                  {weeklyTrendData
                    .filter((point) => point.dayIndex === 0 && point.hour % 6 === 0)
                    .map((point) => {
                    const x =
                      chartPadding.left +
                      (point.slot / (weeklyTrendData.length - 1)) * plotWidth;
                    return (
                      <text
                        key={`hour-label-${point.hour}`}
                        x={x}
                        y={chartHeight - 28}
                        textAnchor="middle"
                        fontSize="9"
                        fill="#9ca3af"
                      >
                        {point.hourLabel}
                      </text>
                    );
                  })}
                  {[0, 0.15, 0.3, 0.5, 0.7, 0.85, 1].map((tick) => {
                      const value = 100 - 100 * tick;
                      const y = chartPadding.top + tick * plotHeight;

                      return (
                        <text
                          key={`left-range-${tick}`}
                          x={chartPadding.left - 8}
                          y={y + 3}
                          textAnchor="end"
                          fontSize="9"
                          fill="#374151"
                        >
                          {formatDeviationScore(value)}
                        </text>
                      );
                    })}
                  {visibleTrendMetrics.map((metric) => (
                    <path
                      key={metric.key}
                      d={trendPath(weeklyTrendData, metricRanges, metric)}
                      fill="none"
                      stroke={metric.color}
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ))}
                  {hoveredTrendPoint && Number.isFinite(hoveredTrendX) ? (
                    <g pointerEvents="none">
                      <line
                        x1={hoveredTrendX}
                        x2={hoveredTrendX}
                        y1={chartPadding.top}
                        y2={chartPadding.top + plotHeight}
                        stroke="#111827"
                        strokeWidth="1.5"
                        strokeDasharray="4 3"
                      />
                      {Number.isFinite(hoveredTrendY) ? (
                        <>
                          <line
                            x1={chartPadding.left}
                            x2={hoveredTrendX}
                            y1={hoveredTrendY}
                            y2={hoveredTrendY}
                            stroke="#111827"
                            strokeWidth="1.2"
                            strokeDasharray="4 3"
                          />
                          <text
                            x={chartPadding.left - 8}
                            y={hoveredTrendY + 3}
                            textAnchor="end"
                            fontSize="9"
                            fontWeight="600"
                            fill="#111827"
                          >
                            {hoveredTrendMetric &&
                            Number.isFinite(hoveredTrendPoint?.[hoveredTrendMetric.key])
                              ? formatDeviationScore(
                                  trendHealthScore(
                                    hoveredTrendMetric,
                                    hoveredTrendPoint[hoveredTrendMetric.key]
                                  )
                                )
                              : ""}
                          </text>
                        </>
                      ) : null}
                      <rect
                        x={Math.min(
                          chartWidth - chartPadding.right - 164,
                          Math.max(chartPadding.left, hoveredTrendX + 8)
                        )}
                        y={chartPadding.top + 8}
                        width="156"
                        height={32 + visibleTrendMetrics.length * 16}
                        rx="4"
                        fill="white"
                        stroke="#d1d5db"
                      />
                      <text
                        x={Math.min(
                          chartWidth - chartPadding.right - 154,
                          Math.max(chartPadding.left + 10, hoveredTrendX + 18)
                        )}
                        y={chartPadding.top + 27}
                        fontSize="11"
                        fontWeight="600"
                        fill="#111827"
                      >
                        {hoveredTrendPoint.label}
                      </text>
                      {visibleTrendMetrics.map((metric, index) => {
                        const value = hoveredTrendPoint[metric.key];
                        const y = chartPadding.top + 46 + index * 16;
                        const x = Math.min(
                          chartWidth - chartPadding.right - 154,
                          Math.max(chartPadding.left + 10, hoveredTrendX + 18)
                        );

                        return (
                          <g key={`hover-${metric.key}`}>
                            <circle
                              cx={x + 4}
                              cy={y - 4}
                              r="3"
                              fill={metric.color}
                            />
                            <text x={x + 12} y={y} fontSize="10" fill="#374151">
                              {metric.label}:{" "}
                              {Number.isFinite(value)
                                ? `${formatMeasurement(value)} ${metric.unit}`
                                : "No Data"}
                            </text>
                          </g>
                        );
                      })}
                    </g>
                  ) : null}
                  <rect
                    x={chartPadding.left}
                    y={chartPadding.top}
                    width={plotWidth}
                    height={plotHeight}
                    fill="transparent"
                  />
                </svg>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-xs">
                {activeTrendMetrics.map((metric) => {
                  const averageValue = averageMetricValue(weeklyTrendData, metric);
                  const metricSelected =
                    selectedTrendMetricKeys.length === 0 ||
                    selectedTrendMetricKeys.includes(metric.key);
                  return (
                    <button
                      type="button"
                      key={metric.key}
                      onClick={() => toggleTrendMetric(metric.key)}
                      className={`flex items-center justify-between gap-2 rounded border px-2 py-1 text-left transition ${
                        metricSelected
                          ? "border-gray-300 bg-white shadow-sm"
                          : "border-gray-200 bg-gray-50 text-gray-400 opacity-70"
                      }`}
                    >
                      <span className="flex items-center gap-1">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{
                            backgroundColor: metricSelected
                              ? metric.color
                              : "#d1d5db",
                          }}
                        />
                        {metric.label}
                      </span>
                      <span className="font-semibold">
                        {Number.isFinite(averageValue)
                          ? `${formatMeasurement(averageValue)} ${metric.unit}`
                          : "No Data"}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-gray-600">
                Lines are plotted on a shared deviation scale: 0 is good/fine,
                positive values are drifting high, and negative values are
                drifting low. Hover values still show the original units.
              </p>
            </>
          ) : (
            <div className="rounded border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
              Weekly trend data will appear once energy or IAQ readings are available.
            </div>
          )}
        </div>
        )}

        {!shouldShowDeepDive ? null : (
        <div className="mt-4 bg-white rounded border p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold">Carbon Evidence Readiness</h3>
              <p className="text-xs text-gray-600">
                {nextCarbonEvidenceStep
                  ? `Next: ${nextCarbonEvidenceStep.label}`
                  : "Ready for token activation"}
              </p>
            </div>
            <p className="text-sm font-semibold">
              {carbonEvidenceCompleteCount}/{carbonEvidenceSteps.length} complete
            </p>
          </div>

          <div className="h-3 rounded bg-gray-200 overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all"
              style={{ width: `${carbonEvidenceProgress}%` }}
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-xs">
            {carbonEvidenceSteps.map((step) => (
              <div
                key={step.label}
                className={`rounded border p-2 ${
                  step.complete
                    ? "border-blue-200 bg-blue-50 text-blue-900"
                    : "border-gray-200 bg-gray-50 text-gray-600"
                }`}
              >
                <span className="font-semibold">
                  {step.complete ? "Complete" : "Pending"}
                </span>
                <br />
                {step.label}
              </div>
            ))}
          </div>
        </div>
        )}
      </div>

      <div className="bg-gray-100 p-4 rounded shadow">
        <h2 className="text-lg font-bold mb-3">WBPA Carbon Token</h2>

        <div
          className={`bg-white rounded border p-4 space-y-3 transition-opacity ${
            carbonTokenUnlocked ? "opacity-100" : "opacity-45"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p>
              <strong>{formatNumber(carbonCredits, 4)}</strong> WBPA-C
            </p>
            <span
              className={`rounded border px-2 py-1 text-xs font-semibold ${
                carbonTokenUnlocked
                  ? "border-green-300 bg-green-50 text-green-800"
                  : "border-gray-300 bg-gray-50 text-gray-600"
              }`}
            >
              {carbonTokenUnlocked ? "Unlocked" : "Locked"}
            </span>
          </div>

          <p className="text-sm text-gray-600">
            {carbonTokenUnlocked
              ? "Credit-grade evidence is ready for token design and issuance rules."
              : "Complete carbon evidence readiness before tokenised savings can become active."}
          </p>
          <div className="grid gap-2 text-xs text-gray-600 sm:grid-cols-2">
            <p>
              <strong>Total saved:</strong>{" "}
              {Number.isFinite(carbonSavingsSummary.totalSavedKgCo2e)
                ? `${formatNumber(carbonSavingsSummary.totalSavedKgCo2e, 2)} kgCO2e`
                : "Pending calculation"}
            </p>
            <p>
              <strong>Estimated value:</strong>{" "}
              {Number.isFinite(carbonMarketValue)
                ? formatCurrency(carbonMarketValue)
                : "Pending price"}
            </p>
            <p>
              <strong>Carbon price:</strong>{" "}
              {Number.isFinite(carbonMarketPrice.gbpPerTonne)
                ? `${formatCurrency(carbonMarketPrice.gbpPerTonne)}/tCO2e`
                : "Pending"}
              <br />
              <span className="text-[10px] text-gray-500">
                {carbonMarketPrice.live ? "Live" : "Fallback"} -{" "}
                {carbonMarketPrice.source}
              </span>
            </p>
            <p>
              <strong>Latest day:</strong>{" "}
              {carbonSavingsSummary.latestDate &&
              Number.isFinite(carbonSavingsSummary.latestSavedKgCo2e)
                ? `${carbonSavingsSummary.latestDate}: ${formatNumber(
                    carbonSavingsSummary.latestSavedKgCo2e,
                    2
                  )} kgCO2e`
                : "Pending calculation"}
            </p>
          </div>

          <button
            type="button"
            disabled={!carbonTokenUnlocked}
            className={`px-4 py-2 w-36 rounded text-white ${
              carbonTokenUnlocked
                ? "bg-red-500"
                : "bg-gray-400 cursor-not-allowed"
            }`}
          >
            SELL CREDITS
          </button>
        </div>
      </div>
    </div>
  );
};

const NewBuildingSetupPanel = () => {
  const [setupMode, setSetupMode] = useState("api");
  const [apiDetails, setApiDetails] = useState("");
  const [modelInput, setModelInput] = useState("");
  const [manualData, setManualData] = useState({
    address: "",
    latitude: "",
    longitude: "",
    internalArea: "",
  });
  const [energyConsent, setEnergyConsent] = useState(false);
  const [historicalDataFileName, setHistoricalDataFileName] = useState("");

  const modelId = useMemo(() => extractMatterportModelId(modelInput), [modelInput]);
  const modelUrl = useMemo(() => normalizeMatterportUrl(modelInput), [modelInput]);
  const embedUrl = useMemo(() => buildMatterportEmbedUrl(modelInput), [modelInput]);
  const hasManualBuildingInput =
    manualData.address ||
    manualData.latitude ||
    manualData.longitude ||
    manualData.internalArea;
  const hasCompleteBuildingProfile = Boolean(
    apiDetails ||
      (manualData.address &&
        manualData.latitude &&
        manualData.longitude &&
        manualData.internalArea)
  );
  const hasWeatherAndArea = Boolean(
    apiDetails ||
      (manualData.latitude && manualData.longitude && manualData.internalArea)
  );
  const baselineReadinessSteps = [
    { label: "Building profile", complete: hasCompleteBuildingProfile },
    { label: "Energy consent", complete: energyConsent },
    { label: "13-month energy history", complete: Boolean(historicalDataFileName) },
    { label: "Weather/GIA ready", complete: hasWeatherAndArea },
    { label: "IAQ monitoring started", complete: false },
    { label: "Baseline locked", complete: false },
  ];
  const baselineCompleteCount = baselineReadinessSteps.filter(
    (step) => step.complete
  ).length;
  const baselineProgress = Math.round(
    (baselineCompleteCount / baselineReadinessSteps.length) * 100
  );
  const nextBaselineStep = baselineReadinessSteps.find((step) => !step.complete);

  const handleManualChange = (field, value) => {
    setManualData((current) => ({
      ...current,
      [field]: value,
    }));
  };

  return (
    <div className="min-h-screen bg-white p-4 flex flex-col space-y-6">
      <div className="bg-gray-100 p-4 rounded shadow">
        <h2 className="text-lg font-bold mb-3">New Building</h2>

        <div className="mx-auto max-w-3xl bg-white rounded border p-4 space-y-3">
          <h3 className="text-base font-semibold text-center">Matterport Data</h3>

          {setupMode === "api" ? (
            <textarea
              className="border p-3 w-full min-h-[110px] text-sm"
              value={apiDetails}
              onChange={(event) => setApiDetails(event.target.value)}
              placeholder="Paste Matterport SDK / API details when available"
            />
          ) : null}

          <div className="flex flex-wrap gap-2 justify-center">
            <button
              type="button"
              className={`px-3 py-2 rounded border text-sm font-semibold ${
                setupMode === "api" ? "bg-blue-600 text-white" : "bg-white"
              }`}
              onClick={() => setSetupMode("api")}
            >
              Use SDK / API details
            </button>
            <button
              type="button"
              className={`px-3 py-2 rounded border text-sm font-semibold ${
                setupMode === "manual" ? "bg-blue-600 text-white" : "bg-white"
              }`}
              onClick={() => setSetupMode("manual")}
            >
              No SDK / API details
            </button>
          </div>

          {setupMode === "manual" ? (
            <div className="grid gap-2">
              <input
                type="text"
                className="border p-2 w-full text-sm"
                value={modelInput}
                onChange={(event) => setModelInput(event.target.value)}
                placeholder="Model URL"
              />
              <input
                type="text"
                className="border p-2 w-full text-sm"
                value={modelId || modelInput}
                onChange={(event) => setModelInput(event.target.value)}
                placeholder="Model number"
              />
              <div className="text-xs bg-gray-50 border rounded p-2 break-all">
                <strong>Model URL:</strong> {modelUrl || "Pending"}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {setupMode === "api" && apiDetails ? (
        <div className="bg-gray-100 p-4 rounded shadow">
          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_360px]">
            <div className="bg-white rounded border p-3">
              <h3 className="font-semibold mb-2">Building Input</h3>
              <p className="text-sm text-gray-600">
                SDK/API parsing is ready for integration. Once connected, this
                section will be populated from the Matterport account/model
                response.
              </p>
            </div>

            <div className="bg-white rounded border p-3">
              <h3 className="font-semibold mb-2">Model Preview</h3>
              <div className="h-[220px] border rounded flex items-center justify-center text-sm text-gray-500 text-center p-4">
                Waiting for API-backed model URL.
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {setupMode === "manual" ? (
        <div className="bg-gray-100 p-4 rounded shadow">
          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_360px] items-start">
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="bg-white rounded border p-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">
                    Address
                  </p>
                  <input
                    type="text"
                    className="border p-2 w-full text-sm mt-2"
                    value={manualData.address}
                    onChange={(event) =>
                      handleManualChange("address", event.target.value)
                    }
                    placeholder="Building address"
                  />
                </div>

                <div className="bg-white rounded border p-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">
                    Coordinates
                  </p>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <input
                      type="number"
                      className="border p-2 w-full text-sm"
                      value={manualData.latitude}
                      onChange={(event) =>
                        handleManualChange("latitude", event.target.value)
                      }
                      placeholder="Lat"
                    />
                    <input
                      type="number"
                      className="border p-2 w-full text-sm"
                      value={manualData.longitude}
                      onChange={(event) =>
                        handleManualChange("longitude", event.target.value)
                      }
                      placeholder="Long"
                    />
                  </div>
                </div>

                <div className="bg-white rounded border p-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">
                    Internal Area
                  </p>
                  <input
                    type="number"
                    className="border p-2 w-full text-sm mt-2"
                    value={manualData.internalArea}
                    onChange={(event) =>
                      handleManualChange("internalArea", event.target.value)
                    }
                    placeholder="m2"
                  />
                </div>
              </div>

              {hasManualBuildingInput ? (
                <div className="bg-white rounded border p-3 text-sm">
                  <h3 className="font-semibold mb-2">Current Building Input</h3>
                  <p>
                    <strong>Address:</strong> {manualData.address || "Pending"}
                  </p>
                  <p>
                    <strong>Coordinates:</strong>{" "}
                    {manualData.latitude || "--"}, {manualData.longitude || "--"}
                  </p>
                  <p>
                    <strong>Internal Area:</strong>{" "}
                    {manualData.internalArea
                      ? `${manualData.internalArea} m2`
                      : "Pending"}
                  </p>
                </div>
              ) : null}
            </div>

            <div className="space-y-2 bg-white rounded border p-3">
              <h3 className="font-semibold">Model Preview</h3>
              {embedUrl ? (
                <iframe
                  title="New Matterport model"
                  src={embedUrl}
                  className="w-full h-[190px] min-[390px]:h-[220px] sm:h-[250px] border rounded bg-white"
                  allow="autoplay; fullscreen; xr-spatial-tracking; accelerometer; gyroscope; vr"
                  allowFullScreen
                />
              ) : (
                <div className="w-full h-[190px] min-[390px]:h-[220px] sm:h-[250px] border rounded bg-white flex items-center justify-center text-gray-500 text-sm p-4 text-center">
                  Enter a model URL or model number to preview it here.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <div className="bg-gray-100 p-4 rounded shadow">
        <h2 className="text-lg font-bold mb-3">Performance</h2>
        <div className="grid gap-4 md:grid-cols-2 items-start">
          <div className="bg-white rounded border p-4 space-y-4">
            <div>
              <h3 className="font-semibold mb-2">Energy Data</h3>
              <p className="text-sm text-gray-600">
                Import historical smart-meter data to set the carbon baseline,
                calculate daily averages, annualised EUI, HDD intensity and future
                regulated/unregulated splits.
              </p>
            </div>

            <div className="border rounded p-3 bg-gray-50 space-y-3">
              <div>
                <h4 className="font-semibold text-sm">n3rgy Registration Mock</h4>
                <p className="text-xs text-gray-600">
                  Capture the consent and meter identifiers needed before importing
                  half-hourly smart-meter history.
                </p>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  type="text"
                  className="border rounded p-2 w-full text-xs"
                  placeholder="MPAN / MPRN"
                />
                <input
                  type="text"
                  className="border rounded p-2 w-full text-xs"
                  placeholder="IHD MAC / Device ID"
                />
                <input
                  type="text"
                  className="border rounded p-2 w-full text-xs"
                  placeholder="House number or name"
                />
                <input
                  type="text"
                  className="border rounded p-2 w-full text-xs"
                  placeholder="Postcode"
                />
                <input
                  type="date"
                  className="border rounded p-2 w-full text-xs"
                  aria-label="Historical data start date"
                />
                <select
                  className="border rounded p-2 w-full text-xs"
                  defaultValue="half-hourly"
                >
                  <option value="half-hourly">Half-hourly consumption</option>
                  <option value="daily">Daily consumption</option>
                  <option value="inventory">Meter inventory check</option>
                </select>
              </div>

              <label className="flex items-start gap-2 text-xs text-gray-700">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={energyConsent}
                  onChange={(event) => setEnergyConsent(event.target.checked)}
                />
                <span>
                  Customer has given consent for WBPAI to retrieve historical smart-meter
                  data for this building profile.
                </span>
              </label>

              <button
                type="button"
                className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-semibold"
              >
                Register Data Access
              </button>
            </div>

            <div className="border rounded p-3 bg-gray-50 space-y-2">
              <h4 className="font-semibold text-sm">Energy Bill / Tariff Evidence Upload</h4>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.csv,.xlsx,.xls,application/pdf,image/*,text/csv"
                className="block w-full text-xs"
                onChange={(event) =>
                  setHistoricalDataFileName(event.target.files?.[0]?.name || "")
                }
              />
              {historicalDataFileName ? (
                <p className="text-xs text-gray-700">
                  Selected: {historicalDataFileName}
                </p>
              ) : null}
              <p className="text-xs text-gray-600">
                Upload bills, tariff documents, green tariff evidence or non-smart-meter
                meter-read histories. Half-hourly consumption should come through
                the n3rgy/API registration path where available.
              </p>
            </div>

          </div>

          <div className="bg-white rounded border p-4 space-y-4">
            <div>
              <h3 className="font-semibold mb-2">Health Data</h3>
              <p className="text-sm text-gray-600">
                Scan for a preferred IAQ monitor to connect comfort and air quality
                readings for health scoring, seasonal resilience and HTC overlap.
              </p>
            </div>

            <div className="border rounded p-3 bg-gray-50 space-y-3">
              <div>
                <h4 className="font-semibold text-sm">IAQ Monitor Scan</h4>
                <p className="text-xs text-gray-600">
                  Future setup step for supported CO2, PM2.5, VOC, temperature and
                  humidity monitors.
                </p>
              </div>
              <button
                type="button"
                className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-semibold"
              >
                Scan Now
              </button>
              <div className="text-xs border rounded bg-white p-2 text-gray-600">
                Status: waiting for supported IAQ monitor integration
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 bg-white rounded border p-4 space-y-4">
          <div>
            <h3 className="font-semibold mb-2">Carbon Context</h3>
            <p className="text-sm text-gray-600">
              Record the tariff, fuel and building systems context used to calculate
              operational carbon and assess whether future savings are credit-grade.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="space-y-1 text-xs text-gray-600">
              Electricity tariff
              <select
                className="border rounded p-2 w-full text-xs"
                defaultValue="unknown"
              >
                <option value="unknown">Unknown / not verified</option>
                <option value="standard">Standard grid electricity</option>
                <option value="renewable-unverified">Renewable tariff - unverified</option>
                <option value="renewable-verified">Renewable tariff - evidence uploaded</option>
              </select>
            </label>

            <label className="space-y-1 text-xs text-gray-600">
              Gas / thermal fuel
              <select
                className="border rounded p-2 w-full text-xs"
                defaultValue="unknown"
              >
                <option value="unknown">Unknown / not verified</option>
                <option value="mains-gas">Mains gas</option>
                <option value="green-gas-unverified">Green gas - unverified</option>
                <option value="green-gas-verified">Green gas - evidence uploaded</option>
                <option value="none">No gas supply</option>
                <option value="other">Oil / LPG / solid fuel / other</option>
              </select>
            </label>

            <label className="space-y-1 text-xs text-gray-600">
              Main heating system
              <select
                className="border rounded p-2 w-full text-xs"
                defaultValue="unknown"
              >
                <option value="unknown">Unknown</option>
                <option value="gas-boiler">Gas boiler</option>
                <option value="heat-pump">Heat pump</option>
                <option value="direct-electric">Direct electric</option>
                <option value="hybrid">Hybrid heating</option>
                <option value="other">Other</option>
              </select>
            </label>

            <label className="space-y-1 text-xs text-gray-600">
              Solar PV
              <select
                className="border rounded p-2 w-full text-xs"
                defaultValue="none"
              >
                <option value="none">No / unknown</option>
                <option value="planned">Planned</option>
                <option value="installed-unverified">Installed - unverified</option>
                <option value="installed-verified">Installed - evidence uploaded</option>
              </select>
            </label>

            <label className="space-y-1 text-xs text-gray-600">
              Battery storage
              <select
                className="border rounded p-2 w-full text-xs"
                defaultValue="none"
              >
                <option value="none">No / unknown</option>
                <option value="planned">Planned</option>
                <option value="installed-unverified">Installed - unverified</option>
                <option value="installed-verified">Installed - evidence uploaded</option>
              </select>
            </label>

            <label className="space-y-1 text-xs text-gray-600">
              Carbon evidence status
              <select
                className="border rounded p-2 w-full text-xs"
                defaultValue="unverified"
              >
                <option value="unverified">Unverified user declaration</option>
                <option value="bill-uploaded">Bill/tariff evidence uploaded</option>
                <option value="api-verified">API / supplier verified</option>
                <option value="audit-ready">Audit-ready evidence pack</option>
              </select>
            </label>
          </div>

          <p className="text-xs text-gray-600">
            Tariff and system details can reduce reported carbon intensity when verified,
            but they do not bypass the measured energy, IAQ and seasonal evidence checks.
          </p>
        </div>
        <div className="mt-4 bg-white rounded border p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold">Baseline Readiness</h3>
              <p className="text-xs text-gray-600">
                {nextBaselineStep
                  ? `Next: ${nextBaselineStep.label}`
                  : "Ready to lock baseline"}
              </p>
            </div>
            <p className="text-sm font-semibold">
              {baselineCompleteCount}/{baselineReadinessSteps.length} complete
            </p>
          </div>

          <div className="h-3 rounded bg-gray-200 overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all"
              style={{ width: `${baselineProgress}%` }}
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6 text-xs">
            {baselineReadinessSteps.map((step) => (
              <div
                key={step.label}
                className={`rounded border p-2 ${
                  step.complete
                    ? "border-blue-200 bg-blue-50 text-blue-900"
                    : "border-gray-200 bg-gray-50 text-gray-600"
                }`}
              >
                <span className="font-semibold">
                  {step.complete ? "Complete" : "Pending"}
                </span>
                <br />
                {step.label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const BuildingDashboard = () => {
  const defaultIndex = BUILDINGS.findIndex((building) => building.id === "cc");
  const [activeIndex, setActiveIndex] = useState(defaultIndex >= 0 ? defaultIndex : 0);
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
              {building.setupOnly ? (
                <NewBuildingSetupPanel />
              ) : (
                <BuildingDashboardPanel building={building} />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default BuildingDashboard;

