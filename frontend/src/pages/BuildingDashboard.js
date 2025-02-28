import React, { useState, useEffect } from "react";

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

  function calculatePerformance(data) {
    let score = 100;
    const tempDiff = Math.abs(data.temperature - 21);
    score -= tempDiff * 2;
    if (data.humidity < 40 || data.humidity > 60) score -= 10;
    if (data.co2 > 600) score -= (data.co2 - 600) / 10;
    if (score < 0) score = 0;
    if (score > 100) score = 100;
    setPerformanceValue(Math.round(score));
  }

  function calculateCarbonCredits(data, area) {
    const baseline = (20 * area) / 50; // Very rough baseline
    const savings = baseline - data.energyUse; 
    if (savings > 0) {
      const co2Savings = savings * 0.4; 
      setCarbonCredits(Math.round(co2Savings));
    } else {
      setCarbonCredits(0);
    }
  }

  const handleOccupantChange = (e) => setOccupantCount(Number(e.target.value));
  const handleBuildingAreaChange = (e) => setBuildingArea(Number(e.target.value));

  const handleGeolocate = () => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          alert(`Location found:\nLat: ${pos.coords.latitude}, Lng: ${pos.coords.longitude}`);
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
    // Reset or decrement credits if desired
  };

  return (
    <div className="min-h-screen bg-white p-4 flex flex-col space-y-6">

      {/* DATA SECTION */}
      <div className="bg-gray-100 p-4 rounded shadow">
        <h2 className="text-lg font-bold mb-2">Data</h2>
        <div className="flex items-center space-x-4 mb-4">
          <select className="border p-2" defaultValue="auto-scan">
            <option value="auto-scan">Auto-Scan</option>
            <option value="manual-setup">Manual Setup</option>
          </select>
          <button onClick={scanForSmartMeter} className="bg-green-500 text-white px-3 py-2 rounded">
            Scan for Smart Meter
          </button>
          <button onClick={scanForSensors} className="bg-blue-500 text-white px-3 py-2 rounded">
            Scan for Sensors
          </button>
        </div>

        <div className="flex items-center space-x-4 mb-4">
          <label className="font-semibold">Internal Area:</label>
          <select className="border p-2" value={buildingArea} onChange={handleBuildingAreaChange}>
            {[50, 100, 150, 200, 250, 300].map((val) => (
              <option key={val} value={val}>{val} m²</option>
            ))}
          </select>

          <label className="font-semibold">Occupants:</label>
          <select className="border p-2" value={occupantCount} onChange={handleOccupantChange}>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((val) => (
              <option key={val} value={val}>{val}</option>
            ))}
          </select>

          <button onClick={handleGeolocate} className="bg-yellow-500 text-white px-3 py-2 rounded">
            Geolocate
          </button>
        </div>
      </div>

      {/* PERFORMANCE SECTION */}
      <div className="bg-gray-100 p-4 rounded shadow flex flex-col space-y-4">
        <h2 className="text-lg font-bold">Performance</h2>
        <div className="flex">
          {/* Left: Gauge */}
          <div className="flex-1 flex flex-col items-center">
            <p className="mb-2 font-semibold">Live Gauge</p>
            <div className="relative w-40 h-40 bg-white border-2 border-gray-300 rounded-full flex items-center justify-center">
              <p className="text-2xl font-bold">{performanceValue}%</p>
            </div>
          </div>

          {/* Right: Averages */}
          <div className="flex-1 grid grid-cols-2 gap-2 pl-4 text-sm">
            <span className="font-semibold">Energy use:</span>
            <span>{sensorData.energyUse} kWh/day</span>

            <span className="font-semibold">Temperature:</span>
            <span>{sensorData.temperature} °C</span>

            <span className="font-semibold">External Temp:</span>
            <span>{sensorData.externalTemp} °C</span>

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

