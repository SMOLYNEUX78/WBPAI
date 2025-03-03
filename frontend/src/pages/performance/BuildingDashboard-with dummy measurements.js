import React, { useState, useEffect } from "react";
import AnalogGauge from "../../components/AnalogGauge";

const BuildingDashboard = () => {
  const [buildingArea, setBuildingArea] = useState(50);
  const [sensorData, setSensorData] = useState({
    energyUse: 15.2,
    temperature: 21.5,
    externalTemp: 15.0,
    humidity: 45,
    co2: 400,
    vocs: 0.12,
    pm25: 12,
  });
  const [performanceValue, setPerformanceValue] = useState(0);
  const [carbonCredits, setCarbonCredits] = useState(0);

  useEffect(() => {
    const interval = setInterval(fetchSensorData, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    calculatePerformance(sensorData, buildingArea);
    calculateCarbonCredits(sensorData, buildingArea);
  }, [sensorData, buildingArea]);

  const fetchSensorData = async () => {
    try {
      const simulatedData = {
        energyUse: 10 + Math.random() * 10,
        temperature: 19 + Math.random() * 4,
        externalTemp: 10 + Math.random() * 10,
        humidity: 35 + Math.random() * 30,
        co2: 400 + Math.random() * 300,
        vocs: 0.1 + Math.random() * 0.4,
        pm25: 5 + Math.random() * 20,
      };

      setSensorData(simulatedData);
    } catch (error) {
      console.error("Error fetching sensor data:", error);
    }
  };

  const calculatePerformance = (data, area) => {
    let score = 100;
    const adjustedArea = Math.max(area, 20);
    const energyPerSqM = data.energyUse / adjustedArea;

    if (energyPerSqM > 10) score -= 30;
    else if (energyPerSqM > 5) score -= 15;
    else if (energyPerSqM > 2) score -= 5;

    score -= Math.abs(data.temperature - 21) * 3;
    if (data.humidity < 40 || data.humidity > 60) score -= 10;
    if (data.co2 > 600) score -= (data.co2 - 600) / 10;
    if (data.vocs > 0.3) score -= (data.vocs - 0.3) * 10;
    if (data.pm25 > 12) score -= (data.pm25 - 12) * 5;

    score = Math.max(0, Math.min(100, score));
    setPerformanceValue(Math.round(score));
  };

  const calculateCarbonCredits = (data, area) => {
    const partLBaseline = (15 * area) / 50;
    const savings = partLBaseline - data.energyUse;
    setCarbonCredits(savings > 0 ? Math.round(savings * 0.4) : 0);
  };

  return (
    <div className="min-h-screen bg-white p-4 flex flex-col space-y-6">
      <div className="bg-gray-100 p-4 rounded shadow">
        <h2 className="text-lg font-bold mb-2">Data Input</h2>
        <div className="mb-2">
          <select className="border p-2" defaultValue="auto-scan">
            <option value="auto-scan">Auto-Scan</option>
            <option value="manual-setup">Manual Setup</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-4 mb-4">
          <button className="bg-green-500 text-white px-3 py-2 rounded">Scan for Smart Meter</button>
          <button className="bg-green-500 text-white px-3 py-2 rounded">Scan for Sensors</button>
        </div>
        <div className="flex flex-wrap items-center gap-4 mb-4">
          <div className="flex items-center gap-2">
            <label className="font-semibold">Internal Area:</label>
            <input 
              type="number" 
              className="border p-2 w-24" 
              value={buildingArea} 
              onChange={(e) => setBuildingArea(Math.max(20, Number(e.target.value)))}
            />
            <span>m²</span>
          </div>
        </div>
      </div>
      <div className="bg-gray-100 p-4 rounded shadow">
        <h2 className="text-lg font-bold">Performance</h2>
        <div className="flex items-center">
          <AnalogGauge value={performanceValue} />
          <div className="ml-4 text-sm">
            <p><strong>Energy Use:</strong> {sensorData.energyUse.toFixed(1)} kWh</p>
            <p><strong>Temperature:</strong> {sensorData.temperature.toFixed(1)} °C</p>
            <p><strong>External Temp:</strong> {sensorData.externalTemp.toFixed(1)} °C</p>
            <hr className="my-2" />
            <p><strong>Humidity:</strong> {sensorData.humidity.toFixed(1)}%</p>
            <p><strong>CO2:</strong> {sensorData.co2.toFixed(1)} ppm</p>
            <p><strong>VOCs:</strong> {sensorData.vocs.toFixed(2)} ppm</p>
            <p><strong>PM2.5:</strong> {sensorData.pm25.toFixed(1)} µg/m³</p>
          </div>
        </div>
      </div>
      <div className="bg-gray-100 p-4 rounded shadow">
        <h2 className="text-lg font-bold">Digital Carbon Credits</h2>
        <p><strong>{carbonCredits}</strong> DCC</p>
        <button className="bg-red-500 text-white px-4 py-2 w-32 rounded">SELL CREDITS</button>
      </div>
    </div>
  );
};

export default BuildingDashboard;

