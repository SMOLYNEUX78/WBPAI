import React, { useEffect, useMemo, useRef, useState } from "react";
import AnalogGauge from "../../components/AnalogGauge";
import supabase from "../../supabaseClient";

const DEFAULT_MATTERPORT_URL = "https://my.matterport.com/show/?m=zHm8SwWeHiN";
const HDD_BASE_TEMP_C = 15.5;

const BUILDINGS = [
  {
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
  const matterportInput = useMemo(() => {
    return (
      localStorage.getItem(`${building.id}:matterportModelInput`) ||
      building.defaultMatterportUrl
    );
  }, [building.id, building.defaultMatterportUrl]);
  const manualMatterportData = useMemo(() => {
    const savedData = localStorage.getItem(`${building.id}:matterportManualData`);

    if (savedData) {
      try {
        return JSON.parse(savedData);
      } catch (error) {
        return {};
      }
    }

    return {};
  }, [building.id]);
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
    pm10: null,
    hcho: null,
  });
  const [roomIaqData, setRoomIaqData] = useState([]);
  const supportsExtendedIaqColumns = useRef(true);

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
  const [heatLossSummary, setHeatLossSummary] = useState({
    kwhPerHdd: null,
    weatherNormalisedEui: null,
    htcEstimate: null,
    hddDays: 0,
    htcSamples: 0,
    hddSource: "current",
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

    return query.eq("building_id", building.id);
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
      columns.push("pm10", "hcho");
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
  } = {}) => {
    const runQuery = async (includeExtended) => {
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
          .or(
            "temperature_inside.not.is.null,humidity.not.is.null,co2.not.is.null,vocs.not.is.null,pm25.not.is.null"
          )
      );

      if (orderDescending) {
        query = query.order("timestamp", { ascending: false });
      }

      if (limit) {
        query = query.limit(limit);
      }

      return query;
    };

    let result = await runQuery(true);

    if (
      result.error &&
      supportsExtendedIaqColumns.current &&
      /pm10|hcho|schema cache/i.test(result.error.message || "")
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

    return averageScore([co2Score, pm25Score, pm10Score, vocScore, hchoScore]);
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

    return tailAwareScore(internalTempValues, scoreTemperature, 10, 0.5);
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

    return tailAwareScore(humidityValues, scoreHumidity, 90, 0.55);
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

    return clampScore(Math.min(...ieqComponentScores)) / 100;
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

        if (Number.isFinite(inside) && inside !== 0) {
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

      setHeatLossSummary({
        kwhPerHdd: hddSummary.kwhPerHdd,
        weatherNormalisedEui: hddSummary.weatherNormalisedEui,
        htcEstimate: htcSamples > 0 ? htcTotal / htcSamples : null,
        hddDays: hddSummary.hddDays || 0,
        htcSamples,
        hddSource: hddSummary.hddSource || "current",
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
      const { data, error } = await fetchScopedIaqRows({
        includeReadingType: true,
        limit: 30,
        orderDescending: true,
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
          });
          return rooms;
        }, [])
        .sort((a, b) => {
          const order = { Downstairs: 0, Upstairs: 1 };
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
            }
          : null;

      setRoomIaqData(roomRows);

      setSensorData((prev) => ({
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
      }));
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
          building.id === "home" &&
          row.reading_type === "dyson:living_room"
        ) {
          return {
            ...row,
            co2: null,
            vocs: null,
            pm25: null,
            pm10: null,
            hcho: null,
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

      const calculatedIAQScore = calculateIAQScore({
        co2Values,
        vocValues,
        pm25Values,
        pm10Values,
        hchoValues,
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

  useEffect(() => {
    fetchLongTermAverage();
    fetchHeatLossSummary();
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
  }, [
    building.id,
    historicalPerformance,
    matterportMetadata.internalArea,
    heatLossSummary.weatherNormalisedEui,
  ]);

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
  ];
  const carbonEvidenceCompleteCount = carbonEvidenceSteps.filter(
    (step) => step.complete
  ).length;
  const carbonEvidenceProgress = Math.round(
    (carbonEvidenceCompleteCount / carbonEvidenceSteps.length) * 100
  );
  const nextCarbonEvidenceStep = carbonEvidenceSteps.find(
    (step) => !step.complete
  );
  const carbonTokenUnlocked = carbonEvidenceSteps.every((step) => step.complete);
  return (
    <div className="min-h-screen bg-white p-4 flex flex-col space-y-6">
      <div className="bg-gray-100 p-4 rounded shadow">
        <h2 className="text-lg font-bold mb-3">Building Input</h2>

        <div className="grid gap-3 grid-cols-2 sm:gap-5 items-start">
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
                3D Model
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

            {matterportEmbedUrl ? (
              <iframe
                title="Matterport model"
                src={matterportEmbedUrl}
                className="w-full h-[150px] min-[390px]:h-[180px] sm:h-[280px] border rounded bg-white"
                allow="fullscreen; xr-spatial-tracking; vr"
              />
            ) : (
              <div className="w-full h-[150px] min-[390px]:h-[180px] sm:h-[280px] border rounded bg-white flex items-center justify-center text-gray-500 text-[10px] min-[390px]:text-xs sm:text-sm p-2 sm:p-6 text-center">
                3D model pending.
              </div>
            )}

          </div>
        </div>
      </div>

      <div className="bg-gray-100 p-4 rounded shadow">
        <h2 className="text-lg font-bold mb-3">Performance</h2>

        <div className="space-y-3 sm:space-y-5">
          <div className="bg-white rounded border p-2.5 sm:p-4 min-w-0">
            <div className="grid grid-cols-[minmax(0,150px)_minmax(0,1fr)] gap-3 sm:gap-6 items-start">
              <div className="space-y-4 sm:space-y-6 text-[10px] min-[390px]:text-xs sm:text-sm leading-tight">
                <div className="space-y-0.5 sm:space-y-1">
                  <p>
                    <strong>Health:</strong>{" "}
                    {formatScore(performanceBreakdown.health)}
                  </p>
                  <p>
                    <strong>Energy:</strong>{" "}
                    {formatScore(performanceBreakdown.energy)}
                  </p>
                </div>
              </div>

              <div className="flex justify-center min-w-0 scale-110 sm:scale-125 origin-top">
                <AnalogGauge
                  value={performanceValue}
                  historicalValue={historicalPerformance}
                />
              </div>
            </div>
          </div>

          <div className="bg-white rounded border p-2.5 sm:p-4 min-w-0 overflow-hidden">
            <div className="grid grid-cols-3 gap-2 sm:gap-5 text-[10px] min-[390px]:text-xs sm:text-sm leading-tight">
              <div className="space-y-2 sm:space-y-3 break-words min-w-0">
                <h3 className="font-semibold mb-2 sm:mb-3">Energy</h3>
                <p>
                  <strong>Annualised EUI</strong>
                  <br />
                  {Number.isFinite(historicalPerformance) &&
                  matterportMetadata.internalArea !== "--"
                    ? (
                        (historicalPerformance * 365) /
                        Number(matterportMetadata.internalArea)
                      ).toFixed(4)
                    : "No Data"}
                  <br />
                  kWh/m2/yr
                </p>
                <p>
                  <strong>Electricity</strong>
                  <br />
                  Daily Average
                  <br />
                  {formatNumber(energySummary.electricityDailyAverage)}{" "}
                  kWh
                </p>

                {energySummary.hasGasData ? (
                  <p>
                    <strong>Gas</strong>
                    <br />
                    Daily Average
                    <br />
                    {formatNumber(energySummary.gasDailyAverage)}{" "}
                    kWh
                  </p>
                ) : (
                  <p>
                    <strong>Gas</strong>
                    <br />
                    Daily Average
                    <br />
                    No Data
                  </p>
                )}
              </div>

              <div className="space-y-0.5 break-words min-w-0">
                <h3 className="font-semibold mb-2 sm:mb-3">IAQ Data</h3>
                <p>
                  <strong>Internal Temp:</strong>{" "}
                  {formatMeasurement(sensorData.internalTemp)} deg C
                </p>
                <p>
                  <strong>External Temp:</strong>{" "}
                  {formatMeasurement(sensorData.externalTemp)} deg C
                </p>
                <p>
                  <strong>Humidity:</strong>{" "}
                  {formatMeasurement(sensorData.humidity)}%
                </p>
                {building.id !== "home" ? (
                  <p>
                    <strong>CO2:</strong> {formatMeasurement(sensorData.co2)} ppm
                  </p>
                ) : null}
                <p>
                  <strong>VOCs:</strong> {formatMeasurement(sensorData.vocs)} ppb
                </p>
                <p>
                  <strong>PM2.5:</strong> {formatMeasurement(sensorData.pm25)} ug/m3
                </p>
                {Number.isFinite(sensorData.pm10) ? (
                  <p>
                    <strong>PM10:</strong> {formatMeasurement(sensorData.pm10)} ug/m3
                  </p>
                ) : null}
                {Number.isFinite(sensorData.hcho) ? (
                  <p>
                    <strong>HCHO:</strong> {formatMeasurement(sensorData.hcho)} ppb
                  </p>
                ) : null}
                {roomIaqData.length > 0 ? (
                  <div className="pt-1 mt-1 border-t border-gray-200 space-y-1">
                    {roomIaqData.map((room) => {
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
                            ]),
                      ].filter((metric) => Number.isFinite(metric.value));

                      return (
                        <div key={room.key} className="space-y-0.5">
                          <p className="font-semibold">{room.label}</p>
                          <p>
                            {roomMetrics.length
                              ? roomMetrics
                                  .map(
                                    (metric) =>
                                      `${metric.label} ${formatMeasurement(
                                        metric.value
                                      )} ${metric.unit}`
                                  )
                                  .join(" / ")
                              : "No IAQ data"}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>

              <div className="space-y-2 sm:space-y-3 break-words min-w-0">
                <h3 className="font-semibold mb-2 sm:mb-3">Heat Loss Analysis</h3>
                <div className="space-y-0.5">
                  <p>
                    <strong>HDD Intensity:</strong>{" "}
                    {Number.isFinite(heatLossSummary.kwhPerHdd)
                      ? `${formatNumber(heatLossSummary.kwhPerHdd, 3)} kWh/HDD`
                      : "Pending completed energy + HDD data"}
                  </p>
                  <p>
                    <strong>HTC Estimate:</strong>{" "}
                    {Number.isFinite(heatLossSummary.htcEstimate)
                      ? `${formatNumber(heatLossSummary.htcEstimate, 1)} W/K`
                      : "Pending energy + indoor/outdoor temperature overlap"}
                  </p>
                  <p>
                    <strong>HDD / HTC Days:</strong>{" "}
                    {heatLossSummary.hddDays || 0} /{" "}
                    {heatLossSummary.htcSamples || 0}
                  </p>
                  <p>
                    <strong>Weather-normalised EUI:</strong>{" "}
                    {Number.isFinite(heatLossSummary.weatherNormalisedEui)
                      ? `${formatNumber(
                          heatLossSummary.weatherNormalisedEui
                        )} kWh/m2/yr`
                      : "Pending"}
                  </p>
                  <p>
                    <strong>HDD Source:</strong>{" "}
                    {heatLossSummary.hddSource === "legacy"
                      ? "Legacy museum daily totals"
                      : "Current building data"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

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
              <strong>{carbonCredits}</strong> WBPA-C
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
                  className="w-full h-[220px] border rounded bg-white"
                  allow="fullscreen; xr-spatial-tracking; vr"
                />
              ) : (
                <div className="w-full h-[220px] border rounded bg-white flex items-center justify-center text-gray-500 text-sm p-4 text-center">
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

