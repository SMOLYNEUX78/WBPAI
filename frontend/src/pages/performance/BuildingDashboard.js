// src/pages/performance/BuildingDashboard.js
import React, { useState, useEffect } from "react";
import AnalogGauge from "../../components/AnalogGauge";
import axios from "axios"; // Placeholder for sensor data fetching

const BuildingDashboard = () => {
  const [buildingArea, setBuildingArea] = useState(50);
  const [occupantCount, setOccupantCount] = useState(1);
  const [location, setLocation] = useState({ lat: null, lng: null });
  const [sensorData, setSensorData] = useState({
    energyUse: 15.2, // kWh/day
    temperature: 21.5, // °C
    externalTemp: 15.0, // °C
    humidity: 45, // %
    co2: 400, // ppm
    vocs: 0.12, // mg/m³
    pm25: 12, // µg/m³
  });
  const [performanceValue, setPerformanceValue] = useState(0);
  const [carbonCredits, setCarbonCredits] = useState(0);

  useEffect(() => {
    fetchSensorData(); // Placeholder for real sensor connection
  }, []);

  useEffect(() => {
    calculatePerformance(sensorData, buildingArea);
    calculateCarbonCredits(sensorData, buildingArea);
  }, [sensorData, buildingArea]);

  const fetchSensorData = async () => {
    try {
      const response = await axios.get("https://api.example.com/sensors");
      setSensorData(response.data);
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

  const handleGeolocate = () => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          alert(`Location found:\nLat: ${pos.coords.latitude}\nLng: ${pos.coords.longitude}`);
        },
        (err) => console.error("Geolocation error:", err)
      );
    }
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
        <AnalogGauge value={performanceValue} />
        <div className="grid grid-cols-2 gap-2 pt-4 text-sm">
          <span className="font-semibold">Energy use:</span>
          <span>{sensorData.energyUse} kWh/day</span>
          <span className="font-semibold">Temperature:</span>
          <span>{sensorData.temperature} °C</span>
          <span className="font-semibold">External Temp:</span>
          <span>{sensorData.externalTemp} °C</span>
          <div className="col-span-2 border-t border-gray-400 my-2"></div>
          <span className="font-semibold">Humidity:</span>
          <span>{sensorData.humidity} %</span>
          <span className="font-semibold">CO₂:</span>
          <span>{sensorData.co2} ppm</span>
          <span className="font-semibold">VOCs:</span>
          <span>{sensorData.vocs} mg/m³</span>
          <span className="font-semibold">PM2.5:</span>
          <span>{sensorData.pm25} µg/m³</span>
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

