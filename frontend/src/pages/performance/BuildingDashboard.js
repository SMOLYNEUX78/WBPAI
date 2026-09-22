import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import AnalogGauge from "../../components/AnalogGauge";
import supabase from "../../supabaseClient";
import { TEST_PROFESSIONAL_EMAIL } from "../../professionalEmail";
import govukCrown from "../../assets/govuk-crown.png";
import matterportMark from "../../assets/matterport-mark.png";

const DEFAULT_MATTERPORT_URL = "https://my.matterport.com/show/?m=zHm8SwWeHiN";
const HDD_BASE_TEMP_C = 15.5;
const FALLBACK_CARBON_PRICE_GBP_PER_TONNE = 65;
const CARBON_SAVINGS_CALCULATION_VERSION = "enerphit-certified-v3";
const CARBON_SAVINGS_SCENARIO = "enerphit-certified-v3";
const LEGACY_CARBON_SAVINGS_SCENARIO = "enerphit-certified";
const CARBON_SAVINGS_ENERGY_VALUE_METHOD =
  "saved_kwh_x_measured_baseline_blended_tariff";
const CARBON_INTERVAL_SAVINGS_CACHE_KEY = "carbonIntervalSavingsSummary:v4";
const CARBON_SUMMARY_REFRESH_MS = 12 * 60 * 60 * 1000;
const DASHBOARD_SNAPSHOT_REFRESH_MS = 5 * 60 * 1000;
const HEAVY_DASHBOARD_REFRESH_EVERY = 6;
const RAIN_HUMIDITY_LOOKBACK_DAYS = 180;
const MIN_BASELINE_METERED_DAYS = 7;
const MIN_BASELINE_HDD_DAYS = 14;
const MIN_RELIABLE_HDD_TOTAL = 10;
const MIN_RELIABLE_HTC_SAMPLES = 7;
const MIN_RELIABLE_HTC_DELTA_TOTAL = 35;
const NIGHT_COOLDOWN_HEAT_CAPACITY_KJ_PER_M2K = 165;
const MIN_SEASONAL_BASELINE_DAYS = 90;
const MIN_FULL_YEAR_BASELINE_DAYS = 365;
const MIN_FULL_YEAR_METERED_DAYS = 300;
const SEASON_NAMES = ["Summer", "Autumn", "Winter", "Spring"];

const PROPERTY_DISCOVERY_CACHE_KEY = "wbp-property-discovery-draft:v1";
const PROPERTY_DISCOVERY_DATASETS = [
  "planning-application",
  "listed-building",
  "conservation-area",
  "article-4-direction-area",
  "tree-preservation-zone",
  "flood-risk-zone",
];

const normalisePostcode = (value = "") => value.trim().toUpperCase().replace(/\s+/g, " ");

const sourceStatusClasses = {
  found: "border-emerald-200 bg-emerald-50 text-emerald-900",
  checked: "border-blue-200 bg-blue-50 text-blue-900",
  action: "border-amber-200 bg-amber-50 text-amber-900",
  unavailable: "border-gray-200 bg-gray-50 text-gray-600",
};

const getMeteorologicalSeason = (date = new Date()) => {
  const month = date.getUTCMonth();
  const year = date.getUTCFullYear();

  if (month >= 5 && month <= 7) {
    return {
      name: "Summer",
      key: `Summer-${year}`,
      year,
      startDate: `${year}-06-01`,
      endDate: `${year}-08-31`,
    };
  }

  if (month >= 8 && month <= 10) {
    return {
      name: "Autumn",
      key: `Autumn-${year}`,
      year,
      startDate: `${year}-09-01`,
      endDate: `${year}-11-30`,
    };
  }

  if (month <= 1) {
    return {
      name: "Winter",
      key: `Winter-${year}`,
      year,
      startDate: `${year - 1}-12-01`,
      endDate: `${year}-02-${year % 4 === 0 ? "29" : "28"}`,
    };
  }

  if (month === 11) {
    return {
      name: "Winter",
      key: `Winter-${year + 1}`,
      year: year + 1,
      startDate: `${year}-12-01`,
      endDate: `${year + 1}-02-${(year + 1) % 4 === 0 ? "29" : "28"}`,
    };
  }

  return {
    name: "Spring",
    key: `Spring-${year}`,
    year,
    startDate: `${year}-03-01`,
    endDate: `${year}-05-31`,
  };
};

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
    id: "new",
    name: "New",
    subtitle: "New building setup",
    setupOnly: true,
  },
  {
    ...HOME_BUILDING,
    id: "home",
    name: "WBP-001",
  },
  {
    ...HOME_BUILDING,
    id: "cc",
    name: "WBP-001cc",
    subtitle: "Carbon credit token workspace",
    dataSourceId: "home",
  },
  {
    id: "portfolio",
    name: "Portfolio",
    subtitle: "Social housing portfolio management",
    portfolioOnly: true,
  },
  {
    id: "exchange",
    name: "Exchange",
    subtitle: "Portfolio credit marketplace",
    exchangeOnly: true,
  },
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
  const activeSeasonInfo = useMemo(() => getMeteorologicalSeason(), []);
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
    fromDate: null,
    toDate: null,
    calculatedAt: null,
    dailyRows: null,
    latestTimestamp: null,
    latestSavedKgCo2e: null,
    totalSavedKgCo2e: null,
    totalSavedKwh: null,
    energyCostSavedGbp: null,
    carbonCredits: null,
    calculationVersion: null,
    calculationStatus: "pending",
  };
  const defaultHeatLossSummary = {
    kwhPerHdd: null,
    weatherNormalisedEui: null,
    htcEstimate: null,
    hddDays: 0,
    hddTotal: 0,
    htcSamples: 0,
    htcDeltaTotal: 0,
    nightCooldownHtc: null,
    nightCooldownTauHours: null,
    nightCooldownRateCPerHour: null,
    nightCooldownNights: 0,
    nightCooldownSamples: 0,
    hddSource: "current",
    hlaConfidence: "pending",
    auditKwhPerHdd: null,
    auditHtcEstimate: null,
    averageInternalTemp: null,
    comfortHddDays: 0,
    flatlineIndoorTemp: false,
    filteredInsideReadings: 0,
  };
  const defaultHeatExclusionSummary = {
    averageBuffer: null,
    sampleCount: 0,
    overheatingShare: null,
    hotThreshold: 24,
  };
  const defaultRainHumiditySummary = {
    rainySamples: 0,
    drySamples: 0,
    averageRainyRh: null,
    averageDryRh: null,
    rhUplift: null,
    correlation: null,
    maxRainfallMm: null,
    windowDays: RAIN_HUMIDITY_LOOKBACK_DAYS,
    status: "pending",
  };
  const defaultPerformanceSummary = {
    value: null,
    breakdown: {
      health: null,
      energy: null,
      hla: null,
      resilience: null,
      iaq: null,
      comfort: null,
      humidity: null,
    },
  };
  const defaultMrvEvidence = {
    baselineStartDate: "",
    baselineEndDate: "",
    baselineLocked: false,
    interventionDate: "",
    interventionEvidence: "",
    architectName: "",
    retrofitCoordinatorName: "",
    principalContractorName: "",
    installerNames: "",
    pasReference: "",
    trustMarkReference: "",
    warrantyReference: "",
    defectsAndRemediation: "",
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
      `${dataSourceBuildingId}:${CARBON_INTERVAL_SAVINGS_CACHE_KEY}`,
      defaultCarbonIntervalSavingsSummary
    );
  const hasUsableCarbonIntervalSummary = (summary) =>
    Number.isFinite(Number(summary?.carbonCredits)) &&
    Number(summary.carbonCredits) >= 0 &&
    Number.isFinite(Number(summary?.totalSavedKgCo2e)) &&
    Number(summary.totalSavedKgCo2e) >= 0 &&
    Number.isFinite(Number(summary?.totalSavedKwh)) &&
    Number(summary.totalSavedKwh) >= 0 &&
    Number.isFinite(Number(summary?.energyCostSavedGbp)) &&
    Number(summary.energyCostSavedGbp) >= 0;
  const normaliseCarbonIntervalSummary = (summary) =>
    hasUsableCarbonIntervalSummary(summary)
      ? {
          ...summary,
          dailyRows: Number.isFinite(Number(summary.dailyRows))
            ? Number(summary.dailyRows)
            : null,
          latestSavedKgCo2e: Number.isFinite(Number(summary.latestSavedKgCo2e))
            ? Number(summary.latestSavedKgCo2e)
            : null,
          totalSavedKgCo2e: Number(summary.totalSavedKgCo2e),
          totalSavedKwh: Number(summary.totalSavedKwh),
          energyCostSavedGbp: Number(summary.energyCostSavedGbp),
          carbonCredits: Number(summary.carbonCredits),
          calculationVersion: summary.calculationVersion || null,
          calculationStatus: summary.calculationStatus || "current",
        }
      : defaultCarbonIntervalSavingsSummary;
  const carbonIntervalSummaryTime = (summary) => {
    const candidates = [
      summary?.calculatedAt,
      summary?.latestTimestamp,
      summary?.toDate,
    ];

    for (const candidate of candidates) {
      const parsedTime = Date.parse(candidate);
      if (Number.isFinite(parsedTime)) {
        return parsedTime;
      }
    }

    return null;
  };
  const isOlderCarbonIntervalSummary = (nextSummary, currentSummary) => {
    if (!hasUsableCarbonIntervalSummary(currentSummary)) {
      return false;
    }

    const nextTime = carbonIntervalSummaryTime(nextSummary);
    const currentTime = carbonIntervalSummaryTime(currentSummary);

    if (Number.isFinite(nextTime) && Number.isFinite(currentTime)) {
      return nextTime < currentTime;
    }

    const nextRows = Number(nextSummary?.dailyRows);
    const currentRows = Number(currentSummary?.dailyRows);

    return Number.isFinite(nextRows) &&
      Number.isFinite(currentRows) &&
      nextRows < currentRows;
  };
  const readCachedWeeklyTrendData = () =>
    readCachedDashboardState(`${dataSourceBuildingId}:weeklyTrendData`, []);
  const readCachedSeasonalTrendArchive = () => {
    const cachedArchive = readCachedDashboardState(
      `${dataSourceBuildingId}:seasonalTrendArchive:v1`,
      { seasons: {} }
    );

    return {
      seasons:
        cachedArchive && typeof cachedArchive.seasons === "object"
          ? cachedArchive.seasons
          : {},
    };
  };
  const readCachedHeatLossSummary = () =>
    readCachedDashboardState(
      `${dataSourceBuildingId}:heatLossSummary`,
      defaultHeatLossSummary
    );
  const readCachedHeatExclusionSummary = () =>
    readCachedDashboardState(
      `${dataSourceBuildingId}:heatExclusionSummary`,
      defaultHeatExclusionSummary
    );
  const readCachedRainHumiditySummary = () =>
    readCachedDashboardState(
      `${dataSourceBuildingId}:rainHumiditySummary`,
      defaultRainHumiditySummary
    );
  const readCachedPerformanceSummary = () =>
    readCachedDashboardState(
      `${dataSourceBuildingId}:performanceSummary:v2`,
      defaultPerformanceSummary
    );
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

  const [performanceValue, setPerformanceValue] = useState(() => {
    const cachedPerformanceSummary = readCachedPerformanceSummary();
    return Number.isFinite(cachedPerformanceSummary.value)
      ? cachedPerformanceSummary.value
      : null;
  });
  const [historicalPerformance, setHistoricalPerformance] = useState(() => {
    const cachedEnergySummary = readCachedEnergySummary();
    return Number.isFinite(cachedEnergySummary.totalDailyAverage)
      ? cachedEnergySummary.totalDailyAverage
      : null;
  });
  const [carbonIntervalSavingsSummary, setCarbonIntervalSavingsSummary] = useState(
    () => normaliseCarbonIntervalSummary(readCachedCarbonIntervalSavingsSummary())
  );
  const carbonIntervalSavingsSummaryRef = useRef(carbonIntervalSavingsSummary);
  const [carbonCredits, setCarbonCredits] = useState(() => {
    const cachedCarbonIntervalSummary = normaliseCarbonIntervalSummary(
      readCachedCarbonIntervalSavingsSummary()
    );
    return Number.isFinite(cachedCarbonIntervalSummary.carbonCredits)
      ? cachedCarbonIntervalSummary.carbonCredits
      : null;
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

  const [performanceBreakdown, setPerformanceBreakdown] = useState(() => {
    const cachedPerformanceSummary = readCachedPerformanceSummary();
    return {
      ...defaultPerformanceSummary.breakdown,
      ...(cachedPerformanceSummary.breakdown || {}),
    };
  });
  const [heatLossSummary, setHeatLossSummary] = useState(
    readCachedHeatLossSummary
  );
  const [heatExclusionSummary, setHeatExclusionSummary] = useState(
    readCachedHeatExclusionSummary
  );
  const [rainHumiditySummary, setRainHumiditySummary] = useState(
    readCachedRainHumiditySummary
  );
  const [weeklyTrendData, setWeeklyTrendData] = useState(readCachedWeeklyTrendData);
  const [seasonalTrendArchive, setSeasonalTrendArchive] = useState(
    readCachedSeasonalTrendArchive
  );
  const [selectedTrendSeason, setSelectedTrendSeason] = useState(
    activeSeasonInfo.name
  );
  const [selectedTrendMetricKeys, setSelectedTrendMetricKeys] = useState([]);
  const [selectedHealthTrendArea, setSelectedHealthTrendArea] = useState("all");
  const [hoveredTrendSlot, setHoveredTrendSlot] = useState(null);

  useEffect(() => {
    if (!weeklyTrendData.length || activeSeasonInfo.name !== "Summer") {
      return;
    }

    setSeasonalTrendArchive((currentArchive) => {
      const currentSeason = currentArchive?.seasons?.[activeSeasonInfo.key];

      if (Array.isArray(currentSeason?.data) && currentSeason.data.length > 0) {
        return currentArchive;
      }

      const capturedAt = new Date().toISOString();
      const nextArchive = {
        seasons: {
          ...(currentArchive?.seasons || {}),
          [activeSeasonInfo.key]: {
            ...activeSeasonInfo,
            capturedAt,
            status:
              new Date(`${activeSeasonInfo.endDate}T23:59:59.999Z`) < new Date()
                ? "complete"
                : "active",
            data: weeklyTrendData,
          },
        },
      };

      localStorage.setItem(
        `${dataSourceBuildingId}:seasonalTrendArchive:v1`,
        JSON.stringify(nextArchive)
      );
      supabase
        .from("BuildingLatestSnapshot")
        .update({
          weekly_trend: nextArchive,
          updated_at: capturedAt,
        })
        .eq("building_id", dataSourceBuildingId)
        .then(({ error }) => {
          if (error) {
            console.error("Error persisting seasonal trend archive:", error.message);
          }
        });
      return nextArchive;
    });
  }, [activeSeasonInfo, dataSourceBuildingId, weeklyTrendData]);

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
    indoorOnly = false,
    limit,
    orderDescending = false,
    readingTypes,
    rangeFrom,
    rangeTo,
    timestampFrom,
    timestampTo,
  } = {}) => {
    const runQuery = async (includeExtended) => {
      const valueColumns = [
        "temperature_inside",
        ...(indoorOnly ? [] : ["temperature_outside"]),
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

      if (timestampFrom) {
        query = query.gte("timestamp", timestampFrom);
      }

      if (timestampTo) {
        query = query.lt("timestamp", timestampTo);
      }

      if (orderDescending) {
        query = query.order("timestamp", { ascending: false });
      } else if (timestampFrom || timestampTo) {
        query = query.order("timestamp", { ascending: true });
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
  const pearsonCorrelation = (pairs) => {
    if (pairs.length < 3) {
      return null;
    }

    const averageX = average(pairs.map((pair) => pair.x));
    const averageY = average(pairs.map((pair) => pair.y));
    const numerator = pairs.reduce(
      (sum, pair) => sum + (pair.x - averageX) * (pair.y - averageY),
      0
    );
    const denominatorX = Math.sqrt(
      pairs.reduce((sum, pair) => sum + (pair.x - averageX) ** 2, 0)
    );
    const denominatorY = Math.sqrt(
      pairs.reduce((sum, pair) => sum + (pair.y - averageY) ** 2, 0)
    );

    if (denominatorX === 0 || denominatorY === 0) {
      return null;
    }

    return numerator / (denominatorX * denominatorY);
  };

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

  const dysonRoomKey = (readingType) =>
    String(readingType || "").replace(/^dyson:/, "");
  const isDownstairsDysonReading = (readingType) => {
    const roomKey = dysonRoomKey(readingType);

    return roomKey === "living_room" || roomKey === "downstairs";
  };
  const normaliseRoomLabel = (readingType) => {
    const roomKey = dysonRoomKey(readingType);

    if (isDownstairsDysonReading(readingType)) {
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
  const roomSupportsIaqMetric = (room, metricKey) => {
    if (!room || !isDownstairsDysonReading(room.key)) {
      return true;
    }

    return ["internalTemp", "humidity", "vocs", "pm25"].includes(metricKey);
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

      return (
        Number.isFinite(inside) &&
        Number.isFinite(outside) &&
        inside !== 0 &&
        outside !== 0 &&
        outside >= 24
      );
    });

    const coldRows = rows.filter((row) => {
      const inside = Number(row.temperature_inside);
      const outside = Number(row.temperature_outside);

      return (
        Number.isFinite(inside) &&
        Number.isFinite(outside) &&
        inside !== 0 &&
        outside !== 0 &&
        outside <= 10
      );
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

  const fetchCompactDailyEnergyHistory = async () => {
    const { data, error } = await supabase
      .from("CarbonSavingsDaily")
      .select("saving_date, baseline_electricity_kwh, baseline_gas_kwh")
      .eq("building_id", dataSourceBuildingId)
      .eq("scenario", CARBON_SAVINGS_SCENARIO)
      .order("saving_date", { ascending: true })
      .limit(500);

    if (error) {
      console.warn("Compact daily energy history unavailable:", error.message);
      return [];
    }

    const today = new Date().toISOString().slice(0, 10);
    return (data || []).filter((row) => row.saving_date < today);
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
    const safeCarbonIntervalSummary = normaliseCarbonIntervalSummary(
      nextCarbonIntervalSavingsSummary
    );

    if (!hasUsableCarbonIntervalSummary(safeCarbonIntervalSummary)) {
      return;
    }

    if (
      isOlderCarbonIntervalSummary(
        safeCarbonIntervalSummary,
        carbonIntervalSavingsSummaryRef.current
      )
    ) {
      return;
    }

    carbonIntervalSavingsSummaryRef.current = safeCarbonIntervalSummary;
    setCarbonIntervalSavingsSummary(safeCarbonIntervalSummary);
    setCarbonCredits(safeCarbonIntervalSummary.carbonCredits);
    localStorage.setItem(
      `${dataSourceBuildingId}:${CARBON_INTERVAL_SAVINGS_CACHE_KEY}`,
      JSON.stringify(safeCarbonIntervalSummary)
    );
    localStorage.removeItem(`${dataSourceBuildingId}:carbonIntervalSavingsSummary:v3`);
    localStorage.removeItem(`${dataSourceBuildingId}:carbonIntervalSavingsSummary:v2`);
    localStorage.removeItem(`${dataSourceBuildingId}:carbonIntervalSavingsSummary`);
  };
  const applyWeeklyTrendData = (
    nextWeeklyTrendData,
    seasonInfo = getMeteorologicalSeason()
  ) => {
    setWeeklyTrendData(nextWeeklyTrendData);
    localStorage.setItem(
      `${dataSourceBuildingId}:weeklyTrendData`,
      JSON.stringify(nextWeeklyTrendData)
    );
    setSeasonalTrendArchive((currentArchive) => {
      const capturedAt = new Date().toISOString();
      const nextArchive = {
        seasons: {
          ...(currentArchive?.seasons || {}),
          [seasonInfo.key]: {
            ...seasonInfo,
            capturedAt,
            status:
              new Date(`${seasonInfo.endDate}T23:59:59.999Z`) < new Date()
                ? "complete"
                : "active",
            data: nextWeeklyTrendData,
          },
        },
      };

      localStorage.setItem(
        `${dataSourceBuildingId}:seasonalTrendArchive:v1`,
        JSON.stringify(nextArchive)
      );
      supabase
        .from("BuildingLatestSnapshot")
        .update({
          weekly_trend: nextArchive,
          updated_at: capturedAt,
        })
        .eq("building_id", dataSourceBuildingId)
        .then(({ error }) => {
          if (error) {
            console.error("Error persisting seasonal trend archive:", error.message);
          }
        });
      return nextArchive;
    });
  };
  const applyDashboardSnapshot = (snapshot) => {
    if (!snapshot) {
      return false;
    }

    const snapshotEnergySummary = snapshot.energy_summary;
    if (snapshotEnergySummary && typeof snapshotEnergySummary === "object") {
      const nextEnergySummary = {
        ...defaultEnergySummary,
        ...snapshotEnergySummary,
      };
      applyEnergySummary(nextEnergySummary, nextEnergySummary.totalDailyAverage);
    }

    const snapshotIaqSummary = snapshot.iaq_summary;
    if (snapshotIaqSummary && typeof snapshotIaqSummary === "object") {
      if (
        snapshotIaqSummary.latestIaq &&
        typeof snapshotIaqSummary.latestIaq === "object"
      ) {
        setSensorData((prev) => {
          const nextSensorData = {
            ...prev,
            ...snapshotIaqSummary.latestIaq,
          };

          localStorage.setItem(
            `${dataSourceBuildingId}:latestIaq`,
            JSON.stringify(nextSensorData)
          );
          return nextSensorData;
        });
      }

      if (Array.isArray(snapshotIaqSummary.roomIaq)) {
        setRoomIaqData(snapshotIaqSummary.roomIaq);
        localStorage.setItem(
          `${dataSourceBuildingId}:roomIaq`,
          JSON.stringify(snapshotIaqSummary.roomIaq)
        );
      }
    }

    const snapshotWeatherSummary = snapshot.weather_summary;
    if (
      snapshotWeatherSummary &&
      typeof snapshotWeatherSummary === "object" &&
      Number.isFinite(Number(snapshotWeatherSummary.externalTemp))
    ) {
      setSensorData((prev) => {
        const nextSensorData = {
          ...prev,
          externalTemp: Number(snapshotWeatherSummary.externalTemp),
        };

        localStorage.setItem(
          `${dataSourceBuildingId}:latestIaq`,
          JSON.stringify(nextSensorData)
        );
        return nextSensorData;
      });
    }

    const snapshotRainHumiditySummary = snapshot.rain_humidity_summary;
    if (
      snapshotRainHumiditySummary &&
      typeof snapshotRainHumiditySummary === "object" &&
      Object.keys(snapshotRainHumiditySummary).length > 0
    ) {
      const nextRainHumiditySummary = {
        ...defaultRainHumiditySummary,
        ...snapshotRainHumiditySummary,
      };
      setRainHumiditySummary(nextRainHumiditySummary);
      localStorage.setItem(
        `${dataSourceBuildingId}:rainHumiditySummary`,
        JSON.stringify(nextRainHumiditySummary)
      );
    }

    const snapshotPerformanceSummary = snapshot.performance_summary;
    if (
      snapshotPerformanceSummary &&
      typeof snapshotPerformanceSummary === "object" &&
      Number.isFinite(Number(snapshotPerformanceSummary.value))
    ) {
      const nextPerformanceSummary = {
        ...defaultPerformanceSummary,
        ...snapshotPerformanceSummary,
        breakdown: {
          ...defaultPerformanceSummary.breakdown,
          ...(snapshotPerformanceSummary.breakdown || {}),
        },
      };
      setPerformanceValue(Number(nextPerformanceSummary.value));
      setPerformanceBreakdown(nextPerformanceSummary.breakdown);
      localStorage.setItem(
        `${dataSourceBuildingId}:performanceSummary:v2`,
        JSON.stringify(nextPerformanceSummary)
      );
    }

    const snapshotWeeklyTrend = snapshot.weekly_trend;
    if (
      snapshotWeeklyTrend?.seasons &&
      typeof snapshotWeeklyTrend.seasons === "object"
    ) {
      const nextArchive = { seasons: snapshotWeeklyTrend.seasons };
      const activeSeasonRecord = snapshotWeeklyTrend.seasons[activeSeasonInfo.key];

      setSeasonalTrendArchive(nextArchive);
      localStorage.setItem(
        `${dataSourceBuildingId}:seasonalTrendArchive:v1`,
        JSON.stringify(nextArchive)
      );

      if (Array.isArray(activeSeasonRecord?.data)) {
        applyWeeklyTrendData(activeSeasonRecord.data, activeSeasonRecord);
      }
    } else if (Array.isArray(snapshotWeeklyTrend?.data)) {
      const snapshotHasFloorHumidity = snapshotWeeklyTrend.data.some(
        (point) =>
          Number.isFinite(Number(point?.upstairsHumidity)) ||
          Number.isFinite(Number(point?.downstairsHumidity))
      );
      const currentHasFloorHumidity = weeklyTrendData.some(
        (point) =>
          Number.isFinite(Number(point?.upstairsHumidity)) ||
          Number.isFinite(Number(point?.downstairsHumidity))
      );

      if (snapshotHasFloorHumidity || !currentHasFloorHumidity) {
        applyWeeklyTrendData(snapshotWeeklyTrend.data);
      }
    }

    return true;
  };
  const fetchDashboardSnapshot = async () => {
    try {
      const { data, error } = await supabase
        .from("BuildingLatestSnapshot")
        .select(
          "calculated_at, energy_summary, iaq_summary, weather_summary, rain_humidity_summary, performance_summary, weekly_trend"
        )
        .eq("building_id", dataSourceBuildingId)
        .maybeSingle();

      if (
        error &&
        /BuildingLatestSnapshot|schema cache|does not exist/i.test(
          error.message || ""
        )
      ) {
        return false;
      }

      if (error) {
        throw error;
      }

      applyDashboardSnapshot(data);
      return data || null;
    } catch (err) {
      console.error("Error fetching dashboard snapshot:", err.message);
      return false;
    }
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
      const [
        completedDailyData,
        todayDailyData,
        gasIntervalData,
        compactDailyHistory,
      ] = await Promise.all([
        fetchEnergyDailyTotals({ beforeToday: true }),
        fetchEnergyDailyTotals({ beforeToday: false }),
        fetchGasIntervalRows(),
        fetchCompactDailyEnergyHistory(),
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
        const compactHistoryByDay = (compactDailyHistory || []).reduce(
          (days, row) => {
            const electricity = Number(row.baseline_electricity_kwh);
            const gas = Number(row.baseline_gas_kwh);
            days[row.saving_date] = {
              electricity: Number.isFinite(electricity) ? electricity : null,
              gas: Number.isFinite(gas) ? gas : null,
            };
            return days;
          },
          {}
        );
        const hasCompactHistory = Object.keys(compactHistoryByDay).length > 0;
        const completedBaselineDays = (
          hasCompactHistory
            ? Object.keys(compactHistoryByDay)
            : Object.keys(completedDailyTotalsByDay)
        ).sort();
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

        const dailyValues = (fuelType) => {
          if (hasCompactHistory) {
            return Object.values(compactHistoryByDay)
              .map((day) => day[fuelType])
              .filter((value) => Number.isFinite(value));
          }

          return Object.entries(completedDailyTotalsByFuel)
            .filter(([key]) => key.startsWith(`${fuelType}:`))
            .map(([, value]) => value);
        };

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
          historicalEnergySource: hasCompactHistory
            ? "CarbonSavingsDaily completed days"
            : "EnergyReadings fallback",
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
      const temperatureRows = [];
      const temperaturePageSize = 1000;
      const maxTemperaturePages = 120;
      const temperatureWindowStart = new Date(
        Date.now() - 45 * 24 * 60 * 60 * 1000
      ).toISOString();

      for (let page = 0; page < maxTemperaturePages; page += 1) {
        const { data, error } = await applyBuildingScope(
          supabase
            .from("Readings")
            .select("timestamp, temperature_inside, temperature_outside")
            .or("temperature_inside.not.is.null,temperature_outside.not.is.null")
            .gte("timestamp", temperatureWindowStart)
            .order("timestamp", { ascending: false })
            .range(
              page * temperaturePageSize,
              (page + 1) * temperaturePageSize - 1
            )
        );

        if (error) throw error;

        temperatureRows.push(...(data || []));

        if (!data || data.length < temperaturePageSize) {
          break;
        }
      }

      const temperatureRowsByTimestamp = Array.from(
        new Map(
          temperatureRows
            .filter((row) => row?.timestamp)
            .map((row) => [row.timestamp, row])
        ).values()
      );
      const indoorTemperatureRows = temperatureRowsByTimestamp;
      const outdoorTemperatureRows = temperatureRowsByTimestamp;

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

      const calculateNightCooldownHtc = () => {
        const validNightSamples = temperatureRowsByTimestamp
          .map((row) => {
            const timestamp = new Date(row.timestamp);
            const inside = Number(row.temperature_inside);
            const outside = Number(row.temperature_outside);

            if (
              Number.isNaN(timestamp.getTime()) ||
              !Number.isFinite(inside) ||
              !Number.isFinite(outside)
            ) {
              return null;
            }

            const hour = timestamp.getUTCHours();

            if (!(hour >= 22 || hour < 6)) {
              return null;
            }

            const nightDate = new Date(timestamp);
            if (hour < 6) {
              nightDate.setUTCDate(nightDate.getUTCDate() - 1);
            }

            const delta = inside - outside;

            if (delta <= 1.5) {
              return null;
            }

            return {
              night: nightDate.toISOString().slice(0, 10),
              timestamp,
              inside,
              outside,
              delta,
            };
          })
          .filter(Boolean);
        const nights = validNightSamples.reduce((groups, sample) => {
          groups[sample.night] = groups[sample.night] || [];
          groups[sample.night].push(sample);
          return groups;
        }, {});
        const acceptedNights = [];

        Object.entries(nights).forEach(([night, samples]) => {
          const sortedSamples = samples
            .slice()
            .sort((a, b) => a.timestamp - b.timestamp);
          const first = sortedSamples[0];
          const last = sortedSamples[sortedSamples.length - 1];
          const spanHours = (last.timestamp - first.timestamp) / 3600000;

          if (sortedSamples.length < 6 || spanHours < 3) {
            return;
          }

          const firstDelta = first.delta;
          const lastDelta = last.delta;

          if (firstDelta < 2 || firstDelta - lastDelta < 0.25) {
            return;
          }

          const xMean =
            sortedSamples.reduce(
              (sum, sample) => sum + (sample.timestamp - first.timestamp) / 3600000,
              0
            ) / sortedSamples.length;
          const yValues = sortedSamples.map((sample) => Math.log(sample.delta));
          const yMean =
            yValues.reduce((sum, value) => sum + value, 0) / yValues.length;
          const { numerator, denominator } = sortedSamples.reduce(
            (acc, sample, index) => {
              const x = (sample.timestamp - first.timestamp) / 3600000;
              const y = yValues[index];
              acc.numerator += (x - xMean) * (y - yMean);
              acc.denominator += (x - xMean) ** 2;
              return acc;
            },
            { numerator: 0, denominator: 0 }
          );

          if (denominator <= 0) {
            return;
          }

          const slopePerHour = numerator / denominator;

          if (!Number.isFinite(slopePerHour) || slopePerHour >= -0.002) {
            return;
          }

          const tauHours = -1 / slopePerHour;
          const areaM2 = Number.isFinite(area) && area > 0 ? area : 99.2;
          const thermalCapacityJPerK =
            areaM2 * NIGHT_COOLDOWN_HEAT_CAPACITY_KJ_PER_M2K * 1000;
          const htcEstimate = thermalCapacityJPerK / (tauHours * 3600);

          if (!Number.isFinite(htcEstimate) || htcEstimate <= 0) {
            return;
          }

          acceptedNights.push({
            night,
            samples: sortedSamples.length,
            tauHours,
            htcEstimate,
            coolingRateCPerHour: (first.inside - last.inside) / spanHours,
          });
        });

        if (acceptedNights.length === 0) {
          return {
            nightCooldownHtc: null,
            nightCooldownTauHours: null,
            nightCooldownRateCPerHour: null,
            nightCooldownNights: 0,
            nightCooldownSamples: 0,
          };
        }

        return {
          nightCooldownHtc: average(
            acceptedNights.map((night) => night.htcEstimate)
          ),
          nightCooldownTauHours: average(
            acceptedNights.map((night) => night.tauHours)
          ),
          nightCooldownRateCPerHour: average(
            acceptedNights.map((night) => night.coolingRateCPerHour)
          ),
          nightCooldownNights: acceptedNights.length,
          nightCooldownSamples: acceptedNights.reduce(
            (sum, night) => sum + night.samples,
            0
          ),
        };
      };

      const calculateHeatLossFromDailyEnergy = (energyByDay) => {
        let nextHddTotal = 0;
        let nextHddEnergyTotal = 0;
        let nextHtcTotal = 0;
        let nextHddDays = 0;
        let nextHtcSamples = 0;
        let nextHtcDeltaTotal = 0;
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
            const temperatureDelta = insideAverage - outsideAverage;
            const averagePowerWatts = (totalKwh * 1000) / sampleHours;
            nextHtcTotal += averagePowerWatts / temperatureDelta;
            nextHtcDeltaTotal += temperatureDelta;
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
          hddTotal: nextHddTotal,
          htcSamples: nextHtcSamples,
          htcDeltaTotal: nextHtcDeltaTotal,
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
        hddTotal: Number.isFinite(currentHdd) && currentHdd > 0 ? currentHdd : 0,
        htcSamples: Number.isFinite(liveHtcEstimate) ? 1 : 0,
        htcDeltaTotal:
          Number.isFinite(todayInsideAverage) &&
          Number.isFinite(todayOutsideAverage) &&
          todayInsideAverage > todayOutsideAverage
            ? todayInsideAverage - todayOutsideAverage
            : 0,
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
        hddTotal: hddSampleSource.hddTotal || 0,
        htcSamples: htcSampleSource.htcSamples || 0,
        htcDeltaTotal: htcSampleSource.htcDeltaTotal || 0,
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
      const nightCooldownSummary = calculateNightCooldownHtc();

      const nextHeatLossSummary = {
        kwhPerHdd: displayedHeatLoss.kwhPerHdd,
        weatherNormalisedEui: displayedHeatLoss.weatherNormalisedEui,
        htcEstimate: displayedHeatLoss.htcEstimate,
        hddDays: displayedHeatLoss.hddDays || 0,
        hddTotal: displayedHeatLoss.hddTotal || 0,
        htcSamples: displayedHeatLoss.htcSamples || 0,
        htcDeltaTotal: displayedHeatLoss.htcDeltaTotal || 0,
        hddSource: displayedHeatLoss.hddSource || "current",
        hlaConfidence: displayedHeatLoss.hlaConfidence,
        hddConfidence: displayedHeatLoss.hddConfidence,
        htcConfidence: displayedHeatLoss.htcConfidence,
        auditKwhPerHdd: auditHeatLoss.kwhPerHdd,
        auditHtcEstimate: auditHeatLoss.htcEstimate,
        averageInternalTemp: displayedHeatLoss.averageInternalTemp,
        comfortHddDays: displayedHeatLoss.comfortHddDays || 0,
        nightCooldownHtc: nightCooldownSummary.nightCooldownHtc,
        nightCooldownTauHours: nightCooldownSummary.nightCooldownTauHours,
        nightCooldownRateCPerHour:
          nightCooldownSummary.nightCooldownRateCPerHour,
        nightCooldownNights: nightCooldownSummary.nightCooldownNights,
        nightCooldownSamples: nightCooldownSummary.nightCooldownSamples,
        flatlineIndoorTemp,
        filteredInsideReadings,
      };
      setHeatLossSummary(nextHeatLossSummary);
      localStorage.setItem(
        `${dataSourceBuildingId}:heatLossSummary`,
        JSON.stringify(nextHeatLossSummary)
      );
      return nextHeatLossSummary;
    } catch (err) {
      console.error("Error fetching heat loss summary:", err.message);
      setHeatLossSummary({
        kwhPerHdd: null,
        weatherNormalisedEui: null,
        htcEstimate: null,
        hddDays: 0,
        hddTotal: 0,
        htcSamples: 0,
        htcDeltaTotal: 0,
        nightCooldownHtc: null,
        nightCooldownTauHours: null,
        nightCooldownRateCPerHour: null,
        nightCooldownNights: 0,
        nightCooldownSamples: 0,
        hddSource: "current",
        hlaConfidence: "pending",
        auditKwhPerHdd: null,
        auditHtcEstimate: null,
        averageInternalTemp: null,
        comfortHddDays: 0,
        flatlineIndoorTemp: false,
        filteredInsideReadings: 0,
      });
      return null;
    }
  };

  const calculateHeatExclusionFromRows = (indoorRows, outdoorRows) => {
    const buckets = {};

    [...(indoorRows || []), ...(outdoorRows || [])].forEach((row) => {
      const date = new Date(row.timestamp);

      if (Number.isNaN(date.getTime())) {
        return;
      }

      const bucketKey = date.toISOString().slice(0, 13);
      buckets[bucketKey] = buckets[bucketKey] || {
        inside: [],
        outside: [],
      };

      const inside = Number(row.temperature_inside);
      const outside = Number(row.temperature_outside);

      if (Number.isFinite(inside) && inside !== 0) {
        buckets[bucketKey].inside.push(inside);
      }

      if (Number.isFinite(outside) && outside !== 0) {
        buckets[bucketKey].outside.push(outside);
      }
    });

    const hotWeatherRows = Object.entries(buckets)
      .map(([bucketKey, bucket]) => {
        const inside = bucket.inside.length ? average(bucket.inside) : null;
        const outside = bucket.outside.length ? average(bucket.outside) : null;

        if (
          !Number.isFinite(inside) ||
          !Number.isFinite(outside) ||
          inside === 0 ||
          outside < 24
        ) {
          return null;
        }

        return {
          buffer: outside - inside,
          inside,
          outside,
        };
      })
      .filter(Boolean);
    const hotWeatherBuffers = hotWeatherRows.map((row) => row.buffer);
    const overheatingRows = hotWeatherRows.filter((row) => row.inside >= 28);

    return {
      averageBuffer: hotWeatherBuffers.length ? average(hotWeatherBuffers) : null,
      sampleCount: hotWeatherBuffers.length,
      overheatingShare: hotWeatherRows.length
        ? overheatingRows.length / hotWeatherRows.length
        : null,
      hotThreshold: 24,
    };
  };

  const fetchHeatExclusionSummary = async () => {
    try {
      const now = Date.now();
      const heatExclusionWindows = [
        { fromDaysAgo: 0, toDaysAgo: 7, maxRows: 4000 },
        { fromDaysAgo: 7, toDaysAgo: 30, maxRows: 5000 },
        { fromDaysAgo: 30, toDaysAgo: 90, maxRows: 5000 },
        { fromDaysAgo: 90, toDaysAgo: 180, maxRows: 5000 },
      ];
      const fetchTemperatureRows = async ({ column }) => {
        const rowsByKey = new Map();
        const pageSize = 1000;

        for (const window of heatExclusionWindows) {
          const timestampFrom = new Date(
            now - window.toDaysAgo * 24 * 60 * 60 * 1000
          ).toISOString();
          const timestampTo =
            window.fromDaysAgo > 0
              ? new Date(
                  now - window.fromDaysAgo * 24 * 60 * 60 * 1000
                ).toISOString()
              : null;

          for (
            let rangeFrom = 0;
            rangeFrom < window.maxRows;
            rangeFrom += pageSize
          ) {
            let query = supabase
              .from("Readings")
              .select(`timestamp, ${column}`)
              .not(column, "is", null)
              .gte("timestamp", timestampFrom)
              .order("timestamp", { ascending: false })
              .range(rangeFrom, rangeFrom + pageSize - 1);

            if (timestampTo) {
              query = query.lt("timestamp", timestampTo);
            }

            if (
              dataSourceBuildingId === "home" &&
              column === "temperature_inside"
            ) {
              query = query.eq("reading_type", "dyson:whole_home");
            }

            const result = await applyBuildingScope(query);

            if (result.error) throw result.error;

            (result.data || []).forEach((row) => {
              rowsByKey.set(`${row.timestamp || ""}:${column}`, row);
            });

            if (!result.data || result.data.length < pageSize) {
              break;
            }
          }
        }

        return Array.from(rowsByKey.values());
      };
      const [indoorRows, outdoorRows] = await Promise.all([
        fetchTemperatureRows({ column: "temperature_inside" }),
        fetchTemperatureRows({ column: "temperature_outside" }),
      ]);

      const nextHeatExclusionSummary = calculateHeatExclusionFromRows(
        indoorRows || [],
        outdoorRows || []
      );

      setHeatExclusionSummary(nextHeatExclusionSummary);
      localStorage.setItem(
        `${dataSourceBuildingId}:heatExclusionSummary`,
        JSON.stringify(nextHeatExclusionSummary)
      );
      return nextHeatExclusionSummary;
    } catch (err) {
      console.error("Error fetching heat exclusion summary:", err.message);
      return null;
    }
  };

  const fetchRainHumiditySummary = async () => {
    if (dataSourceBuildingId !== "home") {
      setRainHumiditySummary(defaultRainHumiditySummary);
      return;
    }

    try {
      const timestampFrom = new Date(
        Date.now() - RAIN_HUMIDITY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
      ).toISOString();
      const [rainResult, downstairsHumidityResult, upstairsHumidityResult] =
        await Promise.all([
          applyBuildingScope(
            supabase
              .from("Readings")
              .select("timestamp, rainfall_mm, rainfall_1h_mm, rainfall_3h_mm")
              .not("rainfall_mm", "is", null)
              .gte("timestamp", timestampFrom)
              .order("timestamp", { ascending: false })
              .limit(5000)
          ),
          applyBuildingScope(
            supabase
              .from("Readings")
              .select("timestamp, reading_type, humidity")
              .in("reading_type", ["dyson:living_room", "dyson:downstairs"])
              .not("humidity", "is", null)
              .gte("timestamp", timestampFrom)
              .order("timestamp", { ascending: false })
              .limit(5000)
          ),
          applyBuildingScope(
            supabase
              .from("Readings")
              .select("timestamp, reading_type, humidity")
              .eq("reading_type", "dyson:upstairs")
              .not("humidity", "is", null)
              .gte("timestamp", timestampFrom)
              .order("timestamp", { ascending: false })
              .limit(5000)
          ),
        ]);

      if (
        rainResult.error &&
        /rainfall|schema cache/i.test(rainResult.error.message || "")
      ) {
        const nextSummary = {
          ...defaultRainHumiditySummary,
          status: "needs-rainfall-columns",
        };
        setRainHumiditySummary(nextSummary);
        localStorage.setItem(
          `${dataSourceBuildingId}:rainHumiditySummary`,
          JSON.stringify(nextSummary)
        );
        return;
      }

      if (rainResult.error) throw rainResult.error;
      if (downstairsHumidityResult.error) throw downstairsHumidityResult.error;
      if (upstairsHumidityResult.error) throw upstairsHumidityResult.error;

      const bucketHour = (timestamp) => {
        const date = new Date(timestamp);
        if (Number.isNaN(date.getTime())) {
          return null;
        }
        date.setMinutes(0, 0, 0);
        return date.toISOString();
      };
      const rainByHour = new Map();
      (rainResult.data || []).forEach((row) => {
        const bucket = bucketHour(row.timestamp);
        const rainfall = Math.max(
          0,
          Number(row.rainfall_mm ?? row.rainfall_1h_mm ?? row.rainfall_3h_mm ?? 0)
        );

        if (!bucket || !Number.isFinite(rainfall)) {
          return;
        }

        rainByHour.set(bucket, (rainByHour.get(bucket) || 0) + rainfall);
      });

      const buildRainHumidityAreaSummary = (humidityRows) => {
        const humidityByHour = new Map();
        humidityRows.forEach((row) => {
          const bucket = bucketHour(row.timestamp);
          const humidity = Number(row.humidity);

          if (!bucket || !Number.isFinite(humidity)) {
            return;
          }

          const values = humidityByHour.get(bucket) || [];
          values.push(humidity);
          humidityByHour.set(bucket, values);
        });

        const rows = Array.from(humidityByHour.entries())
          .map(([bucket, values]) => {
            const bucketTime = new Date(bucket).getTime();
            const recentRainfall = [0, 1, 2, 3].reduce((sum, hoursAgo) => {
              const rainDate = new Date(bucketTime - hoursAgo * 60 * 60 * 1000);
              return sum + (rainByHour.get(rainDate.toISOString()) || 0);
            }, 0);

            return {
              rainfall: recentRainfall,
              humidity: average(values),
            };
          })
          .filter(
            (row) => Number.isFinite(row.rainfall) && Number.isFinite(row.humidity)
          );
        const rainyRows = rows.filter((row) => row.rainfall >= 0.1);
        const dryRows = rows.filter((row) => row.rainfall < 0.1);
        const averageRainyRh = rainyRows.length
          ? average(rainyRows.map((row) => row.humidity))
          : null;
        const averageDryRh = dryRows.length
          ? average(dryRows.map((row) => row.humidity))
          : null;

        return {
          rainySamples: rainyRows.length,
          drySamples: dryRows.length,
          averageRainyRh,
          averageDryRh,
          rhUplift:
            Number.isFinite(averageRainyRh) && Number.isFinite(averageDryRh)
              ? averageRainyRh - averageDryRh
              : null,
          correlation: pearsonCorrelation(
            rows.map((row) => ({ x: row.rainfall, y: row.humidity }))
          ),
          maxRainfallMm: rows.length
            ? Math.max(...rows.map((row) => row.rainfall))
            : null,
          windowDays: RAIN_HUMIDITY_LOOKBACK_DAYS,
          status:
            rainyRows.length >= 3 && dryRows.length >= 3
              ? "ready"
              : rainByHour.size > 0
              ? "collecting"
              : "pending-rainfall",
        };
      };
      const downstairsSummary = buildRainHumidityAreaSummary(
        downstairsHumidityResult.data || []
      );
      const upstairsSummary = buildRainHumidityAreaSummary(
        upstairsHumidityResult.data || []
      );
      const nextSummary = {
        ...downstairsSummary,
        area: "downstairs",
        downstairs: downstairsSummary,
        upstairs: upstairsSummary,
        areas: {
          downstairs: downstairsSummary,
          upstairs: upstairsSummary,
        },
      };

      setRainHumiditySummary(nextSummary);
      localStorage.setItem(
        `${dataSourceBuildingId}:rainHumiditySummary`,
        JSON.stringify(nextSummary)
      );
    } catch (err) {
      console.error("Error fetching rain/RH summary:", err.message);
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
        indoorOnly: true,
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
            pm10: isDownstairsDysonReading(row.reading_type)
              ? null
              : numericOrNull(row.pm10),
            hcho: isDownstairsDysonReading(row.reading_type)
              ? null
              : numericOrNull(row.hcho),
            no2: isDownstairsDysonReading(row.reading_type)
              ? null
              : dysonAppDisplayValue(row.reading_type, "no2", row.no2),
          });
          return rooms;
        }, [])
        .sort((a, b) => {
          const order = { Upstairs: 0, Downstairs: 1 };
          return (order[a.label] ?? 10) - (order[b.label] ?? 10);
        });

      const hasIndoorIaqData = (row) =>
        [
          row.temperature_inside,
          row.humidity,
          row.co2,
          row.vocs,
          row.pm25,
          row.pm10,
          row.hcho,
          row.no2,
        ].some((value) => Number.isFinite(Number(value)));
      const fallbackIaqRow = data.find(hasIndoorIaqData) || data[0];
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

  const fetchLongTermBuildingPerformance = async (overrides = {}) => {
    try {
      const scoreHistoricalPerformance = Number.isFinite(
        Number(overrides.historicalPerformance)
      )
        ? Number(overrides.historicalPerformance)
        : historicalPerformance;
      const scoreHeatLossSummary =
        overrides.heatLossSummary || heatLossSummary;
      const scoreHeatExclusionSummary =
        overrides.heatExclusionSummary || heatExclusionSummary;
      const rowsByKey = new Map();
      let error = null;
      const now = Date.now();
      const historicalWindows = [
        { fromDaysAgo: 0, toDaysAgo: 2, limit: 1200 },
        { fromDaysAgo: 2, toDaysAgo: 7, limit: 1200 },
        { fromDaysAgo: 7, toDaysAgo: 30, limit: 1200 },
        { fromDaysAgo: 30, toDaysAgo: 90, limit: 1200 },
        { fromDaysAgo: 90, toDaysAgo: 180, limit: 1200 },
      ];

      for (const window of historicalWindows) {
        const timestampFrom = new Date(
          now - window.toDaysAgo * 24 * 60 * 60 * 1000
        ).toISOString();
        const timestampTo =
          window.fromDaysAgo > 0
            ? new Date(
                now - window.fromDaysAgo * 24 * 60 * 60 * 1000
              ).toISOString()
            : null;
        const result = await fetchScopedIaqRows({
          includeTimestamp: true,
          includeReadingType: true,
          orderDescending: true,
          limit: window.limit,
          timestampFrom,
          timestampTo,
        });

        if (result.error) {
          error = result.error;
          break;
        }

        (result.data || []).forEach((row) => {
          const key = `${row.timestamp || ""}:${row.reading_type || ""}`;
          rowsByKey.set(key, row);
        });
      }

      const data = Array.from(rowsByKey.values());

      if (error) throw error;
      if (!data || data.length === 0) return;

      const ieqRows = data.map((row) => {
        if (
          dataSourceBuildingId === "home" &&
          isDownstairsDysonReading(row.reading_type)
        ) {
          return {
            ...row,
            co2: null,
            vocs: row.vocs,
            pm25: row.pm25,
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
      const nextHeatExclusionSummary = scoreHeatExclusionSummary;
      const averageHeatExclusionBuffer =
        nextHeatExclusionSummary.averageBuffer;
      const overheatingShare = nextHeatExclusionSummary.overheatingShare;

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
        ? clampScore(ieqPenaltyFactor * 100)
        : null;

      const estimatedArea =
        matterportMetadata.internalArea !== "--"
          ? Number(matterportMetadata.internalArea)
          : 145;
      const annualEnergyUse = Number.isFinite(scoreHistoricalPerformance)
        ? scoreHistoricalPerformance * 365
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
      const hasReliableHddSampleForScore =
        scoreHeatLossSummary.hddSource === "legacy" ||
        ((scoreHeatLossSummary.hddDays || 0) >= MIN_BASELINE_HDD_DAYS &&
          (scoreHeatLossSummary.hddTotal || 0) >= MIN_RELIABLE_HDD_TOTAL);
      const weatherNormalisedEuiScore = calculateEnergyScore(
        hasReliableHddSampleForScore
          ? scoreHeatLossSummary.weatherNormalisedEui
          : null,
        building.targetEui,
        building.nationalAverageEui
      );
      const lowerIsBetterScore = (value, goodLimit, poorLimit) => {
        if (
          !Number.isFinite(value) ||
          !Number.isFinite(goodLimit) ||
          !Number.isFinite(poorLimit) ||
          poorLimit <= goodLimit
        ) {
          return null;
        }

        if (value <= goodLimit) {
          return 100;
        }

        if (value >= poorLimit) {
          return 0;
        }

        return clampScore(
          100 - ((value - goodLimit) / (poorLimit - goodLimit)) * 100
        );
      };
      const hddIntensityPerM2ForScore =
        Number.isFinite(scoreHeatLossSummary.kwhPerHdd) &&
        Number.isFinite(estimatedArea) &&
        estimatedArea > 0
          ? scoreHeatLossSummary.kwhPerHdd / estimatedArea
          : null;
      const annualHddForScore =
        Number.isFinite(scoreHeatLossSummary.weatherNormalisedEui) &&
        Number.isFinite(hddIntensityPerM2ForScore) &&
        hddIntensityPerM2ForScore > 0
          ? scoreHeatLossSummary.weatherNormalisedEui / hddIntensityPerM2ForScore
          : null;
      const targetHddIntensityForScore =
        Number.isFinite(annualHddForScore) && annualHddForScore > 0
          ? building.targetEui / annualHddForScore
          : 0.0075;
      const hddScore = lowerIsBetterScore(
        hasReliableHddSampleForScore ? hddIntensityPerM2ForScore : null,
        targetHddIntensityForScore,
        targetHddIntensityForScore * 6
      );
      const htcPerM2ForScore =
        Number.isFinite(scoreHeatLossSummary.htcEstimate) &&
        Number.isFinite(estimatedArea) &&
        estimatedArea > 0
          ? scoreHeatLossSummary.htcEstimate / estimatedArea
          : null;
      const hasReliableHtcSampleForScore =
        scoreHeatLossSummary.hddSource === "legacy" ||
        ((scoreHeatLossSummary.htcSamples || 0) >= MIN_RELIABLE_HTC_SAMPLES &&
          (scoreHeatLossSummary.htcDeltaTotal || 0) >=
            MIN_RELIABLE_HTC_DELTA_TOTAL);
      const htcScore = lowerIsBetterScore(
        hasReliableHtcSampleForScore ? htcPerM2ForScore : null,
        1.5,
        3.5
      );
      const heatExclusionScore = Number.isFinite(averageHeatExclusionBuffer)
        ? clampScore(
            averageHeatExclusionBuffer >= 2
              ? 100
              : averageHeatExclusionBuffer >= 0
              ? 70 + (averageHeatExclusionBuffer / 2) * 30
              : 70 + (averageHeatExclusionBuffer / 3) * 70
          )
        : null;
      const overheatingAdjustedHeatExclusionScore =
        Number.isFinite(heatExclusionScore) &&
        Number.isFinite(overheatingShare)
          ? clampScore(heatExclusionScore - overheatingShare * 35)
          : heatExclusionScore;
      const hlaScore = averageScore([
        weatherNormalisedEuiScore,
        hddScore,
        htcScore,
        overheatingAdjustedHeatExclusionScore,
      ]);
      const calculatedEnergyScore = averageScore([
        annualEuiScore,
        hlaScore,
      ]);

      const buildingPerformanceIndex = calculateGlobalIeqEnergyIndex({
        energy: calculatedEnergyScore,
        ieqPenaltyFactor,
      });

      const nextPerformanceBreakdown = {
        health: calculatedHealthScore,
        energy: calculatedEnergyScore,
        hla: hlaScore,
        resilience: resilienceScore,
        iaq: calculatedIAQScore,
        comfort: calculatedComfortScore,
        humidity: humidityStabilityScore,
      };

      setPerformanceBreakdown(nextPerformanceBreakdown);

      setPerformanceValue(buildingPerformanceIndex);
      const calculatedAt = new Date().toISOString();
      const nextPerformanceSummary = {
        value: buildingPerformanceIndex,
        breakdown: nextPerformanceBreakdown,
        calculatedAt,
      };
      localStorage.setItem(
        `${dataSourceBuildingId}:performanceSummary:v2`,
        JSON.stringify(nextPerformanceSummary)
      );
      localStorage.removeItem(`${dataSourceBuildingId}:performanceSummary`);
      const { error: performancePersistError } = await supabase
        .from("BuildingLatestSnapshot")
        .update({
          performance_summary: nextPerformanceSummary,
          updated_at: calculatedAt,
        })
        .eq("building_id", dataSourceBuildingId);

      if (performancePersistError) {
        console.error(
          "Error persisting shared performance summary:",
          performancePersistError.message
        );
      }

      return nextPerformanceSummary;
    } catch (err) {
      console.error(
        "Error calculating long-term building performance:",
        err.message
      );
      return null;
    }
  };

  const fetchWeeklyPerformanceTrend = async () => {
    try {
      const trendWindowEnd = new Date();
      const rollingTrendWindowStart = new Date(
        trendWindowEnd.getTime() - 35 * 24 * 60 * 60 * 1000
      );
      const activeSeasonStart = new Date(`${activeSeasonInfo.startDate}T00:00:00.000Z`);
      const trendWindowStart =
        activeSeasonStart > rollingTrendWindowStart
          ? activeSeasonStart
          : rollingTrendWindowStart;
      const trendLookbackDays = Math.max(
        0,
        Math.ceil(
          (trendWindowEnd.getTime() - trendWindowStart.getTime()) /
            (24 * 60 * 60 * 1000)
        )
      );

      const fetchEnergyIntervalRows = async () => {
        const [intervalResult, dailyResult] = await Promise.all([
          supabase
            .from("EnergyReadings")
            .select("timestamp, created_at, fuel_type, reading_type, usage_kwh")
            .eq("building_id", dataSourceBuildingId)
            .eq("reading_type", "interval_30m")
            .not("usage_kwh", "is", null)
            .gte("timestamp", trendWindowStart.toISOString())
            .lte("timestamp", trendWindowEnd.toISOString())
            .order("timestamp", { ascending: true })
            .limit(5000),
          supabase
            .from("EnergyReadings")
            .select("timestamp, created_at, fuel_type, reading_type, usage_kwh")
            .eq("building_id", dataSourceBuildingId)
            .eq("reading_type", "daily_total")
            .not("usage_kwh", "is", null)
            .gte("created_at", trendWindowStart.toISOString())
            .order("created_at", { ascending: false })
            .limit(3000),
        ]);

        if (intervalResult.error) throw intervalResult.error;
        if (dailyResult.error) throw dailyResult.error;

        return [...(intervalResult.data || []), ...(dailyResult.data || [])];
      };

      const fetchIaqTrendRows = async () => {
        const rows = [];
        const dayStart = new Date(
          Date.UTC(
            trendWindowStart.getUTCFullYear(),
            trendWindowStart.getUTCMonth(),
            trendWindowStart.getUTCDate()
          )
        );

        for (let day = 0; day <= trendLookbackDays; day += 1) {
          const fromDate = new Date(dayStart.getTime() + day * 24 * 60 * 60 * 1000);
          const toDate = new Date(fromDate.getTime() + 24 * 60 * 60 * 1000);
          const homeTrendReadingTypes =
            dataSourceBuildingId === "home"
              ? [
                  "dyson:whole_home",
                  "dyson:upstairs",
                  "dyson:living_room",
                  "dyson:downstairs",
                ]
              : null;
          const result = await fetchScopedIaqRows({
            includeTimestamp: true,
            includeReadingType: true,
            limit: dataSourceBuildingId === "home" ? 1500 : 240,
            readingTypes: homeTrendReadingTypes,
            timestampFrom: fromDate.toISOString(),
            timestampTo: toDate.toISOString(),
          });

          if (result.error) throw result.error;

          rows.push(...(result.data || []));
        }

        return rows;
      };

      const fetchOutdoorTrendRows = async () => {
        const { data, error } = await applyBuildingScope(
          supabase
            .from("Readings")
            .select("timestamp, temperature_outside")
            .not("temperature_outside", "is", null)
            .gte("timestamp", trendWindowStart.toISOString())
            .lte("timestamp", trendWindowEnd.toISOString())
            .order("timestamp", { ascending: true })
            .limit(5000)
        );

        if (error) throw error;
        return data || [];
      };

      const [energyIntervalRows, iaqTrendRows, outdoorTrendRows] = await Promise.all([
        fetchEnergyIntervalRows(),
        fetchIaqTrendRows(),
        fetchOutdoorTrendRows(),
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
          warmthBuffer: [],
          humidity: [],
          upstairsHumidity: [],
          downstairsHumidity: [],
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
        if (row.reading_type === "dyson:upstairs") {
          pushMetric("upstairsHumidity", row.humidity);
        }
        if (
          row.reading_type === "dyson:downstairs" ||
          row.reading_type === "dyson:living_room"
        ) {
          pushMetric("downstairsHumidity", row.humidity);
        }
        pushMetric("pm25", row.pm25);
        pushMetric("vocs", row.vocs);
      });

      outdoorTrendRows.forEach((row) => {
        const slot = getWeeklySlot(row.timestamp);

        if (slot === null || !weeklyBuckets[slot]) {
          return;
        }

        const outside = Number(row.temperature_outside);
        if (Number.isFinite(outside)) {
          weeklyBuckets[slot].externalTemp.push(outside);
        }
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
        warmthBuffer:
          bucket.internalTemp.length && bucket.externalTemp.length
            ? average(bucket.internalTemp) - average(bucket.externalTemp)
            : null,
        humidity: bucket.humidity.length ? average(bucket.humidity) : null,
        upstairsHumidity: bucket.upstairsHumidity.length
          ? average(bucket.upstairsHumidity)
          : null,
        downstairsHumidity: bucket.downstairsHumidity.length
          ? average(bucket.downstairsHumidity)
          : null,
        pm25: bucket.pm25.length ? average(bucket.pm25) : null,
        vocs: bucket.vocs.length ? average(bucket.vocs) : null,
      }));

      const fillSparseTrendMetric = (rows, key) => {
        const values = rows.map((row) => row[key]);
        const firstValidIndex = values.findIndex((value) => Number.isFinite(value));

        if (firstValidIndex === -1) {
          return rows;
        }

        return rows.map((row, index) => {
          if (Number.isFinite(row[key])) {
            return row;
          }

          let previousIndex = index - 1;
          while (previousIndex >= 0 && !Number.isFinite(values[previousIndex])) {
            previousIndex -= 1;
          }

          let nextIndex = index + 1;
          while (nextIndex < values.length && !Number.isFinite(values[nextIndex])) {
            nextIndex += 1;
          }

          const previousValue =
            previousIndex >= 0 && Number.isFinite(values[previousIndex])
              ? values[previousIndex]
              : null;
          const nextValue =
            nextIndex < values.length && Number.isFinite(values[nextIndex])
              ? values[nextIndex]
              : null;

          let filledValue = previousValue ?? nextValue;

          if (
            Number.isFinite(previousValue) &&
            Number.isFinite(nextValue) &&
            nextIndex > previousIndex
          ) {
            const progress = (index - previousIndex) / (nextIndex - previousIndex);
            filledValue = previousValue + (nextValue - previousValue) * progress;
          }

          return Number.isFinite(filledValue)
            ? { ...row, [key]: filledValue, [`${key}Interpolated`]: true }
            : row;
        });
      };
      const trendValueKeys = [
        "electricity",
        "electricityRegulated",
        "electricityUnregulated",
        "gas",
        "gasRegulated",
        "gasUnregulated",
        "internalTemp",
        "externalTemp",
        "warmthBuffer",
        "humidity",
        "upstairsHumidity",
        "downstairsHumidity",
        "pm25",
        "vocs",
      ];
      const displayWeeklyTrend = trendValueKeys.reduce(
        (rows, key) => fillSparseTrendMetric(rows, key),
        averagedWeeklyTrend
      );

      applyWeeklyTrendData(displayWeeklyTrend, activeSeasonInfo);
    } catch (err) {
      console.error("Error fetching weekly performance trend:", err.message);
    }
  };

  const fetchCarbonSavingsSummary = async () => {
    if (!isCarbonCreditTab) {
      return;
    }

    const applyPersistedSavingsSummary = (
      summaryRow,
      calculationStatus = "current"
    ) => {
      const totalSavedKgCo2e = Number(summaryRow.total_saved_kgco2e);
      const totalSavedKwh = Number(summaryRow.total_saved_kwh);
      const energyCostSavedGbp = Number(summaryRow.total_energy_cost_saved_gbp);
      const totalCredits = Number(summaryRow.carbon_credits);
      const latestSavedKgCo2e = Number(summaryRow.latest_saved_kgco2e);

      applyCarbonSavingsSummary({
        latestDate: summaryRow.latest_date || summaryRow.to_date || null,
        latestSavedKgCo2e: Number.isFinite(latestSavedKgCo2e)
          ? latestSavedKgCo2e
          : null,
        totalSavedKgCo2e: Number.isFinite(totalSavedKgCo2e)
          ? totalSavedKgCo2e
          : null,
      });
      applyCarbonIntervalSavingsSummary({
        fromDate: summaryRow.from_date || null,
        toDate: summaryRow.to_date || null,
        calculatedAt: summaryRow.calculated_at || null,
        dailyRows: Number.isFinite(Number(summaryRow.daily_rows))
          ? Number(summaryRow.daily_rows)
          : null,
        latestTimestamp: summaryRow.calculated_at || summaryRow.latest_date || null,
        latestSavedKgCo2e: Number.isFinite(latestSavedKgCo2e)
          ? latestSavedKgCo2e
          : null,
        totalSavedKgCo2e: Number.isFinite(totalSavedKgCo2e)
          ? totalSavedKgCo2e
          : null,
        totalSavedKwh: Number.isFinite(totalSavedKwh) ? totalSavedKwh : null,
        energyCostSavedGbp: Number.isFinite(energyCostSavedGbp)
          ? energyCostSavedGbp
          : null,
        carbonCredits: Number.isFinite(totalCredits) ? totalCredits : null,
        calculationVersion: summaryRow.calculation_version || null,
        calculationStatus,
      });
    };
    const isCurrentPersistedSavingsSummary = (summaryRow) => {
      const rawPayload =
        typeof summaryRow?.raw_payload === "string"
          ? (() => {
              try {
                return JSON.parse(summaryRow.raw_payload);
              } catch (error) {
                return {};
              }
            })()
          : summaryRow?.raw_payload || {};
      const hasUsableTotals =
        Number.isFinite(Number(summaryRow?.total_saved_kgco2e)) &&
        Number.isFinite(Number(summaryRow?.total_saved_kwh)) &&
        Number.isFinite(Number(summaryRow?.total_energy_cost_saved_gbp));
      const hasCurrentValueMethod =
        rawPayload.energyValueMethod === CARBON_SAVINGS_ENERGY_VALUE_METHOD &&
        rawPayload.summaryAggregation === "interval_accrued_plus_daily_fallback";

      return (
        summaryRow?.calculation_version === CARBON_SAVINGS_CALCULATION_VERSION &&
        hasUsableTotals &&
        hasCurrentValueMethod
      );
    };
    const hasUsablePersistedSavingsSummary = (summaryRow) =>
      Number.isFinite(Number(summaryRow?.total_saved_kgco2e)) &&
      Number.isFinite(Number(summaryRow?.total_saved_kwh)) &&
      Number.isFinite(Number(summaryRow?.total_energy_cost_saved_gbp)) &&
      Number.isFinite(Number(summaryRow?.carbon_credits));

    try {
      const { data: summaryData, error: summaryError } = await supabase
        .from("CarbonSavingsSummary")
        .select(
          "scenario, from_date, to_date, calculated_at, daily_rows, total_saved_kgco2e, total_saved_kwh, total_energy_cost_saved_gbp, carbon_credits, latest_date, latest_saved_kgco2e, latest_saved_kwh, latest_energy_cost_saved_gbp, calculation_version, raw_payload"
        )
        .eq("building_id", dataSourceBuildingId)
        .in("scenario", [
          CARBON_SAVINGS_SCENARIO,
          LEGACY_CARBON_SAVINGS_SCENARIO,
        ])
        .order("calculated_at", { ascending: false });

      if (!summaryError && summaryData?.length) {
        const newestSummaryData = summaryData.slice().sort((a, b) => {
          const aTime = Date.parse(a?.calculated_at);
          const bTime = Date.parse(b?.calculated_at);

          return (Number.isFinite(bTime) ? bTime : 0) -
            (Number.isFinite(aTime) ? aTime : 0);
        });
        const currentSummary = newestSummaryData.find(
          isCurrentPersistedSavingsSummary
        );
        const fallbackSummary =
          newestSummaryData.find(
            (row) => row.scenario === LEGACY_CARBON_SAVINGS_SCENARIO
          ) || newestSummaryData.find(hasUsablePersistedSavingsSummary);

        if (currentSummary) {
          applyPersistedSavingsSummary(currentSummary);
          return;
        }
        if (hasUsablePersistedSavingsSummary(fallbackSummary)) {
          applyPersistedSavingsSummary(fallbackSummary, "stale");
          console.warn(
            "Carbon savings summary is stale; displaying it until the tablet writes a v3 interval summary."
          );
          return;
        }
        console.warn(
          "Carbon savings summary is stale; keeping the last good cached CC value until the tablet refreshes it."
        );
        return;
      }

      if (summaryError) {
        console.warn(
          "Carbon savings summary unavailable; keeping the last good cached CC value:",
          summaryError.message
        );
        return;
      }

      console.warn(
        "Carbon savings summary is not available yet; keeping the current CC display."
      );
    } catch (err) {
      console.warn(
        "Carbon savings summary refresh failed; keeping the current CC display:",
        err.message
      );
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
    setCarbonSavingsSummary(readCachedCarbonSavingsSummary());
    const cachedCarbonIntervalSummary = normaliseCarbonIntervalSummary(
      readCachedCarbonIntervalSavingsSummary()
    );

    if (hasUsableCarbonIntervalSummary(cachedCarbonIntervalSummary)) {
      carbonIntervalSavingsSummaryRef.current = cachedCarbonIntervalSummary;
      setCarbonIntervalSavingsSummary(cachedCarbonIntervalSummary);
      setCarbonCredits(cachedCarbonIntervalSummary.carbonCredits);
    } else {
      carbonIntervalSavingsSummaryRef.current = defaultCarbonIntervalSavingsSummary;
      setCarbonIntervalSavingsSummary(defaultCarbonIntervalSavingsSummary);
      setCarbonCredits(null);
    }
    setWeeklyTrendData(readCachedWeeklyTrendData());
    setHeatLossSummary(readCachedHeatLossSummary());
    setHeatExclusionSummary(readCachedHeatExclusionSummary());
    setRainHumiditySummary(readCachedRainHumiditySummary());
    const cachedPerformanceSummary = readCachedPerformanceSummary();
    setPerformanceValue(
      Number.isFinite(cachedPerformanceSummary.value)
        ? cachedPerformanceSummary.value
        : null
    );
    setPerformanceBreakdown({
      ...defaultPerformanceSummary.breakdown,
      ...(cachedPerformanceSummary.breakdown || {}),
    });
    setMrvEvidence(readCachedMrvEvidence());
    let cancelled = false;
    const refreshBuilding = async () => {
      const snapshot = await fetchDashboardSnapshot();

      if (cancelled) {
        return;
      }

      fetchExternalTemp();
      fetchIAQData();
      fetchRainHumiditySummary();
      fetchWeeklyPerformanceTrend();

      const hasSharedPerformance = Number.isFinite(
        Number(snapshot?.performance_summary?.value)
      );

      if (!snapshot) {
        await fetchLongTermAverage();
      }

      if (!snapshot || !hasSharedPerformance) {
        const nextHeatLossSummary = await fetchHeatLossSummary();
        const nextHeatExclusionSummary = await fetchHeatExclusionSummary();
        await fetchLongTermBuildingPerformance({
          historicalPerformance: snapshot?.energy_summary?.totalDailyAverage,
          heatLossSummary: nextHeatLossSummary,
          heatExclusionSummary: nextHeatExclusionSummary,
        });
      }
    };

    refreshBuilding();
    return () => {
      cancelled = true;
    };
    // Building switch refresh only; polling effect below handles continuing updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSourceBuildingId]);

  useEffect(() => {
    let refreshCount = 0;

    const interval = setInterval(async () => {
      refreshCount += 1;
      const snapshot = await fetchDashboardSnapshot();
      fetchIAQData();
      fetchExternalTemp();

      if (refreshCount % HEAVY_DASHBOARD_REFRESH_EVERY === 0) {
        await fetchLongTermAverage();
        const nextHeatLossSummary = await fetchHeatLossSummary();
        const nextHeatExclusionSummary = await fetchHeatExclusionSummary();
        await fetchLongTermBuildingPerformance({
          historicalPerformance: snapshot?.energy_summary?.totalDailyAverage,
          heatLossSummary: nextHeatLossSummary,
          heatExclusionSummary: nextHeatExclusionSummary,
        });
        fetchWeeklyPerformanceTrend();
        fetchRainHumiditySummary();
      }
    }, DASHBOARD_SNAPSHOT_REFRESH_MS);

    return () => clearInterval(interval);
    // The interval should reset only when the selected building or area source changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSourceBuildingId, matterportMetadata.internalArea]);

  useEffect(() => {
    if (dataSourceBuildingId !== "home" || selectedHealthTrendArea === "all") {
      return;
    }

    const floorMetricKey =
      selectedHealthTrendArea === "upstairs"
        ? "upstairsHumidity"
        : "downstairsHumidity";
    const hasFloorTrendData = weeklyTrendData.some((point) =>
      Number.isFinite(Number(point?.[floorMetricKey]))
    );

    if (!hasFloorTrendData) {
      fetchWeeklyPerformanceTrend();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSourceBuildingId, selectedHealthTrendArea]);

  useEffect(() => {
    if (!isCarbonCreditTab) {
      return undefined;
    }

    fetchCarbonSavingsSummary();
    fetchCarbonMarketPrice();

    const interval = setInterval(() => {
      fetchCarbonSavingsSummary();
      fetchCarbonMarketPrice();
    }, CARBON_SUMMARY_REFRESH_MS);

    return () => clearInterval(interval);
    // CC values should refresh from the persisted summary, not raw readings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSourceBuildingId, isCarbonCreditTab]);

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
  const hasReliableHddSample =
    heatLossSummary.hddSource === "legacy" ||
    ((heatLossSummary.hddDays || 0) >= MIN_BASELINE_HDD_DAYS &&
      (heatLossSummary.hddTotal || 0) >= MIN_RELIABLE_HDD_TOTAL);
  const hasWeakSummerHddSample =
    Number.isFinite(heatLossSummary.kwhPerHdd) && !hasReliableHddSample;
  const hasReliableHtcSample =
    heatLossSummary.hddSource === "legacy" ||
    ((heatLossSummary.htcSamples || 0) >= MIN_RELIABLE_HTC_SAMPLES &&
      (heatLossSummary.htcDeltaTotal || 0) >=
        MIN_RELIABLE_HTC_DELTA_TOTAL);
  const hasWeakHtcSample =
    Number.isFinite(heatLossSummary.htcEstimate) && !hasReliableHtcSample;
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
      : hasWeakSummerHddSample
      ? `Low confidence / summer sample (${formatNumber(
          heatLossSummary.hddTotal || 0,
          1
        )} total HDD)`
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
    hasWeakSummerHddSample
      ? "pending"
      : rawHddStatus === "good" && !hddComfortQualified
      ? "warning"
      : rawHddStatus;
  const rawHtcStatus = Number.isFinite(htcPerM2)
    ? htcPerM2 <= 1.5
      ? "good"
      : htcPerM2 <= 3
      ? "warning"
      : "poor"
    : "pending";
  const htcStatus =
    heatLossSummary.flatlineIndoorTemp || hasWeakHtcSample
      ? "pending"
      : rawHtcStatus;
  const nightCooldownHtcPerM2 =
    Number.isFinite(heatLossSummary.nightCooldownHtc) &&
    Number.isFinite(dashboardArea) &&
    dashboardArea > 0
      ? heatLossSummary.nightCooldownHtc / dashboardArea
      : null;
  const nightCooldownStatus = Number.isFinite(nightCooldownHtcPerM2)
    ? (heatLossSummary.nightCooldownNights || 0) < 3
      ? "warning"
      : nightCooldownHtcPerM2 <= 1.5
      ? "good"
      : nightCooldownHtcPerM2 <= 3
      ? "warning"
      : "poor"
    : "pending";
  const heatExclusionStatus = Number.isFinite(
    heatExclusionSummary.averageBuffer
  )
    ? heatExclusionSummary.averageBuffer >= 2
      ? "good"
      : heatExclusionSummary.averageBuffer >= 0
      ? "warning"
      : "poor"
    : "pending";
  const getRainHumidityStatus = (summary = rainHumiditySummary) =>
    summary?.status === "ready" && Number.isFinite(summary.rhUplift)
      ? summary.rhUplift >= 8
        ? "poor"
        : summary.rhUplift >= 4
        ? "warning"
        : "good"
      : "pending";
  const rainHumidityStatus = getRainHumidityStatus(
    rainHumiditySummary.downstairs || rainHumiditySummary
  );
  const formatCorrelation = (value) => {
    if (!Number.isFinite(value)) {
      return "correlation pending";
    }

    if (value >= 0.6) {
      return `strong correlation (${formatNumber(value, 2)})`;
    }

    if (value >= 0.35) {
      return `moderate correlation (${formatNumber(value, 2)})`;
    }

    if (value >= 0.15) {
      return `weak correlation (${formatNumber(value, 2)})`;
    }

    return `little correlation (${formatNumber(value, 2)})`;
  };
  const describeRainHumiditySummary = (summary) => {
    if (!summary) {
      return "Pending rain/RH overlap";
    }

    if (summary.status === "needs-rainfall-columns") {
      return "Needs rainfall columns in Supabase";
    }

    if (summary.status === "pending-rainfall") {
      return "Waiting for rainfall readings";
    }

    if (summary.status === "collecting") {
      return "Collecting rain/dry comparison samples";
    }

    if (Number.isFinite(summary.rhUplift)) {
      return `${formatNumber(summary.rhUplift, 1)}% RH uplift after rain`;
    }

    return "Pending rain/RH overlap";
  };
  const rainHumidityAreas = [
    {
      label: "Downstairs",
      summary: rainHumiditySummary.downstairs || rainHumiditySummary,
    },
    {
      label: "Upstairs",
      summary: rainHumiditySummary.upstairs || rainHumiditySummary.areas?.upstairs,
    },
  ].filter((area) => area.summary && Object.keys(area.summary).length > 0);
  const formatHeatExclusionBuffer = (value) => {
    if (!Number.isFinite(value)) {
      return "Pending indoor/outdoor overlap";
    }

    if (value >= 0) {
      return `${formatMeasurement(value)} deg C cooler than outside`;
    }

    return `${formatMeasurement(Math.abs(value))} deg C hotter than outside`;
  };
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
  const recentSummaryMeteredDays = Number(energySummary.baselineMeteredDays) || 0;
  const persistedHistoryMeteredDays = Number(
    carbonIntervalSavingsSummary.dailyRows
  );
  const baselineMeteredDays = Number.isFinite(persistedHistoryMeteredDays)
    ? Math.max(recentSummaryMeteredDays, persistedHistoryMeteredDays)
    : recentSummaryMeteredDays;
  const baselineStartDate =
    carbonIntervalSavingsSummary.fromDate || energySummary.baselineStartDate;
  const baselineEndDate =
    carbonIntervalSavingsSummary.toDate || energySummary.baselineEndDate;
  const baselineDateRange =
    baselineStartDate && baselineEndDate
      ? `${baselineStartDate} to ${baselineEndDate}`
      : null;
  const baselineCoverageDays =
    baselineStartDate && baselineEndDate
      ? Math.max(
          1,
          Math.round(
            (new Date(baselineEndDate) - new Date(baselineStartDate)) /
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
    (heatLossSummary.hddDays >= MIN_BASELINE_HDD_DAYS &&
      (heatLossSummary.hddTotal || 0) >= MIN_RELIABLE_HDD_TOTAL);
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
    `${formatNumber(heatLossSummary.hddTotal || 0, 1)} total HDD`,
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
      detail: `${heatLossSummary.hddDays || 0} HDD day(s), ${formatNumber(
        heatLossSummary.hddTotal || 0,
        1
      )} total HDD, base ${HDD_BASE_TEMP_C} deg C`,
    },
    {
      label: "Cold-weather HDD",
      complete: hddNormalisedBaseline,
      detail: `${heatLossSummary.hddDays || 0}/${MIN_BASELINE_HDD_DAYS} HDD day(s), ${formatNumber(
        heatLossSummary.hddTotal || 0,
        1
      )}/${MIN_RELIABLE_HDD_TOTAL} total HDD`,
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
  const deliveryTeamComplete = Boolean(
    mrvEvidence.principalContractorName?.trim() &&
      (mrvEvidence.architectName?.trim() ||
        mrvEvidence.retrofitCoordinatorName?.trim())
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
      label: "Retrofit delivery record",
      fieldKey: "intervention",
      detail:
        interventionComplete && deliveryTeamComplete
          ? `${mrvEvidence.interventionDate}: ${mrvEvidence.principalContractorName} / ${
              mrvEvidence.retrofitCoordinatorName || mrvEvidence.architectName
            }`
          : "Needs completion evidence, contractor, and architect or retrofit coordinator details",
      complete: interventionComplete && deliveryTeamComplete,
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
        startDate: baselineStartDate,
        endDate: baselineEndDate,
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
        architect: mrvEvidence.architectName,
        retrofitCoordinator: mrvEvidence.retrofitCoordinatorName,
        principalContractor: mrvEvidence.principalContractorName,
        installers: mrvEvidence.installerNames,
        pasReference: mrvEvidence.pasReference,
        trustMarkReference: mrvEvidence.trustMarkReference,
        warrantyReference: mrvEvidence.warrantyReference,
        defectsAndRemediation: mrvEvidence.defectsAndRemediation,
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
  const carbonCalculationWindow =
    carbonIntervalSavingsSummary.fromDate && carbonIntervalSavingsSummary.toDate
      ? `${carbonIntervalSavingsSummary.dailyRows || "--"} metered days / ${
          carbonIntervalSavingsSummary.fromDate
        } to ${carbonIntervalSavingsSummary.toDate}`
      : "Awaiting persisted carbon summary";
  const carbonCalculationStatus =
    carbonIntervalSavingsSummary.calculationStatus === "stale"
      ? `stale ${
          carbonIntervalSavingsSummary.calculationVersion || "legacy"
        } summary`
      : carbonIntervalSavingsSummary.calculationVersion
      ? `${carbonIntervalSavingsSummary.calculationVersion} summary`
      : "awaiting summary";
  const trendMetrics = [
    {
      key: "electricity",
      label: "Electricity",
      unit: "kWh/h",
      summaryUnit: "kWh/day",
      summaryMultiplier: 24,
      color: "#2563eb",
      energyStatus: true,
    },
    {
      key: "gas",
      label: "Gas",
      unit: "kWh/h",
      summaryUnit: "kWh/day",
      summaryMultiplier: 24,
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
      key: "warmthBuffer",
      label: "Warmth Buffer",
      unit: "deg C",
      color: "#f59e0b",
      displayRange: { min: -5, max: 25 },
      healthyLimits: [{ value: 5, label: "5 deg C hold" }],
      healthBands: [
        { min: 12, max: 25, color: "#dcfce7", label: "Holding warmth" },
        { min: 5, max: 12, color: "#fef3c7", label: "Moderate hold" },
        { min: -5, max: 5, color: "#fee2e2", label: "Low buffer" },
      ],
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
      key: "upstairsHumidity",
      label: "Upstairs RH",
      unit: "%",
      color: "#4f46e5",
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
      key: "downstairsHumidity",
      label: "Downstairs RH",
      unit: "%",
      color: "#9333ea",
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
  const seasonalTrendRecords = Object.values(
    seasonalTrendArchive?.seasons || {}
  );
  const selectedSeasonRecord =
    seasonalTrendRecords.find((record) => record.name === selectedTrendSeason) ||
    (selectedTrendSeason === activeSeasonInfo.name
      ? seasonalTrendArchive?.seasons?.[activeSeasonInfo.key]
      : null);
  const selectedSeasonTrendData = Array.isArray(selectedSeasonRecord?.data)
    ? selectedSeasonRecord.data
    : selectedTrendSeason === activeSeasonInfo.name
    ? weeklyTrendData
    : [];
  const availableSeasonNames = SEASON_NAMES.filter(
    (seasonName) =>
      seasonName === activeSeasonInfo.name ||
      seasonalTrendRecords.some((record) => record.name === seasonName)
  );
  const seasonalTrendLabel = selectedSeasonRecord
    ? `${selectedSeasonRecord.name} ${
        selectedSeasonRecord.status === "complete" ? "snapshot" : "season so far"
      }: historical weekly hourly averages, Monday to Sunday`
    : `${selectedTrendSeason} data will appear once that season has readings`;
  const activeTrendMetrics = trendMetrics.filter((metric) =>
    selectedSeasonTrendData.some((day) => Number.isFinite(day[metric.key]))
  );
  const trendMetricGroups = [
    {
      key: "all",
      label: "Full Picture",
      metricKeys: [],
    },
    {
      key: "energy",
      label: "Energy",
      metricKeys: ["electricity", "gas"],
    },
    {
      key: "comfort",
      label: "Comfort",
      metricKeys: ["internalTemp", "externalTemp", "warmthBuffer"],
    },
    {
      key: "health",
      label: "Health",
      metricKeys: ["humidity", "pm25", "vocs"],
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
    .filter((group) => group.key === "all" || group.metricKeys.length > 0);
  const selectedTrendMetricGroupKey =
    selectedTrendMetricKeys.length === 0
      ? "all"
      : selectedTrendMetricKeys.length > 0
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
  const healthTrendAreaOptions = [
    {
      key: "all",
      label: "All",
      metricKeys: ["humidity", "pm25", "vocs"],
    },
    {
      key: "upstairs",
      label: "Upstairs",
      metricKeys: ["upstairsHumidity"],
    },
    {
      key: "downstairs",
      label: "Downstairs",
      metricKeys: ["downstairsHumidity"],
    },
  ];
  const healthTrendKeys = [
    "humidity",
    "upstairsHumidity",
    "downstairsHumidity",
    "pm25",
    "vocs",
  ];
  const healthTrendSelected =
    selectedTrendMetricGroupKey === "health" ||
    selectedTrendMetricKeys.some((key) => healthTrendKeys.includes(key));
  const activeHealthTrendArea =
    healthTrendAreaOptions.find((option) => option.key === selectedHealthTrendArea) ||
    healthTrendAreaOptions[0];
  const areaFilteredTrendMetrics =
    healthTrendSelected && activeHealthTrendArea
      ? activeTrendMetrics.filter((metric) =>
          activeHealthTrendArea.metricKeys.includes(metric.key)
        )
      : selectedActiveTrendMetrics;
  const visibleTrendMetrics =
    healthTrendSelected &&
    activeHealthTrendArea &&
    activeHealthTrendArea.key !== "all"
      ? areaFilteredTrendMetrics
      : areaFilteredTrendMetrics.length
      ? areaFilteredTrendMetrics
      : selectedActiveTrendMetrics.length
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
    if (metricKeys.length === 0) {
      setSelectedTrendMetricKeys([]);
      setSelectedHealthTrendArea("all");
      return;
    }

    const filteredKeys = metricKeys.filter((key) =>
      activeTrendMetricKeys.includes(key)
    );
    const healthKeys = ["humidity", "pm25", "vocs"];
    const isHealthGroup =
      filteredKeys.length === healthKeys.filter((key) =>
        activeTrendMetricKeys.includes(key)
      ).length &&
      filteredKeys.every((key) => healthKeys.includes(key));

    if (isHealthGroup && selectedHealthTrendArea !== "all") {
      const areaKeys =
        healthTrendAreaOptions.find((option) => option.key === selectedHealthTrendArea)
          ?.metricKeys || filteredKeys;
      setSelectedTrendMetricKeys(areaKeys);
      return;
    }

    setSelectedTrendMetricKeys(
      filteredKeys
    );
  };
  const selectHealthTrendArea = (areaKey) => {
    const option = healthTrendAreaOptions.find((item) => item.key === areaKey);

    if (!option) {
      return;
    }

    setSelectedHealthTrendArea(areaKey);
    setSelectedTrendMetricKeys(option.metricKeys);

    if (areaKey !== "all") {
      fetchWeeklyPerformanceTrend();
    }
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
  const metricRanges = buildMetricRanges(selectedSeasonTrendData, visibleTrendMetrics);
  const rawMetricRanges = activeTrendMetrics.reduce((ranges, metric) => {
    const values = selectedSeasonTrendData
      .map((point) => point[metric.key])
      .filter((value) => Number.isFinite(value));
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 1;
    ranges[metric.key] = { min, max: max === min ? max + 1 : max };
    return ranges;
  }, {});
  const hoveredTrendPoint = Number.isInteger(hoveredTrendSlot)
    ? selectedSeasonTrendData[hoveredTrendSlot]
    : null;
  const hoveredTrendX =
    hoveredTrendPoint && selectedSeasonTrendData.length > 1
      ? chartPadding.left +
        (hoveredTrendPoint.slot / (selectedSeasonTrendData.length - 1)) *
          plotWidth
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

    if (metric.key === "warmthBuffer") {
      if (value >= 5 && value <= 12) {
        return linearScore(value, [
          { min: 5, max: 12, startScore: 40, endScore: 65 },
        ]);
      }
      if (value > 12) {
        return linearScore(value, [
          { min: 12, max: 25, startScore: 65, endScore: 80 },
        ]);
      }
      return linearScore(value, [
        { min: -5, max: 0, startScore: 10, endScore: 20 },
        { min: 0, max: 5, startScore: 20, endScore: 40 },
      ]);
    }

    if (
      metric.key === "humidity" ||
      metric.key === "upstairsHumidity" ||
      metric.key === "downstairsHumidity"
    ) {
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
    if (!selectedSeasonTrendData.length) {
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
    const nextSlot = Math.round(
      (plotX / plotWidth) * (selectedSeasonTrendData.length - 1)
    );

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
    const meanValue = values.length ? average(values) : null;
    return Number.isFinite(meanValue) && Number.isFinite(metric.summaryMultiplier)
      ? meanValue * metric.summaryMultiplier
      : meanValue;
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
    hddTotal: 365,
    htcSamples: 90,
    htcDeltaTotal: 450,
    nightCooldownHtc: 115,
    nightCooldownTauHours: 39.5,
    nightCooldownRateCPerHour: 0.08,
    nightCooldownNights: 90,
    nightCooldownSamples: 720,
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
        hddTotal: projectedPerformanceDeepDive.hddTotal,
        htcSamples: projectedPerformanceDeepDive.htcSamples,
        htcDeltaTotal: projectedPerformanceDeepDive.htcDeltaTotal,
        nightCooldownHtc: projectedPerformanceDeepDive.nightCooldownHtc,
        nightCooldownTauHours:
          projectedPerformanceDeepDive.nightCooldownTauHours,
        nightCooldownRateCPerHour:
          projectedPerformanceDeepDive.nightCooldownRateCPerHour,
        nightCooldownNights: projectedPerformanceDeepDive.nightCooldownNights,
        nightCooldownSamples: projectedPerformanceDeepDive.nightCooldownSamples,
        hddSource: "projected",
        averageInternalTemp: projectedPerformanceDeepDive.internalTemp,
        flatlineIndoorTemp: false,
        filteredInsideReadings: 0,
      }
    : heatLossSummary;
  const displayedHddStatus = isNewPerformanceDeepDive ? "good" : hddStatus;
  const displayedHtcStatus = isNewPerformanceDeepDive ? "good" : htcStatus;
  const displayedNightCooldownStatus = isNewPerformanceDeepDive
    ? "good"
    : nightCooldownStatus;
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
                      const roomMetrics = [
                        {
                          key: "internalTemp",
                          label: "Temp",
                          value: room.internalTemp,
                          unit: "deg C",
                        },
                        {
                          key: "humidity",
                          label: "RH",
                          value: room.humidity,
                          unit: "%",
                        },
                        {
                          key: "vocs",
                          label: "VOC",
                          value: room.vocs,
                          unit: "ppb",
                        },
                        {
                          key: "pm25",
                          label: "PM2.5",
                          value: room.pm25,
                          unit: "ug/m3",
                        },
                        {
                          key: "pm10",
                          label: "PM10",
                          value: room.pm10,
                          unit: "ug/m3",
                        },
                        {
                          key: "hcho",
                          label: "HCHO",
                          value: room.hcho,
                          unit: "ppb",
                        },
                        {
                          key: "no2",
                          label: "NO2",
                          value: room.no2,
                          unit: "ppb",
                        },
                      ].filter(
                        (metric) =>
                          roomSupportsIaqMetric(room, metric.key) &&
                          Number.isFinite(metric.value)
                      );

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
                    <strong>HLA Score:</strong>{" "}
                    {Number.isFinite(performanceBreakdown.hla)
                      ? `${formatScore(performanceBreakdown.hla)}/100`
                      : "Pending"}
                  </p>
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
                      : Number.isFinite(displayedSensorData.externalTemp) &&
                        displayedSensorData.externalTemp > HDD_BASE_TEMP_C
                      ? `0 active HDD at ${formatMeasurement(
                          displayedSensorData.externalTemp
                        )} deg C outside`
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
                    {!isNewPerformanceDeepDive && hasWeakHtcSample
                      ? ` (Low confidence / weak temperature separation, ${formatNumber(
                          heatLossSummary.htcDeltaTotal || 0,
                          1
                        )} total deg C delta)`
                      : ""}
                  </p>
                  <p className={heatLossStatusClass(displayedNightCooldownStatus)}>
                    <HeatLossStatusDot status={displayedNightCooldownStatus} />{" "}
                    <strong>Night Cooldown HTC:</strong>{" "}
                    {Number.isFinite(displayedHeatLossSummary.nightCooldownHtc)
                      ? `${formatNumber(
                          displayedHeatLossSummary.nightCooldownHtc,
                          1
                        )} W/K`
                      : "Needs clear overnight cooling windows"}
                    {Number.isFinite(displayedHeatLossSummary.nightCooldownTauHours)
                      ? ` / tau ${formatNumber(
                          displayedHeatLossSummary.nightCooldownTauHours,
                          1
                        )} h`
                      : ""}
                    {Number.isFinite(
                      displayedHeatLossSummary.nightCooldownRateCPerHour
                    )
                      ? ` / ${formatNumber(
                          displayedHeatLossSummary.nightCooldownRateCPerHour,
                          2
                        )} deg C/h`
                      : ""}
                  </p>
                  {!isNewPerformanceDeepDive ? (
                    <>
                      <div className={heatLossStatusClass(heatExclusionStatus)}>
                        <p>
                          <HeatLossStatusDot status={heatExclusionStatus} />{" "}
                          <strong>Heat Exclusion:</strong>{" "}
                          {formatHeatExclusionBuffer(
                            heatExclusionSummary.averageBuffer
                          )}
                        </p>
                        {heatExclusionSummary.sampleCount > 0 ? (
                          <p className="pl-4 text-xs">
                            {heatExclusionSummary.sampleCount} hot-weather sample(s)
                            above {heatExclusionSummary.hotThreshold} deg C outside
                            {Number.isFinite(heatExclusionSummary.overheatingShare)
                              ? ` / ${formatNumber(
                                  heatExclusionSummary.overheatingShare * 100,
                                  0
                                )}% at 28 deg C+ indoors`
                              : ""}
                          </p>
                        ) : null}
                      </div>
                      <div className={heatLossStatusClass(rainHumidityStatus)}>
                        {(rainHumidityAreas.length
                          ? rainHumidityAreas
                          : [{ label: "Downstairs", summary: rainHumiditySummary }]
                        ).map(({ label, summary }) => {
                          const areaStatus = getRainHumidityStatus(summary);

                          return (
                            <div key={label} className="mb-2 last:mb-0">
                              <p>
                                <HeatLossStatusDot status={areaStatus} />{" "}
                                <strong>Rain / {label} RH:</strong>{" "}
                                {describeRainHumiditySummary(summary)}
                              </p>
                              {summary.rainySamples > 0 ||
                              summary.drySamples > 0 ? (
                                <p className="pl-4 text-xs">
                                  {summary.rainySamples} rainy hour(s) /{" "}
                                  {summary.drySamples} dry hour(s)
                                  {Number.isFinite(summary.averageRainyRh) &&
                                  Number.isFinite(summary.averageDryRh)
                                    ? ` / rainy ${formatNumber(
                                        summary.averageRainyRh,
                                        1
                                      )}% vs dry ${formatNumber(
                                        summary.averageDryRh,
                                        1
                                      )}%`
                                    : ""}
                                  {summary.status === "ready"
                                    ? ` / ${formatCorrelation(summary.correlation)}`
                                    : ""}
                                </p>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <p className="text-emerald-700">
                      <HeatLossStatusDot status="good" />{" "}
                      <strong>Heat Exclusion:</strong> Shading and summer bypass
                      assumed
                    </p>
                  )}
                  <p className="pt-2 mt-2 border-t border-gray-200">
                    <strong>HDD / HTC Days:</strong>{" "}
                    {(displayedHeatLossSummary.hddDays || 0) > 0 ||
                    (displayedHeatLossSummary.htcSamples || 0) > 0
                      ? `${displayedHeatLossSummary.hddDays || 0} / ${
                          displayedHeatLossSummary.htcSamples || 0
                        }`
                      : "No valid overlap yet"}
                    {!isNewPerformanceDeepDive &&
                    Number.isFinite(displayedHeatLossSummary.hddTotal)
                      ? ` / ${formatNumber(
                          displayedHeatLossSummary.hddTotal,
                          1
                        )} total HDD`
                      : ""}
                    {!isNewPerformanceDeepDive &&
                    Number.isFinite(displayedHeatLossSummary.htcDeltaTotal)
                      ? ` / ${formatNumber(
                          displayedHeatLossSummary.htcDeltaTotal,
                          1
                        )} HTC deg C delta`
                      : ""}
                    {(displayedHeatLossSummary.nightCooldownNights || 0) > 0
                      ? ` / ${displayedHeatLossSummary.nightCooldownNights} cooldown night(s)`
                      : ""}
                  </p>
                  <p
                    className="pt-2 mt-2 border-t border-gray-200 text-[11px] sm:text-xs leading-snug text-gray-600 break-words"
                    style={{ fontSize: "clamp(11px, 2.8vw, 12px)" }}
                  >
                    <span className="font-semibold text-gray-700">
                      HDD source:
                    </span>{" "}
                    {isNewPerformanceDeepDive
                      ? projectedPerformanceDeepDive.hddSource
                      : heatLossSummary.hddSource === "legacy"
                      ? "Legacy museum daily totals"
                      : "Current building data"}
                  </p>
                  {!isNewPerformanceDeepDive ? (
                    <p className="text-[11px] sm:text-xs leading-snug text-gray-600 break-words">
                      HLA confidence:{" "}
                      {hasWeakSummerHddSample
                        ? "Low confidence / summer HDD sample"
                        : hasWeakHtcSample
                        ? "Low confidence / weak HTC sample"
                        : heatLossSummary.hlaConfidence === "audit-grade"
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

        {!shouldShowDeepDive ? null : (
        <div className="mt-4 bg-white rounded border p-3 sm:p-4 space-y-3 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold">Seasonal Performance Trends</h3>
              <p className="text-xs text-gray-600">
                {seasonalTrendLabel}
              </p>
            </div>
            <div className="flex flex-wrap gap-1 text-xs">
              {SEASON_NAMES.map((season) => {
                const seasonAvailable = availableSeasonNames.includes(season);
                const seasonSelected = selectedTrendSeason === season;

                return (
                  <button
                    type="button"
                    key={season}
                    onClick={() => {
                      if (seasonAvailable) {
                        setSelectedTrendSeason(season);
                        setHoveredTrendSlot(null);
                      }
                    }}
                    disabled={!seasonAvailable}
                    className={`rounded border px-2 py-1 ${
                      seasonSelected
                        ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                        : seasonAvailable
                        ? "border-gray-300 bg-white text-gray-700"
                        : "border-gray-200 bg-gray-50 text-gray-500"
                    }`}
                  >
                    {season}
                  </button>
                );
              })}
            </div>
          </div>

          {activeTrendMetrics.length > 0 ? (
            <>
              <div className="flex flex-wrap gap-2 text-xs">
                {activeTrendMetricGroups.map((group) => {
                  const groupSelected =
                    selectedTrendMetricGroupKey === group.key ||
                    (group.key === "health" && healthTrendSelected);

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
              {dataSourceBuildingId === "home" && healthTrendSelected ? (
                <div className="flex flex-wrap gap-2 text-xs">
                  {healthTrendAreaOptions.map((option) => {
                    const optionSelected =
                      (activeHealthTrendArea?.key || "all") === option.key;

                    return (
                      <button
                        type="button"
                        key={option.key}
                        onClick={() => selectHealthTrendArea(option.key)}
                        className={`rounded border px-3 py-1.5 font-semibold transition ${
                          optionSelected
                            ? "border-purple-600 bg-purple-600 text-white"
                            : "border-gray-300 bg-white text-gray-700"
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              ) : null}

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
                  {selectedSeasonTrendData
                    .filter((point) => point.hour === 0)
                    .map((point) => {
                      const x =
                        chartPadding.left +
                        (point.slot / (selectedSeasonTrendData.length - 1)) *
                          plotWidth;
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
                  {selectedSeasonTrendData
                    .filter((point) => point.hour % 6 === 0)
                    .map((point) => {
                      const x =
                        chartPadding.left +
                        (point.slot / (selectedSeasonTrendData.length - 1)) *
                          plotWidth;
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
                        (midpointSlot / (selectedSeasonTrendData.length - 1)) *
                          plotWidth;
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
                  {selectedSeasonTrendData
                    .filter((point) => point.dayIndex === 0 && point.hour % 6 === 0)
                    .map((point) => {
                    const x =
                      chartPadding.left +
                      (point.slot / (selectedSeasonTrendData.length - 1)) *
                        plotWidth;
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
                      d={trendPath(selectedSeasonTrendData, metricRanges, metric)}
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
                  const averageValue = averageMetricValue(
                    selectedSeasonTrendData,
                    metric
                  );
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
                          ? `${formatMeasurement(averageValue)} ${
                              metric.summaryUnit || metric.unit
                            }`
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

      {isCarbonCreditTab && <div className="bg-gray-100 p-4 rounded shadow">
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
            <p className="mt-3 text-xs font-medium text-gray-600">
              Calculation: {carbonCalculationWindow} / {carbonCalculationStatus}
              {carbonIntervalSavingsSummary.calculatedAt
                ? ` / updated ${new Date(
                    carbonIntervalSavingsSummary.calculatedAt
                  ).toLocaleString("en-GB", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}`
                : ""}
            </p>
          </div>
        </div>
      </div>}

      {building.id === "home" && <div className="bg-gray-100 p-4 rounded shadow">
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
      </div>}

      {building.id === "home" && activeMrvEvidenceField && typeof document !== "undefined"
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
                  <div className="border-t border-gray-200 pt-4">
                    <h4 className="font-semibold text-gray-900">Delivery team</h4>
                    <p className="mt-1 text-xs text-gray-600">Links measured outcomes to the organisations responsible for design, coordination and installation.</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {[
                        ["Architect / practice", "architectName", "Practice or lead architect"],
                        ["Retrofit coordinator", "retrofitCoordinatorName", "Coordinator name and organisation"],
                        ["Principal contractor", "principalContractorName", "Contractor responsible for delivery"],
                        ["Installers / specialists", "installerNames", "Names or organisations, separated by commas"],
                        ["PAS 2035 / 2030 reference", "pasReference", "Project or lodgement reference"],
                        ["TrustMark reference", "trustMarkReference", "Business or project reference"],
                        ["Warranty / guarantee", "warrantyReference", "Provider and reference"],
                      ].map(([label, key, placeholder]) => (
                        <label key={key} className="block space-y-1">
                          <span className="text-xs font-semibold text-gray-700">{label}</span>
                          <input
                            type="text"
                            value={mrvEvidence[key] || ""}
                            onChange={(event) => updateMrvEvidence({ [key]: event.target.value })}
                            placeholder={placeholder}
                            className="w-full rounded border border-gray-300 px-3 py-2"
                          />
                        </label>
                      ))}
                    </div>
                    <label className="mt-3 block space-y-1">
                      <span className="text-xs font-semibold text-gray-700">Defects and remedial work</span>
                      <textarea
                        value={mrvEvidence.defectsAndRemediation || ""}
                        onChange={(event) => updateMrvEvidence({ defectsAndRemediation: event.target.value })}
                        placeholder="Record defects, responsible party, corrective work and closure date"
                        className="min-h-20 w-full rounded border border-gray-300 px-3 py-2"
                      />
                    </label>
                  </div>
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
  const location = useLocation();
  const recordMode = new URLSearchParams(location.search).get("record") || "new";
  const [ownershipRecord, setOwnershipRecord] = useState(() => {
    try {
      return JSON.parse(window.localStorage.getItem("wbp-new-building-passport") || "null");
    } catch {
      return null;
    }
  });
  const [passportSaveStatus, setPassportSaveStatus] = useState(() => {
    try {
      const savedRecord = JSON.parse(window.localStorage.getItem("wbp-new-building-passport") || "null");
      return savedRecord?.databaseId ? "saved" : savedRecord ? "local-only" : "idle";
    } catch {
      return "idle";
    }
  });
  const [passportSaveError, setPassportSaveError] = useState("");
  const [ownershipDraft, setOwnershipDraft] = useState({
    ownershipType: "owner-occupier",
    legalOwnerName: "",
    tenure: "freehold",
    custodianName: "",
    occupierName: "",
    uprn: "",
    titleNumber: "",
    authorityToCreate: false,
    privacyAccepted: false,
  });
  const [profileEditMode, setProfileEditMode] = useState(false);
  const [ownershipEvidence, setOwnershipEvidence] = useState(() => {
    try {
      const savedRecord = JSON.parse(window.localStorage.getItem("wbp-new-building-passport") || "null");
      return savedRecord?.ownershipEvidence || {
        route: "title-register",
        titleNumber: savedRecord?.titleNumber || "",
        fileName: "",
        declarationAccepted: false,
        status: "not-started",
      };
    } catch {
      return {
        route: "title-register",
        titleNumber: "",
        fileName: "",
        declarationAccepted: false,
        status: "not-started",
      };
    }
  });
  const [propertySearch, setPropertySearch] = useState(() => {
    try {
      const cached = JSON.parse(window.localStorage.getItem(PROPERTY_DISCOVERY_CACHE_KEY) || "null");
      return cached?.search || {
        address: "",
        postcode: "",
        uprn: "",
        latitude: "",
        longitude: "",
      };
    } catch {
      return { address: "", postcode: "", uprn: "", latitude: "", longitude: "" };
    }
  });
  const [propertyDiscovery, setPropertyDiscovery] = useState(() => {
    try {
      return JSON.parse(window.localStorage.getItem(PROPERTY_DISCOVERY_CACHE_KEY) || "null")?.snapshot || null;
    } catch {
      return null;
    }
  });
  const [discoveryStatus, setDiscoveryStatus] = useState("idle");
  const [discoveryError, setDiscoveryError] = useState("");
  const [setupMode, setSetupMode] = useState("manual");
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
  const [healthSensors, setHealthSensors] = useState([]);
  const [sensorEvidenceFileName, setSensorEvidenceFileName] = useState("");
  const [sensorDraft, setSensorDraft] = useState({
    manufacturer: "",
    model: "",
    serialNumber: "",
    location: "",
    evidenceGrade: "indicative",
    verificationStatus: "unverified",
    verificationDate: "",
    placementNotes: "",
    metrics: ["temperature", "humidity"],
  });
  const healthMetricOptions = [
    ["temperature", "Temperature"],
    ["humidity", "Humidity"],
    ["pm25", "PM2.5"],
    ["pm10", "PM10"],
    ["voc", "VOC"],
    ["no2", "NO2"],
    ["co2", "CO2"],
    ["hcho", "HCHO"],
  ];

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
    { label: "Ownership and custodianship", complete: Boolean(ownershipRecord) },
    { label: "Building profile", complete: hasCompleteBuildingProfile },
    { label: "Energy consent", complete: energyConsent },
    { label: "13-month energy history", complete: Boolean(historicalDataFileName) },
    { label: "Weather/GIA ready", complete: hasWeatherAndArea },
    { label: "IAQ monitoring started", complete: healthSensors.length > 0 },
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

  const updateOwnershipDraft = (field, value) => {
    setOwnershipDraft((current) => ({ ...current, [field]: value }));
  };

  const updateRetailOwnerName = (value) => {
    setOwnershipDraft((current) => ({
      ...current,
      legalOwnerName: value,
      custodianName: value,
    }));
  };

  const startProfileEdit = () => {
    setOwnershipDraft((current) => ({
      ...current,
      ownershipType: ownershipRecord?.ownershipType || current.ownershipType,
      legalOwnerName: ownershipRecord?.legalOwnerName || current.legalOwnerName,
      tenure: ownershipRecord?.tenure || current.tenure,
      custodianName: ownershipRecord?.custodianName || current.custodianName,
      uprn: ownershipRecord?.uprn || current.uprn,
      titleNumber: ownershipRecord?.titleNumber || current.titleNumber,
      authorityToCreate: ownershipRecord?.authorityToCreate ?? current.authorityToCreate,
      privacyAccepted: ownershipRecord?.privacyAccepted ?? current.privacyAccepted,
    }));
    setProfileEditMode(true);
  };

  const saveProfileDetails = async (event) => {
    event.preventDefault();
    if (!ownershipRecord) return;
    const updatedAt = new Date().toISOString();
    const nextRecord = {
      ...ownershipRecord,
      ownershipType: ownershipDraft.ownershipType,
      legalOwnerName: ownershipDraft.legalOwnerName.trim(),
      tenure: ownershipDraft.tenure,
      custodianName: ownershipDraft.legalOwnerName.trim(),
      updatedAt,
      history: [
        ...(ownershipRecord.history || []),
        {
          event: "Home profile details updated",
          actor: ownershipDraft.legalOwnerName.trim(),
          timestamp: updatedAt,
        },
      ],
    };
    window.localStorage.setItem("wbp-new-building-passport", JSON.stringify(nextRecord));
    setOwnershipRecord(nextRecord);
    setProfileEditMode(false);
    if (ownershipRecord.databaseId) {
      setPassportSaveStatus("saving");
      setPassportSaveError("");
      try {
        const securedRecord = await persistPassportRecord(nextRecord);
        window.localStorage.setItem("wbp-new-building-passport", JSON.stringify(securedRecord));
        setOwnershipRecord(securedRecord);
        setPassportSaveStatus("saved");
      } catch (error) {
        setPassportSaveStatus("error");
        setPassportSaveError(error?.message || "Your changes remain on this browser but could not be saved to your secure account.");
      }
    }
  };

  const saveOwnershipEvidence = (event) => {
    event.preventDefault();
    if (!ownershipRecord || !ownershipEvidence.declarationAccepted) return;
    const updatedAt = new Date().toISOString();
    const nextEvidence = {
      ...ownershipEvidence,
      titleNumber: ownershipEvidence.titleNumber.trim(),
      status: "ready-for-review",
      submittedAt: updatedAt,
    };
    const nextRecord = {
      ...ownershipRecord,
      titleNumber: nextEvidence.titleNumber,
      ownershipEvidence: nextEvidence,
      ownershipVerificationStatus: "ready-for-review",
      updatedAt,
      history: [
        ...(ownershipRecord.history || []),
        {
          event: "Ownership evidence prepared for review",
          actor: ownershipRecord.legalOwnerName,
          timestamp: updatedAt,
        },
      ],
    };
    window.localStorage.setItem("wbp-new-building-passport", JSON.stringify(nextRecord));
    setOwnershipEvidence(nextEvidence);
    setOwnershipRecord(nextRecord);
  };

  const updatePropertySearch = (field, value) => {
    setPropertySearch((current) => ({ ...current, [field]: value }));
  };

  const discoverProperty = async () => {
    const postcode = normalisePostcode(propertySearch.postcode);
    if (!propertySearch.address.trim() || !postcode) {
      setDiscoveryError("Enter the property address and postcode first.");
      return;
    }

    setDiscoveryStatus("loading");
    setDiscoveryError("");

    try {
      let latitude = Number(propertySearch.latitude) || null;
      let longitude = Number(propertySearch.longitude) || null;
      let localAuthority = "";
      let postcodeMatched = false;

      try {
        const postcodeResponse = await fetch(
          `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode.replace(/\s/g, ""))}`
        );
        if (postcodeResponse.ok) {
          const postcodePayload = await postcodeResponse.json();
          latitude = latitude || postcodePayload?.result?.latitude || null;
          longitude = longitude || postcodePayload?.result?.longitude || null;
          localAuthority = postcodePayload?.result?.admin_district || "";
          postcodeMatched = true;
        }
      } catch {
        // Manual coordinates still allow discovery when postcode lookup is unavailable.
      }

      const planningRecords = [];
      let planningChecked = false;
      if (latitude && longitude) {
        const planningUrl = new URL("https://www.planning.data.gov.uk/entity.json");
        planningUrl.searchParams.set("latitude", latitude);
        planningUrl.searchParams.set("longitude", longitude);
        planningUrl.searchParams.set("limit", "100");
        PROPERTY_DISCOVERY_DATASETS.forEach((dataset) =>
          planningUrl.searchParams.append("dataset", dataset)
        );

        try {
          const planningResponse = await fetch(planningUrl.toString());
          if (planningResponse.ok) {
            const planningPayload = await planningResponse.json();
            const entities = planningPayload?.entities || planningPayload?.data || [];
            entities.forEach((entity) => {
              planningRecords.push({
                dataset: entity.dataset || entity?.typology || "planning-record",
                name: entity.name || entity.reference || "Property planning record",
                reference: entity.reference || entity.entity || "",
                documentationUrl: entity["documentation-url"] || entity.documentation_url || "",
                startDate: entity["start-date"] || entity.start_date || "",
                provenance: "MHCLG Planning Data",
              });
            });
            planningChecked = true;
          }
        } catch {
          planningChecked = false;
        }
      }

      const discoveredAt = new Date().toISOString();
      const snapshot = {
        version: 1,
        discoveredAt,
        confirmedAt: null,
        address: propertySearch.address.trim(),
        postcode,
        uprn: propertySearch.uprn.trim(),
        latitude,
        longitude,
        localAuthority,
        planningRecords,
        sources: [
          {
            id: "address",
            label: "Address and location",
            status: postcodeMatched ? "checked" : latitude && longitude ? "checked" : "action",
            detail: postcodeMatched
              ? `${postcode}${localAuthority ? ` · ${localAuthority}` : ""} · postcode location confirmed`
              : latitude && longitude
              ? "Location supplied by owner"
              : "Coordinates need confirmation",
            provenance: postcodeMatched ? "Postcodes.io / ONS geography" : "Owner supplied",
          },
          {
            id: "planning",
            label: "Planning and design history",
            status: planningRecords.length ? "found" : planningChecked ? "checked" : "action",
            detail: planningRecords.length
              ? `${planningRecords.length} public record${planningRecords.length === 1 ? "" : "s"} intersect the postcode location`
              : planningChecked
              ? "Public datasets checked; no matching record returned"
              : "Local planning portal search still required",
            provenance: "MHCLG Planning Data",
          },
          {
            id: "epc",
            label: "Energy certificate history",
            status: "action",
            detail: "Connect the government EPC credential to import certificates and floor-area evidence",
            provenance: "MHCLG EPC Register",
          },
          {
            id: "ownership",
            label: "Ownership evidence",
            status: propertySearch.uprn.trim() ? "found" : "action",
            detail: propertySearch.uprn.trim()
              ? `UPRN ${propertySearch.uprn.trim()} resolved and ready for title matching`
              : "Automatic UPRN lookup is awaiting the OS Places production connector; you do not need to find it manually",
            provenance: propertySearch.uprn.trim()
              ? "OS Places / owner-confirmed record"
              : "OS Places connector pending",
          },
          {
            id: "building-control",
            label: "Building-control record",
            status: "action",
            detail: "Owner authority may be required before plans or completion records can be released",
            provenance: localAuthority || "Relevant building-control body",
          },
        ],
      };

      const nextSearch = {
        ...propertySearch,
        postcode,
        latitude: latitude || "",
        longitude: longitude || "",
      };
      setPropertySearch(nextSearch);
      setPropertyDiscovery(snapshot);
      setOwnershipDraft((current) => ({
        ...current,
        uprn: propertySearch.uprn.trim() || current.uprn,
      }));
      setManualData((current) => ({
        ...current,
        address: propertySearch.address.trim(),
        latitude: latitude || current.latitude,
        longitude: longitude || current.longitude,
      }));
      window.localStorage.setItem(
        PROPERTY_DISCOVERY_CACHE_KEY,
        JSON.stringify({ search: nextSearch, snapshot })
      );
      setDiscoveryStatus("complete");
    } catch (error) {
      setDiscoveryStatus("error");
      setDiscoveryError(error?.message || "Property discovery could not be completed.");
    }
  };

  const confirmPropertyDiscovery = () => {
    if (!propertyDiscovery) return;
    const uprn = propertySearch.uprn.trim();
    const confirmedSnapshot = {
      ...propertyDiscovery,
      uprn,
      confirmedAt: new Date().toISOString(),
      sources: propertyDiscovery.sources.map((source) =>
        source.id === "ownership"
          ? {
              ...source,
              status: uprn ? "found" : "action",
              detail: uprn
                ? `UPRN ${uprn} added by the homeowner`
                : "Property number can be added later",
              provenance: uprn ? "Homeowner confirmed" : "Pending",
            }
          : source
      ),
    };
    setOwnershipDraft((current) => ({ ...current, uprn }));
    setPropertyDiscovery(confirmedSnapshot);
    window.localStorage.setItem(
      PROPERTY_DISCOVERY_CACHE_KEY,
      JSON.stringify({ search: propertySearch, snapshot: confirmedSnapshot })
    );
  };

  const persistPassportRecord = async (record) => {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      throw new Error("Your secure session has expired. Sign in again to save this profile.");
    }

    const userId = authData.user.id;
    const buildingPayload = {
      record_reference: record.recordId,
      uprn: record.uprn || record.propertyDiscovery?.uprn || null,
      address: {
        address: record.propertyDiscovery?.address || "",
        postcode: record.propertyDiscovery?.postcode || "",
        local_authority: record.propertyDiscovery?.localAuthority || "",
      },
      ownership_type: record.ownershipType,
      tenure: record.tenure,
      lifecycle_stage: "occupy",
      legal_owner_name: record.legalOwnerName,
      custodian_user_id: userId,
      genesis_hash: record.genesisHash,
      passport_status: "draft",
      ownership_verification_status: record.ownershipVerificationStatus || "unverified",
      privacy_notice_version: "homeowner-v1",
      privacy_notice_accepted_at: record.privacyAccepted ? record.createdAt : null,
      updated_at: new Date().toISOString(),
    };

    const { data: existingRecord, error: lookupError } = await supabase
      .from("WBPBuildingRecords")
      .select("id")
      .eq("record_reference", record.recordId)
      .maybeSingle();
    if (lookupError) throw lookupError;

    let databaseRecord = existingRecord;
    if (existingRecord?.id) {
      const { data, error } = await supabase
        .from("WBPBuildingRecords")
        .update(buildingPayload)
        .eq("id", existingRecord.id)
        .select("id")
        .single();
      if (error) throw error;
      databaseRecord = data;
    } else {
      const { data, error } = await supabase
        .from("WBPBuildingRecords")
        .insert(buildingPayload)
        .select("id")
        .single();
      if (error) throw error;
      databaseRecord = data;

      if (record.propertyDiscovery) {
        const discovery = record.propertyDiscovery;
        const { error: discoveryError } = await supabase
          .from("WBPPropertyDiscoverySnapshots")
          .insert({
            building_record_id: databaseRecord.id,
            snapshot_version: discovery.version || 1,
            searched_address: discovery.address,
            postcode: discovery.postcode || null,
            uprn: discovery.uprn || null,
            latitude: discovery.latitude || null,
            longitude: discovery.longitude || null,
            local_authority: discovery.localAuthority || null,
            discovered_sources: discovery.sources || [],
            planning_records: discovery.planningRecords || [],
            owner_confirmed_at: discovery.confirmedAt || null,
            discovered_at: discovery.discoveredAt || record.createdAt,
            created_by: userId,
          });
        if (discoveryError) throw discoveryError;
      }
    }

    await supabase.from("WBPAuditEvents").insert({
      building_record_id: databaseRecord.id,
      actor_user_id: userId,
      event_type: existingRecord?.id ? "home-profile-updated" : "home-profile-created",
      event_data: { record_reference: record.recordId },
    });

    return { ...record, databaseId: databaseRecord.id, storageState: "supabase" };
  };

  const secureExistingPassport = async () => {
    if (!ownershipRecord) return;
    setPassportSaveStatus("saving");
    setPassportSaveError("");
    try {
      const securedRecord = await persistPassportRecord(ownershipRecord);
      window.localStorage.setItem("wbp-new-building-passport", JSON.stringify(securedRecord));
      setOwnershipRecord(securedRecord);
      setPassportSaveStatus("saved");
    } catch (error) {
      setPassportSaveStatus("error");
      setPassportSaveError(error?.message || "The profile could not be saved securely.");
    }
  };

  const createBuildingPassport = async (event) => {
    event.preventDefault();
    const recordId = `WBP-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const createdAt = new Date().toISOString();
    const canonicalPayload = JSON.stringify({
      recordId,
      createdAt,
      lifecycleStage: "occupy",
      ...ownershipDraft,
      propertyDiscovery,
    });
    let genesisHash = "hash-pending";

    if (window.crypto?.subtle) {
      const bytes = new TextEncoder().encode(canonicalPayload);
      const digest = await window.crypto.subtle.digest("SHA-256", bytes);
      genesisHash = Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    }

    const nextRecord = {
      recordId,
      createdAt,
      lifecycleStage: "occupy",
      custodianStatus: "active",
      genesisHash,
      ...ownershipDraft,
      propertyDiscovery,
      history: [
        {
          event: "Building passport created",
          actor: ownershipDraft.custodianName || ownershipDraft.legalOwnerName,
          timestamp: createdAt,
        },
      ],
    };

    window.localStorage.setItem("wbp-new-building-passport", JSON.stringify(nextRecord));
    setOwnershipRecord(nextRecord);
    setPassportSaveStatus("saving");
    setPassportSaveError("");
    try {
      const securedRecord = await persistPassportRecord(nextRecord);
      window.localStorage.setItem("wbp-new-building-passport", JSON.stringify(securedRecord));
      setOwnershipRecord(securedRecord);
      setPassportSaveStatus("saved");
    } catch (error) {
      setPassportSaveStatus("error");
      setPassportSaveError(error?.message || "The profile is saved on this browser, but not yet in your secure account.");
    }
  };

  const handleSensorDraftChange = (field, value) => {
    setSensorDraft((current) => ({ ...current, [field]: value }));
  };

  const toggleSensorMetric = (metric) => {
    setSensorDraft((current) => ({
      ...current,
      metrics: current.metrics.includes(metric)
        ? current.metrics.filter((item) => item !== metric)
        : [...current.metrics, metric],
    }));
  };

  const addHealthSensor = () => {
    if (
      !sensorDraft.manufacturer.trim() ||
      !sensorDraft.model.trim() ||
      !sensorDraft.location.trim() ||
      sensorDraft.metrics.length === 0
    ) {
      return;
    }

    setHealthSensors((current) => [
      ...current,
      {
        ...sensorDraft,
        id: `health-sensor-${Date.now()}`,
        evidenceFileName: sensorEvidenceFileName,
      },
    ]);
    setSensorDraft({
      manufacturer: "",
      model: "",
      serialNumber: "",
      location: "",
      evidenceGrade: "indicative",
      verificationStatus: "unverified",
      verificationDate: "",
      placementNotes: "",
      metrics: ["temperature", "humidity"],
    });
    setSensorEvidenceFileName("");
  };

  return (
    <div className="min-h-screen bg-white p-4 flex flex-col space-y-6">
      <div className="bg-gray-100 p-4 rounded shadow">
        <h2 className="text-lg font-bold mb-3">New Building</h2>

        {!ownershipRecord ? (
          <form onSubmit={createBuildingPassport} className="mx-auto max-w-4xl border border-emerald-200 bg-white p-4 sm:p-5">
            <div className="border-b border-gray-200 pb-4">
              <p className="text-xs font-bold uppercase text-emerald-700">New home profile</p>
              <h3 className="mt-1 text-xl font-bold">Let’s set up your home</h3>
              <p className="mt-1 max-w-2xl text-sm text-gray-600">
                Find the address, confirm it is yours and create the profile. Documents and monitoring can be added afterwards.
              </p>
            </div>

            {recordMode === "import" ? (
              <div className="mt-4 border-l-4 border-blue-500 bg-blue-50 p-3 text-sm text-blue-900">
                You selected an imported handover record. Enter the existing WBP reference below once supplied; the sender and evidence history will be verified before custodianship changes.
              </div>
            ) : null}

            <section className="mt-5 border border-gray-200 bg-gray-50 p-3 sm:p-4">
              <div>
                <p className="text-xs font-bold uppercase text-blue-700">Step 1 of 2</p>
                <h4 className="mt-1 text-base font-bold">Find your home</h4>
                <p className="mt-1 text-sm text-gray-600">Enter the address exactly as you normally use it.</p>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(130px,1fr)]">
                <label className="space-y-1">
                  <span className="text-xs font-semibold text-gray-700">Property address</span>
                  <input
                    className="w-full border border-gray-300 p-2 text-sm"
                    value={propertySearch.address}
                    onChange={(event) => updatePropertySearch("address", event.target.value)}
                    placeholder="House number, street and town"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold text-gray-700">Postcode</span>
                  <input
                    className="w-full border border-gray-300 p-2 text-sm uppercase"
                    value={propertySearch.postcode}
                    onChange={(event) => updatePropertySearch("postcode", event.target.value)}
                    placeholder="IP12 4HA"
                  />
                </label>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={discoverProperty}
                    disabled={discoveryStatus === "loading"}
                    className="w-full bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-60"
                  >
                    {discoveryStatus === "loading" ? "Checking address..." : propertyDiscovery ? "Check again" : "Check address"}
                  </button>
                </div>
              </div>

              {discoveryError ? (
                <p className="mt-3 border border-red-200 bg-red-50 p-2 text-xs text-red-800">{discoveryError}</p>
              ) : null}

              {propertyDiscovery ? (
                <div className="mt-4 space-y-3 border-t border-gray-200 pt-4">
                  <div className="border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">
                    <p className="text-sm font-bold">Home location found</p>
                    <p className="mt-1 text-xs">
                      {propertyDiscovery.address}, {propertyDiscovery.postcode}
                      {propertyDiscovery.localAuthority ? ` · ${propertyDiscovery.localAuthority}` : ""}
                    </p>
                  </div>

                  <div className="border border-blue-200 bg-white p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold">Add your property number</p>
                        <p className="mt-1 max-w-xl text-xs text-gray-600">
                          The UPRN is your home’s permanent reference number. It helps us avoid duplicate profiles and is free to find.
                        </p>
                      </div>
                      <a
                        href="https://www.findmyaddress.co.uk/search"
                        target="_blank"
                        rel="noreferrer"
                        className="border border-blue-700 bg-white px-3 py-2 text-xs font-bold text-blue-800"
                      >
                        Find it free
                      </a>
                    </div>
                    <label className="mt-3 block space-y-1">
                      <span className="text-xs font-semibold text-gray-700">Property number (UPRN)</span>
                      <input
                        inputMode="numeric"
                        className="w-full border border-gray-300 p-2 text-sm sm:max-w-sm"
                        value={propertySearch.uprn}
                        onChange={(event) => updatePropertySearch("uprn", event.target.value.replace(/\D/g, ""))}
                        placeholder="Paste the number here"
                      />
                    </label>
                    <p className="mt-2 text-[11px] text-gray-500">FindMyAddress opens separately because its licence does not allow it to be embedded in WBP.</p>
                  </div>

                  <details className="border border-gray-200 bg-white p-3">
                    <summary className="cursor-pointer text-xs font-semibold text-gray-700">What did WBP check?</summary>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {propertyDiscovery.sources
                        .filter((source) => ["address", "planning"].includes(source.id))
                        .map((source) => (
                          <div key={source.id} className={`border p-3 text-xs ${sourceStatusClasses[source.status] || sourceStatusClasses.unavailable}`}>
                            <p className="font-bold">{source.label}</p>
                            <p className="mt-1">{source.detail}</p>
                          </div>
                        ))}
                    </div>
                  </details>

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-3">
                    <p className="text-xs text-gray-600">
                      {propertyDiscovery.confirmedAt
                        ? "Home confirmed"
                        : propertySearch.uprn.trim()
                        ? "UPRN added. Confirm this is the correct home."
                        : "You can continue without the UPRN and add it later."}
                    </p>
                    {!propertyDiscovery.confirmedAt ? (
                      <button type="button" onClick={confirmPropertyDiscovery} className="border border-emerald-700 bg-white px-3 py-2 text-xs font-bold text-emerald-800">
                        Use this home
                      </button>
                    ) : (
                      <span className="bg-emerald-700 px-3 py-2 text-xs font-bold text-white">Home confirmed</span>
                    )}
                  </div>
                </div>
              ) : null}
            </section>

            {propertyDiscovery?.confirmedAt ? (
              <section className="mt-5 border border-gray-200 bg-white p-3 sm:p-4">
                <p className="text-xs font-bold uppercase text-emerald-700">Step 2 of 2</p>
                <h4 className="mt-1 text-base font-bold">About you</h4>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-xs font-semibold text-gray-700">Your name</span>
                    <input required className="w-full border border-gray-300 p-2 text-sm" value={ownershipDraft.legalOwnerName} onChange={(event) => updateRetailOwnerName(event.target.value)} placeholder="Property owner’s name" />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-semibold text-gray-700">You are the</span>
                    <select className="w-full border border-gray-300 p-2 text-sm" value={ownershipDraft.ownershipType} onChange={(event) => updateOwnershipDraft("ownershipType", event.target.value)}>
                      <option value="owner-occupier">Homeowner living here</option>
                      <option value="private-landlord">Homeowner letting the property</option>
                      <option value="shared-ownership">Shared owner</option>
                      <option value="leaseholder">Leaseholder</option>
                      <option value="managing-agent">Authorised representative</option>
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-semibold text-gray-700">The home is</span>
                    <select className="w-full border border-gray-300 p-2 text-sm" value={ownershipDraft.tenure} onChange={(event) => updateOwnershipDraft("tenure", event.target.value)}>
                      <option value="freehold">Freehold</option>
                      <option value="leasehold">Leasehold</option>
                      <option value="commonhold">Commonhold</option>
                      <option value="shared-ownership">Shared ownership</option>
                      <option value="other">Not sure</option>
                    </select>
                  </label>
                  {recordMode === "import" ? (
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-gray-700">Handover code</span>
                      <input required className="w-full border border-gray-300 p-2 text-sm" placeholder="WBP record or handover code" />
                    </label>
                  ) : null}
                </div>

                <div className="mt-5 grid gap-3 border-t border-gray-200 pt-4">
                  <label className="flex items-start gap-3 text-sm text-gray-700">
                    <input type="checkbox" className="mt-1" checked={ownershipDraft.authorityToCreate} onChange={(event) => updateOwnershipDraft("authorityToCreate", event.target.checked)} />
                    <span>I confirm that I own this home or have the owner’s permission to create its profile.</span>
                  </label>
                  <label className="flex items-start gap-3 text-sm text-gray-700">
                    <input type="checkbox" className="mt-1" checked={ownershipDraft.privacyAccepted} onChange={(event) => updateOwnershipDraft("privacyAccepted", event.target.checked)} />
                    <span>I agree to keep household information private and separate from the transferable building record.</span>
                  </label>
                </div>

                <button type="submit" disabled={!ownershipDraft.legalOwnerName.trim() || !ownershipDraft.authorityToCreate || !ownershipDraft.privacyAccepted} className="mt-5 w-full bg-emerald-700 px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto">
                  Create home profile
                </button>
              </section>
            ) : null}
          </form>
        ) : (
          <div className="mx-auto max-w-4xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase text-emerald-700">Home profile created</p>
                <h3 className="mt-1 text-lg font-bold">{ownershipRecord.recordId}</h3>
                <p className="mt-1 text-sm text-gray-700">Created by {ownershipRecord.legalOwnerName}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-bold uppercase text-amber-900">
                  {ownershipRecord.ownershipVerificationStatus === "ready-for-review" ? "Evidence awaiting review" : "Ownership unverified"}
                </span>
                <span className="border border-gray-300 bg-white px-2 py-1 text-xs font-bold uppercase text-gray-700">Not transferable</span>
                <span className={`border px-2 py-1 text-xs font-bold uppercase ${passportSaveStatus === "saved" ? "border-emerald-300 bg-white text-emerald-800" : "border-gray-300 bg-gray-100 text-gray-700"}`}>
                  {passportSaveStatus === "saved" ? "Saved securely" : passportSaveStatus === "saving" ? "Saving..." : "Browser only"}
                </span>
              </div>
            </div>
            <div className="mt-4 grid gap-3 border-t border-emerald-200 pt-3 text-xs text-gray-700 sm:grid-cols-3">
              <p><strong>Ownership:</strong><br />{ownershipRecord.ownershipType.replaceAll("-", " ")}</p>
              <p><strong>Tenure:</strong><br />{ownershipRecord.tenure.replaceAll("-", " ")}</p>
              <p><strong>Property number:</strong><br />{ownershipRecord.uprn || "Can be added later"}</p>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-emerald-200 pt-3">
              <p className="text-xs text-gray-600">This is an owner-created profile. WBP has not yet verified legal ownership.</p>
              <div className="flex flex-wrap gap-2">
                {passportSaveStatus !== "saved" ? <button type="button" disabled={passportSaveStatus === "saving"} onClick={secureExistingPassport} className="bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{passportSaveStatus === "saving" ? "Saving..." : "Save to secure account"}</button> : null}
                <button type="button" onClick={startProfileEdit} className="border border-emerald-700 bg-white px-3 py-2 text-xs font-bold text-emerald-800">Edit profile</button>
              </div>
            </div>
            {passportSaveError ? <p className="mt-3 border border-red-200 bg-red-50 p-2 text-xs text-red-800">{passportSaveError}</p> : null}
          </div>
        )}

        {ownershipRecord && profileEditMode ? (
          <form onSubmit={saveProfileDetails} className="mx-auto mt-4 max-w-4xl border border-gray-300 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold">Edit profile</h3>
                <p className="mt-1 text-xs text-gray-600">Correct the profile while ownership is being checked. Its record ID will not change.</p>
              </div>
              <button type="button" onClick={() => setProfileEditMode(false)} className="text-xs font-semibold underline">Cancel</button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <label className="space-y-1"><span className="text-xs font-semibold">Your name</span><input required className="w-full border border-gray-300 p-2 text-sm" value={ownershipDraft.legalOwnerName} onChange={(event) => updateRetailOwnerName(event.target.value)} /></label>
              <label className="space-y-1"><span className="text-xs font-semibold">You are the</span><select className="w-full border border-gray-300 p-2 text-sm" value={ownershipDraft.ownershipType} onChange={(event) => updateOwnershipDraft("ownershipType", event.target.value)}><option value="owner-occupier">Homeowner living here</option><option value="private-landlord">Homeowner letting the property</option><option value="shared-ownership">Shared owner</option><option value="leaseholder">Leaseholder</option><option value="managing-agent">Authorised representative</option></select></label>
              <label className="space-y-1"><span className="text-xs font-semibold">The home is</span><select className="w-full border border-gray-300 p-2 text-sm" value={ownershipDraft.tenure} onChange={(event) => updateOwnershipDraft("tenure", event.target.value)}><option value="freehold">Freehold</option><option value="leasehold">Leasehold</option><option value="commonhold">Commonhold</option><option value="shared-ownership">Shared ownership</option><option value="other">Not sure</option></select></label>
            </div>
            <button type="submit" className="mt-4 bg-emerald-700 px-4 py-2 text-sm font-bold text-white">Save changes</button>
          </form>
        ) : null}

        {ownershipRecord ? (
          <section className="mx-auto mt-4 max-w-4xl border border-amber-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase text-amber-700">Ownership check</p>
                <h3 className="mt-1 text-base font-bold">Show that you can manage this home profile</h3>
                <p className="mt-1 max-w-2xl text-xs text-gray-600">Choose the most convenient evidence. Creating the profile does not transfer the property or replace HM Land Registry.</p>
              </div>
              <span className={`px-2 py-1 text-xs font-bold uppercase ${ownershipEvidence.status === "ready-for-review" ? "bg-amber-100 text-amber-900" : "bg-gray-100 text-gray-700"}`}>
                {ownershipEvidence.status === "ready-for-review" ? "Ready for review" : "Not started"}
              </span>
            </div>

            <form onSubmit={saveOwnershipEvidence} className="mt-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="border border-gray-200 p-3 text-sm">
                  <span className="block text-xs font-bold">Evidence route</span>
                  <select className="mt-2 w-full border border-gray-300 p-2 text-sm" value={ownershipEvidence.route} onChange={(event) => setOwnershipEvidence((current) => ({ ...current, route: event.target.value, status: "not-started" }))}>
                    <option value="title-register">Title register or official copy</option>
                    <option value="conveyancer">Conveyancer or solicitor confirmation</option>
                    <option value="shared-owner">Shared ownership or lease evidence</option>
                    <option value="representative">Owner authority for a representative</option>
                  </select>
                </label>
                <label className="border border-gray-200 p-3 text-sm">
                  <span className="block text-xs font-bold">Title number, if known</span>
                  <input className="mt-2 w-full border border-gray-300 p-2 text-sm uppercase" value={ownershipEvidence.titleNumber} onChange={(event) => setOwnershipEvidence((current) => ({ ...current, titleNumber: event.target.value }))} placeholder="For example, SK123456" />
                </label>
                <label className="border border-gray-200 p-3 text-sm">
                  <span className="block text-xs font-bold">Choose supporting document</span>
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="mt-2 block w-full text-xs" onChange={(event) => setOwnershipEvidence((current) => ({ ...current, fileName: event.target.files?.[0]?.name || "", status: "not-started" }))} />
                  <span className="mt-2 block text-[11px] text-gray-500">The file is not uploaded or stored yet. Secure document storage must be connected first.</span>
                </label>
              </div>
              <label className="mt-4 flex items-start gap-3 text-sm text-gray-700">
                <input type="checkbox" className="mt-1" checked={ownershipEvidence.declarationAccepted} onChange={(event) => setOwnershipEvidence((current) => ({ ...current, declarationAccepted: event.target.checked }))} />
                <span>I confirm that these details are accurate and that WBP may use them only to check my authority to manage this home profile.</span>
              </label>
              <div className="mt-4 flex justify-end">
                <button type="submit" disabled={!ownershipEvidence.declarationAccepted} className="bg-amber-500 px-4 py-2 text-sm font-bold text-black disabled:cursor-not-allowed disabled:opacity-40">Save evidence details</button>
              </div>
            </form>

            <details className="mt-4 border-t border-gray-200 pt-3">
              <summary className="cursor-pointer text-xs font-bold text-gray-700">How WBP protects this information</summary>
              <div className="mt-3 grid gap-2 text-xs text-gray-600 sm:grid-cols-2">
                <p><strong>Private by default:</strong> ownership and identity evidence is not part of the public or transferable building record.</p>
                <p><strong>Minimum evidence:</strong> WBP should retain verification results and document hashes where possible, rather than unnecessary document copies.</p>
                <p><strong>Separate household data:</strong> names, health information and occupancy behaviour must remain separate from property evidence.</p>
                <p><strong>Your control:</strong> a production account must support access, correction, deletion requests and a clear retention period.</p>
              </div>
            </details>
            <a href="https://www.gov.uk/search-property-information-land-registry" target="_blank" rel="noopener noreferrer" className="mt-4 flex items-center gap-3 border border-yellow-300 bg-yellow-50 p-3 text-sm font-semibold text-gray-900 transition-colors hover:bg-yellow-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-700">
              <span className="flex shrink-0 items-center gap-1.5 font-extrabold" aria-hidden="true"><img src={govukCrown} alt="" className="h-12 w-12 object-contain" />GOV.UK</span>
              <span>Get property information from HM Land Registry</span>
              <span className="ml-auto shrink-0 text-lg" aria-hidden="true">&#8599;</span>
            </a>
          </section>
        ) : null}

        {ownershipRecord ? <div className="mx-auto mt-4 max-w-4xl bg-white rounded border p-4 space-y-3">
          <h3 className="text-base font-semibold">Matterport Data</h3>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`px-3 py-2 rounded border text-sm font-semibold ${
                setupMode === "manual" ? "bg-blue-600 text-white" : "bg-white"
              }`}
              onClick={() => setSetupMode("manual")}
            >
              URL / number
            </button>
            <button
              type="button"
              className={`px-3 py-2 rounded border text-sm font-semibold ${
                setupMode === "api" ? "bg-blue-600 text-white" : "bg-white"
              }`}
              onClick={() => setSetupMode("api")}
            >
              SDK / API
            </button>
          </div>

          {setupMode === "api" ? (
            <textarea
              className="border p-3 w-full min-h-[110px] text-sm"
              value={apiDetails}
              onChange={(event) => setApiDetails(event.target.value)}
              placeholder="Paste Matterport SDK / API details when available"
            />
          ) : null}

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
          <a href="https://matterport.com/3d-camera-app" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 border border-yellow-300 bg-yellow-50 p-3 text-sm font-semibold text-gray-900 transition-colors hover:bg-yellow-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-700">
            <img src={matterportMark} alt="" className="h-12 w-12 shrink-0 object-contain" />
            <span className="min-w-0"><strong className="block text-base text-gray-900">matterport</strong><span>Scan your home with the Matterport app</span></span>
            <span className="ml-auto shrink-0 text-lg" aria-hidden="true">&#8599;</span>
          </a>
        </div> : null}
      </div>

      {ownershipRecord ? <>
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
                Register each IAQ instrument so its readings carry the device,
                placement and assurance evidence needed for health scoring and audit.
              </p>
            </div>

            <div className="border rounded p-3 bg-gray-50 space-y-3">
              <div>
                <h4 className="font-semibold text-sm">Instrument Register</h4>
                <p className="text-xs text-gray-600">
                  Record only the metrics exposed by this device. Evidence grades are
                  provisional until the audit pack is independently reviewed.
                </p>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <label className="space-y-1 text-xs text-gray-600">
                  Manufacturer
                  <input
                    type="text"
                    className="border rounded p-2 w-full text-xs bg-white"
                    value={sensorDraft.manufacturer}
                    onChange={(event) =>
                      handleSensorDraftChange("manufacturer", event.target.value)
                    }
                    placeholder="e.g. Dyson"
                  />
                </label>
                <label className="space-y-1 text-xs text-gray-600">
                  Model
                  <input
                    type="text"
                    className="border rounded p-2 w-full text-xs bg-white"
                    value={sensorDraft.model}
                    onChange={(event) =>
                      handleSensorDraftChange("model", event.target.value)
                    }
                    placeholder="Model name or number"
                  />
                </label>
                <label className="space-y-1 text-xs text-gray-600">
                  Serial / device ID
                  <input
                    type="text"
                    className="border rounded p-2 w-full text-xs bg-white"
                    value={sensorDraft.serialNumber}
                    onChange={(event) =>
                      handleSensorDraftChange("serialNumber", event.target.value)
                    }
                    placeholder="Optional device identifier"
                  />
                </label>
                <label className="space-y-1 text-xs text-gray-600">
                  Installed location
                  <input
                    type="text"
                    className="border rounded p-2 w-full text-xs bg-white"
                    value={sensorDraft.location}
                    onChange={(event) =>
                      handleSensorDraftChange("location", event.target.value)
                    }
                    placeholder="e.g. Downstairs living room"
                  />
                </label>
                <label className="space-y-1 text-xs text-gray-600">
                  Provisional evidence grade
                  <select
                    className="border rounded p-2 w-full text-xs bg-white"
                    value={sensorDraft.evidenceGrade}
                    onChange={(event) =>
                      handleSensorDraftChange("evidenceGrade", event.target.value)
                    }
                  >
                    <option value="indicative">Indicative</option>
                    <option value="validated">Validated field device</option>
                    <option value="reference">Reference grade</option>
                  </select>
                </label>
                <label className="space-y-1 text-xs text-gray-600">
                  Physical / calibration check
                  <select
                    className="border rounded p-2 w-full text-xs bg-white"
                    value={sensorDraft.verificationStatus}
                    onChange={(event) =>
                      handleSensorDraftChange("verificationStatus", event.target.value)
                    }
                  >
                    <option value="unverified">Not yet checked</option>
                    <option value="manufacturer">Manufacturer specification recorded</option>
                    <option value="co-location">Co-location comparison completed</option>
                    <option value="site-inspection">Site inspection completed</option>
                    <option value="traceable">Traceable calibration recorded</option>
                  </select>
                </label>
                <label className="space-y-1 text-xs text-gray-600">
                  Check / calibration date
                  <input
                    type="date"
                    className="border rounded p-2 w-full text-xs bg-white"
                    value={sensorDraft.verificationDate}
                    onChange={(event) =>
                      handleSensorDraftChange("verificationDate", event.target.value)
                    }
                  />
                </label>
                <label className="space-y-1 text-xs text-gray-600">
                  Supporting evidence
                  <input
                    key={sensorEvidenceFileName || "empty-sensor-evidence"}
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.csv,application/pdf,image/*,text/csv"
                    className="block w-full text-xs pt-1"
                    onChange={(event) =>
                      setSensorEvidenceFileName(event.target.files?.[0]?.name || "")
                    }
                  />
                </label>
              </div>

              <fieldset className="space-y-2">
                <legend className="text-xs font-semibold text-gray-700">
                  Metrics supplied by this device
                </legend>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {healthMetricOptions.map(([value, label]) => (
                    <label
                      key={value}
                      className="flex items-center gap-2 text-xs border rounded bg-white p-2"
                    >
                      <input
                        type="checkbox"
                        checked={sensorDraft.metrics.includes(value)}
                        onChange={() => toggleSensorMetric(value)}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <label className="space-y-1 text-xs text-gray-600 block">
                Placement and installation notes
                <textarea
                  className="border rounded p-2 w-full min-h-[64px] text-xs bg-white"
                  value={sensorDraft.placementNotes}
                  onChange={(event) =>
                    handleSensorDraftChange("placementNotes", event.target.value)
                  }
                  placeholder="Height, room position, airflow obstructions or installation notes"
                />
              </label>

              <button
                type="button"
                className="bg-blue-600 disabled:bg-gray-300 disabled:text-gray-500 text-white px-4 py-2 rounded text-sm font-semibold"
                disabled={
                  !sensorDraft.manufacturer.trim() ||
                  !sensorDraft.model.trim() ||
                  !sensorDraft.location.trim() ||
                  sensorDraft.metrics.length === 0
                }
                onClick={addHealthSensor}
              >
                Add Instrument
              </button>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <h4 className="font-semibold text-sm">Registered Instruments</h4>
                <span className="text-xs text-gray-500">
                  {healthSensors.length} registered
                </span>
              </div>
              {healthSensors.length === 0 ? (
                <div className="text-xs border rounded bg-gray-50 p-3 text-gray-600">
                  No health-data instruments registered yet.
                </div>
              ) : (
                healthSensors.map((sensor) => (
                  <div key={sensor.id} className="border rounded p-3 text-xs space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold break-words">
                          {sensor.manufacturer} {sensor.model}
                        </p>
                        <p className="text-gray-600 break-words">
                          {sensor.location}
                          {sensor.serialNumber ? ` | ${sensor.serialNumber}` : ""}
                        </p>
                      </div>
                      <span className="shrink-0 border rounded px-2 py-1 uppercase text-[10px] text-gray-600">
                        {sensor.evidenceGrade}
                      </span>
                    </div>
                    <p className="text-gray-700">
                      <strong>Metrics:</strong>{" "}
                      {sensor.metrics
                        .map(
                          (metric) =>
                            healthMetricOptions.find(([value]) => value === metric)?.[1] ||
                            metric
                        )
                        .join(", ")}
                    </p>
                    <p className="text-gray-600">
                      <strong>Assurance:</strong>{" "}
                      {sensor.verificationStatus.replaceAll("-", " ")}
                      {sensor.verificationDate ? ` on ${sensor.verificationDate}` : ""}
                      {sensor.evidenceFileName
                        ? ` | Evidence: ${sensor.evidenceFileName}`
                        : ""}
                    </p>
                    <button
                      type="button"
                      className="text-red-700 underline"
                      onClick={() =>
                        setHealthSensors((current) =>
                          current.filter((item) => item.id !== sensor.id)
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
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
      </> : null}
    </div>
  );
};

const PORTFOLIO_PROPERTIES = [
  { id: "WBP-001", estate: "14 Bridgewood Road", archetype: "Semi-detached", health: 87, energy: 88, risk: "Monitor", retrofit: "Assessed", evidence: 63, qa: "Monitoring", supplier: "Pending appointment", collector: "Live", euiBefore: 41.5, euiAfter: null, measure: "Whole-house design pending", pas2035: true, residentConsent: false, trustmark: false, buildingId: "home" },
  { id: "WBP-002", estate: "Bridgewood", archetype: "Terrace", health: 61, energy: 54, risk: "Damp", retrofit: "Assessed", evidence: 42, qa: "Action needed", supplier: "EastBuild Retrofit", collector: "Live", euiBefore: 132, euiAfter: null, measure: "Fabric assessment", pas2035: true, residentConsent: false, trustmark: false },
  { id: "WBP-003", estate: "Kyson", archetype: "Flat", health: 72, energy: 47, risk: "Cold", retrofit: "Design ready", evidence: 78, qa: "Pre-works", supplier: "Suffolk Whole House", collector: "Live", euiBefore: 148, euiAfter: null, measure: "Insulation + glazing", pas2035: true, residentConsent: false, trustmark: false },
  { id: "WBP-004", estate: "Kyson", archetype: "Maisonette", health: 58, energy: 69, risk: "IAQ", retrofit: "Installation started", evidence: 86, qa: "Action needed", supplier: "EastBuild Retrofit", collector: "Attention", euiBefore: 94, euiAfter: null, measure: "Ventilation + fabric", pas2035: true, residentConsent: true, trustmark: false },
  { id: "WBP-005", estate: "Rendlesham", archetype: "Bungalow", health: 91, energy: 76, risk: "Good", retrofit: "TrustMark + handover", evidence: 100, qa: "Verified", supplier: "Suffolk Whole House", collector: "Live", euiBefore: 118, euiAfter: 36, measure: "Fabric + heat pump", pas2035: true, residentConsent: true, trustmark: true, projectedAnnualCredits: 1.35 },
  { id: "WBP-006", estate: "Rendlesham", archetype: "Semi-detached", health: 67, energy: 51, risk: "Heat loss", retrofit: "Assessed", evidence: 55, qa: "Action needed", supplier: "Coastal Energy Works", collector: "Live", euiBefore: 151, euiAfter: null, measure: "Fabric assessment", pas2035: true, residentConsent: false, trustmark: false },
  { id: "WBP-007", estate: "Melton", archetype: "Terrace", health: 76, energy: 64, risk: "Overheat", retrofit: "Resident confirmed", evidence: 71, qa: "Pre-works", supplier: "Coastal Energy Works", collector: "Live", euiBefore: 88, euiAfter: null, measure: "Solar + ventilation", pas2035: true, residentConsent: true, trustmark: false },
  { id: "WBP-008", estate: "Melton", archetype: "Flat", health: 83, energy: 81, risk: "Good", retrofit: "TrustMark + handover", evidence: 96, qa: "Verified", supplier: "Suffolk Whole House", collector: "Live", euiBefore: 102, euiAfter: 42, measure: "Fabric + solar", pas2035: true, residentConsent: true, trustmark: true, projectedAnnualCredits: 0.92 },
];

const PORTFOLIO_SELLER_RESERVE_PRICE = 85;
const PORTFOLIO_EXCHANGE_PROPERTIES = PORTFOLIO_PROPERTIES.filter(
  (property) =>
    property.qa === "Verified" &&
    Number.isFinite(property.projectedAnnualCredits)
);
const PORTFOLIO_EXCHANGE_SUMMARY = (() => {
  const propertyCount = PORTFOLIO_EXCHANGE_PROPERTIES.length;
  const carbonCredits = PORTFOLIO_EXCHANGE_PROPERTIES.reduce(
    (sum, property) => sum + property.projectedAnnualCredits,
    0
  );
  const carbonValue = carbonCredits * PORTFOLIO_SELLER_RESERVE_PRICE;
  const monitoringValue = propertyCount * 144;
  const healthValue = propertyCount * 120;
  const gridValue = propertyCount * 180;
  const evidenceValue = propertyCount * 300;

  return {
    propertyCount,
    carbonCredits,
    carbonValue,
    monitoringValue,
    healthValue,
    gridValue,
    evidenceValue,
    totalValue:
      carbonValue +
      monitoringValue +
      healthValue +
      gridValue +
      evidenceValue,
  };

})();

const PORTFOLIO_SUPPLIERS = [
  { name: "Suffolk Whole House", projects: 3, verified: 2, outcome: 89, defects: 1 },
  { name: "Coastal Energy Works", projects: 2, verified: 0, outcome: 74, defects: 2 },
  { name: "EastBuild Retrofit", projects: 2, verified: 0, outcome: 62, defects: 3 },
];

const readCachedBridgewoodValue = () => {
  try {
    const cached = JSON.parse(
      localStorage.getItem(`home:${CARBON_INTERVAL_SAVINGS_CACHE_KEY}`) || "null"
    );
    return {
      credits: Number.isFinite(Number(cached?.carbonCredits))
        ? Number(cached.carbonCredits)
        : null,
      energyValue: Number.isFinite(Number(cached?.energyCostSavedGbp))
        ? Number(cached.energyCostSavedGbp)
        : null,
    };
  } catch (error) {
    return { credits: null, energyValue: null };
  }
};

const PortfolioDashboardPanel = ({
  bridgewoodTokens,
  onOpenBuilding,
  onOpenExchange,
}) => {
  const [riskFilter, setRiskFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [propertySort, setPropertySort] = useState("priority");
  const [propertySortDirection, setPropertySortDirection] = useState("asc");
  const [propertyPage, setPropertyPage] = useState(1);
  const riskOptions = ["All", "Damp", "Cold", "IAQ", "Heat loss", "Overheat", "Monitor", "Good"];
  const riskPriority = { Damp: 1, IAQ: 2, Cold: 3, "Heat loss": 4, Overheat: 5, Monitor: 6, Good: 7 };
  const filteredProperties = PORTFOLIO_PROPERTIES
    .filter((property) => {
      const matchesRisk = riskFilter === "All" || property.risk === riskFilter;
      const query = search.trim().toLowerCase();
      const matchesSearch = !query || [property.id, property.estate, property.archetype]
        .some((value) => value.toLowerCase().includes(query));
      return matchesRisk && matchesSearch;
    })
    .sort((a, b) => {
      const direction = propertySortDirection === "asc" ? 1 : -1;
      const values = {
        priority: [riskPriority[a.risk] || 99, riskPriority[b.risk] || 99],
        property: [a.id, b.id],
        estate: [a.estate, b.estate],
        health: [a.health, b.health],
        energy: [a.energy, b.energy],
        evidence: [a.evidence, b.evidence],
        stage: [a.retrofit, b.retrofit],
      };
      const [aValue, bValue] = values[propertySort] || values.priority;
      return direction * (typeof aValue === "string" ? aValue.localeCompare(bValue) : aValue - bValue);
    });
  const propertyPageSize = 25;
  const propertyPageCount = Math.max(1, Math.ceil(filteredProperties.length / propertyPageSize));
  const pagedProperties = filteredProperties.slice((propertyPage - 1) * propertyPageSize, propertyPage * propertyPageSize);

  useEffect(() => {
    setPropertyPage(1);
  }, [search, riskFilter, propertySort, propertySortDirection]);
  const liveCount = PORTFOLIO_PROPERTIES.filter((property) => property.collector === "Live").length;
  const priorityCount = PORTFOLIO_PROPERTIES.filter((property) => !["Good", "Monitor"].includes(property.risk)).length;
  const verifiedCount = PORTFOLIO_PROPERTIES.filter((property) => property.trustmark).length;
  const portfolioTokens = PORTFOLIO_EXCHANGE_SUMMARY.carbonCredits;
  const portfolioTokenValue = PORTFOLIO_EXCHANGE_SUMMARY.totalValue;
  const perPropertyDataValue =
    PORTFOLIO_EXCHANGE_SUMMARY.propertyCount > 0
      ? (PORTFOLIO_EXCHANGE_SUMMARY.monitoringValue +
          PORTFOLIO_EXCHANGE_SUMMARY.healthValue +
          PORTFOLIO_EXCHANGE_SUMMARY.gridValue +
          PORTFOLIO_EXCHANGE_SUMMARY.evidenceValue) /
        PORTFOLIO_EXCHANGE_SUMMARY.propertyCount
      : 0;
  const incomingPortfolioValue = Number.isFinite(bridgewoodTokens)
    ? bridgewoodTokens * PORTFOLIO_SELLER_RESERVE_PRICE + perPropertyDataValue
    : null;
  const reportingReadyCount = PORTFOLIO_PROPERTIES.filter((property) => property.trustmark && Number.isFinite(property.euiAfter) && property.evidence >= 90).length;
  const retrofitReadyCount = PORTFOLIO_PROPERTIES.filter((property) => ["Design ready", "Resident confirmed", "Installation started", "TrustMark + handover"].includes(property.retrofit)).length;
  const residentConfirmedCount = PORTFOLIO_PROPERTIES.filter((property) => property.residentConsent).length;
  const euiTargetCount = PORTFOLIO_PROPERTIES.filter((property) => Number.isFinite(property.euiAfter) && property.euiAfter <= 60).length;
  const priorityProperties = PORTFOLIO_PROPERTIES
    .filter((property) => !["Good", "Monitor"].includes(property.risk))
    .sort((a, b) => (a.health + a.energy) - (b.health + b.energy));
  const performanceBands = [
    {
      label: "Health",
      segments: [
        ["Good", PORTFOLIO_PROPERTIES.filter((property) => property.health >= 80).length, "bg-emerald-500"],
        ["Watch", PORTFOLIO_PROPERTIES.filter((property) => property.health >= 65 && property.health < 80).length, "bg-amber-400"],
        ["Action", PORTFOLIO_PROPERTIES.filter((property) => property.health < 65).length, "bg-red-500"],
      ],
    },
    {
      label: "Energy",
      segments: [
        ["Good", PORTFOLIO_PROPERTIES.filter((property) => property.energy >= 75).length, "bg-emerald-500"],
        ["Watch", PORTFOLIO_PROPERTIES.filter((property) => property.energy >= 55 && property.energy < 75).length, "bg-amber-400"],
        ["Action", PORTFOLIO_PROPERTIES.filter((property) => property.energy < 55).length, "bg-red-500"],
      ],
    },
    {
      label: "Evidence",
      segments: [
        ["Ready", PORTFOLIO_PROPERTIES.filter((property) => property.evidence >= 90).length, "bg-emerald-500"],
        ["Progressing", PORTFOLIO_PROPERTIES.filter((property) => property.evidence >= 60 && property.evidence < 90).length, "bg-amber-400"],
        ["Incomplete", PORTFOLIO_PROPERTIES.filter((property) => property.evidence < 60).length, "bg-red-500"],
      ],
    },
  ];

  const statusClass = (value) => {
    if (["Good", "Verified", "Live", "Ready for sale", "TrustMark + handover"].includes(value)) return "bg-emerald-50 text-emerald-800 border-emerald-200";
    if (["Damp", "Cold", "IAQ", "Heat loss", "Overheat", "Attention", "Action needed"].includes(value)) return "bg-red-50 text-red-800 border-red-200";
    return "bg-amber-50 text-amber-800 border-amber-200";
  };

  return (
    <main className="min-h-screen bg-white p-3 sm:p-5">
      <header className="border-b border-gray-200 pb-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase text-gray-500">Portfolio prototype</p>
            <h1 className="text-2xl font-bold">East Suffolk Social Housing</h1>
            <p className="text-sm text-gray-600">Warm Homes: Social Housing Fund · 2027 delivery</p>
          </div>
          <button type="button" onClick={onOpenExchange} className="shrink-0 border border-gray-300 bg-white px-3 py-2 text-xs font-semibold hover:bg-gray-50 sm:text-sm">View exchange</button>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-px border-b border-emerald-200 bg-emerald-200 sm:grid-cols-3 xl:grid-cols-6">
        {[
          ["Homes", PORTFOLIO_PROPERTIES.length, `${liveCount} monitored`],
          ["Action required", priorityCount, "Health or energy risk"],
          ["Retrofit ready", retrofitReadyCount, `${verifiedCount} verified`],
          ["Reporting ready", reportingReadyCount, `${PORTFOLIO_EXCHANGE_SUMMARY.propertyCount} exchange eligible`],
          ["Ready value", `£${portfolioTokenValue.toFixed(0)}`, `${portfolioTokens.toFixed(2)} WBP-C + data`],
          ["Incoming", Number.isFinite(incomingPortfolioValue) ? `£${incomingPortfolioValue.toFixed(0)}` : "--", "Bridgewood processing"],
        ].map(([label, value, detail]) => (
          <div key={label} className="bg-emerald-50 px-3 py-4 sm:px-4">
            <p className="text-xs font-semibold uppercase text-emerald-800">{label}</p>
            <p className="mt-1 text-2xl font-bold text-emerald-950">{value}</p>
            <p className="text-xs text-emerald-800">{detail}</p>
          </div>
        ))}
      </section>

      <section className="grid border-b border-gray-200 lg:grid-cols-2">
        <div className="px-3 py-5 sm:px-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold">Priority actions</h2>
            <span className="text-xs font-semibold text-red-700">{priorityCount} homes</span>
          </div>
          <div className="divide-y divide-gray-200 border-y border-gray-200">
            {priorityProperties.slice(0, 4).map((property) => (
              <button key={property.id} type="button" onClick={property.buildingId ? () => onOpenBuilding(property.buildingId) : undefined} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3 text-left hover:bg-gray-50">
                <span className="min-w-0">
                  <strong className="block truncate text-sm">{property.id} · {property.estate}</strong>
                  <span className="text-xs text-gray-600">{property.risk} · {property.retrofit}</span>
                </span>
                <span className={`border px-2 py-1 text-xs font-semibold ${statusClass(property.risk)}`}>{property.risk}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="border-t border-gray-200 px-3 py-5 sm:px-5 lg:border-l lg:border-t-0">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold">Portfolio performance</h2>
            <span className="text-xs text-gray-500">{PORTFOLIO_PROPERTIES.length} homes</span>
          </div>
          <div className="space-y-5">
            {performanceBands.map((band) => (
              <div key={band.label}>
                <div className="mb-1.5 flex items-center justify-between text-sm"><strong>{band.label}</strong><span className="text-xs text-gray-500">Good · Watch · Action</span></div>
                <div className="flex h-4 overflow-hidden bg-gray-100">
                  {band.segments.map(([label, count, colour]) => <div key={label} className={colour} style={{ width: `${count / PORTFOLIO_PROPERTIES.length * 100}%` }} title={`${label}: ${count}`} />)}
                </div>
                <div className="mt-1.5 flex gap-4 text-xs text-gray-600">
                  {band.segments.map(([label, count, colour]) => <span key={label} className="flex items-center gap-1"><i className={`h-2 w-2 ${colour}`} />{label} {count}</span>)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid min-w-0 border-b border-gray-200 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
        <div className="min-w-0 px-3 py-5 sm:px-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Property register</h2>
              <p className="text-xs text-gray-500">{filteredProperties.length} of {PORTFOLIO_PROPERTIES.length} homes</p>
            </div>
          </div>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-[minmax(180px,1fr)_140px_160px_42px]">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search homes"
              className="col-span-2 min-w-0 border border-gray-300 px-3 py-2 text-sm sm:col-span-1"
            />
            <select value={riskFilter} onChange={(event) => setRiskFilter(event.target.value)} className="min-w-0 border border-gray-300 bg-white px-2 py-2 text-sm" aria-label="Filter properties by priority">
              {riskOptions.map((risk) => <option key={risk} value={risk}>{risk === "All" ? "All priorities" : risk}</option>)}
            </select>
            <select value={propertySort} onChange={(event) => setPropertySort(event.target.value)} className="min-w-0 border border-gray-300 bg-white px-2 py-2 text-sm" aria-label="Sort properties">
              <option value="priority">Priority</option>
              <option value="property">Property ID</option>
              <option value="estate">Estate</option>
              <option value="health">Health score</option>
              <option value="energy">Energy score</option>
              <option value="evidence">Evidence readiness</option>
              <option value="stage">Scheme stage</option>
            </select>
            <button type="button" onClick={() => setPropertySortDirection((current) => current === "asc" ? "desc" : "asc")} className="border border-gray-300 bg-white px-2 text-lg font-semibold hover:bg-gray-50" title={propertySortDirection === "asc" ? "Ascending" : "Descending"} aria-label={`Sort ${propertySortDirection === "asc" ? "ascending" : "descending"}`}>
              {propertySortDirection === "asc" ? "↑" : "↓"}
            </button>
          </div>
          <div className="border border-gray-200">
            <div className="hidden grid-cols-[minmax(170px,1.35fr)_64px_64px_minmax(90px,0.8fr)_minmax(95px,0.9fr)] gap-2 bg-gray-100 px-3 py-2 text-xs font-semibold uppercase text-gray-600 md:grid">
              <span>Home</span><span>Health</span><span>Energy</span><span>Priority</span><span>Evidence</span>
            </div>
            <div className="divide-y divide-gray-200">
              {pagedProperties.map((property) => (
                <button
                  key={property.id}
                  type="button"
                  onClick={property.buildingId ? () => onOpenBuilding(property.buildingId) : undefined}
                  className={`grid w-full gap-2 px-3 py-2 text-left md:grid-cols-[minmax(170px,1.35fr)_64px_64px_minmax(90px,0.8fr)_minmax(95px,0.9fr)] md:items-center ${property.buildingId ? "hover:bg-emerald-50" : "hover:bg-gray-50"}`}
                >
                  <span className="min-w-0" title={`${property.measure} · ${property.supplier}`}>
                    <strong className={`block truncate text-sm ${property.buildingId ? "text-emerald-800 underline decoration-emerald-300 underline-offset-4" : ""}`}>{property.id} · {property.estate}</strong>
                    <span className="block truncate text-xs text-gray-500">{property.archetype} · {property.retrofit} · EUI {property.euiBefore}{Number.isFinite(property.euiAfter) ? ` → ${property.euiAfter}` : ""} kWh/m²/yr</span>
                  </span>
                  <span className="grid grid-cols-2 gap-2 md:contents">
                    <span><small className="block text-[10px] uppercase text-gray-500 md:hidden">Health</small><strong className="text-sm">{property.health}/100</strong></span>
                    <span><small className="block text-[10px] uppercase text-gray-500 md:hidden">Energy</small><strong className="text-sm">{property.energy}/100</strong></span>
                  </span>
                  <span className="flex items-center justify-between gap-2 md:block">
                    <small className="text-[10px] uppercase text-gray-500 md:hidden">Priority</small>
                    <span className={`border px-2 py-1 text-xs font-semibold ${statusClass(property.risk)}`}>{property.risk}</span>
                  </span>
                  <span>
                    <span className="mb-1 flex justify-between text-xs"><small className="uppercase text-gray-500 md:hidden">Evidence</small><strong>{property.evidence}%</strong></span>
                    <span className="block h-1.5 bg-gray-100"><i className={`block h-full ${property.evidence >= 90 ? "bg-emerald-500" : property.evidence >= 60 ? "bg-amber-400" : "bg-red-500"}`} style={{ width: `${property.evidence}%` }} /></span>
                  </span>
                </button>
              ))}
            </div>
            {filteredProperties.length === 0 ? <p className="p-6 text-center text-sm text-gray-500">No matching properties</p> : null}
            {propertyPageCount > 1 ? (
              <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-3 py-2 text-xs">
                <span>Page {propertyPage} of {propertyPageCount}</span>
                <span className="flex gap-1">
                  <button type="button" disabled={propertyPage === 1} onClick={() => setPropertyPage((page) => Math.max(1, page - 1))} className="border border-gray-300 bg-white px-3 py-1.5 font-semibold disabled:opacity-40">Previous</button>
                  <button type="button" disabled={propertyPage === propertyPageCount} onClick={() => setPropertyPage((page) => Math.min(propertyPageCount, page + 1))} className="border border-gray-300 bg-white px-3 py-1.5 font-semibold disabled:opacity-40">Next</button>
                </span>
              </div>
            ) : null}
          </div>
        </div>

        <aside className="border-t border-gray-200 px-3 py-5 sm:px-5 lg:border-l lg:border-t-0">
          <h2 className="text-lg font-bold">Warm Homes compliance</h2>
          <div className="mt-4 grid grid-cols-2 gap-px border border-gray-200 bg-gray-200 text-sm">
            <div className="bg-white p-3"><p className="text-xs uppercase text-gray-500">PAS 2035 assessed</p><p className="mt-1 text-xl font-bold">{PORTFOLIO_PROPERTIES.filter((property) => property.pas2035).length}</p></div>
            <div className="bg-white p-3"><p className="text-xs uppercase text-gray-500">Resident confirmed</p><p className="mt-1 text-xl font-bold">{residentConfirmedCount}</p></div>
            <div className="bg-white p-3"><p className="text-xs uppercase text-gray-500">EUI target achieved</p><p className="mt-1 text-xl font-bold text-emerald-700">{euiTargetCount}</p></div>
            <div className="bg-white p-3"><p className="text-xs uppercase text-gray-500">TrustMark lodged</p><p className="mt-1 text-xl font-bold text-emerald-700">{verifiedCount}</p></div>
          </div>
          <div className="mt-6 grid grid-cols-2 border-t border-gray-200 pt-4">
            <div className="min-w-0 pr-3 sm:pr-4">
              <h3 className="text-sm font-semibold sm:text-base">Scheme milestones</h3>
              <div className="mt-3 space-y-3">
                {[
                  ["Homes assessed", 8, "bg-gray-500"],
                  ["Design ready", 5, "bg-blue-500"],
                  ["Resident confirmed", residentConfirmedCount, "bg-cyan-500"],
                  ["Installation started", 3, "bg-violet-500"],
                  ["Installation complete", verifiedCount, "bg-teal-500"],
                  ["TrustMark + handover", verifiedCount, "bg-emerald-500"],
                ].map(([label, count, colour]) => (
                  <div key={label}>
                    <div className="mb-1 flex justify-between gap-2 text-xs sm:text-sm"><span>{label}</span><strong>{count}</strong></div>
                    <div className="h-2 bg-gray-100"><div className={`h-full ${colour}`} style={{ width: `${count / PORTFOLIO_PROPERTIES.length * 100}%` }} /></div>
                  </div>
                ))}
              </div>
            </div>
            <div className="min-w-0 border-l border-gray-200 pl-3 sm:pl-4">
              <h3 className="text-sm font-semibold sm:text-base">Reporting evidence</h3>
              <dl className="mt-3 space-y-3 text-xs sm:text-sm">
                <div className="flex items-start justify-between gap-2"><dt>Whole Dwelling Assessments</dt><dd className="shrink-0 font-semibold">8 / 8</dd></div>
                <div className="flex items-start justify-between gap-2"><dt>Resident consent</dt><dd className="shrink-0 font-semibold">{residentConfirmedCount} / 8</dd></div>
                <div className="flex items-start justify-between gap-2"><dt>Post-works EUI ≤60</dt><dd className="shrink-0 font-semibold">{euiTargetCount} / 8</dd></div>
                <div className="flex items-start justify-between gap-2"><dt>TrustMark + handover</dt><dd className="shrink-0 font-semibold">{verifiedCount} / 8</dd></div>
                <div className="flex items-start justify-between gap-2"><dt>Monthly report ready</dt><dd className="shrink-0 font-semibold text-emerald-700">{reportingReadyCount}</dd></div>
              </dl>
            </div>
          </div>
        </aside>
      </section>

      <section className="border-b border-gray-200 px-3 py-5 sm:px-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Delivery partner outcomes</h2>
            <p className="text-sm text-gray-600">Measured project results support procurement, remediation and performance-linked retention decisions.</p>
          </div>
          <p className="text-xs text-gray-500">Indicative prototype · verified evidence only at award stage</p>
        </div>
        <div className="w-full overflow-x-auto border border-gray-200">
          <table className="w-full min-w-[680px] border-collapse text-left text-sm">
            <thead className="bg-gray-100 text-xs uppercase text-gray-600">
              <tr>{["Delivery partner", "Projects", "Verified", "Outcome score", "Open defects", "Procurement signal"].map((heading) => <th key={heading} className="border-b border-gray-200 px-3 py-2 font-semibold">{heading}</th>)}</tr>
            </thead>
            <tbody>
              {PORTFOLIO_SUPPLIERS.map((supplier) => {
                const signal = supplier.outcome >= 85 ? "Preferred" : supplier.outcome >= 70 ? "Monitor" : "Remediation";
                return (
                  <tr key={supplier.name} className="border-b border-gray-100 last:border-b-0">
                    <td className="px-3 py-3 font-semibold">{supplier.name}</td>
                    <td className="px-3 py-3">{supplier.projects}</td>
                    <td className="px-3 py-3">{supplier.verified}</td>
                    <td className="px-3 py-3 font-semibold">{supplier.outcome}/100</td>
                    <td className="px-3 py-3">{supplier.defects}</td>
                    <td className="px-3 py-3"><span className={`rounded border px-2 py-1 text-xs font-semibold ${statusClass(signal === "Remediation" ? "Action needed" : signal === "Preferred" ? "Verified" : "Monitor")}`}>{signal}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
};

const ExchangeDashboardPanel = ({
  bridgewoodTokens,
}) => {
  const [marketView, setMarketView] = useState("carbon");
  const [tradeTimeframe, setTradeTimeframe] = useState("1D");
  const [salePanelOpen, setSalePanelOpen] = useState(false);
  const [saleMode, setSaleMode] = useState("simple");
  const [carbonSaleAction, setCarbonSaleAction] = useState("market");
  const [carbonAskPrice, setCarbonAskPrice] = useState(95);
  const [carbonSalePercent, setCarbonSalePercent] = useState(100);
  const [dataLicenceAction, setDataLicenceAction] = useState("auto");
  const [selectedDataLots, setSelectedDataLots] = useState(["Monitoring", "Health", "Grid", "Evidence"]);
  const [salePrepared, setSalePrepared] = useState(false);
  const [basketAnimationReady, setBasketAnimationReady] = useState(false);
  const carbonPrice = FALLBACK_CARBON_PRICE_GBP_PER_TONNE;
  const sellerReservePrice = PORTFOLIO_SELLER_RESERVE_PRICE;
  const bestBidPrice = 76;
  const bestAskPrice = 88;
  const bidAskSpread = bestAskPrice - bestBidPrice;
  const marketMidPrice = (bestBidPrice + bestAskPrice) / 2;
  const projectedLots = PORTFOLIO_EXCHANGE_PROPERTIES;
  const projectedAnnualCredits = PORTFOLIO_EXCHANGE_SUMMARY.carbonCredits;
  const annualCarbonValue = PORTFOLIO_EXCHANGE_SUMMARY.carbonValue;
  const annualMonitoringValue = PORTFOLIO_EXCHANGE_SUMMARY.monitoringValue;
  const annualHealthDataValue = PORTFOLIO_EXCHANGE_SUMMARY.healthValue;
  const annualGridDataValue = PORTFOLIO_EXCHANGE_SUMMARY.gridValue;
  const annualEvidenceValue = PORTFOLIO_EXCHANGE_SUMMARY.evidenceValue;
  const annualPortfolioValue = PORTFOLIO_EXCHANGE_SUMMARY.totalValue;
  const carbonValueShare = annualPortfolioValue > 0 ? annualCarbonValue / annualPortfolioValue * 100 : 0;
  const monitoringValueShare = annualPortfolioValue > 0 ? annualMonitoringValue / annualPortfolioValue * 100 : 0;
  const healthDataValueShare = annualPortfolioValue > 0 ? annualHealthDataValue / annualPortfolioValue * 100 : 0;
  const gridDataValueShare = annualPortfolioValue > 0 ? annualGridDataValue / annualPortfolioValue * 100 : 0;
  const monitoringShareEnd = carbonValueShare + monitoringValueShare;
  const healthShareEnd = monitoringShareEnd + healthDataValueShare;
  const gridShareEnd = healthShareEnd + gridDataValueShare;
  const bridgewoodValue = Number.isFinite(bridgewoodTokens)
    ? bridgewoodTokens * carbonPrice
    : null;
  const basketLots = [
    { name: "Carbon", target: annualCarbonValue, coverage: 1, status: "1 of 1 transfer settled", rights: "Finite right", colour: "#047857" },
    { name: "Monitoring", target: annualMonitoringValue, coverage: 0.72, status: "3 buyers matched · still available", rights: "Repeatable licence", colour: "#2563eb" },
    { name: "Health", target: annualHealthDataValue, coverage: 0.41, status: "2 buyers matched · still available", rights: "Repeatable licence", colour: "#be123c" },
    { name: "Grid", target: annualGridDataValue, coverage: 1, status: "1 buyer matched · renewal open", rights: "Repeatable licence", colour: "#0891b2" },
    { name: "Evidence", target: annualEvidenceValue, coverage: 0.22, status: "1 service engagement · open", rights: "Repeatable service", colour: "#d97706" },
  ];
  const basketSecuredValue = basketLots.reduce(
    (sum, lot) => sum + lot.target * lot.coverage,
    0
  );
  const theoreticalBasketSales = [
    { date: "18 Sep 2026", right: "Carbon", buyer: "Corporate carbon buyer", share: 1, value: annualCarbonValue, structure: "Transfer and retirement" },
    { date: "16 Sep 2026", right: "Monitoring", buyer: "Social housing lender", share: 0.28, value: annualMonitoringValue * 0.28, structure: "12-month licence" },
    { date: "12 Sep 2026", right: "Monitoring", buyer: "Retrofit research consortium", share: 0.24, value: annualMonitoringValue * 0.24, structure: "Research licence" },
    { date: "08 Sep 2026", right: "Monitoring", buyer: "Building insurer", share: 0.2, value: annualMonitoringValue * 0.2, structure: "Risk-analysis licence" },
    { date: "14 Sep 2026", right: "Health", buyer: "Regional NHS partner", share: 0.23, value: annualHealthDataValue * 0.23, structure: "Outcomes licence" },
    { date: "06 Sep 2026", right: "Health", buyer: "Public-health research team", share: 0.18, value: annualHealthDataValue * 0.18, structure: "Cohort licence" },
    { date: "10 Sep 2026", right: "Grid", buyer: "Distribution network operator", share: 1, value: annualGridDataValue, structure: "Planning licence" },
    { date: "04 Sep 2026", right: "Evidence", buyer: "Retrofit programme funder", share: 0.22, value: annualEvidenceValue * 0.22, structure: "Evidence review" },
  ];
  const dataRights = [
    { name: "Monitoring", value: annualMonitoringValue, detail: "Building performance and retrofit trends", licence: "Non-exclusive · multiple approved buyers" },
    { name: "Health", value: annualHealthDataValue, detail: "Aggregated IAQ and outcomes analysis", licence: "Purpose-bound · NHS and research buyers" },
    { name: "Grid", value: annualGridDataValue, detail: "Demand, peak and heat-pump readiness", licence: "Non-exclusive · network planning access" },
    { name: "Evidence", value: annualEvidenceValue, detail: "Verified provenance and performance records", licence: "Repeatable verifier and funder service" },
  ];
  const selectedCarbonPrice = carbonSaleAction === "ask" ? Number(carbonAskPrice) || 0 : bestBidPrice;
  const selectedCarbonValue =
    projectedAnnualCredits * selectedCarbonPrice * carbonSalePercent / 100;
  const selectedDataValue = dataRights.reduce(
    (sum, right) =>
      selectedDataLots.includes(right.name) ? sum + right.value : sum,
    0
  );
  const toggleDataLot = (name) => {
    setSelectedDataLots((current) => current.includes(name)
      ? current.filter((item) => item !== name)
      : [...current, name]);
  };
  const openSalePanel = (mode, carbonAction = null) => {
    setSaleMode(mode);
    if (mode === "simple") {
      setCarbonSalePercent(100);
      setDataLicenceAction("auto");
      setSelectedDataLots(["Monitoring", "Health", "Grid", "Evidence"]);
    }
    if (carbonAction) {
      setCarbonSaleAction(carbonAction);
    }
    setSalePrepared(false);
    setSalePanelOpen(true);
  };
  const dataProducts = [
    { name: "Monitoring data", supplier: "Council / housing provider", buyer: "Homes England / lender / insurer / researcher", product: "Consented portfolio performance and retrofit-prioritisation dataset", price: "£12 / property / month", route: "Annual licence" },
    { name: "Evidence", supplier: "Council / housing provider", buyer: "Funder / verifier", product: "Evidence-pack status, provenance and verified performance records", price: "From £2,400 / year", route: "Evidence service" },
  ];
  const marketViews = [
    ["carbon", "Carbon market"],
    ["data", "Data licences"],
    ["flexibility", "Grid services"],
    ["outcomes", "Health outcomes"],
  ];
  const tradeSeriesByTimeframe = {
    "4H": [
      ["09:00", 78, 34], ["09:20", 79, 42], ["09:40", 78, 29], ["10:00", 81, 64], ["10:20", 80, 48], ["10:40", 82, 71],
      ["11:00", 83, 54], ["11:20", 82, 38], ["11:40", 84, 76], ["12:00", 83, 51], ["12:20", 85, 82], ["12:40", 84, 44],
    ],
    "1D": [
      ["00:00", 75, 42], ["02:00", 77, 55], ["04:00", 76, 37], ["06:00", 79, 68], ["08:00", 81, 91], ["10:00", 80, 59],
      ["12:00", 82, 73], ["14:00", 84, 110], ["16:00", 83, 65], ["18:00", 86, 126], ["20:00", 85, 82], ["22:00", 84, 61],
    ],
    "1W": [
      ["Mon", 68, 95], ["Tue", 70, 112], ["Wed", 69, 76], ["Thu", 73, 134], ["Fri", 75, 147], ["Sat", 74, 83], ["Sun", 76, 71],
      ["Mon", 78, 128], ["Tue", 77, 102], ["Wed", 80, 159], ["Thu", 82, 141], ["Fri", 81, 118], ["Sat", 83, 87], ["Sun", 84, 106],
    ],
    "1M": [
      ["1", 62, 180], ["3", 64, 142], ["5", 63, 126], ["7", 67, 211], ["9", 69, 175], ["11", 68, 137], ["13", 72, 238], ["15", 74, 196],
      ["17", 73, 154], ["19", 76, 221], ["21", 78, 205], ["23", 77, 168], ["25", 81, 246], ["27", 83, 194], ["29", 84, 218],
    ],
  };
  const tradeSeries = tradeSeriesByTimeframe[tradeTimeframe];
  const tradePrices = tradeSeries.map(([, price]) => price);
  const tradeMinPrice = Math.min(...tradePrices) - 2;
  const tradeMaxPrice = Math.max(...tradePrices) + 2;
  const tradePriceRange = Math.max(1, tradeMaxPrice - tradeMinPrice);
  const tradeMaxVolume = Math.max(...tradeSeries.map(([, , volume]) => volume));
  const tradeCurrentPrice = tradeSeries[tradeSeries.length - 1][1];
  const tradeOpeningPrice = tradeSeries[0][1];
  const tradePriceChange = (tradeCurrentPrice - tradeOpeningPrice) / tradeOpeningPrice * 100;
  const orderBookAsks = [
    { price: 105, volume: 120 },
    { price: 92, volume: 60 },
    { price: 88, volume: 25 },
  ];
  const orderBookBids = [
    { price: 76, volume: 40 },
    { price: 72, volume: 100 },
    { price: 68, volume: 250 },
  ];
  const orderBookMaxVolume = Math.max(
    ...orderBookAsks.map((order) => order.volume),
    ...orderBookBids.map((order) => order.volume)
  );

  useEffect(() => {
    const animationFrame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setBasketAnimationReady(true));
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, []);

  return (
    <main className="min-h-screen bg-white p-3 sm:p-5">
      <section className="border-b border-gray-200">
        <div className="grid grid-cols-[minmax(0,0.85fr)_96px_minmax(112px,1fr)] items-start gap-2 px-3 py-5 sm:grid-cols-[minmax(150px,0.9fr)_160px_minmax(180px,1fr)] sm:gap-5 sm:px-5 sm:py-7 lg:grid-cols-[minmax(220px,1fr)_176px_minmax(240px,1fr)] lg:gap-8">
          <div className="min-w-0">
            <p className="mb-1 text-[9px] font-semibold uppercase text-gray-500 sm:text-xs">East Suffolk Social Housing</p>
            <h1 className="text-sm font-bold sm:text-lg lg:text-2xl">Portfolio Value</h1>
            <p className="mt-1 break-words text-2xl font-bold sm:text-3xl lg:text-4xl">£{annualPortfolioValue.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            <p className="mt-1 text-[10px] text-gray-600 sm:text-xs">{projectedLots.length} Good / Verified homes · modelled</p>
          </div>
          <div
            className="relative h-24 w-24 rounded-full sm:h-40 sm:w-40 lg:h-44 lg:w-44"
            style={{ background: `conic-gradient(#047857 0 ${carbonValueShare}%, #2563eb ${carbonValueShare}% ${monitoringShareEnd}%, #be123c ${monitoringShareEnd}% ${healthShareEnd}%, #0891b2 ${healthShareEnd}% ${gridShareEnd}%, #d97706 ${gridShareEnd}% 100%)` }}
            role="img"
            aria-label={`Annual assumed value: carbon £${annualCarbonValue.toFixed(2)}, monitoring data £${annualMonitoringValue.toFixed(2)}, health data £${annualHealthDataValue.toFixed(2)}, grid data £${annualGridDataValue.toFixed(2)}, evidence £${annualEvidenceValue.toFixed(2)}`}
          >
            <div className="absolute inset-[18%] rounded-full bg-white" />
          </div>
          <div className="min-w-0 space-y-2 border-l border-gray-200 pl-2 sm:pl-4">
            {[
              ["Carbon", annualCarbonValue, "bg-emerald-700", Number.isFinite(bridgewoodValue) ? `Live £${bridgewoodValue.toFixed(2)} · ref £${carbonPrice}/t` : `Ref £${carbonPrice}/t`],
              ["Monitoring data", annualMonitoringValue, "bg-blue-600", "Repeatable annual licences"],
              ["Health data", annualHealthDataValue, "bg-rose-700", "Repeatable outcomes licences"],
              ["Grid data", annualGridDataValue, "bg-cyan-600", "Repeatable planning licences"],
              ["Evidence", annualEvidenceValue, "bg-amber-600", "Repeatable verifier/funder service"],
            ].map(([label, value, colour, detail]) => (
              <div key={label} className="min-w-0 text-[8px] leading-tight sm:text-[11px]">
                <div className="flex items-start gap-1 sm:gap-1.5">
                  <span className={`mt-0.5 h-2 w-2 shrink-0 ${colour}`} />
                  <span className="min-w-0 font-semibold">{label}: £{Number(value).toFixed(2)}</span>
                </div>
                <p className="pl-3 text-gray-500 sm:pl-3.5">{detail}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 border-t border-gray-200 px-3 py-3 sm:px-5">
          <button type="button" aria-pressed={salePanelOpen && saleMode === "simple"} onClick={() => openSalePanel("simple", "market")} className="min-h-11 border border-lime-500 bg-lime-400 px-3 py-2.5 text-sm font-semibold text-gray-950 hover:bg-lime-500">Sell</button>
          <button type="button" aria-pressed={salePanelOpen && saleMode === "advanced"} onClick={() => openSalePanel("advanced")} className="min-h-11 border border-lime-500 bg-lime-400 px-3 py-2.5 text-sm font-semibold text-gray-950 hover:bg-lime-500">Managed sale</button>
        </div>
      </section>

      <section className="border-b border-gray-200 px-3 py-5 sm:px-5">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase text-gray-500 sm:text-xs">Divisible rights basket</p>
            <h2 className="mt-1 text-lg font-bold">£{basketSecuredValue.toFixed(2)} secured <span className="font-normal text-gray-500">/ £{annualPortfolioValue.toFixed(2)} target</span></h2>
          </div>
          <p className="max-w-sm text-right text-[10px] text-gray-500 sm:text-xs">One offer. Carbon settles once; each data buyer receives a separate controlled licence.</p>
        </div>
        <div className="flex h-10 w-full overflow-hidden border border-gray-300 bg-gray-100" role="img" aria-label={`Basket bids have secured £${basketSecuredValue.toFixed(2)} of a £${annualPortfolioValue.toFixed(2)} target`}>
          {basketLots.map((lot) => (
            <div
              key={lot.name}
              className="relative h-full border-r border-white last:border-r-0"
              style={{ flexBasis: `${lot.target / annualPortfolioValue * 100}%`, backgroundColor: `${lot.colour}45` }}
              title={`${lot.name}: £${(lot.target * lot.coverage).toFixed(2)} secured of £${lot.target.toFixed(2)}`}
            >
              <div
                className="h-full transition-[width] duration-1000 ease-out motion-reduce:transition-none"
                style={{
                  width: basketAnimationReady ? `${lot.coverage * 100}%` : "0%",
                  backgroundColor: lot.colour,
                }}
              />
            </div>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5 sm:gap-3">
          {basketLots.map((lot) => (
            <div key={lot.name} className="min-w-0 border-l-2 pl-2" style={{ borderColor: lot.colour }}>
              <div className="flex items-start justify-between gap-2 text-[10px] sm:text-xs">
                <strong>{lot.name}</strong>
                <span className="text-gray-500">{lot.rights}</span>
              </div>
              <p className="mt-0.5 text-xs font-semibold sm:text-sm">£{(lot.target * lot.coverage).toFixed(2)} / £{lot.target.toFixed(2)}</p>
              <p className="text-[9px] text-gray-500 sm:text-[10px]">{lot.status}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 border-t border-gray-200 pt-3 text-[10px] text-gray-500 sm:text-xs">The carbon lot closes when transferred and retired. A data match does not exhaust that right: further purpose-bound licences can be issued to other approved buyers, subject to consent, aggregation and permitted-use controls.</p>

        <div className="mt-5 border-t border-gray-200 pt-4">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold sm:text-base">Theoretical sales</h3>
              <p className="text-[10px] text-gray-500 sm:text-xs">
                Illustrative matches making up the secured portion of the basket.
              </p>
            </div>
            <strong className="shrink-0 text-sm">£{basketSecuredValue.toFixed(2)}</strong>
          </div>
          <div className="overflow-x-auto border border-gray-200">
            <table className="w-full min-w-[680px] border-collapse text-left text-xs">
              <thead className="bg-gray-50 text-[10px] uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Date</th>
                  <th className="px-3 py-2 font-semibold">Right</th>
                  <th className="px-3 py-2 font-semibold">Buyer</th>
                  <th className="px-3 py-2 font-semibold">Structure</th>
                  <th className="px-3 py-2 text-right font-semibold">Matched</th>
                  <th className="px-3 py-2 text-right font-semibold">Value</th>
                </tr>
              </thead>
              <tbody>
                {theoreticalBasketSales.map((sale) => {
                  const lot = basketLots.find((item) => item.name === sale.right);
                  return (
                    <tr key={`${sale.right}-${sale.buyer}`} className="border-t border-gray-100">
                      <td className="whitespace-nowrap px-3 py-2 text-gray-500">{sale.date}</td>
                      <td className="px-3 py-2 font-semibold">
                        <span
                          className="mr-2 inline-block h-2 w-2"
                          style={{ backgroundColor: lot?.colour || "#6b7280" }}
                        />
                        {sale.right}
                      </td>
                      <td className="px-3 py-2">{sale.buyer}</td>
                      <td className="px-3 py-2 text-gray-600">{sale.structure}</td>
                      <td className="px-3 py-2 text-right">{Math.round(sale.share * 100)}%</td>
                      <td className="px-3 py-2 text-right font-semibold">£{sale.value.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {false ? <>
      <section className="border-b border-gray-200 px-3 py-3 sm:px-5">
        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Exchange markets">
          {marketViews.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={marketView === key}
              onClick={() => setMarketView(key)}
              className={`shrink-0 rounded border px-4 py-2 text-sm font-semibold ${marketView === key ? "border-black bg-black text-white" : "border-gray-300 bg-white hover:bg-gray-50"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {marketView === "carbon" ? (
        <>
          <section className="border-b border-gray-200">
            <div className="px-3 py-5 sm:px-5">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold">WBP-C / GBP</h2>
                  <p className="text-sm text-gray-600">Simulated trading view. No executable or issued units.</p>
                </div>
                <div className="grid grid-cols-3 gap-4 text-right text-sm">
                  <div><span className="block text-xs uppercase text-gray-500">Best bid</span><strong>£{bestBidPrice}</strong></div>
                  <div><span className="block text-xs uppercase text-gray-500">Best ask</span><strong>£{bestAskPrice}</strong></div>
                  <div><span className="block text-xs uppercase text-gray-500">Spread</span><strong>£{bidAskSpread}</strong></div>
                </div>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_130px] gap-2 min-[430px]:grid-cols-[minmax(0,1fr)_160px] sm:grid-cols-[minmax(0,1fr)_200px] sm:gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
                <div className="min-w-0 border border-gray-200">
                  <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-3 py-2">
                    <div><span className="text-base font-bold sm:text-xl">£{tradeCurrentPrice.toFixed(2)}</span><span className={`ml-1 text-[10px] font-semibold sm:ml-2 sm:text-xs ${tradePriceChange >= 0 ? "text-emerald-700" : "text-red-600"}`}>{tradePriceChange >= 0 ? "+" : ""}{tradePriceChange.toFixed(2)}%</span></div>
                    <div className="flex rounded border border-gray-300 bg-white p-0.5" aria-label="Trading timeframe">
                      {["4H", "1D", "1W", "1M"].map((timeframe) => (
                        <button key={timeframe} type="button" onClick={() => setTradeTimeframe(timeframe)} className={`px-1.5 py-1 text-[10px] font-semibold sm:px-2.5 sm:text-xs ${tradeTimeframe === timeframe ? "bg-black text-white" : "text-gray-600 hover:bg-gray-100"}`}>{timeframe}</button>
                      ))}
                    </div>
                  </div>
                  <div className="h-72 overflow-hidden" role="img" aria-label={`${tradeTimeframe} simulated WBP-C candlestick price and volume chart`}>
                    <svg viewBox="0 0 720 250" className="h-full w-full" preserveAspectRatio="none" aria-hidden="true">
                      {[0, 1, 2, 3].map((gridIndex) => {
                        const price = tradeMaxPrice - tradePriceRange * gridIndex / 3;
                        const y = 16 + gridIndex * 49;
                        return <g key={`grid-${gridIndex}`}><line x1="42" y1={y} x2="706" y2={y} stroke="#e5e7eb" strokeWidth="1" /><text x="4" y={y + 3} fontSize="10" fill="#6b7280">£{price.toFixed(0)}</text></g>;
                      })}
                      {tradeSeries.map(([label, close, volume], index) => {
                        const open = index > 0 ? tradeSeries[index - 1][1] : close - 1;
                        const high = Math.max(open, close) + 0.7 + index % 3 * 0.25;
                        const low = Math.min(open, close) - 0.6 - index % 2 * 0.25;
                        const xStep = 660 / tradeSeries.length;
                        const x = 46 + xStep * index + xStep / 2;
                        const priceY = (price) => 16 + (tradeMaxPrice - price) / tradePriceRange * 147;
                        const openY = priceY(open);
                        const closeY = priceY(close);
                        const highY = priceY(high);
                        const lowY = priceY(low);
                        const rising = close >= open;
                        const colour = rising ? "#059669" : "#ef4444";
                        const bodyY = Math.min(openY, closeY);
                        const bodyHeight = Math.max(3, Math.abs(closeY - openY));
                        const candleWidth = Math.max(4, Math.min(18, xStep * 0.55));
                        const volumeHeight = Math.max(3, volume / tradeMaxVolume * 42);
                        return (
                          <g key={`${label}-${index}`}>
                            <title>{label}: open £{open.toFixed(2)}, high £{high.toFixed(2)}, low £{low.toFixed(2)}, close £{close.toFixed(2)}, volume {volume} WBP-C</title>
                            <line x1={x} y1={highY} x2={x} y2={lowY} stroke={colour} strokeWidth="1.5" />
                            <rect x={x - candleWidth / 2} y={bodyY} width={candleWidth} height={bodyHeight} fill={colour} />
                            <rect x={x - candleWidth / 2} y={222 - volumeHeight} width={candleWidth} height={volumeHeight} fill={rising ? "#a7f3d0" : "#fecaca"} />
                          </g>
                        );
                      })}
                      <line x1="42" y1="174" x2="706" y2="174" stroke="#d1d5db" strokeWidth="1" />
                      <line x1="42" y1="222" x2="706" y2="222" stroke="#d1d5db" strokeWidth="1" />
                      {(() => {
                        const currentY = 16 + (tradeMaxPrice - tradeCurrentPrice) / tradePriceRange * 147;
                        return <g><line x1="42" y1={currentY} x2="706" y2={currentY} stroke="#111827" strokeWidth="1" strokeDasharray="4 4" /><rect x="660" y={currentY - 8} width="46" height="16" fill="#111827" /><text x="683" y={currentY + 3} textAnchor="middle" fontSize="9" fill="white">£{tradeCurrentPrice.toFixed(2)}</text></g>;
                      })()}
                      <text x="46" y="242" fontSize="10" fill="#6b7280">{tradeSeries[0][0]}</text>
                      <text x="374" y="242" textAnchor="middle" fontSize="10" fill="#6b7280">{tradeSeries[Math.floor(tradeSeries.length / 2)][0]}</text>
                      <text x="706" y="242" textAnchor="end" fontSize="10" fill="#6b7280">{tradeSeries[tradeSeries.length - 1][0]}</text>
                    </svg>
                  </div>
                </div>
                <aside className="min-w-0 border border-gray-200">
                  <div className="grid grid-cols-2 bg-gray-100 px-2 py-2 text-[9px] font-semibold uppercase text-gray-600 sm:px-3 sm:text-xs"><span>Price</span><span className="text-right">WBP-C</span></div>
                  <div className="flex justify-between border-t border-gray-200 bg-red-50 px-2 py-1.5 text-[10px] font-semibold text-red-900 sm:px-3 sm:text-xs"><span>Asks</span><span>Sell</span></div>
                  {[{ price: 105, volume: 120 }, { price: 92, volume: 60 }, { price: 88, volume: 25 }].map((order) => (
                    <div key={`ask-${order.price}`} className="grid grid-cols-2 border-t border-gray-100 px-2 py-1.5 text-[10px] sm:px-3 sm:text-sm"><strong>£{order.price}/t</strong><span className="text-right">{order.volume}</span></div>
                  ))}
                  <div className="border-y border-gray-300 bg-gray-900 px-2 py-2 text-center text-white">
                    <p className="text-[9px] font-semibold uppercase text-gray-300">Market midpoint · spread £{bidAskSpread}</p>
                    <p className="text-sm font-bold">£{marketMidPrice.toFixed(2)}/t</p>
                  </div>
                  <div className="flex justify-between border-t border-gray-200 bg-emerald-50 px-2 py-1.5 text-[10px] font-semibold text-emerald-900 sm:px-3 sm:text-xs"><span>Bids</span><span>Buy</span></div>
                  {[{ price: 76, volume: 40 }, { price: 72, volume: 100 }, { price: 68, volume: 250 }].map((order) => (
                    <div key={`bid-${order.price}`} className="grid grid-cols-2 border-t border-gray-100 px-2 py-1.5 text-[10px] sm:px-3 sm:text-sm"><strong>£{order.price}/t</strong><span className="text-right">{order.volume}</span></div>
                  ))}
                </aside>
              </div>
              <div className="mt-4 border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950">
                The £{sellerReservePrice} reserve is the portfolio's minimum acceptable price, not a guaranteed value. Orders remain illustrative until methodology approval, verification, issuance and buyer onboarding are complete.
              </div>
            </div>
          </section>

          <section className="grid border-b border-gray-200 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <div className="px-3 py-5 sm:px-5">
          <div className="mb-4">
            <h2 className="text-lg font-bold">Projected annual lots</h2>
            <p className="text-sm text-gray-600">Example outcomes for Good, verified retrofit projects over a full year.</p>
          </div>
          <div className="overflow-x-auto border border-gray-200">
            <table className="w-full min-w-[680px] border-collapse text-left text-sm">
              <thead className="bg-gray-100 text-xs uppercase text-gray-600">
                <tr>
                  {['Project', 'Annual WBP-C', 'Carbon rights', 'Monitoring data', 'Evidence service', 'Annual total'].map((heading) => (
                    <th key={heading} className="border-b border-gray-200 px-3 py-2 font-semibold">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {projectedLots.map((property) => (
                  <tr key={property.id} className="border-b border-gray-100 last:border-b-0">
                    <td className="px-3 py-3"><span className="font-semibold">{property.estate}</span><br /><span className="text-xs text-emerald-700">Good / Verified</span></td>
                    <td className="px-3 py-3 font-semibold">{property.projectedAnnualCredits.toFixed(2)}</td>
                    <td className="px-3 py-3">£{(property.projectedAnnualCredits * sellerReservePrice).toFixed(2)}</td>
                    <td className="px-3 py-3">£144.00</td>
                    <td className="px-3 py-3">£300.00</td>
                    <td className="px-3 py-3 font-bold">£{(property.projectedAnnualCredits * sellerReservePrice + 444).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-gray-500">Illustrative forecasts are not issued credits and cannot be traded.</p>
        </div>

        <aside className="border-t border-gray-200 px-3 py-5 sm:px-5 lg:border-l lg:border-t-0">
          <h2 className="text-lg font-bold">Marketplace route</h2>
          <ol className="mt-4 space-y-4 text-sm">
            {[
              ["1", "Evidence complete", "Monitoring, baseline, works and ownership records"],
              ["2", "Independent verification", "Portfolio batch reviewed against an accepted methodology"],
              ["3", "Issue WBP-C lots", "Serialised units with vintage and evidence references"],
              ["4", "List for buyers", "Price, quantity, retirement and co-benefit terms"],
            ].map(([number, title, detail]) => (
              <li key={number} className="grid grid-cols-[28px_1fr] gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-900 text-xs font-bold text-white">{number}</span>
                <div><strong>{title}</strong><p className="text-gray-600">{detail}</p></div>
              </li>
            ))}
          </ol>
          <button
            type="button"
            disabled
            title="Enabled once verified credits have been issued"
            className="mt-6 w-full cursor-not-allowed rounded border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800 opacity-70"
          >
            Create sell order - Locked
          </button>
            </aside>
          </section>
        </>
      ) : null}

      {marketView === "data" ? (
        <section className="px-3 py-5 sm:px-5">
          <div className="mb-4">
            <h2 className="text-lg font-bold">Data licences</h2>
            <p className="text-sm text-gray-600">The portfolio owner supplies consented, minimised and appropriately aggregated evidence to approved buyers.</p>
          </div>
          <div className="overflow-x-auto border border-gray-200">
            <table className="w-full min-w-[980px] border-collapse text-left text-sm">
              <thead className="bg-gray-100 text-xs uppercase text-gray-600">
                <tr>{['Product', 'Supplier', 'Likely buyer', 'Deliverable', 'Illustrative pricing', 'Contract route'].map((heading) => <th key={heading} className="border-b border-gray-200 px-3 py-2 font-semibold">{heading}</th>)}</tr>
              </thead>
              <tbody>
                {dataProducts.map((product) => (
                  <tr key={product.name} className="border-b border-gray-100 last:border-b-0">
                    <td className="px-3 py-3 font-semibold">{product.name}</td><td className="px-3 py-3">{product.supplier}</td><td className="px-3 py-3">{product.buyer}</td><td className="px-3 py-3">{product.product}</td><td className="px-3 py-3 font-semibold">{product.price}</td><td className="px-3 py-3">{product.route}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-gray-500">Pricing is an editable commercial assumption, not accrued revenue. Household-level smart-meter and IAQ data must not be sold as an identifiable raw feed.</p>
        </section>
      ) : null}

      {marketView === "flexibility" ? (
        <section className="grid border-b border-gray-200 md:grid-cols-4">
          {[
            ["Grid data", `£${annualGridDataValue.toFixed(2)} modelled`, "Aggregated demand, peak and heat-pump readiness licence"],
            ["Available capacity", "Pending", "Requires controllable load and an aggregator route"],
            ["Dispatch evidence", "Not tested", "Baseline, event response and settlement measurements"],
            ["Revenue", "£0.00", "Earned only when an accepted service is delivered"],
          ].map(([label, value, detail]) => (
            <div key={label} className="border-r border-gray-200 px-5 py-6 last:border-r-0"><p className="text-xs uppercase text-gray-500">{label}</p><p className="mt-2 text-2xl font-bold">{value}</p><p className="mt-1 text-sm text-gray-600">{detail}</p></div>
          ))}
        </section>
      ) : null}

      {marketView === "outcomes" ? (
        <section className="border-b border-gray-200 px-5 py-6">
          <p className="text-xs uppercase text-gray-500">Health data</p><p className="mt-2 text-2xl font-bold">£{annualHealthDataValue.toFixed(2)} modelled</p><p className="mt-1 max-w-3xl text-sm text-gray-600">A consented, aggregated outcomes licence for an agreed commissioner. Value remains modelled until the health measures, attribution method and purchasing route are contracted.</p>
        </section>
      ) : null}
      </> : null}

      {salePanelOpen && typeof document !== "undefined" ? createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto bg-black/50 p-3 sm:p-6" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setSalePanelOpen(false);
          }
        }}>
          <section className="my-auto max-h-[calc(100vh-1.5rem)] w-full max-w-5xl overflow-y-auto rounded-lg border border-gray-300 bg-white shadow-2xl sm:max-h-[calc(100vh-3rem)]" role="dialog" aria-modal="true" aria-labelledby="sale-panel-title">
            <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-gray-200 bg-white px-4 py-4 sm:px-6">
              <div>
                <p className="text-[10px] font-semibold uppercase text-emerald-700">Prototype order ticket</p>
                <h2 id="sale-panel-title" className="mt-1 text-xl font-bold">{saleMode === "simple" ? "Sell available value" : "Manage sale"}</h2>
                <p className="mt-1 text-xs text-gray-600">Current portfolio vintage · independently settling rights</p>
              </div>
              <button type="button" onClick={() => setSalePanelOpen(false)} className="h-9 w-9 shrink-0 rounded border border-gray-300 text-xl leading-none text-gray-600 hover:bg-gray-50" aria-label="Close sale ticket">×</button>
            </header>

            {salePrepared ? (
              <div className="px-4 py-8 text-center sm:px-6">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl font-bold text-emerald-800">✓</div>
                <h3 className="mt-4 text-xl font-bold">Basket offer prepared</h3>
                <p className="mx-auto mt-2 max-w-lg text-sm text-gray-600">No real order has been submitted. In production, eligible carbon would route to an approved venue while data lots enter controlled buyer matching under their selected licence terms.</p>
                <div className="mx-auto mt-5 grid max-w-md grid-cols-2 border border-gray-200 text-left text-sm">
                  <div className="border-r border-gray-200 p-3"><p className="text-xs text-gray-500">Carbon order</p><p className="mt-1 font-semibold">£{selectedCarbonValue.toFixed(2)} estimated</p></div>
                  <div className="p-3"><p className="text-xs text-gray-500">Data licences</p><p className="mt-1 font-semibold">Buyer matching</p></div>
                </div>
                <button type="button" onClick={() => setSalePanelOpen(false)} className="mt-6 border border-gray-900 bg-gray-900 px-6 py-2.5 text-sm font-semibold text-white">Done</button>
              </div>
            ) : (
              <>
                <div className="grid border-b border-gray-200 sm:grid-cols-[1.25fr_0.75fr]">
                  <div className="space-y-6 px-4 py-5 sm:px-6">
                    {saleMode === "simple" ? (
                      <div className="space-y-3">
                        <div className="border border-emerald-200 bg-emerald-50 p-4">
                          <p className="text-xs font-semibold uppercase text-emerald-800">Carbon</p>
                          <p className="mt-1 text-base font-bold">Sell 100% at the best approved market price</p>
                          <p className="mt-1 text-xs text-emerald-900">Estimated £{selectedCarbonValue.toFixed(2)} when an eligible market bid is available.</p>
                        </div>
                        <div className="border border-blue-200 bg-blue-50 p-4">
                          <p className="text-xs font-semibold uppercase text-blue-800">Data and evidence</p>
                          <p className="mt-1 text-base font-bold">Offer non-exclusive licences</p>
                          <p className="mt-1 text-xs text-blue-900">Match approved buyers to monitoring, health, grid and evidence rights. Source data stays with the portfolio.</p>
                        </div>
                        <button type="button" onClick={() => setSaleMode("advanced")} className="w-full border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">Change sale options</button>
                      </div>
                    ) : (
                      <>
                    <fieldset>
                      <legend className="text-sm font-bold">Carbon</legend>
                      <p className="mt-1 text-xs text-gray-600">Choose what happens to the exclusive carbon rights in this vintage.</p>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        {[["market", "Sell now"], ["ask", "Set ask"]].map(([value, label]) => (
                          <button key={value} type="button" onClick={() => setCarbonSaleAction(value)} className={`border px-3 py-2.5 text-sm font-semibold ${carbonSaleAction === value ? "border-emerald-700 bg-emerald-700 text-white" : "border-gray-300 bg-white text-gray-700"}`}>{label}</button>
                        ))}
                      </div>
                      <div
                        className={`grid overflow-hidden ${carbonSaleAction === "ask" ? "pointer-events-auto" : "pointer-events-none"}`}
                        style={{
                          gridTemplateRows:
                            carbonSaleAction === "ask" ? "1fr" : "0fr",
                          opacity: carbonSaleAction === "ask" ? 1 : 0,
                          marginTop: carbonSaleAction === "ask" ? "1rem" : 0,
                          transition:
                            "grid-template-rows 240ms ease, opacity 180ms ease, margin-top 240ms ease",
                        }}
                        aria-hidden={carbonSaleAction !== "ask"}
                      >
                        <label className="min-h-0 block overflow-hidden text-xs font-semibold text-gray-700">Minimum price per tonne
                          <div className="mt-1 flex items-center border border-gray-300 bg-white px-3"><span>£</span><input type="number" min="1" step="1" value={carbonAskPrice} onChange={(event) => setCarbonAskPrice(event.target.value)} tabIndex={carbonSaleAction === "ask" ? 0 : -1} className="min-w-0 flex-1 px-2 py-2 text-sm outline-none" /><span className="text-gray-500">/t</span></div>
                        </label>
                      </div>
                      <label className="mt-4 block text-xs font-semibold text-gray-700">Sell {carbonSalePercent}% of available carbon
                        <input type="range" min="10" max="100" step="10" value={carbonSalePercent} onChange={(event) => setCarbonSalePercent(Number(event.target.value))} className="mt-2 w-full accent-emerald-700" />
                      </label>
                    </fieldset>

                    <section className="border border-gray-200" aria-label="Carbon market">
                      <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-3 py-2">
                        <div><p className="text-[10px] font-semibold uppercase text-gray-500">WBP-C / GBP</p><span className="text-lg font-bold">£{tradeCurrentPrice.toFixed(2)}</span><span className={`ml-2 text-[10px] font-semibold ${tradePriceChange >= 0 ? "text-emerald-700" : "text-red-600"}`}>{tradePriceChange >= 0 ? "+" : ""}{tradePriceChange.toFixed(2)}%</span></div>
                        <div className="flex border border-gray-300 bg-white p-0.5" aria-label="Trading timeframe">
                          {["4H", "1D", "1W", "1M"].map((timeframe) => (
                            <button key={timeframe} type="button" onClick={() => setTradeTimeframe(timeframe)} className={`px-1.5 py-1 text-[9px] font-semibold sm:px-2 ${tradeTimeframe === timeframe ? "bg-black text-white" : "text-gray-600"}`}>{timeframe}</button>
                          ))}
                        </div>
                      </div>
                      <div className="grid grid-cols-[minmax(0,1fr)_104px] sm:grid-cols-[minmax(0,1fr)_132px]">
                        <div className="h-52 min-w-0 overflow-hidden border-r border-gray-200" role="img" aria-label={`${tradeTimeframe} simulated WBP-C candlestick price and volume chart`}>
                          <svg viewBox="0 0 720 250" className="h-full w-full" preserveAspectRatio="none" aria-hidden="true">
                            {[0, 1, 2, 3].map((gridIndex) => {
                              const price = tradeMaxPrice - tradePriceRange * gridIndex / 3;
                              const y = 16 + gridIndex * 49;
                              return <g key={`manage-grid-${gridIndex}`}><line x1="42" y1={y} x2="706" y2={y} stroke="#e5e7eb" strokeWidth="1" /><text x="4" y={y + 3} fontSize="10" fill="#6b7280">£{price.toFixed(0)}</text></g>;
                            })}
                            {tradeSeries.map(([label, close, volume], index) => {
                              const open = index > 0 ? tradeSeries[index - 1][1] : close - 1;
                              const high = Math.max(open, close) + 0.7 + index % 3 * 0.25;
                              const low = Math.min(open, close) - 0.6 - index % 2 * 0.25;
                              const xStep = 660 / tradeSeries.length;
                              const x = 46 + xStep * index + xStep / 2;
                              const priceY = (price) => 16 + (tradeMaxPrice - price) / tradePriceRange * 147;
                              const openY = priceY(open);
                              const closeY = priceY(close);
                              const rising = close >= open;
                              const colour = rising ? "#059669" : "#ef4444";
                              const candleWidth = Math.max(4, Math.min(18, xStep * 0.55));
                              const volumeHeight = Math.max(3, volume / tradeMaxVolume * 42);
                              return <g key={`manage-${label}-${index}`}><line x1={x} y1={priceY(high)} x2={x} y2={priceY(low)} stroke={colour} strokeWidth="1.5" /><rect x={x - candleWidth / 2} y={Math.min(openY, closeY)} width={candleWidth} height={Math.max(3, Math.abs(closeY - openY))} fill={colour} /><rect x={x - candleWidth / 2} y={222 - volumeHeight} width={candleWidth} height={volumeHeight} fill={rising ? "#a7f3d0" : "#fecaca"} /></g>;
                            })}
                            <line x1="42" y1="174" x2="706" y2="174" stroke="#d1d5db" strokeWidth="1" />
                            <line x1="42" y1="222" x2="706" y2="222" stroke="#d1d5db" strokeWidth="1" />
                            <text x="46" y="242" fontSize="10" fill="#6b7280">{tradeSeries[0][0]}</text>
                            <text x="706" y="242" textAnchor="end" fontSize="10" fill="#6b7280">{tradeSeries[tradeSeries.length - 1][0]}</text>
                          </svg>
                        </div>
                        <aside className="h-52 min-w-0 overflow-y-auto text-[8px] sm:text-[9px]">
                          <div className="sticky top-0 z-[1] grid grid-cols-2 bg-red-50 px-1.5 py-1 font-semibold text-red-900"><span>Asks</span><span className="text-right">Vol.</span></div>
                          {orderBookAsks.map((order) => (
                            <div key={`manage-ask-${order.price}`} className="relative overflow-hidden border-t border-red-100">
                              <div className="absolute inset-y-0 right-0 bg-red-100" style={{ width: `${order.volume / orderBookMaxVolume * 100}%` }} />
                              <div className="relative grid grid-cols-2 px-1.5 py-1"><strong className="text-red-800">£{order.price}/t</strong><span className="text-right font-semibold">{order.volume}</span></div>
                            </div>
                          ))}
                          <div className="border-y border-gray-400 bg-white px-1.5 py-1.5 text-center text-black"><p className="text-[7px] font-semibold uppercase text-gray-500">Market</p><strong>£{marketMidPrice.toFixed(2)}/t</strong></div>
                          <div className="grid grid-cols-2 bg-emerald-50 px-1.5 py-1 font-semibold text-emerald-900"><span>Bids</span><span className="text-right">Vol.</span></div>
                          {orderBookBids.map((order) => (
                            <div key={`manage-bid-${order.price}`} className="relative overflow-hidden border-t border-emerald-100">
                              <div className="absolute inset-y-0 right-0 bg-emerald-100" style={{ width: `${order.volume / orderBookMaxVolume * 100}%` }} />
                              <div className="relative grid grid-cols-2 px-1.5 py-1"><strong className="text-emerald-800">£{order.price}/t</strong><span className="text-right font-semibold">{order.volume}</span></div>
                            </div>
                          ))}
                        </aside>
                      </div>
                      <p className="border-t border-gray-200 px-3 py-2 text-[9px] text-gray-500">Simulated market view. No executable or issued units.</p>
                    </section>

                    <fieldset>
                      <legend className="text-sm font-bold">Data and evidence</legend>
                      <p className="mt-1 text-xs text-gray-600">Choose how approved buyers can bid for controlled, non-exclusive licences. The portfolio keeps the source data.</p>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        {[
                          ["auto", "Sell now"],
                          ["review", "Open for offers"],
                        ].map(([value, label]) => (
                          <button key={value} type="button" onClick={() => setDataLicenceAction(value)} className={`border px-3 py-2.5 text-sm font-semibold ${dataLicenceAction === value ? "border-emerald-700 bg-emerald-700 text-white" : "border-gray-300 bg-white text-gray-700"}`}>{label}</button>
                        ))}
                      </div>
                      <div className="mt-4">
                          <p className="text-xs font-semibold text-gray-700">Licences to include</p>
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            {dataRights.map((right) => (
                              <label key={right.name} className={`cursor-pointer border p-3 ${selectedDataLots.includes(right.name) ? "border-blue-600 bg-blue-50" : "border-gray-200 bg-white"}`}>
                                <span className="flex items-start gap-2">
                                  <input type="checkbox" checked={selectedDataLots.includes(right.name)} onChange={() => toggleDataLot(right.name)} className="mt-0.5 accent-blue-700" />
                                  <span className="min-w-0"><strong className="block text-xs sm:text-sm">{right.name}</strong><span className="block text-[10px] leading-tight text-gray-600 sm:text-xs">{right.detail}</span><span className="mt-1 block text-[10px] font-semibold text-blue-800">{right.licence}</span><span className="mt-1 block text-[10px] text-gray-600">£{right.value.toFixed(2)} modelled annual value</span></span>
                                </span>
                              </label>
                            ))}
                          </div>
                      </div>
                    </fieldset>
                      </>
                    )}
                  </div>

                  <aside className="border-t border-gray-200 bg-gray-50 px-4 py-5 sm:border-l sm:border-t-0 sm:px-5">
                    <h3 className="text-sm font-bold">Sale summary</h3>
                    <dl className="mt-4 space-y-3 text-sm">
                      <div className="flex justify-between gap-3"><dt className="text-gray-600">Carbon</dt><dd className="text-right font-semibold">£{selectedCarbonValue.toFixed(2)}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-gray-600">Carbon route</dt><dd className="text-right font-semibold">{carbonSaleAction === "market" ? "Best approved market" : carbonSaleAction === "ask" ? `Ask £${Number(carbonAskPrice || 0).toFixed(0)}/t` : "Not listed"}</dd></div>
                      <div className="flex justify-between gap-3 border-t border-gray-200 pt-3"><dt className="text-gray-600">Data potential</dt><dd className="text-right font-semibold">£{selectedDataValue.toFixed(2)}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-gray-600">Data route</dt><dd className="text-right font-semibold">{dataLicenceAction === "auto" ? "Auto-match buyers" : dataLicenceAction === "review" ? "Open for offers" : "Keep private"}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-gray-600">Licence model</dt><dd className="text-right font-semibold">Multiple approved buyers</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-gray-600">Licences listed</dt><dd className="text-right font-semibold">{selectedDataLots.length} of {dataRights.length}</dd></div>
                    </dl>
                    <div className="mt-5 border border-amber-200 bg-amber-50 p-3 text-[10px] leading-relaxed text-amber-950">Carbon may produce immediate proceeds when an eligible bid exists. Data values remain modelled until an approved buyer accepts a licence; they are not guaranteed sale proceeds.</div>
                    <div className="mt-4 border-t border-gray-200 pt-4">
                      <p className="text-[10px] font-semibold uppercase text-gray-500">Included vintage</p>
                      <p className="mt-1 text-xs text-gray-700">All currently eligible portfolio evidence accrued to date. Future readings remain outside this offer unless recurring licensing is enabled.</p>
                    </div>
                  </aside>
                </div>
                <footer className="flex flex-col-reverse gap-2 px-4 py-4 sm:flex-row sm:justify-end sm:px-6">
                  <button type="button" onClick={() => setSalePanelOpen(false)} className="border border-gray-300 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700">Cancel</button>
                  <button type="button" onClick={() => setSalePrepared(true)} disabled={selectedDataLots.length === 0} className="border border-emerald-700 bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:border-gray-300 disabled:bg-gray-200 disabled:text-gray-500">{saleMode === "simple" ? "Offer available value" : dataLicenceAction === "review" ? "Open selected rights for offers" : "Create selected listings"}</button>
                </footer>
              </>
            )}
          </section>
        </div>,
        document.body
      ) : null}
    </main>
  );
};

const BuildingDashboard = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const accessParams = new URLSearchParams(location.search);
  const storedRole = window.localStorage.getItem("wbp-user-role") || "";
  const accessRole = accessParams.get("role") || storedRole;
  const roleDetails = {
    architect: { label: "Architect", phase: "Design", focus: "Design intent and specification" },
    builder: { label: "Builder", phase: "Build", focus: "Delivery, quality and commissioning" },
    homeowner: { label: "Homeowner", phase: "Occupy", focus: "Handover and measured performance" },
  }[accessRole];
  const routeSection = location.pathname.split("/").filter(Boolean)[1] || "new";
  const routeIndex = BUILDINGS.findIndex((building) => building.id === routeSection);
  const defaultIndex = routeIndex >= 0
    ? routeIndex
    : BUILDINGS.findIndex((building) => building.id === "new");
  const [activeIndex, setActiveIndex] = useState(defaultIndex >= 0 ? defaultIndex : 0);
  const [isTestAccount, setIsTestAccount] = useState(false);
  const [bridgewoodValue, setBridgewoodValue] = useState(readCachedBridgewoodValue);
  const bridgewoodTokens = bridgewoodValue.credits;
  const touchStartX = useRef(null);
  const [dragOffset, setDragOffset] = useState(0);

  const activeBuilding = BUILDINGS[activeIndex];

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) setIsTestAccount(data.session?.user.email?.toLowerCase() === TEST_PROFESSIONAL_EMAIL);
    });
    return () => { mounted = false; };
  }, []);

  const logOut = async () => {
    await supabase.auth.signOut();
    window.localStorage.removeItem("wbp-user-role");
    window.localStorage.removeItem("wbp-user-email");
    navigate("/login");
  };

  const goToBuilding = (nextIndex) => {
    const wrappedIndex = (nextIndex + BUILDINGS.length) % BUILDINGS.length;
    setActiveIndex(wrappedIndex);
    const nextPath = `/dashboard/${BUILDINGS[wrappedIndex].id}`;
    if (location.pathname !== nextPath) {
      navigate(nextPath);
    }
  };

  useEffect(() => {
    const currentSection = location.pathname.split("/").filter(Boolean)[1];
    const currentIndex = BUILDINGS.findIndex(
      (building) => building.id === currentSection
    );

    if (currentIndex >= 0) {
      setActiveIndex(currentIndex);
      return;
    }

    navigate("/dashboard/new", { replace: true });
  }, [location.pathname, navigate]);

  const openBuildingById = (buildingId) => {
    const buildingIndex = BUILDINGS.findIndex((building) => building.id === buildingId);
    if (buildingIndex >= 0) {
      goToBuilding(buildingIndex);
    }
  };

  const openSectionById = (sectionId) => {
    const sectionIndex = BUILDINGS.findIndex((building) => building.id === sectionId);
    if (sectionIndex >= 0) {
      goToBuilding(sectionIndex);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const loadBridgewoodTokens = async () => {
      const { data, error } = await supabase
        .from("CarbonSavingsSummary")
        .select("carbon_credits, total_energy_cost_saved_gbp, calculated_at")
        .eq("building_id", "home")
        .eq("scenario", CARBON_SAVINGS_SCENARIO)
        .order("calculated_at", { ascending: false })
        .limit(1);
      const credits = Number(data?.[0]?.carbon_credits);
      if (!cancelled && !error && Number.isFinite(credits) && credits >= 0) {
        const energyValue = Number(data?.[0]?.total_energy_cost_saved_gbp);
        setBridgewoodValue({
          credits,
          energyValue: Number.isFinite(energyValue) && energyValue >= 0
            ? energyValue
            : null,
        });
      }
    };

    loadBridgewoodTokens();
    return () => {
      cancelled = true;
    };
  }, []);

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
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <div className="flex min-w-0 w-full gap-2 overflow-x-auto pb-1 sm:w-auto sm:flex-1">
            {BUILDINGS.map((building, index) => (
              <React.Fragment key={building.id}>
                {building.id === "museum" ? (
                  <span className="mx-2 h-9 w-px shrink-0 self-center bg-gray-300" aria-hidden="true" />
                ) : null}
                <button
                  type="button"
                  className={`shrink-0 px-3 py-2 rounded border text-sm font-semibold sm:px-4 ${
                    activeBuilding.id === building.id
                      ? "bg-black text-white border-black"
                      : "bg-white text-black border-gray-300"
                  }`}
                  onClick={() => goToBuilding(index)}
                >
                  {building.name}
                </button>
              </React.Fragment>
            ))}
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 sm:gap-3">
            <p className="text-xs text-gray-500 hidden lg:block">
              Swipe left or right to switch buildings
            </p>
            {isTestAccount ? (
              <button
                type="button"
                onClick={() => navigate("/login")}
                className="shrink-0 border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:border-gray-500 hover:text-black"
              >
                Switch workspace
              </button>
            ) : null}
            <button
              type="button"
              onClick={logOut}
              className="shrink-0 border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:border-gray-500 hover:text-black"
            >
              Log out
            </button>
          </div>
        </div>
      </div>

      {activeBuilding.id === "new" && roleDetails ? (
        <section className="border-b border-emerald-200 bg-emerald-50 px-4 py-3">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <span className="bg-emerald-700 px-2 py-1 text-xs font-bold uppercase text-white">
                {roleDetails.label}
              </span>
              <div>
                <p className="m-0 text-sm font-bold text-gray-900">{roleDetails.phase} workspace</p>
                <p className="m-0 text-xs text-gray-600">{roleDetails.focus}</p>
              </div>
            </div>
            <p className="m-0 text-xs font-semibold text-emerald-800">
              Design &rarr; Procurement &rarr; Build &rarr; Commission &rarr; Occupancy
            </p>
          </div>
        </section>
      ) : null}

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
                ) : building.portfolioOnly ? (
                  <PortfolioDashboardPanel
                    bridgewoodTokens={bridgewoodTokens}
                    onOpenBuilding={openBuildingById}
                    onOpenExchange={() => openSectionById("exchange")}
                  />
                ) : building.exchangeOnly ? (
                  <ExchangeDashboardPanel
                    bridgewoodTokens={bridgewoodTokens}
                    onOpenPortfolio={() => openSectionById("portfolio")}
                  />
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

