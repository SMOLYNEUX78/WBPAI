import React, { useState, useEffect } from "react";
import AnalogGauge from "../../components/AnalogGauge";
import supabase from "../../supabaseClient";

const BuildingDashboard = () => {
  const [buildingArea, setBuildingArea] = useState(() => {
    const savedArea = localStorage.getItem("buildingArea");
    return savedArea ? Number(savedArea) : 50;
  });

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

  const [performanceBreakdown, setPerformanceBreakdown] = useState({
    energy: 0,
    iaq: 0,
    comfort: 0,
    heatResilience: 0,
    humidityRisk: 0,
  });

  const scoreRange = (value, idealMin, idealMax, hardMin, hardMax) => {
    if (!value && value !== 0) return 0;

    if (value >= idealMin && value <= idealMax) return 100;

    if (value < idealMin) {
      return Math.max(
        0,
        ((value - hardMin) / (idealMin - hardMin)) * 100
      );
    }

    return Math.max(
      0,
      ((hardMax - value) / (hardMax - idealMax)) * 100
    );
  };

  const calculateIAQScore = ({ co2, pm25, vocs }) => {
    const co2Score =
      co2 > 0
        ? co2 <= 800
          ? 100
          : Math.max(0, 100 - ((co2 - 800) / 800) * 100)
        : 0;

    const pm25Score =
      pm25 > 0
        ? pm25 <= 12
          ? 100
          : Math.max(0, 100 - ((pm25 - 12) / 25) * 100)
        : 0;

    const vocScore =
      vocs > 0
        ? vocs <= 200
          ? 100
          : Math.max(0, 100 - ((vocs - 200) / 400) * 100)
        : 0;

    const scores = [co2Score, pm25Score, vocScore].filter(
      (score) => score > 0
    );

    return scores.length
      ? scores.reduce((sum, score) => sum + score, 0) / scores.length
      : 0;
  };

  const calculateComfortScore = ({ internalTemp, humidity }) => {
    const tempScore = scoreRange(internalTemp, 18, 22, 10, 30);
    const humidityScore = scoreRange(humidity, 40, 60, 20, 80);

    const scores = [tempScore, humidityScore].filter((score) => score > 0);

    return scores.length
      ? scores.reduce((sum, score) => sum + score, 0) / scores.length
      : 0;
  };

  const fetchLongTermAverage = async () => {
    try {
      const { data, error } = await supabase
        .from("DailyEnergyTotals")
        .select("total_energy_kwh");

      if (error) throw error;

      const validEntries = data.filter(
        (row) => row.total_energy_kwh !== null
      );

      if (validEntries.length > 0) {
        const total = validEntries.reduce(
          (sum, row) => sum + row.total_energy_kwh,
          0
        );

        setHistoricalPerformance(total / validEntries.length);
      }
    } catch (err) {
      console.error("Error fetching historical performance:", err.message);
    }
  };

  const fetchExternalTemp = async () => {
    try {
      const { data, error } = await supabase
        .from("Readings")
        .select("temperature_outside")
        .not("temperature_outside", "is", null)
        .order("timestamp", { ascending: false })
        .limit(1)
        .single();

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
      const { data, error } = await supabase
        .from("Readings")
        .select("temperature_inside, humidity, co2, vocs, pm25")
        .or(
          "temperature_inside.not.is.null,humidity.not.is.null,co2.not.is.null,vocs.not.is.null,pm25.not.is.null"
        )
        .order("timestamp", { ascending: false })
        .limit(1)
        .single();

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

      console.log("Latest IAQ data from Supabase:", data);
    } catch (err) {
      console.error("Error fetching IAQ data:", err.message);
    }
  };

  const fetchLongTermBuildingPerformance = async () => {
    try {
      const since = new Date();
      since.setDate(since.getDate() - 7);

      const { data, error } = await supabase
        .from("Readings")
        .select(
          "temperature_inside, temperature_outside, humidity, co2, vocs, pm25, timestamp"
        )
        .gte("timestamp", since.toISOString());

      if (error) throw error;
      if (!data || data.length === 0) return;

      const valid = (key) =>
        data
          .map((row) => Number(row[key]))
          .filter((value) => !Number.isNaN(value) && value !== 0);

      const avg = (values) =>
        values.length
          ? values.reduce((sum, value) => sum + value, 0) / values.length
          : 0;

      const avgInternalTemp = avg(valid("temperature_inside"));
      const avgOutsideTemp = avg(valid("temperature_outside"));
      const avgHumidity = avg(valid("humidity"));
      const avgCo2 = avg(valid("co2"));
      const avgVocs = avg(valid("vocs"));
      const avgPm25 = avg(valid("pm25"));

      const calculatedIAQScore = calculateIAQScore({
        co2: avgCo2,
        vocs: avgVocs,
        pm25: avgPm25,
      });

      const calculatedComfortScore = calculateComfortScore({
        internalTemp: avgInternalTemp,
        humidity: avgHumidity,
      });

      const heatResilienceScore =
        avgOutsideTemp > 24 && avgInternalTemp > 0
          ? scoreRange(avgOutsideTemp - avgInternalTemp, 3, 8, -2, 12)
          : 100;

      const humidityRiskScore = avgHumidity
        ? scoreRange(avgHumidity, 40, 60, 25, 80)
        : 0;

      const energyPerSqM =
        historicalPerformance && buildingArea
          ? historicalPerformance / buildingArea
          : 0;

      const calculatedEnergyScore =
        energyPerSqM > 0
          ? Math.min((1 / energyPerSqM) * 10, 100)
          : 0;

      const buildingPerformanceIndex = Math.round(
        calculatedEnergyScore * 0.3 +
          calculatedIAQScore * 0.25 +
          calculatedComfortScore * 0.2 +
          heatResilienceScore * 0.15 +
          humidityRiskScore * 0.1
      );

      setPerformanceBreakdown({
        energy: calculatedEnergyScore,
        iaq: calculatedIAQScore,
        comfort: calculatedComfortScore,
        heatResilience: heatResilienceScore,
        humidityRisk: humidityRiskScore,
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
  }, []);

  useEffect(() => {
    fetchLongTermBuildingPerformance();

    const interval = setInterval(() => {
      fetchIAQData();
      fetchExternalTemp();
      fetchLongTermBuildingPerformance();
    }, 60000);

    return () => clearInterval(interval);
  }, [historicalPerformance, buildingArea]);

  const handleAreaChange = (e) => {
    const newArea = Number(e.target.value);
    setBuildingArea(newArea);
    localStorage.setItem("buildingArea", newArea);
  };

  return (
    <div className="min-h-screen bg-white p-4 flex flex-col space-y-6">
      <div className="bg-gray-100 p-4 rounded shadow">
        <h2 className="text-lg font-bold mb-2">Data Input</h2>

        <div className="flex items-center gap-2 mb-4">
          <label className="font-semibold">Internal Area:</label>

          <input
            type="number"
            className="border p-2 w-24"
            value={buildingArea}
            onChange={handleAreaChange}
          />

          <span>m²</span>
        </div>
      </div>

      <div className="bg-gray-100 p-4 rounded shadow">
        <h2 className="text-lg font-bold">
          7-Day Building Performance Index
        </h2>

        <div className="flex items-center">
          <AnalogGauge
            value={performanceValue}
            historicalValue={historicalPerformance}
          />

          <div className="ml-4 text-sm">
            <p>
              <strong>Overall Score:</strong> {performanceValue}/100
            </p>

            <p>
              <strong>Energy:</strong>{" "}
              {performanceBreakdown.energy.toFixed(0)}/100
            </p>

            <p>
              <strong>Air Quality:</strong>{" "}
              {performanceBreakdown.iaq.toFixed(0)}/100
            </p>

            <p>
              <strong>Comfort:</strong>{" "}
              {performanceBreakdown.comfort.toFixed(0)}/100
            </p>

            <p>
              <strong>Heat Resilience:</strong>{" "}
              {performanceBreakdown.heatResilience.toFixed(0)}/100
            </p>

            <p>
              <strong>Humidity Risk:</strong>{" "}
              {performanceBreakdown.humidityRisk.toFixed(0)}/100
            </p>

            <hr className="my-2" />

            <p>
              <strong>Daily Average Energy:</strong>{" "}
              {historicalPerformance
                ? historicalPerformance.toFixed(4)
                : "No Data"}{" "}
              kWh
            </p>

            <p>
              <strong>Energy per m²:</strong>{" "}
              {historicalPerformance && buildingArea
                ? (historicalPerformance / buildingArea).toFixed(4)
                : "No Data"}{" "}
              kWh/m²
            </p>

            <hr className="my-2" />

            <p>
              <strong>Current Internal Temp:</strong>{" "}
              {(sensorData.internalTemp ?? 0).toFixed(1)} °C
            </p>

            <p>
              <strong>Current External Temp:</strong>{" "}
              {(sensorData.externalTemp ?? 0).toFixed(1)} °C
            </p>

            <p>
              <strong>Humidity:</strong>{" "}
              {(sensorData.humidity ?? 0).toFixed(1)}%
            </p>

            <p>
              <strong>CO2:</strong>{" "}
              {(sensorData.co2 ?? 0).toFixed(1)} ppm
            </p>

            <p>
              <strong>VOCs:</strong>{" "}
              {(sensorData.vocs ?? 0).toFixed(1)} ppb
            </p>

            <p>
              <strong>PM2.5:</strong>{" "}
              {(sensorData.pm25 ?? 0).toFixed(1)} µg/m³
            </p>
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

export default BuildingDashboard;