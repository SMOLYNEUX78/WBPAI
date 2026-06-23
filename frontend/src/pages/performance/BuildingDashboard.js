import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import AnalogGauge from "../../components/AnalogGauge";
import supabase from "../../supabaseClient";

const DEFAULT_MATTERPORT_URL = "https://my.matterport.com/show/?m=zHm8SwWeHiN";
const HDD_BASE_TEMP_C = 15.5;
const FALLBACK_CARBON_PRICE_GBP_PER_TONNE = 65;
const ELECTRICITY_PRICE_GBP_PER_KWH = 0.245;
const GAS_PRICE_GBP_PER_KWH = 0.06;
const ELECTRICITY_KGCO2E_PER_KWH = 0.20705;
const GAS_KGCO2E_PER_KWH = 0.18254;
const MIN_BASELINE_METERED_DAYS = 7;
const MIN_BASELINE_HDD_DAYS = 14;
const MIN_SEASONAL_BASELINE_DAYS = 90;
const MIN_FULL_YEAR_BASELINE_DAYS = 365;
const MIN_FULL_YEAR_METERED_DAYS = 300;

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
  const [activeMrvEvidenceField, setActiveMrvEvidenceField] = useState(null);
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
  const defaultEnergySummary = {
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
    baselineMeteredDays: 0,
    baselineStartDate: null,
    baselineEndDate: null,
  };
  const defaultCarbonSavingsSummary = {
    latestDate: null,
    latestSavedKgCo2e: null,
    totalSavedKgCo2e: null,
  };
  const defaultCarbonIntervalSavingsSummary = {
    latestTimestamp: null,
    latestSavedKgCo2e: null,
    totalSavedKgCo2e: null,
    totalSavedKwh: null,
    energyCostSavedGbp: null,
    carbonCredits: null,
  };
  const defaultMrvEvidence = {
    baselineStartDate: "",
    baselineEndDate: "",
    baselineLocked: false,
    interventionDate: "",
    interventionEvidence: "",
    ownershipConsent: false,
    ownershipRecordReference: "",
    ownershipRecordFileName: "",
    verifierName: "",
    verifierStatus: "pre-verification",
  };
  const readCachedEnergySummary = () =>
    readCachedDashboardState(
      `${dataSourceBuildingId}:energySummary`,
      defaultEnergySummary
    );
  const readCachedCarbonSavingsSummary = () =>
    readCachedDashboardState(
      `${dataSourceBuildingId}:carbonSavingsSummary`,
      defaultCarbonSavingsSummary
    );
  const readCachedCarbonIntervalSavingsSummary = () =>
    readCachedDashboardState(
      `${dataSourceBuildingId}:carbonIntervalSavingsSummary`,
      defaultCarbonIntervalSavingsSummary
    );
  const readCachedWeeklyTrendData = () =>
    readCachedDashboardState(`${dataSourceBuildingId}:weeklyTrendData`, []);
  const readCachedMrvEvidence = () =>
    readCachedDashboardState(
      `${dataSourceBuildingId}:mrvEvidence`,
      defaultMrvEvidence
    );
  const [sensorData, setSensorData] = useState(() =>
    readCachedDashboardState(`${dataSourceBuildingId}:latestIaq`, defaultSensorData)
  );
  const [roomIaqData, setRoomIaqData] = useState(() =>
    readCachedDashboardState(`${dataSourceBuildingId}:roomIaq`, [])
  );
  const supportsExtendedIaqColumns = useRef(true);

  const [performanceValue, setPerformanceValue] = useState(null);
  const [historicalPerformance, setHistoricalPerformance] = useState(() => {
    const cachedEnergySummary = readCachedEnergySummary();
    return Number.isFinite(cachedEnergySummary.totalDailyAverage)
      ? cachedEnergySummary.totalDailyAverage
      : null;
  });
  const [carbonIntervalSavingsSummary, setCarbonIntervalSavingsSummary] = useState(
    readCachedCarbonIntervalSavingsSummary
  );
  const [carbonCredits, setCarbonCredits] = useState(() => {
    const cachedIntervalSummary = readCachedCarbonIntervalSavingsSummary();
    return Number.isFinite(cachedIntervalSummary.carbonCredits)
      ? cachedIntervalSummary.carbonCredits
      : 0;
  });
  const [, setCarbonSavingsSummary] = useState(
    readCachedCarbonSavingsSummary
  );
  const [carbonMarketPrice, setCarbonMarketPrice] = useState({
    gbpPerTonne: FALLBACK_CARBON_PRICE_GBP_PER_TONNE,
    source: "Estimated UK/EU carbon allowance price",
    updatedAt: null,
    live: false,
  });
  const [mrvEvidence, setMrvEvidence] = useState(readCachedMrvEvidence);
  const [energySummary, setEnergySummary] = useState(readCachedEnergySummary);

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
    hlaConfidence: "pending",
    auditKwhPerHdd: null,
    auditHtcEstimate: null,
    averageInternalTemp: null,
    comfortHddDays: 0,
    flatlineIndoorTemp: false,
    filteredInsideReadings: 0,
  });
  const [weeklyTrendData, setWeeklyTrendData] = useState(readCachedWeeklyTrendData);
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

  const dysonAppDisplayValue = (readingType, metric, value) => {
    const numericValue = numericOrNull(value);

    if (!String(readingType || "").startsWith("dyson:") || numericValue === null) {
      return numericValue;
    }

    if (metric === "vocs" && numericValue <= 10) {
      return 0;
    }

    if (metric === "no2" && numericValue <= 2) {
      return 0;
    }

    return numericValue;
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

  const applyEnergySummary = (nextEnergySummary, nextHistoricalPerformance) => {
    setEnergySummary(nextEnergySummary);
    setHistoricalPerformance(nextHistoricalPerformance);
    localStorage.setItem(
      `${dataSourceBuildingId}:energySummary`,
      JSON.stringify(nextEnergySummary)
    );
  };
  const applyCarbonSavingsSummary = (nextCarbonSavingsSummary) => {
    setCarbonSavingsSummary(nextCarbonSavingsSummary);
    localStorage.setItem(
      `${dataSourceBuildingId}:carbonSavingsSummary`,
      JSON.stringify(nextCarbonSavingsSummary)
    );
  };
  const applyCarbonIntervalSavingsSummary = (
    nextCarbonIntervalSavingsSummary
  ) => {
    setCarbonIntervalSavingsSummary(nextCarbonIntervalSavingsSummary);
    localStorage.setItem(
      `${dataSourceBuildingId}:carbonIntervalSavingsSummary`,
      JSON.stringify(nextCarbonIntervalSavingsSummary)
    );
  };
  const applyWeeklyTrendData = (nextWeeklyTrendData) => {
    setWeeklyTrendData(nextWeeklyTrendData);
    localStorage.setItem(
      `${dataSourceBuildingId}:weeklyTrendData`,
      JSON.stringify(nextWeeklyTrendData)
    );
  };
  const updateMrvEvidence = (updates) => {
    setMrvEvidence((currentEvidence) => {
      const nextEvidence = { ...currentEvidence, ...updates };
      localStorage.setItem(
        `${dataSourceBuildingId}:mrvEvidence`,
        JSON.stringify(nextEvidence)
      );
      return nextEvidence;
    });
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
        const completedBaselineDays = Object.keys(completedDailyTotalsByDay).sort();
        const baselineMeteredDays = completedBaselineDays.length;
        const baselineStartDate = completedBaselineDays[0] || null;
        const baselineEndDate =
          completedBaselineDays[completedBaselineDays.length - 1] || null;

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

        applyEnergySummary({
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
          baselineMeteredDays,
          baselineStartDate,
          baselineEndDate,
        }, totalDailyAverage);
        return;
      }

      if (!building.legacyUnscopedData) {
        applyEnergySummary(defaultEnergySummary, null);
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

        applyEnergySummary({
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
          baselineMeteredDays: validEntries.length,
          baselineStartDate: null,
          baselineEndDate: null,
        }, electricityDailyAverage);
      }
    } catch (err) {
      console.error("Error fetching historical performance:", err.message);
    }
  };

  const fetchHeatLossSummary = async () => {
    try {
      const area = Number(matterportMetadata.internalArea);
      const completedRows = await fetchEnergyDailyTotals({ beforeToday: true });
      const { data: indoorTemperatureRows, error: indoorTemperatureError } =
        await applyBuildingScope(
          supabase
            .from("Readings")
            .select("timestamp, temperature_inside")
            .not("temperature_inside", "is", null)
            .order("timestamp", { ascending: false })
            .limit(10000)
        );
      const { data: outdoorTemperatureRows, error: outdoorTemperatureError } =
        await applyBuildingScope(
          supabase
            .from("Readings")
            .select("timestamp, temperature_outside")
            .not("temperature_outside", "is", null)
            .order("timestamp", { ascending: false })
            .limit(10000)
        );

      if (indoorTemperatureError) throw indoorTemperatureError;
      if (outdoorTemperatureError) throw outdoorTemperatureError;

      const todayKey = new Date().toISOString().slice(0, 10);
      const now = new Date();
      const elapsedHoursToday = Math.max(
        0.5,
        Math.min(
          24,
          (now - new Date(`${todayKey}T00:00:00.000Z`)) / (1000 * 60 * 60)
        )
      );
      const indicativeEnergyRows = [];
      const indicativePageSize = 1000;
      const indicativeMaxPages = 40;

      for (let page = 0; page < indicativeMaxPages; page += 1) {
        const { data, error } = await supabase
          .from("EnergyReadings")
          .select(
            "timestamp, fuel_type, reading_type, usage_kwh, raw_payload, source"
          )
          .eq("building_id", dataSourceBuildingId)
          .in("reading_type", ["daily_total", "interval_30m"])
          .not("usage_kwh", "is", null)
          .gte("timestamp", "2024-01-01")
          .lte("timestamp", new Date().toISOString())
          .order("timestamp", { ascending: false })
          .range(
            page * indicativePageSize,
            (page + 1) * indicativePageSize - 1
          );

        if (error) throw error;

        indicativeEnergyRows.push(...(data || []));

        if (!data || data.length < indicativePageSize) {
          break;
        }
      }

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

      const dailyTemperatures = {};
      (indoorTemperatureRows || []).forEach((row) => {
        const day = new Date(row.timestamp).toISOString().slice(0, 10);
        dailyTemperatures[day] = dailyTemperatures[day] || {
          inside: [],
          outside: [],
        };

        const inside = Number(row.temperature_inside);
        const isKnownStuckMuseumInsideReading =
          dataSourceBuildingId === "museum" && Math.abs(inside - 17.6) < 0.05;

        if (
          Number.isFinite(inside) &&
          inside !== 0 &&
          !isKnownStuckMuseumInsideReading
        ) {
          dailyTemperatures[day].inside.push(inside);
        }
      });

      (outdoorTemperatureRows || []).forEach((row) => {
        const day = new Date(row.timestamp).toISOString().slice(0, 10);
        dailyTemperatures[day] = dailyTemperatures[day] || {
          inside: [],
          outside: [],
        };
        const outside = Number(row.temperature_outside);
        if (Number.isFinite(outside) && outside !== 0) {
          dailyTemperatures[day].outside.push(outside);
        }
      });

      const calculateHeatLossFromDailyEnergy = (energyByDay) => {
        let nextHddTotal = 0;
        let nextHddEnergyTotal = 0;
        let nextHtcTotal = 0;
        let nextHddDays = 0;
        let nextHtcSamples = 0;
        let nextComfortHddDays = 0;
        const nextInsideAverages = [];
        let nextUsesLegacyMuseumEnergy = false;

        Object.entries(energyByDay).forEach(([day, dayEnergy]) => {
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
            nextHddTotal += hdd;
            nextHddEnergyTotal += totalKwh;
            nextHddDays += 1;

            if (Number.isFinite(insideAverage)) {
              nextInsideAverages.push(insideAverage);
              if (insideAverage >= 18) {
                nextComfortHddDays += 1;
              }
            }
          }

          if (dayEnergy.usesLegacy) {
            nextUsesLegacyMuseumEnergy = true;
          }

          if (
            Number.isFinite(insideAverage) &&
            Number.isFinite(outsideAverage) &&
            insideAverage > outsideAverage &&
            totalKwh > 0
          ) {
            const sampleHours =
              Number.isFinite(dayEnergy.hours) && dayEnergy.hours > 0
                ? dayEnergy.hours
                : 24;
            const averagePowerWatts = (totalKwh * 1000) / sampleHours;
            nextHtcTotal += averagePowerWatts / (insideAverage - outsideAverage);
            nextHtcSamples += 1;
          }
        });

        const nextKwhPerHdd =
          nextHddTotal > 0 ? nextHddEnergyTotal / nextHddTotal : null;
        const nextAnnualHddEstimate =
          nextHddDays > 0 ? (nextHddTotal / nextHddDays) * 365 : null;
        const nextWeatherNormalisedEui =
          Number.isFinite(nextKwhPerHdd) &&
          Number.isFinite(nextAnnualHddEstimate) &&
          Number.isFinite(area) &&
          area > 0
            ? (nextKwhPerHdd * nextAnnualHddEstimate) / area
            : null;

        return {
          kwhPerHdd: nextKwhPerHdd,
          weatherNormalisedEui: nextWeatherNormalisedEui,
          htcEstimate:
            nextHtcSamples > 0 ? nextHtcTotal / nextHtcSamples : null,
          hddDays: nextHddDays,
          htcSamples: nextHtcSamples,
          comfortHddDays: nextComfortHddDays,
          averageInternalTemp: nextInsideAverages.length
            ? average(nextInsideAverages)
            : null,
          hddSource: nextUsesLegacyMuseumEnergy ? "legacy" : "current",
        };
      };

      let filteredInsideReadings = 0;

      const auditHeatLoss = calculateHeatLossFromDailyEnergy(dailyEnergy);
      const indicativeIntervalDays = new Set();
      const indicativeDailyEnergy = {};

      indicativeEnergyRows
        .filter((row) => row.reading_type === "interval_30m")
        .forEach((row) => {
          const date = new Date(row.timestamp);
          if (Number.isNaN(date.getTime())) {
            return;
          }

          const day = date.toISOString().slice(0, 10);
          const fuelType = row.fuel_type || "unknown";
          const usageKwh = Number(row.usage_kwh);

          if (!Number.isFinite(usageKwh)) {
            return;
          }

          indicativeIntervalDays.add(`${fuelType}:${day}`);
          indicativeDailyEnergy[day] = indicativeDailyEnergy[day] || {
            fuels: {},
            hdd: null,
            usesLegacy: false,
            hours: 0,
          };
          indicativeDailyEnergy[day].fuels[fuelType] =
            (indicativeDailyEnergy[day].fuels[fuelType] || 0) + usageKwh;
          indicativeDailyEnergy[day].hours = Math.min(
            24,
            (indicativeDailyEnergy[day].hours || 0) + 0.5
          );
        });

      indicativeEnergyRows
        .filter((row) => row.reading_type === "daily_total")
        .forEach((row) => {
          const date = new Date(row.timestamp);
          if (Number.isNaN(date.getTime())) {
            return;
          }

          const day = date.toISOString().slice(0, 10);
          const fuelType = row.fuel_type || "unknown";
          const usageKwh = Number(row.usage_kwh);

          if (
            !Number.isFinite(usageKwh) ||
            indicativeIntervalDays.has(`${fuelType}:${day}`)
          ) {
            return;
          }

          indicativeDailyEnergy[day] = indicativeDailyEnergy[day] || {
            fuels: {},
            hdd: null,
            usesLegacy: false,
            hours: day === todayKey ? elapsedHoursToday : 24,
          };
          indicativeDailyEnergy[day].fuels[fuelType] = Math.max(
            indicativeDailyEnergy[day].fuels[fuelType] || 0,
            usageKwh
          );
          indicativeDailyEnergy[day].hours = Math.max(
            indicativeDailyEnergy[day].hours || 0,
            day === todayKey ? elapsedHoursToday : 24
          );

          const rowHdd = Number(row.raw_payload?.hdd);
          if (Number.isFinite(rowHdd)) {
            indicativeDailyEnergy[day].hdd = rowHdd;
          }

          if (row.source?.startsWith("legacy-readings-")) {
            indicativeDailyEnergy[day].usesLegacy = true;
          }
        });

      const indicativeHeatLoss =
        calculateHeatLossFromDailyEnergy(indicativeDailyEnergy);
      const todayTemperatures = dailyTemperatures[todayKey];
      const todayInsideAverage = todayTemperatures?.inside.length
        ? average(todayTemperatures.inside)
        : null;
      const todayOutsideAverage = todayTemperatures?.outside.length
        ? average(todayTemperatures.outside)
        : null;
      const todayEnergy = indicativeDailyEnergy[todayKey];
      const todayTotalKwh = todayEnergy
        ? Object.values(todayEnergy.fuels).reduce((sum, value) => sum + value, 0)
        : null;
      const currentHdd = Number.isFinite(todayOutsideAverage)
        ? Math.max(0, HDD_BASE_TEMP_C - todayOutsideAverage)
        : null;
      const liveKwhPerHdd =
        Number.isFinite(currentHdd) &&
        currentHdd > 0 &&
        Number.isFinite(todayTotalKwh) &&
        todayTotalKwh > 0
          ? todayTotalKwh / currentHdd
          : null;
      const liveHtcEstimate =
        Number.isFinite(todayInsideAverage) &&
        Number.isFinite(todayOutsideAverage) &&
        todayInsideAverage > todayOutsideAverage &&
        Number.isFinite(todayTotalKwh) &&
        todayTotalKwh > 0
          ? ((todayTotalKwh * 1000) / elapsedHoursToday) /
            (todayInsideAverage - todayOutsideAverage)
          : null;
      const liveAnnualHddEstimate =
        Number.isFinite(currentHdd) && currentHdd > 0
          ? currentHdd * 365
          : null;
      const liveWeatherNormalisedEui =
        Number.isFinite(liveKwhPerHdd) &&
        Number.isFinite(liveAnnualHddEstimate) &&
        Number.isFinite(area) &&
        area > 0
          ? (liveKwhPerHdd * liveAnnualHddEstimate) / area
          : null;
      const liveIndicativeHeatLoss = {
        kwhPerHdd: liveKwhPerHdd,
        weatherNormalisedEui: liveWeatherNormalisedEui,
        htcEstimate: liveHtcEstimate,
        hddDays: Number.isFinite(currentHdd) && currentHdd > 0 ? 1 : 0,
        htcSamples: Number.isFinite(liveHtcEstimate) ? 1 : 0,
        comfortHddDays:
          Number.isFinite(currentHdd) &&
          currentHdd > 0 &&
          Number.isFinite(todayInsideAverage) &&
          todayInsideAverage >= 18
            ? 1
            : 0,
        averageInternalTemp: todayInsideAverage,
        hddSource: "live",
      };
      if (dataSourceBuildingId === "museum") {
        filteredInsideReadings = (indoorTemperatureRows || []).filter((row) => {
          const inside = Number(row.temperature_inside);
          return Number.isFinite(inside) && Math.abs(inside - 17.6) < 0.05;
        }).length;
      }

      const chooseHeatLossMetric = (key) => {
        if (Number.isFinite(auditHeatLoss[key])) {
          return { value: auditHeatLoss[key], source: "audit-grade" };
        }

        if (Number.isFinite(indicativeHeatLoss[key])) {
          return { value: indicativeHeatLoss[key], source: "indicative" };
        }

        if (Number.isFinite(liveIndicativeHeatLoss[key])) {
          return { value: liveIndicativeHeatLoss[key], source: "live-indicative" };
        }

        return { value: null, source: "pending" };
      };
      const chosenHdd = chooseHeatLossMetric("kwhPerHdd");
      const chosenWeatherNormalisedEui = chooseHeatLossMetric(
        "weatherNormalisedEui"
      );
      const chosenHtc = chooseHeatLossMetric("htcEstimate");
      const lowestConfidenceSource = [
        chosenHdd.source,
        chosenWeatherNormalisedEui.source,
        chosenHtc.source,
      ].find((source) => source === "live-indicative") ||
        [chosenHdd.source, chosenWeatherNormalisedEui.source, chosenHtc.source].find(
          (source) => source === "indicative"
        ) ||
        [chosenHdd.source, chosenWeatherNormalisedEui.source, chosenHtc.source].find(
          (source) => source === "audit-grade"
        ) ||
        "pending";
      const hddSampleSource =
        chosenHdd.source === "audit-grade"
          ? auditHeatLoss
          : chosenHdd.source === "indicative"
          ? indicativeHeatLoss
          : liveIndicativeHeatLoss;
      const htcSampleSource =
        chosenHtc.source === "audit-grade"
          ? auditHeatLoss
          : chosenHtc.source === "indicative"
          ? indicativeHeatLoss
          : liveIndicativeHeatLoss;
      const displayedHeatLoss = {
        kwhPerHdd: chosenHdd.value,
        weatherNormalisedEui: chosenWeatherNormalisedEui.value,
        htcEstimate: chosenHtc.value,
        hddDays: hddSampleSource.hddDays || 0,
        htcSamples: htcSampleSource.htcSamples || 0,
        hddSource:
          lowestConfidenceSource === "live-indicative"
            ? "live"
            : hddSampleSource.hddSource || "current",
        hlaConfidence: lowestConfidenceSource,
        hddConfidence: chosenHdd.source,
        htcConfidence: chosenHtc.source,
        comfortHddDays: hddSampleSource.comfortHddDays || 0,
        averageInternalTemp:
          htcSampleSource.averageInternalTemp ||
          hddSampleSource.averageInternalTemp ||
          null,
      };
      const flatlineIndoorTemp = false;

      setHeatLossSummary({
        kwhPerHdd: displayedHeatLoss.kwhPerHdd,
        weatherNormalisedEui: displayedHeatLoss.weatherNormalisedEui,
        htcEstimate: displayedHeatLoss.htcEstimate,
        hddDays: displayedHeatLoss.hddDays || 0,
        htcSamples: displayedHeatLoss.htcSamples || 0,
        hddSource: displayedHeatLoss.hddSource || "current",
        hlaConfidence: displayedHeatLoss.hlaConfidence,
        hddConfidence: displayedHeatLoss.hddConfidence,
        htcConfidence: displayedHeatLoss.htcConfidence,
        auditKwhPerHdd: auditHeatLoss.kwhPerHdd,
        auditHtcEstimate: auditHeatLoss.htcEstimate,
        averageInternalTemp: displayedHeatLoss.averageInternalTemp,
        comfortHddDays: displayedHeatLoss.comfortHddDays || 0,
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
        hlaConfidence: "pending",
        auditKwhPerHdd: null,
        auditHtcEstimate: null,
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
            vocs: dysonAppDisplayValue(row.reading_type, "vocs", row.vocs),
            pm25: numericOrNull(row.pm25),
            pm10: numericOrNull(row.pm10),
            hcho: numericOrNull(row.hcho),
            no2: dysonAppDisplayValue(row.reading_type, "no2", row.no2),
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
          vocs:
            combinedFromRooms?.vocs ??
            dysonAppDisplayValue(sourceRow.reading_type, "vocs", sourceRow.vocs),
          pm25: numericOrNull(combinedFromRooms?.pm25 ?? sourceRow.pm25),
          pm10: numericOrNull(combinedFromRooms?.pm10 ?? sourceRow.pm10),
          hcho: numericOrNull(combinedFromRooms?.hcho ?? sourceRow.hcho),
          no2:
            combinedFromRooms?.no2 ??
            dysonAppDisplayValue(sourceRow.reading_type, "no2", sourceRow.no2),
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

      applyWeeklyTrendData(averagedWeeklyTrend);
    } catch (err) {
      console.error("Error fetching weekly performance trend:", err.message);
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
      const now = new Date();

      for (let page = 0; page < maxPages; page += 1) {
        const { data, error } = await supabase
          .from("EnergyReadings")
          .select("timestamp, created_at, fuel_type, reading_type, usage_kwh")
          .eq("building_id", dataSourceBuildingId)
          .in("reading_type", ["daily_total", "interval_30m"])
          .not("usage_kwh", "is", null)
          .gte("timestamp", "2020-01-01")
          .lte("timestamp", now.toISOString())
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
      const dailyFallbackEnergy = {};
      const intervalEnergy = {};
      const dayKey = (timestamp) => new Date(timestamp).toISOString().slice(0, 10);
      const intervalKey = (timestamp) => new Date(timestamp).toISOString();

      energyRows
        .filter((row) => row.reading_type === "interval_30m")
        .forEach((row) => {
          const day = dayKey(row.timestamp);
          const interval = intervalKey(row.timestamp);
          const fuelType = row.fuel_type || "unknown";
          const usageKwh = Number(row.usage_kwh);

          if (!Number.isFinite(usageKwh)) {
            return;
          }

          intervalDays.add(`${fuelType}:${day}`);
          dailyEnergy[day] = dailyEnergy[day] || {};
          dailyEnergy[day][fuelType] = (dailyEnergy[day][fuelType] || 0) + usageKwh;
          intervalEnergy[interval] = intervalEnergy[interval] || {};
          intervalEnergy[interval][fuelType] =
            (intervalEnergy[interval][fuelType] || 0) + usageKwh;
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
          dailyFallbackEnergy[day] = dailyFallbackEnergy[day] || {};
          dailyFallbackEnergy[day][fuelType] = Math.max(
            dailyFallbackEnergy[day][fuelType] || 0,
            usageKwh
          );
        });

      const area = Number(matterportMetadata.internalArea);
      const improvedDailyElectricityKwh =
        ((Number.isFinite(area) && area > 0
          ? area
          : building.estimatedInternalArea || 99.2) *
          projectedPerformanceDeepDive.annualEui) /
        365;
      const improvedIntervalElectricityKwh = improvedDailyElectricityKwh / 48;
      const improvedIntervalKgCo2e =
        improvedIntervalElectricityKwh * ELECTRICITY_KGCO2E_PER_KWH;
      const improvedIntervalEnergyCost =
        improvedIntervalElectricityKwh * ELECTRICITY_PRICE_GBP_PER_KWH;
      const today = now.toISOString().slice(0, 10);
      const projectionFactorForDay = (savingDate) => {
        if (savingDate !== today) {
          return 1;
        }

        const startOfToday = new Date(`${today}T00:00:00.000Z`);
        return Math.min(
          1,
          Math.max(0, (now - startOfToday) / 86400000)
        );
      };

      const rows = Object.entries(dailyEnergy)
        .map(([savingDate, fuels]) => {
          const electricityKwh = Number(fuels.electricity || 0);
          const gasKwh = Number(fuels.gas || 0);
          const projectionFactor = projectionFactorForDay(savingDate);
          const improvedElectricityKwh =
            improvedDailyElectricityKwh * projectionFactor;
          const improvedKgCo2e =
            improvedElectricityKwh * ELECTRICITY_KGCO2E_PER_KWH;
          const improvedEnergyCost =
            improvedElectricityKwh * ELECTRICITY_PRICE_GBP_PER_KWH;
          const baselineTotalKwh = electricityKwh + gasKwh;
          const baselineKgCo2e =
            electricityKwh * ELECTRICITY_KGCO2E_PER_KWH +
            gasKwh * GAS_KGCO2E_PER_KWH;
          const measuredEnergyCost =
            electricityKwh * ELECTRICITY_PRICE_GBP_PER_KWH +
            gasKwh * GAS_PRICE_GBP_PER_KWH;
          const savedKgCo2e = Math.max(0, baselineKgCo2e - improvedKgCo2e);
          const savedKwh = Math.max(0, baselineTotalKwh - improvedElectricityKwh);
          const energyCostSavedGbp = Math.max(
            0,
            measuredEnergyCost - improvedEnergyCost
          );

          return {
            saving_date: savingDate,
            saved_kgco2e: savedKgCo2e,
            saved_kwh: savedKwh,
            energy_cost_saved_gbp: energyCostSavedGbp,
            carbon_credits: savedKgCo2e / 1000,
          };
        })
        .sort((a, b) => b.saving_date.localeCompare(a.saving_date));

      const intervalRows = Object.entries(intervalEnergy)
        .map(([timestamp, fuels]) => {
          const electricityKwh = Number(fuels.electricity || 0);
          const gasKwh = Number(fuels.gas || 0);
          const baselineTotalKwh = electricityKwh + gasKwh;
          const baselineKgCo2e =
            electricityKwh * ELECTRICITY_KGCO2E_PER_KWH +
            gasKwh * GAS_KGCO2E_PER_KWH;
          const measuredEnergyCost =
            electricityKwh * ELECTRICITY_PRICE_GBP_PER_KWH +
            gasKwh * GAS_PRICE_GBP_PER_KWH;
          const savedKgCo2e = Math.max(
            0,
            baselineKgCo2e - improvedIntervalKgCo2e
          );
          const savedKwh = Math.max(
            0,
            baselineTotalKwh - improvedIntervalElectricityKwh
          );
          const energyCostSavedGbp = Math.max(
            0,
            measuredEnergyCost - improvedIntervalEnergyCost
          );

          return {
            timestamp,
            saved_kgco2e: savedKgCo2e,
            saved_kwh: savedKwh,
            energy_cost_saved_gbp: energyCostSavedGbp,
            carbon_credits: savedKgCo2e / 1000,
          };
        })
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

      const accruedRows = [
        ...intervalRows,
        ...Object.entries(dailyFallbackEnergy).map(([savingDate, fuels]) => {
          const electricityKwh = Number(fuels.electricity || 0);
          const gasKwh = Number(fuels.gas || 0);
          const projectionFactor = projectionFactorForDay(savingDate);
          const improvedFallbackElectricityKwh =
            electricityKwh > 0 ? improvedDailyElectricityKwh * projectionFactor : 0;
          const improvedFallbackKgCo2e =
            improvedFallbackElectricityKwh * ELECTRICITY_KGCO2E_PER_KWH;
          const improvedFallbackEnergyCost =
            improvedFallbackElectricityKwh * ELECTRICITY_PRICE_GBP_PER_KWH;
          const baselineTotalKwh = electricityKwh + gasKwh;
          const baselineKgCo2e =
            electricityKwh * ELECTRICITY_KGCO2E_PER_KWH +
            gasKwh * GAS_KGCO2E_PER_KWH;
          const measuredEnergyCost =
            electricityKwh * ELECTRICITY_PRICE_GBP_PER_KWH +
            gasKwh * GAS_PRICE_GBP_PER_KWH;
          const savedKgCo2e = Math.max(
            0,
            baselineKgCo2e - improvedFallbackKgCo2e
          );
          const savedKwh = Math.max(
            0,
            baselineTotalKwh - improvedFallbackElectricityKwh
          );
          const energyCostSavedGbp = Math.max(
            0,
            measuredEnergyCost - improvedFallbackEnergyCost
          );

          return {
            timestamp: `${savingDate}T00:00:00.000Z`,
            saved_kgco2e: savedKgCo2e,
            saved_kwh: savedKwh,
            energy_cost_saved_gbp: energyCostSavedGbp,
            carbon_credits: savedKgCo2e / 1000,
          };
        }),
      ].sort((a, b) => b.timestamp.localeCompare(a.timestamp));

      return { dailyRows: rows, intervalRows, accruedRows };
    };

    const applyAccruedSavingsSummary = (accruedRows) => {
      const totalSavedKgCo2e = accruedRows.reduce(
        (sum, row) => sum + (Number(row.saved_kgco2e) || 0),
        0
      );
      const totalSavedKwh = accruedRows.reduce(
        (sum, row) => sum + (Number(row.saved_kwh) || 0),
        0
      );
      const energyCostSavedGbp = accruedRows.reduce(
        (sum, row) => sum + (Number(row.energy_cost_saved_gbp) || 0),
        0
      );
      const totalCredits = accruedRows.reduce(
        (sum, row) => sum + (Number(row.carbon_credits) || 0),
        0
      );
      const latest = accruedRows[0] || null;

      setCarbonCredits(totalCredits);
      applyCarbonIntervalSavingsSummary({
        latestTimestamp: latest?.timestamp || null,
        latestSavedKgCo2e: latest ? Number(latest.saved_kgco2e) : null,
        totalSavedKgCo2e,
        totalSavedKwh,
        energyCostSavedGbp,
        carbonCredits: totalCredits,
      });
    };

    try {
      const { data, error } = await supabase
        .from("CarbonSavingsDaily")
        .select("saving_date, saved_kgco2e, carbon_credits")
        .eq("building_id", dataSourceBuildingId)
        .eq("scenario", "enerphit-certified")
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
      applyCarbonSavingsSummary({
        latestDate: latest?.saving_date || null,
        latestSavedKgCo2e: latest ? Number(latest.saved_kgco2e) : null,
        totalSavedKgCo2e,
      });
      const { accruedRows } = await buildCarbonSavingsFromEnergyRows();
      applyAccruedSavingsSummary(accruedRows);
    } catch (err) {
      console.warn("Carbon savings table unavailable; calculating from EnergyReadings:", err.message);
      try {
        const { dailyRows, accruedRows } = await buildCarbonSavingsFromEnergyRows();
        const totalSavedKgCo2e = dailyRows.reduce(
          (sum, row) => sum + (Number(row.saved_kgco2e) || 0),
          0
        );
        const totalCredits = dailyRows.reduce(
          (sum, row) => sum + (Number(row.carbon_credits) || 0),
          0
        );
        const latest = dailyRows[0] || null;

        setCarbonCredits(totalCredits);
        applyCarbonSavingsSummary({
          latestDate: latest?.saving_date || null,
          latestSavedKgCo2e: latest ? Number(latest.saved_kgco2e) : null,
          totalSavedKgCo2e,
        });
        applyAccruedSavingsSummary(accruedRows);
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
    const cachedEnergySummary = readCachedEnergySummary();
    setEnergySummary(cachedEnergySummary);
    setHistoricalPerformance(
      Number.isFinite(cachedEnergySummary.totalDailyAverage)
        ? cachedEnergySummary.totalDailyAverage
        : null
    );
    const cachedCarbonIntervalSummary =
      readCachedCarbonIntervalSavingsSummary();
    setCarbonSavingsSummary(readCachedCarbonSavingsSummary());
    setCarbonIntervalSavingsSummary(cachedCarbonIntervalSummary);
    setCarbonCredits(
      Number.isFinite(cachedCarbonIntervalSummary.carbonCredits)
        ? cachedCarbonIntervalSummary.carbonCredits
        : 0
    );
    setWeeklyTrendData(readCachedWeeklyTrendData());
    setMrvEvidence(readCachedMrvEvidence());
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
  const baselineMeteredDays = Number(energySummary.baselineMeteredDays) || 0;
  const baselineDateRange =
    energySummary.baselineStartDate && energySummary.baselineEndDate
      ? `${energySummary.baselineStartDate} to ${energySummary.baselineEndDate}`
      : null;
  const baselineCoverageDays =
    energySummary.baselineStartDate && energySummary.baselineEndDate
      ? Math.max(
          1,
          Math.round(
            (new Date(energySummary.baselineEndDate) -
              new Date(energySummary.baselineStartDate)) /
              86400000
          ) + 1
        )
      : 0;
  const candidateMeteredBaseline =
    hasEnergyBaseline && baselineMeteredDays >= MIN_BASELINE_METERED_DAYS;
  const hasWeatherNormalisedBaseline =
    Number.isFinite(heatLossSummary.weatherNormalisedEui) ||
    Number.isFinite(heatLossSummary.kwhPerHdd);
  const hasMatureHddBaseline =
    heatLossSummary.hddSource === "legacy" ||
    heatLossSummary.hddDays >= MIN_BASELINE_HDD_DAYS;
  const hddNormalisedBaseline =
    candidateMeteredBaseline &&
    hasWeatherNormalisedBaseline &&
    hasMatureHddBaseline;
  const seasonalBaseline =
    hddNormalisedBaseline && baselineMeteredDays >= MIN_SEASONAL_BASELINE_DAYS;
  const fullConfidenceBaseline =
    hddNormalisedBaseline &&
    baselineCoverageDays >= MIN_FULL_YEAR_BASELINE_DAYS &&
    baselineMeteredDays >= MIN_FULL_YEAR_METERED_DAYS;
  const baselineConfidence = fullConfidenceBaseline
    ? {
        label: "Full confidence",
        detail: "Full year plus cold-weather HDD baseline",
        score: 100,
        complete: true,
      }
    : seasonalBaseline
    ? {
        label: "High confidence",
        detail: "Seasonal metered baseline with HDD normalisation",
        score: 75,
        complete: false,
      }
    : hddNormalisedBaseline
    ? {
        label: "Medium confidence",
        detail: "Cold-weather/HDD-normalised candidate baseline",
        score: 55,
        complete: false,
      }
    : candidateMeteredBaseline
    ? {
        label: "Low confidence",
        detail: "Metered candidate; needs cold-weather/HDD evidence",
        score: 30,
        complete: false,
      }
    : {
        label: "Collecting",
        detail: "Needs enough completed metered days",
        score: 0,
        complete: false,
      };
  const hddCalculationDetail = [
    `${formatNumber(historicalPerformance, 2)} kWh/day`,
    `${baselineMeteredDays} metered day(s)`,
    `${heatLossSummary.hddDays || 0} HDD day(s)`,
    Number.isFinite(heatLossSummary.kwhPerHdd)
      ? `${formatNumber(heatLossSummary.kwhPerHdd, 3)} kWh/HDD`
      : "kWh/HDD pending",
    Number.isFinite(heatLossSummary.weatherNormalisedEui)
      ? `${formatNumber(heatLossSummary.weatherNormalisedEui, 1)} kWh/m2/yr weather-normalised`
      : "weather-normalised EUI pending",
  ].join(", ");
  const baselineConfidenceSteps = [
    {
      label: "Metered candidate",
      complete: candidateMeteredBaseline,
      detail: `${baselineMeteredDays}/${MIN_BASELINE_METERED_DAYS} completed metered day(s)`,
    },
    {
      label: "Basic HDD calculation",
      complete: hasWeatherNormalisedBaseline,
      detail: `${heatLossSummary.hddDays || 0} HDD day(s), base ${HDD_BASE_TEMP_C} deg C`,
    },
    {
      label: "Cold-weather HDD",
      complete: hddNormalisedBaseline,
      detail: `${heatLossSummary.hddDays || 0}/${MIN_BASELINE_HDD_DAYS} HDD day(s)`,
    },
    {
      label: "Seasonal confidence",
      complete: seasonalBaseline,
      detail: `${baselineMeteredDays}/${MIN_SEASONAL_BASELINE_DAYS} completed metered day(s)`,
    },
    {
      label: "Full-year confidence",
      complete: fullConfidenceBaseline,
      detail: `${baselineCoverageDays}/${MIN_FULL_YEAR_BASELINE_DAYS} day span and ${baselineMeteredDays}/${MIN_FULL_YEAR_METERED_DAYS} metered day(s)`,
    },
  ];
  const hasLiveIaqFeed =
    Number.isFinite(sensorData.internalTemp) ||
    Number.isFinite(sensorData.humidity) ||
    roomIaqData.length > 0;
  const baselineEvidenceComplete = baselineConfidence.complete;
  const interventionComplete = Boolean(
    mrvEvidence.interventionDate && mrvEvidence.interventionEvidence?.trim()
  );
  const ownershipRecordComplete = Boolean(
    mrvEvidence.ownershipRecordReference?.trim() ||
      mrvEvidence.ownershipRecordFileName
  );
  const ownershipConsentComplete = Boolean(
    mrvEvidence.ownershipConsent && ownershipRecordComplete
  );
  const verifierApprovalComplete =
    mrvEvidence.verifierStatus === "approved" &&
    Boolean(mrvEvidence.verifierName?.trim());
  const evidencePackChecks = [
    {
      category: "Monitoring inputs",
      label: "Building identity",
      detail: `${building.address || "Address pending"} / ${
        building.latitude || "--"
      }, ${building.longitude || "--"}`,
      complete: Boolean(building.address && building.latitude && building.longitude),
    },
    {
      category: "Monitoring inputs",
      label: "Internal area",
      detail: hasConfirmedArea
        ? `${matterportMetadata.internalArea} m2`
        : "Matterport or measured GIA pending",
      complete: hasConfirmedArea,
    },
    {
      category: "Monitoring inputs",
      label: "Live IAQ evidence",
      detail: hasLiveIaqFeed
        ? `${roomIaqData.length || 1} active feed(s)`
        : "Needs active IAQ feed",
      complete: hasLiveIaqFeed,
    },
    {
      category: "Monitoring inputs",
      label: "Collector provenance",
      detail: "Collector instance and source columns captured in Supabase",
      complete: true,
    },
    {
      category: "Monitoring inputs",
      label: "Calculation version",
      detail: "enerphit-certified-v1 / dashboard carbon v1",
      complete: true,
    },
    {
      category: "Baseline performance",
      label: "Baseline calculation",
      fieldKey: "baseline",
      detail: hasEnergyBaseline
        ? `${baselineConfidence.label}: ${hddCalculationDetail}`
        : "Needs metered energy plus HDD/weather-normalised baseline",
      complete: baselineEvidenceComplete,
    },
    {
      category: "Retrofit works",
      label: "Intervention completion",
      fieldKey: "intervention",
      detail: interventionComplete
        ? `${mrvEvidence.interventionDate}: ${mrvEvidence.interventionEvidence}`
        : "Needs retrofit completion date and evidence",
      complete: interventionComplete,
    },
    {
      category: "Retrofit works",
      label: "Ownership and consent",
      fieldKey: "ownership",
      detail: ownershipConsentComplete
        ? `Ownership record captured: ${
            mrvEvidence.ownershipRecordFileName ||
            mrvEvidence.ownershipRecordReference
          }`
        : "Needs ownership record plus credit assignment and no-double-counting declaration",
      complete: ownershipConsentComplete,
    },
  ];
  const evidencePackCompleteCount = evidencePackChecks.filter(
    (check) => check.complete
  ).length;
  const orderedEvidencePackChecks = [...evidencePackChecks].sort((a, b) => {
    if (a.complete === b.complete) {
      return 0;
    }

    return a.complete ? 1 : -1;
  });
  const evidencePackCategories = [
    "Monitoring inputs",
    "Baseline performance",
    "Retrofit works",
  ];
  const groupedEvidencePackChecks = evidencePackCategories
    .map((category) => ({
      category,
      checks: orderedEvidencePackChecks.filter(
        (check) => check.category === category
      ),
    }))
    .filter((group) => group.checks.length > 0)
    .sort((a, b) => {
      const aNeeded = a.checks.some((check) => !check.complete);
      const bNeeded = b.checks.some((check) => !check.complete);

      if (aNeeded === bNeeded) {
        return 0;
      }

      return aNeeded ? -1 : 1;
    });
  const evidencePackScore = Math.round(
    (evidencePackCompleteCount / evidencePackChecks.length) * 100
  );
  const evidencePackExportReady = evidencePackScore === 100;
  const sellCreditsAvailable =
    evidencePackExportReady && verifierApprovalComplete;
  const verifierRoutingStatus = evidencePackExportReady
    ? "Ready to route to selected verifier on export"
    : "Verifier routing unlocks when the evidence pack reaches 100%";
  const missingEvidenceItems = evidencePackChecks.filter(
    (check) => !check.complete
  );
  const auditReference = `WBP-${dataSourceBuildingId.toUpperCase()}-${new Date()
    .toISOString()
    .slice(0, 10)
    .replaceAll("-", "")}-${evidencePackScore}`;
  const exportEvidencePack = () => {
    const evidencePack = {
      auditReference,
      exportedAt: new Date().toISOString(),
      status: "candidate-mrv-evidence-pack",
      building: {
        id: building.id,
        dataSourceId: dataSourceBuildingId,
        name: building.name,
        address: building.address,
        latitude: building.latitude,
        longitude: building.longitude,
        internalAreaM2: matterportMetadata.internalArea,
        matterportModelId,
      },
      baseline: {
        confidenceLabel: baselineConfidence.label,
        confidenceScore: baselineConfidence.score,
        confidenceDetail: baselineConfidence.detail,
        fullConfidence: baselineEvidenceComplete,
        meteredDays: baselineMeteredDays,
        coverageDays: baselineCoverageDays,
        hddDays: heatLossSummary.hddDays || 0,
        minimumMeteredDays: MIN_BASELINE_METERED_DAYS,
        minimumHddDays: MIN_BASELINE_HDD_DAYS,
        minimumSeasonalDays: MIN_SEASONAL_BASELINE_DAYS,
        minimumFullYearCoverageDays: MIN_FULL_YEAR_BASELINE_DAYS,
        minimumFullYearMeteredDays: MIN_FULL_YEAR_METERED_DAYS,
        startDate: energySummary.baselineStartDate,
        endDate: energySummary.baselineEndDate,
        historicalPerformanceKwhPerDay: historicalPerformance,
        weatherNormalisedEui: heatLossSummary.weatherNormalisedEui,
        kwhPerHdd: heatLossSummary.kwhPerHdd,
        htcEstimate: heatLossSummary.htcEstimate,
        hddSource: heatLossSummary.hddSource,
      },
      projectedPerformance: {
        standard: "EnerPHit certified candidate scenario",
        annualEui: projectedPerformanceDeepDive.annualEui,
        electricityDailyAverage:
          projectedPerformanceDeepDive.electricityDailyAverage,
        gasDailyAverage: projectedPerformanceDeepDive.gasDailyAverage,
      },
      intervention: {
        completionDate: mrvEvidence.interventionDate,
        evidence: mrvEvidence.interventionEvidence,
      },
      declarations: {
        ownershipConsent: mrvEvidence.ownershipConsent,
        ownershipRecordReference: mrvEvidence.ownershipRecordReference,
        ownershipRecordFileName: mrvEvidence.ownershipRecordFileName,
        noDoubleCounting: mrvEvidence.ownershipConsent,
      },
      verifier: {
        routingStatus: verifierRoutingStatus,
        targetOrganisation: null,
        status: evidencePackExportReady
          ? "ready-for-submission"
          : "awaiting-complete-evidence-pack",
      },
      carbon: {
        candidateCredits: carbonCredits,
        savedKgCo2e: carbonIntervalSavingsSummary.totalSavedKgCo2e,
        carbonValueGbp: intervalCarbonMarketValue,
        carbonPriceGbpPerTonne: carbonMarketPrice.gbpPerTonne,
        carbonPriceSource: carbonMarketPrice.source,
      },
      energy: {
        savedKwh: carbonIntervalSavingsSummary.totalSavedKwh,
        energyValueGbp: carbonIntervalSavingsSummary.energyCostSavedGbp,
      },
      checks: evidencePackChecks,
      checkGroups: groupedEvidencePackChecks,
      missingEvidence: missingEvidenceItems.map((item) => item.label),
    };
    const blob = new Blob([JSON.stringify(evidencePack, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${auditReference.toLowerCase()}-evidence-pack.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const intervalCarbonSavedTonnes = Number.isFinite(
    carbonIntervalSavingsSummary.totalSavedKgCo2e
  )
    ? carbonIntervalSavingsSummary.totalSavedKgCo2e / 1000
    : null;
  const intervalCarbonMarketValue =
    Number.isFinite(intervalCarbonSavedTonnes) &&
    Number.isFinite(carbonMarketPrice.gbpPerTonne)
      ? intervalCarbonSavedTonnes * carbonMarketPrice.gbpPerTonne
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
  const enerphitPerformance = {
    health: 94,
    energy: 92,
    value: 93,
  };
  const isNewPerformanceDeepDive =
    isCarbonCreditTab && deepDivePanel === "new";
  const projectedPerformanceDeepDive = {
    annualEui: 25,
    electricityDailyAverage: 6.8,
    gasDailyAverage: 0,
    regulatedDailyKwh: 4.2,
    unregulatedDailyKwh: 2.6,
    regulatedEnergyShare: 62,
    splitConfidence: "Projected EnerPHit certified all-electric retrofit profile",
    internalTemp: 20.5,
    externalTemp: sensorData.externalTemp,
    humidity: 45,
    vocs: 25,
    pm25: 2,
    pm10: 5,
    hcho: 3,
    no2: 5,
    weatherNormalisedEui: 25,
    kwhPerHdd: 2.6,
    htcEstimate: 125,
    hddDays: 365,
    htcSamples: 90,
    hddSource: "Projected PHPP / EnerPHit retrofit model",
    comfortNote: "20.5 deg C target internal temp / EnerPHit comfort assumed",
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
      className={`flex min-w-0 flex-col rounded border p-2.5 sm:p-3 ${
        tone === "primary"
          ? "border-emerald-200 bg-emerald-50/60"
          : tone === "locked"
          ? "border-gray-200 bg-gray-50"
          : "bg-white"
      }`}
    >
      {title ? (
        <div className="mb-1.5 flex flex-wrap items-start justify-between gap-1.5 sm:gap-2">
          <h3
            className={`text-[10px] font-semibold uppercase tracking-wide sm:text-xs ${
              tone === "primary" ? "text-emerald-800" : "text-gray-500"
            }`}
          >
            {title}
          </h3>
          {statusLabel ? (
            <span
              className={`max-w-full rounded border px-1.5 py-0.5 text-right text-[7px] font-semibold uppercase leading-tight tracking-wide sm:whitespace-nowrap sm:px-2 sm:text-[8px] ${
                tone === "primary"
                  ? "border-emerald-300 bg-white text-emerald-800"
                  : "border-gray-300 bg-white text-gray-600"
              }`}
            >
              {statusLabel}
            </span>
          ) : null}
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
              ? "items-start justify-center pt-0"
              : compact
              ? "min-h-[96px] items-center justify-center pt-1 sm:min-h-[118px]"
              : "min-h-[122px] items-start justify-end pt-1 pr-0 sm:min-h-[168px] sm:pr-4"
          }`}
        >
          <AnalogGauge
            value={gaugeValue}
            historicalValue={historicalPerformance}
            activeBandOnly={activeBandOnly}
            className={
              showStandardDeepDiveToggle
                ? "h-auto w-[210px] max-w-full min-[390px]:w-[240px] sm:w-[340px] lg:w-[410px]"
                : compact
                ? "h-auto w-[104px] max-w-full min-[390px]:w-[122px] sm:w-[170px]"
                : "h-auto w-[145px] max-w-full min-[390px]:w-[170px] sm:w-[265px]"
            }
          />
        </div>
      </div>
      {isCarbonCreditTab && diveKey ? (
        <div className="mt-1 flex flex-col items-stretch gap-1.5 border-t border-gray-100 pt-1.5 sm:mt-2 sm:items-start sm:gap-2">
          <button
            type="button"
            onClick={() => toggleDeepDivePanel(diveKey)}
            className="w-full max-w-full rounded border border-gray-300 bg-white px-2 py-1 text-center text-[10px] font-semibold text-gray-700 shadow-sm transition hover:border-gray-500 hover:text-black sm:w-28 sm:text-xs"
            aria-expanded={deepDivePanel === diveKey}
          >
            Deep Dive
          </button>
        </div>
      ) : showStandardDeepDiveToggle ? (
        <div className="mt-1 flex justify-start border-t border-gray-100 pt-1.5 sm:mt-2">
          <button
            type="button"
            onClick={() => setStandardDeepDiveOpen((isOpen) => !isOpen)}
            className="w-full max-w-full rounded border border-gray-300 bg-white px-2 py-1 text-center text-[10px] font-semibold text-gray-700 shadow-sm transition hover:border-gray-500 hover:text-black sm:w-28 sm:text-xs"
            aria-expanded={standardDeepDiveOpen}
          >
            Deep Dive
          </button>
        </div>
      ) : null}
    </div>
  );
  return (
    <div
      className={`bg-white p-4 flex flex-col space-y-6 ${
        isCarbonCreditTab ? "min-h-0" : "min-h-screen"
      }`}
    >
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
                className="w-full h-[155px] min-[390px]:h-[175px] sm:h-[250px] border rounded bg-white"
                allow="autoplay; fullscreen; xr-spatial-tracking; accelerometer; gyroscope; vr"
                allowFullScreen
              />
            ) : (
              <div className="w-full h-[155px] min-[390px]:h-[175px] sm:h-[250px] border rounded bg-white flex items-center justify-center text-gray-500 text-[10px] min-[390px]:text-xs sm:text-sm p-2 sm:p-6 text-center">
                3D model pending.
              </div>
            )}

          </div>
        </div>
      </div>

      <div className="bg-gray-100 p-3 sm:p-4 rounded shadow">
        <h2 className="mb-2 text-lg font-bold">Performance</h2>

        <div className="space-y-2.5 sm:space-y-4">
          {isCarbonCreditTab ? (
            <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-3">
              {renderPerformanceCard({
                title: "Before",
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
                title: "After",
                healthScore: enerphitPerformance.health,
                energyScore: enerphitPerformance.energy,
                gaugeValue: enerphitPerformance.value,
                diveKey: "new",
                tone: "primary",
                statusLabel: "Enerphit",
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
                    ? "After EnerPHit Performance Deep Dive"
                    : "Before Performance Deep Dive"}
                </h3>
                <p>
                  {deepDivePanel === "new"
                    ? "Projected post-upgrade view using EnerPHit certified retrofit comfort and energy performance."
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
                        <strong>Fabric:</strong> EnerPHit certified retrofit envelope
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
                      : (displayedHeatLossSummary.hddDays || 0) > 0
                      ? "Pending completed energy + HDD data"
                      : "Needs cold-weather days below 15.5 deg C"}
                    {!isNewPerformanceDeepDive && hddDataCaveat
                      ? ` (${hddDataCaveat})`
                      : ""}
                  </p>
                  <p className={heatLossStatusClass(displayedHtcStatus)}>
                    <HeatLossStatusDot status={displayedHtcStatus} />{" "}
                    <strong>HTC Estimate:</strong>{" "}
                    {Number.isFinite(displayedHeatLossSummary.htcEstimate)
                      ? `${formatNumber(displayedHeatLossSummary.htcEstimate, 1)} W/K`
                      : (displayedHeatLossSummary.htcSamples || 0) > 0
                      ? "Pending energy + indoor/outdoor temperature overlap"
                      : "Needs indoor/outdoor temperature and energy overlap"}
                  </p>
                  <p className="pt-2 mt-2 border-t border-gray-200">
                    <strong>HDD / HTC Days:</strong>{" "}
                    {(displayedHeatLossSummary.hddDays || 0) > 0 ||
                    (displayedHeatLossSummary.htcSamples || 0) > 0
                      ? `${displayedHeatLossSummary.hddDays || 0} / ${
                          displayedHeatLossSummary.htcSamples || 0
                        }`
                      : "No valid overlap yet"}
                  </p>
                  <p className="pt-2 mt-2 border-t border-gray-200">
                    <strong>HDD Source:</strong>{" "}
                    {isNewPerformanceDeepDive
                      ? projectedPerformanceDeepDive.hddSource
                      : heatLossSummary.hddSource === "legacy"
                      ? "Legacy museum daily totals"
                      : "Current building data"}
                  </p>
                  {!isNewPerformanceDeepDive ? (
                    <p className="text-xs text-gray-600">
                      HLA confidence:{" "}
                      {heatLossSummary.hlaConfidence === "audit-grade"
                        ? "Audit-grade daily baseline"
                        : heatLossSummary.hlaConfidence === "indicative"
                        ? "Indicative interval/weather fallback"
                        : heatLossSummary.hlaConfidence === "live-indicative"
                        ? "Live current-day indication"
                        : "Pending matching energy and temperature data"}
                    </p>
                  ) : null}
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

        {!shouldShowDeepDive || isCarbonCreditTab ? null : (
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
      </div>

      <div className="bg-gray-100 p-4 rounded shadow">
        <h2 className="mb-3 text-lg font-bold">WBP Carbon Credit</h2>

        <div className="relative bg-white rounded border p-4 space-y-4">
          <div className="absolute right-4 top-4">
            <div
              className="text-gray-500"
              aria-label="Carbon credit actions locked"
              title="Carbon credit actions locked"
            >
              <span className="relative inline-block h-4 w-4 rounded-sm border-2 border-current">
                <span className="absolute -top-3 left-1/2 h-3 w-3 -translate-x-1/2 rounded-t-full border-2 border-b-0 border-current" />
              </span>
            </div>
          </div>

          <div className="opacity-35 pr-8">
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <div>
                <p className="text-xs uppercase text-gray-500">Credits</p>
                <p className="text-2xl font-bold leading-tight min-[390px]:text-3xl">
                  {formatNumber(carbonCredits, 4)}
                </p>
                <p className="text-sm font-semibold text-gray-700">WBP-C</p>
                <p className="mt-2 text-sm text-gray-600">
                  <strong>Value:</strong>{" "}
                  {Number.isFinite(intervalCarbonMarketValue)
                    ? formatCurrency(intervalCarbonMarketValue)
                    : "Pending price"}
                </p>
              </div>

              <div className="border-l pl-4">
                <p className="text-xs uppercase text-gray-500">Energy saved</p>
                <p className="text-2xl font-bold leading-tight">
                  {Number.isFinite(carbonIntervalSavingsSummary.totalSavedKwh)
                    ? formatNumber(
                        carbonIntervalSavingsSummary.totalSavedKwh,
                        1
                      )
                    : "--"}
                </p>
                <p className="text-sm font-semibold text-gray-700">kWh</p>
                <p className="mt-2 text-sm text-gray-600">
                  <strong>Value:</strong>{" "}
                  {Number.isFinite(
                    carbonIntervalSavingsSummary.energyCostSavedGbp
                  )
                    ? formatCurrency(
                        carbonIntervalSavingsSummary.energyCostSavedGbp
                      )
                    : "Pending calculation"}
                </p>
              </div>
            </div>
            <div className="mt-4 sm:flex sm:justify-end">
              <button
                type="button"
                disabled={!sellCreditsAvailable}
                className={`w-full rounded border px-3 py-2 text-sm font-semibold sm:w-40 ${
                  sellCreditsAvailable
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-emerald-200 bg-emerald-50/60 text-emerald-700 cursor-not-allowed"
                }`}
              >
                SELL CREDITS
              </button>
            </div>
          </div>

          <button
            type="button"
            className={`w-full rounded border p-4 text-left shadow-sm transition hover:border-gray-400 ${
              evidencePackExportReady
                ? "border-emerald-200 bg-emerald-50"
                : "border-amber-200 bg-amber-50"
            }`}
            onClick={() => setActiveMrvEvidenceField("overview")}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold">Audit Evidence Pack</h3>
                <p className="text-xs text-gray-600">
                  MRV rail readiness for verifier review and portfolio batching.
                </p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold">{evidencePackScore}%</p>
                <p className="text-[10px] uppercase text-gray-500">
                  Audit ready
                </p>
              </div>
            </div>

            <div className="mt-3 h-3 overflow-hidden rounded bg-gray-200">
              <div
                className={`h-full transition-all ${
                  evidencePackScore >= 80
                    ? "bg-emerald-500"
                    : evidencePackScore >= 50
                    ? "bg-amber-500"
                    : "bg-red-500"
                }`}
                style={{ width: `${evidencePackScore}%` }}
              />
            </div>
            <p className="mt-2 text-xs font-semibold text-gray-700">
              Click to view evidence requirements
            </p>
          </button>
        </div>
      </div>

      {activeMrvEvidenceField && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto bg-black/40 p-3 sm:p-6">
              <div className="relative my-6 max-h-[calc(100vh-3rem)] w-full max-w-6xl overflow-y-auto rounded-lg border border-gray-200 bg-white p-5 shadow-2xl sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold">Audit Evidence Pack</h3>
                <p className="text-sm text-gray-600">
                  Review evidence requirements and complete missing items.
                </p>
              </div>
              <button
                type="button"
                className="rounded border border-gray-300 px-2 py-1 text-sm font-semibold"
                onClick={() => setActiveMrvEvidenceField(null)}
              >
                Close
              </button>
            </div>

            <div className="relative space-y-4 text-sm">
              {activeMrvEvidenceField ? (
                <>
                  <div className="grid gap-3 text-xs sm:grid-cols-3">
                    <div className="rounded border border-gray-200 bg-gray-50 p-3">
                      <p className="uppercase text-gray-500">Audit ID</p>
                      <p className="mt-1 font-semibold text-gray-900">
                        {auditReference}
                      </p>
                    </div>
                    <div className="rounded border border-gray-200 bg-gray-50 p-3">
                      <p className="uppercase text-gray-500">Baseline</p>
                      <p className="mt-1 font-semibold text-gray-900">
                        {baselineConfidence.label}
                      </p>
                      <p className="mt-1 text-[11px] text-gray-600">
                        {baselineDateRange || "No complete range yet"}
                      </p>
                    </div>
                    <div className="rounded border border-gray-200 bg-gray-50 p-3">
                      <p className="uppercase text-gray-500">Metered days</p>
                      <p className="mt-1 text-2xl font-bold text-gray-900">
                        {baselineMeteredDays}
                      </p>
                      <p className="mt-1 text-[11px] text-gray-600">
                        {baselineCoverageDays} day span / {heatLossSummary.hddDays || 0} HDD
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                        <span className="font-semibold text-gray-700">
                          Audit readiness
                        </span>
                        <span className="font-bold text-gray-900">
                          {evidencePackScore}%
                        </span>
                      </div>
                      <div className="h-3 overflow-hidden rounded bg-gray-200">
                        <div
                          className={`h-full transition-all ${
                            evidencePackScore >= 80
                              ? "bg-emerald-500"
                              : evidencePackScore >= 50
                              ? "bg-amber-500"
                              : "bg-red-500"
                          }`}
                          style={{ width: `${evidencePackScore}%` }}
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={!evidencePackExportReady}
                      className={`w-full rounded border px-3 py-2 text-sm font-semibold shadow-sm sm:w-auto ${
                        evidencePackExportReady
                          ? "border-gray-300 bg-white text-gray-800"
                          : "cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400"
                      }`}
                      onClick={exportEvidencePack}
                    >
                      Export
                    </button>
                  </div>

                  <div className="space-y-3">
                    {groupedEvidencePackChecks.map((group) => (
                      <div key={group.category} className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <h4 className="text-xs font-bold uppercase text-gray-600">
                            {group.category}
                          </h4>
                          <span className="text-[11px] font-semibold text-gray-500">
                            {group.checks.filter((check) => check.complete).length}/
                            {group.checks.length} ready
                          </span>
                        </div>
                        <div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
                          {group.checks.map((check) => {
                            const canCompleteInApp = Boolean(check.fieldKey);
                            const TileElement = canCompleteInApp ? "button" : "div";
                            return (
                              <TileElement
                                key={check.label}
                                type={canCompleteInApp ? "button" : undefined}
                                onClick={
                                  canCompleteInApp
                                    ? () => setActiveMrvEvidenceField(check.fieldKey)
                                    : undefined
                                }
                                className={`rounded border p-3 text-left ${
                                  check.complete
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                                    : "border-amber-200 bg-amber-50 text-amber-900"
                                } ${
                                  canCompleteInApp
                                    ? "cursor-pointer hover:shadow-sm"
                                    : ""
                                }`}
                              >
                                <p className="font-semibold">
                                  {check.complete ? "Ready" : "Needed"}:{" "}
                                  {check.label}
                                </p>
                                <p className="mt-1 text-[11px]">{check.detail}</p>
                                {canCompleteInApp ? (
                                  <p className="mt-2 text-[11px] font-semibold underline">
                                    {check.complete ? "Edit" : "Complete in app"}
                                  </p>
                                ) : null}
                              </TileElement>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="rounded border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
                    <p className="font-semibold text-gray-800">
                      Verifier approval
                    </p>
                    <p className="mt-1">{verifierRoutingStatus}</p>
                  </div>

                </>
              ) : null}

              {activeMrvEvidenceField !== "overview" ? (
                <div className="absolute inset-0 z-10 flex items-start justify-center overflow-y-auto rounded-lg bg-white/70 p-3 backdrop-blur-[1px] sm:p-6">
                  <div className="w-full max-w-xl rounded-lg border border-gray-200 bg-white p-4 shadow-2xl sm:p-5">
                    <div className="mb-4 flex items-start justify-between gap-4">
                      <div>
                        <h4 className="text-base font-bold">
                          {activeMrvEvidenceField === "baseline"
                            ? "Baseline Confidence"
                            : activeMrvEvidenceField === "intervention"
                            ? "Complete Intervention Evidence"
                            : activeMrvEvidenceField === "ownership"
                            ? "Complete Ownership Declaration"
                            : "Complete Verifier Approval"}
                        </h4>
                        <p className="text-sm text-gray-600">
                          This evidence is saved to this building's MRV pack.
                        </p>
                      </div>
                      <button
                        type="button"
                        className="rounded bg-black px-4 py-2 text-sm font-semibold text-white"
                        onClick={() => setActiveMrvEvidenceField("overview")}
                      >
                        Done
                      </button>
                    </div>

                    <div className="space-y-4">
              {activeMrvEvidenceField === "baseline" ? (
                <>
                  <div
                    className={`rounded border p-3 text-sm ${
                      baselineEvidenceComplete
                        ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                        : hddNormalisedBaseline
                        ? "border-blue-200 bg-blue-50 text-blue-900"
                        : candidateMeteredBaseline
                        ? "border-amber-200 bg-amber-50 text-amber-900"
                        : "border-gray-200 bg-gray-50 text-gray-800"
                    }`}
                  >
                    <p className="font-semibold">
                      {baselineConfidence.label}: {baselineConfidence.detail}
                    </p>
                    <p className="mt-1 text-xs">
                      {baselineDateRange || "No complete metered range yet"}
                    </p>
                    <div className="mt-3 h-2 overflow-hidden rounded bg-white/70">
                      <div
                        className={`h-full ${
                          baselineEvidenceComplete
                            ? "bg-emerald-500"
                            : hddNormalisedBaseline
                            ? "bg-blue-500"
                            : candidateMeteredBaseline
                            ? "bg-amber-500"
                            : "bg-gray-400"
                        }`}
                        style={{ width: `${baselineConfidence.score}%` }}
                      />
                    </div>
                  </div>
                  <div className="grid gap-2 text-xs sm:grid-cols-2">
                    {[
                      {
                        label: "HDD base",
                        value: `${HDD_BASE_TEMP_C} deg C`,
                      },
                      {
                        label: "HDD days",
                        value: `${heatLossSummary.hddDays || 0}`,
                      },
                      {
                        label: "kWh/HDD",
                        value: Number.isFinite(heatLossSummary.kwhPerHdd)
                          ? formatNumber(heatLossSummary.kwhPerHdd, 3)
                          : "Pending",
                      },
                      {
                        label: "Weather-normalised EUI",
                        value: Number.isFinite(
                          heatLossSummary.weatherNormalisedEui
                        )
                          ? `${formatNumber(
                              heatLossSummary.weatherNormalisedEui,
                              1
                            )} kWh/m2/yr`
                          : "Pending",
                      },
                    ].map((metric) => (
                      <div
                        key={metric.label}
                        className="rounded border border-gray-200 bg-gray-50 p-2"
                      >
                        <p className="uppercase text-[10px] text-gray-500">
                          {metric.label}
                        </p>
                        <p className="mt-1 font-semibold text-gray-900">
                          {metric.value}
                        </p>
                      </div>
                    ))}
                  </div>
                  <div className="grid gap-2 text-xs sm:grid-cols-2">
                    {baselineConfidenceSteps.map((step) => (
                      <div
                        key={step.label}
                        className={`rounded border p-2 ${
                          step.complete
                            ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                            : "border-gray-200 bg-gray-50 text-gray-700"
                        }`}
                      >
                        <p className="font-semibold">
                          {step.complete ? "Ready" : "Needed"}: {step.label}
                        </p>
                        <p className="mt-1 text-[11px]">{step.detail}</p>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}

              {activeMrvEvidenceField === "intervention" ? (
                <>
                  <label className="block space-y-1">
                    <span className="font-semibold text-gray-700">
                      Intervention completion date
                    </span>
                    <input
                      type="date"
                      value={mrvEvidence.interventionDate}
                      onChange={(event) =>
                        updateMrvEvidence({
                          interventionDate: event.target.value,
                        })
                      }
                      className="w-full rounded border border-gray-300 px-3 py-2"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="font-semibold text-gray-700">
                      Intervention evidence
                    </span>
                    <textarea
                      value={mrvEvidence.interventionEvidence}
                      onChange={(event) =>
                        updateMrvEvidence({
                          interventionEvidence: event.target.value,
                        })
                      }
                      placeholder="Installer, measures completed, certificate or invoice reference"
                      className="min-h-28 w-full rounded border border-gray-300 px-3 py-2"
                    />
                  </label>
                </>
              ) : null}

              {activeMrvEvidenceField === "ownership" ? (
                <>
                  <label className="block space-y-1">
                    <span className="font-semibold text-gray-700">
                      Property ownership / authority record
                    </span>
                    <input
                      type="text"
                      value={mrvEvidence.ownershipRecordReference || ""}
                      onChange={(event) =>
                        updateMrvEvidence({
                          ownershipRecordReference: event.target.value,
                        })
                      }
                      placeholder="Land Registry title number, tenancy authority, asset ID or consent record"
                      className="w-full rounded border border-gray-300 px-3 py-2"
                    />
                  </label>

                  <label className="block space-y-1">
                    <span className="font-semibold text-gray-700">
                      Upload ownership record
                    </span>
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,application/pdf,image/*"
                      onChange={(event) =>
                        updateMrvEvidence({
                          ownershipRecordFileName:
                            event.target.files?.[0]?.name || "",
                        })
                      }
                      className="block w-full rounded border border-gray-300 px-3 py-2 text-sm"
                    />
                    <span className="block text-xs text-gray-600">
                      {mrvEvidence.ownershipRecordFileName
                        ? `Selected: ${mrvEvidence.ownershipRecordFileName}`
                        : "Stores the document reference for the evidence pack; durable file storage can be connected later."}
                    </span>
                  </label>

                  <label className="flex items-start gap-2 rounded border border-gray-200 bg-gray-50 p-3">
                    <input
                      type="checkbox"
                      checked={mrvEvidence.ownershipConsent}
                      onChange={(event) =>
                        updateMrvEvidence({
                          ownershipConsent: event.target.checked,
                        })
                      }
                      className="mt-1"
                    />
                    <span>
                      <span className="block font-semibold text-gray-700">
                        Credit assignment and no-double-counting declaration
                      </span>
                      <span className="text-xs text-gray-600">
                        Confirms the carbon saving claim will not be sold or
                        assigned through another registry or programme.
                      </span>
                    </span>
                  </label>
                </>
              ) : null}

              {activeMrvEvidenceField === "verifier" ? (
                <>
                  <label className="block space-y-1">
                    <span className="font-semibold text-gray-700">
                      Verifier
                    </span>
                    <input
                      type="text"
                      value={mrvEvidence.verifierName}
                      onChange={(event) =>
                        updateMrvEvidence({ verifierName: event.target.value })
                      }
                      placeholder="e.g. DNV, TUV, Bureau Veritas"
                      className="w-full rounded border border-gray-300 px-3 py-2"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="font-semibold text-gray-700">
                      Verifier status
                    </span>
                    <select
                      value={mrvEvidence.verifierStatus}
                      onChange={(event) =>
                        updateMrvEvidence({
                          verifierStatus: event.target.value,
                        })
                      }
                      className="w-full rounded border border-gray-300 px-3 py-2"
                    >
                      <option value="pre-verification">Pre-verification</option>
                      <option value="pre-assessment">Pre-assessment</option>
                      <option value="submitted">Submitted</option>
                      <option value="approved">Approved</option>
                    </select>
                  </label>
                </>
              ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
              </div>
            </div>,
            document.body
          )
        : null}
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
          {BUILDINGS.map((building) => {
            const isActiveSlide = activeBuilding.id === building.id;

            return (
              <div
                key={building.id}
                className={isActiveSlide ? "h-auto" : "h-0 overflow-hidden"}
                aria-hidden={!isActiveSlide}
                style={{ width: `${100 / BUILDINGS.length}%` }}
              >
                {building.setupOnly ? (
                  <NewBuildingSetupPanel />
                ) : (
                  <BuildingDashboardPanel building={building} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default BuildingDashboard;

