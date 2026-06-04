import React, { useEffect, useMemo, useRef, useState } from "react";
import AnalogGauge from "../../components/AnalogGauge";
import supabase from "../../supabaseClient";

const DEFAULT_MATTERPORT_URL = "https://my.matterport.com/show/?m=zHm8SwWeHiN";

const BUILDINGS = [
  {
    id: "museum",
    name: "Museum",
    subtitle: "CAD monitor, smart meter and IAQ tablet collector",
    defaultMatterportUrl: DEFAULT_MATTERPORT_URL,
    estimatedInternalArea: 145,
    nationalAverageEui: 200,
    legacyUnscopedData: true,
  },
  {
    id: "home",
    name: "Home",
    subtitle: "Home smart meter, CAD and MQTT collector",
    defaultMatterportUrl: "",
    estimatedInternalArea: "--",
    nationalAverageEui: 150,
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

const createEmptyMatterportMetadata = (statusText) => ({
  address: statusText,
  latitude: "--",
  longitude: "--",
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
  const [matterportInput, setMatterportInput] = useState(() => {
    return (
      localStorage.getItem(`${building.id}:matterportModelInput`) ||
      building.defaultMatterportUrl
    );
  });
  const [matterportMetadata, setMatterportMetadata] = useState(() =>
    createEmptyMatterportMetadata("Connect Matterport SDK / API to load geodata")
  );

  const [sensorData, setSensorData] = useState({
    internalTemp: 0,
    externalTemp: 0,
    humidity: 0,
    co2: 0,
    vocs: 0,
    pm25: 0,
  });

  const [performanceValue, setPerformanceValue] = useState(0);
  const [historicalPerformance, setHistoricalPerformance] = useState(0);
  const [carbonCredits] = useState(0);
  const [energySummary, setEnergySummary] = useState({
    electricityDailyAverage: 0,
    electricityTodayKwh: 0,
    gasDailyAverage: 0,
    gasTodayKwh: 0,
    totalDailyAverage: 0,
    electricityPowerKw: 0,
    hasGasData: false,
  });

  const [performanceBreakdown, setPerformanceBreakdown] = useState({
    health: 0,
    energy: 0,
    resilience: 0,
    iaq: 0,
    comfort: 0,
    humidity: 0,
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
        createEmptyMatterportMetadata("Paste a Matterport URL or ID")
      );
      return;
    }

    setMatterportMetadata({
      ...createEmptyMatterportMetadata(
        "Model connected, geodata awaiting SDK / API"
      ),
      internalArea: getEstimatedInternalArea(matterportModelId, building),
    });
  }, [building, matterportModelId]);

  const applyBuildingScope = (query) => {
    if (building.legacyUnscopedData) {
      return query;
    }

    return query.eq("building_id", building.id);
  };

  const applyStrictBuildingScope = (query) => query.eq("building_id", building.id);

  const getValidValues = (rows, key) =>
    rows
      .map((row) => Number(row[key]))
      .filter((value) => !Number.isNaN(value) && value !== 0);

  const average = (values) =>
    values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0;

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
      : 0;
  };

  const calculateIAQScore = ({ co2Values, pm25Values, vocValues }) => {
    const metricScore = (healthyRatio, poorRatio) =>
      Math.max(0, Math.min(100, healthyRatio * 100 - poorRatio * 35));

    const co2Score = co2Values.length
      ? metricScore(
          percentageWithin(co2Values, (value) => value <= 1000),
          percentageWithin(co2Values, (value) => value > 1500)
        )
      : 0;

    const pm25Score = pm25Values.length
      ? metricScore(
          percentageWithin(pm25Values, (value) => value <= 12),
          percentageWithin(pm25Values, (value) => value > 35)
        )
      : 0;

    const vocScore = vocValues.length
      ? metricScore(
          percentageWithin(vocValues, (value) => value <= 200),
          percentageWithin(vocValues, (value) => value > 500)
        )
      : 0;

    return averageScore([co2Score, pm25Score, vocScore]);
  };

  const calculateComfortScore = ({ internalTempValues }) => {
    if (!internalTempValues.length) {
      return 0;
    }

    const comfortableRatio = percentageWithin(
      internalTempValues,
      (value) => value >= 18 && value <= 25
    );
    const stressRatio = percentageWithin(
      internalTempValues,
      (value) => value < 16 || value > 28
    );

    return Math.max(0, Math.min(100, comfortableRatio * 100 - stressRatio * 30));
  };

  const calculateHumidityScore = (humidityValues) => {
    if (!humidityValues.length) {
      return 0;
    }

    const stableRatio = percentageWithin(
      humidityValues,
      (value) => value >= 40 && value <= 60
    );
    const riskyRatio = percentageWithin(
      humidityValues,
      (value) => value < 30 || value > 70
    );

    return Math.max(0, Math.min(100, stableRatio * 100 - riskyRatio * 35));
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

  const calculateOverallPerformanceScore = ({
    health,
    energy,
    resilience,
  }) => {
    const indoorEnvironment = averageScore([health, resilience]);
    return Math.round(Math.min(energy, indoorEnvironment));
  };

  const calculateEnergyScore = (annualEui, nationalAverageEui) => {
    if (!Number.isFinite(annualEui) || !nationalAverageEui) {
      return 0;
    }

    if (annualEui <= 0) {
      return 100;
    }

    if (annualEui <= nationalAverageEui) {
      return 50 + (1 - annualEui / nationalAverageEui) * 50;
    }

    return Math.max(
      0,
      50 * (1 - (annualEui - nationalAverageEui) / nationalAverageEui)
    );
  };

  const fetchLongTermAverage = async () => {
    try {
      const { data: dailyData, error: dailyError } = await supabase
        .from("EnergyReadings")
        .select("timestamp, fuel_type, usage_kwh")
        .eq("building_id", building.id)
        .eq("reading_type", "daily_total")
        .order("timestamp", { ascending: false })
        .limit(2000);

      if (dailyError) throw dailyError;

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

      const rows = dailyData || [];
      const latestElectricPower = latestElectricPowerRows?.[0];

      if (rows.length > 0 || latestElectricPower) {
        const todayKey = new Date().toISOString().slice(0, 10);
        const dailyTotalsByFuel = rows.reduce((totals, row) => {
          const usageKwh = Number(row.usage_kwh);
          if (!Number.isFinite(usageKwh)) {
            return totals;
          }

          const day = new Date(row.timestamp).toISOString().slice(0, 10);
          const key = `${row.fuel_type}:${day}`;
          totals[key] = Math.max(totals[key] || 0, usageKwh);
          return totals;
        }, {});

        const dailyValues = (fuelType, { includeToday = false } = {}) =>
          Object.entries(dailyTotalsByFuel)
            .filter(([key]) => {
              const [keyFuelType, day] = key.split(":");
              return (
                keyFuelType === fuelType &&
                (includeToday || day !== todayKey)
              );
            })
            .map(([, value]) => value);

        const averageDailyUsage = (fuelType) => {
          const completedDays = dailyValues(fuelType);

          if (completedDays.length > 0) {
            return average(completedDays);
          }

          return average(dailyValues(fuelType, { includeToday: true }));
        };

        const latestDailyTotal = (fuelType) => {
          const values = Object.entries(dailyTotalsByFuel)
            .filter(([key]) => key.startsWith(`${fuelType}:`))
            .sort(([leftKey], [rightKey]) => rightKey.localeCompare(leftKey))
            .map(([, value]) => value);

          return values[0] || 0;
        };

        const electricityDailyAverage = averageDailyUsage("electricity");
        const gasDailyAverage = averageDailyUsage("gas");
        const totalDailyAverage = electricityDailyAverage + gasDailyAverage;
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
          electricityDailyAverage: 0,
          electricityTodayKwh: 0,
          gasDailyAverage: 0,
          gasTodayKwh: 0,
          totalDailyAverage: 0,
          electricityPowerKw: 0,
          hasGasData: false,
        });
        setHistoricalPerformance(0);
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
      const { data, error } = await applyStrictBuildingScope(
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
        externalTemp: Number(data?.temperature_outside) || 0,
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
        internalTemp: Number(data.temperature_inside) || 0,
        humidity: Number(data.humidity) || 0,
        co2: Number(data.co2) || 0,
        vocs: Number(data.vocs) || 0,
        pm25: Number(data.pm25) || 0,
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
      const annualEnergyUse =
        historicalPerformance > 0 ? historicalPerformance * 365 : 0;
      const annualEui =
        historicalPerformance && estimatedArea
          ? annualEnergyUse / estimatedArea
          : 0;

      const calculatedEnergyScore = calculateEnergyScore(
        annualEui,
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

  return (
    <div className="min-h-screen bg-white p-4 flex flex-col space-y-6">
      <div className="bg-gray-100 p-4 rounded shadow">
        <h2 className="text-lg font-bold mb-3">Building Input</h2>

        <div className="grid gap-5 grid-cols-[minmax(0,1fr)_320px] md:grid-cols-[minmax(0,1fr)_360px] items-start">
          <div className="space-y-4">
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

            <details className="bg-white rounded border">
              <summary className="cursor-pointer px-3 py-3 font-semibold">
                Matterport SDK / API Options
              </summary>
              <div className="px-3 pb-3 text-sm space-y-3">
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
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Model Preview</h3>

              {matterportShareUrl ? (
                <a
                  className="text-blue-700 text-sm underline"
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
                className="w-full h-[280px] border rounded bg-white"
                allow="fullscreen; xr-spatial-tracking; vr"
              />
            ) : (
              <div className="w-full h-[280px] border rounded bg-white flex items-center justify-center text-gray-500 text-sm p-6 text-center">
                Paste a Matterport model URL or ID to load the 3D scan here.
              </div>
            )}

          </div>
        </div>
      </div>

      <div className="bg-gray-100 p-4 rounded shadow">
        <h2 className="text-lg font-bold mb-3">Performance</h2>

        <div className="grid gap-5 grid-cols-[minmax(0,1fr)_320px] items-start">
          <div className="bg-white rounded border p-4">
            <div className="flex justify-center">
              <AnalogGauge
                value={performanceValue}
                historicalValue={historicalPerformance}
              />
            </div>

            <div className="mt-4 space-y-1 text-sm leading-tight">
              <p>
                <strong>Health:</strong> {performanceBreakdown.health.toFixed(0)}
                /100
              </p>
              <p>
                <strong>Energy:</strong> {performanceBreakdown.energy.toFixed(0)}
                /100
              </p>
            </div>
          </div>

          <div className="bg-white rounded border p-4">
            <h3 className="text-base font-semibold mb-3">Live Data</h3>

            <div className="space-y-6 text-sm leading-tight">
              <div className="space-y-0.5">
                <p>
                  <strong>Annualised EUI:</strong>{" "}
                  {historicalPerformance &&
                  matterportMetadata.internalArea !== "--"
                    ? (
                        (historicalPerformance * 365) /
                        Number(matterportMetadata.internalArea)
                      ).toFixed(4)
                    : "No Data"}{" "}
                  kWh/m2/yr
                </p>
              </div>

              <div className="space-y-0.5">
                <h4 className="font-semibold">Electricity</h4>
                <p>
                  <strong>Daily Average:</strong>{" "}
                  {energySummary.electricityDailyAverage
                    ? energySummary.electricityDailyAverage.toFixed(4)
                    : "No Data"}{" "}
                  kWh
                </p>
                <p>
                  <strong>Today:</strong>{" "}
                  {Number.isFinite(energySummary.electricityTodayKwh)
                    ? energySummary.electricityTodayKwh.toFixed(4)
                    : "No Data"}{" "}
                  kWh
                </p>
                <p>
                  <strong>Live:</strong>{" "}
                  {energySummary.electricityPowerKw
                    ? energySummary.electricityPowerKw.toFixed(3)
                    : "No Data"}{" "}
                  kW
                </p>
              </div>

              {energySummary.hasGasData ? (
                <div className="space-y-0.5">
                  <h4 className="font-semibold">Gas</h4>
                  <p>
                    <strong>Daily Average:</strong>{" "}
                    {energySummary.gasDailyAverage
                      ? energySummary.gasDailyAverage.toFixed(4)
                      : "No Data"}{" "}
                    kWh
                  </p>
                  <p>
                    <strong>Today:</strong>{" "}
                    {Number.isFinite(energySummary.gasTodayKwh)
                      ? energySummary.gasTodayKwh.toFixed(4)
                      : "No Data"}{" "}
                    kWh
                  </p>
                </div>
              ) : null}

              <div className="space-y-0.5">
                <p>
                  <strong>Internal Temp:</strong>{" "}
                  {(sensorData.internalTemp ?? 0).toFixed(1)} deg C
                </p>
                <p>
                  <strong>External Temp:</strong>{" "}
                  {(sensorData.externalTemp ?? 0).toFixed(1)} deg C
                </p>
              </div>

              <div className="space-y-0.5">
                <p>
                  <strong>Humidity:</strong> {(sensorData.humidity ?? 0).toFixed(1)}%
                </p>
                <p>
                  <strong>CO2:</strong> {(sensorData.co2 ?? 0).toFixed(1)} ppm
                </p>
                <p>
                  <strong>VOCs:</strong> {(sensorData.vocs ?? 0).toFixed(1)} ppb
                </p>
                <p>
                  <strong>PM2.5:</strong> {(sensorData.pm25 ?? 0).toFixed(1)} ug/m3
                </p>
              </div>
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
  const [activeIndex, setActiveIndex] = useState(0);
  const touchStartX = useRef(null);

  const activeBuilding = BUILDINGS[activeIndex];

  const goToBuilding = (nextIndex) => {
    const wrappedIndex = (nextIndex + BUILDINGS.length) % BUILDINGS.length;
    setActiveIndex(wrappedIndex);
  };

  const handleTouchStart = (event) => {
    touchStartX.current = event.touches[0].clientX;
  };

  const handleTouchEnd = (event) => {
    if (touchStartX.current === null) {
      return;
    }

    const touchEndX = event.changedTouches[0].clientX;
    const deltaX = touchEndX - touchStartX.current;
    touchStartX.current = null;

    if (Math.abs(deltaX) < 60) {
      return;
    }

    goToBuilding(activeIndex + (deltaX < 0 ? 1 : -1));
  };

  return (
    <div
      className="min-h-screen bg-white"
      onTouchStart={handleTouchStart}
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

      <BuildingDashboardPanel key={activeBuilding.id} building={activeBuilding} />
    </div>
  );
};

export default BuildingDashboard;














