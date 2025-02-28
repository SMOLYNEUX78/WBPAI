// src/pages/performance/BuildingDashboard.js
import React, { useState, useEffect } from "react";
import AnalogGauge from "../components/AnalogGauge";

const BuildingDashboard = () => {
  const [buildingArea, setBuildingArea] = useState(50);
  const [occupantCount, setOccupantCount] = useState(1);
  const [location, setLocation] = useState({ lat: null, lng: null });
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
    calculatePerformance(sensorData);
    calculateCarbonCredits(sensorData, buildingArea);
  }, [sensorData, buildingArea]);

  const calculatePerformance = (data) => {
    let score = 100;
    const tempDiff = Math.abs(data.temperature - 21);
    score -= tempDiff * 2;
    if (data.humidity < 40 || data.humidity > 60) score -= 10;
    if (data.co2 > 600) score -= (data.co2 - 600) / 10;
    if (score < 0) score = 0;
    if (score > 100) score = 100;
    setPerformanceValue(Math.round(score));
  };

  const calculateCarbonCredits = (data, area) => {
    const baseline = (20 * area) / 50;
    const savings = baseline - data.energyUse;
    if (savings > 0) {
      const co2Savings = savings * 0.4;
      setCarbonCredits(Math.round(co2Savings));
    } else {
      setCarbonCredits(0);
    }
  };

  const handleOccupantChange = (e) => setOccupantCount(Number(e.target.value));
  const handleBuildingAreaChange = (e) => setBuildingArea(Number(e.target.value));

  const handleGeolocate = () => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          alert(`Location found:\nLat: ${pos.coords.latitude}\nLng: ${pos.coords.longitude}`);
        },
        (err) => {
          alert("Unable to retrieve location.");
          console.error(err);
        }
      );
    } else {
      alert("Geolocation is not supported by this browser.");
    }
  };

  const scanForSmartMeter = () => alert("Scanning for Smart Meter...");
  const scanForSensors = () => alert("Scanning for Sensors...");
  const handleSellCredits = () => {
    alert(`You sold ${carbonCredits} DCC!`);
  };

  return (
    <div className="min-h-screen bg-white p-4 flex flex-col space-y-6">
      {/* DATA SECTION */}
      <div className="bg-gray-100 p-4 rounded shadow">
        <h2 className="text-lg font-bold mb-2">Data</h2>
        {/* Dropdown for Auto-Scan/Manual Setup */}
        <div className="mb-2">
          <select className="border p-2" defaultValue="auto-scan">
            <option value="auto-scan">Auto-Scan</option>
            <option value="manual-setup">Manual Setup</option>
          </select>
        </div>
        {/* Buttons: Both green, on one line */}
        <div className="flex flex-wrap items-center gap-4 mb-4">
          <button onClick={scanForSmartMeter} className="bg-green-500 text-white px-3 py-2 rounded">
            Scan for Smart Meter
          </button>
          <button onClick={scanForSensors} className="bg-green-500 text-white px-3 py-2 rounded">
            Scan for Sensors
          </button>
        </div>
        {/* Internal Area & Occupants */}
        <div className="flex flex-wrap items-center gap-4 mb-4">
          <div className="flex items-center gap-2">
            <label className="font-semibold">Internal Area:</label>
            <input 
              type="number" 
              className="border p-2 w-24" 
              value={buildingArea} 
              onChange={handleBuildingAreaChange} 
            />
            <span>m²</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="font-semibold">Occupants:</label>
            <select className="border p-2" value={occupantCount} onChange={handleOccupantChange}>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((val) => (
                <option key={val} value={val}>
                  {val}
                </option>
              ))}
            </select>
          </div>
          <button onClick={handleGeolocate} className="bg-yellow-500 text-white px-3 py-2 rounded">
            Geolocate
          </button>
        </div>
      </div>

      {/* PERFORMANCE SECTION */}
      <div className="bg-gray-100 p-4 rounded shadow flex flex-col space-y-4">
        <h2 className="text-lg font-bold">Performance</h2>
        <div className="flex flex-col md:flex-row">
          {/* Left: Analog Gauge */}
          <div className="flex-1 flex flex-col items-center mb-4 md:mb-0">
            <p className="mb-2 font-semibold">Live Gauge</p>
            <AnalogGauge value={performanceValue} />
          </div>
          {/* Right: Split into two groups with extra spacing */}
          <div className="flex flex-col md:flex-row flex-1 gap-4 pl-0 md:pl-4 text-sm">
            {/* Energy Group */}
            <div className="flex-1 grid grid-cols-2 gap-2">
              <span className="font-semibold">Energy use:</span>
              <span>{sensorData.energyUse} kWh/day</span>
              <span className="font-semibold">Temperature:</span>
              <span>{sensorData.temperature} °C</span>
              <span className="font-semibold">External Temp:</span>
              <span>{sensorData.externalTemp} °C</span>
            </div>
            {/* Spacer for separation */}
            <div className="hidden md:block w-6"></div>
            {/* IAQ Group */}
            <div className="flex-1 grid grid-cols-2 gap-2 md:mt-4">
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
        </div>
      </div>

      {/* CREDITS SECTION */}
      <div className="bg-gray-100 p-4 rounded shadow flex flex-col space-y-2">
        <h2 className="text-lg font-bold">Credits</h2>
        <p className="text-sm">
          <strong>{carbonCredits}</strong> DCC (Digital Carbon Credits)
        </p>
        <button onClick={handleSellCredits} className="bg-red-500 text-white px-4 py-2 w-32 rounded">
          SELL
        </button>
      </div>
    </div>
  );
};

export default BuildingDashboard;

