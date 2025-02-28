import React, { useState, useEffect } from "react";

// Optional: If you want a real gauge library, install and import one, e.g.:
// import { Gauge } from "react-gauge-component";

const BuildingDashboard = () => {
  // -- 1) State for occupant data, building area, and location --
  const [buildingArea, setBuildingArea] = useState(50);  // m²
  const [occupantCount, setOccupantCount] = useState(1);
  const [location, setLocation] = useState({ lat: null, lng: null });

  // -- 2) State for sensor data (mocked for now) --
  const [sensorData, setSensorData] = useState({
    energyUse: 15.2,            // kWh (daily average)
    temperature: 21.5,          // °C (indoor daily avg)
    externalTemp: 15.0,         // °C (outdoor daily avg)
    humidity: 45,               // % (indoor daily avg)
    co2: 400,                   // ppm
    vocs: 0.12,                 // mg/m³ or similar
    pm25: 12,                   // µg/m³
  });

  // -- 3) Performance gauge value (0-100) --
  //    Example calculation based on sensor data and occupant data
  const [performanceValue, setPerformanceValue] = useState(0);

  // -- 4) Carbon credits (Digital Carbon Credit) calculation --
  //    Compare building performance to baseline from UK Building Regs Part L
  const [carbonCredits, setCarbonCredits] = useState(0);

  // -- 5) On mount, simulate daily sensor snapshots or fetch real data from an API --
  useEffect(() => {
    // Example: calculate performance
    calculatePerformance(sensorData);

    // Example: calculate carbon credits
    calculateCarbonCredits(sensorData, buildingArea);
  }, [sensorData, buildingArea]);

  // -- 6) Functions --

  // Example performance calc (very simplified placeholder):
  function calculatePerformance(data) {
    // Weighted average or more complex logic can go here
    let score = 100;
    // If temperature is far from 21°C, reduce score
    const tempDiff = Math.abs(data.temperature - 21);
    score -= tempDiff * 2;

    // If humidity is out of range (40-60%), reduce score
    if (data.humidity < 40 || data.humidity > 60) {
      score -= 10;
    }

    // If CO2 is high, reduce score
    if (data.co2 > 600) {
      score -= (data.co2 - 600) / 10;
    }

    // Score boundaries
    if (score < 0) score = 0;
    if (score > 100) score = 100;
    setPerformanceValue(Math.round(score));
  }

  // Example carbon credits calc:
  // Compare building's daily kWh to a baseline for an equivalent building
  // built to UK Part L. This is a placeholder formula.
  function calculateCarbonCredits(data, area) {
    // Baseline: e.g., 20 kWh/day for a 50m² building, scaling up linearly
    const baseline = (20 * area) / 50;
    const savings = baseline - data.energyUse; // in kWh

    if (savings > 0) {
      // Convert kWh savings to kg CO2 eq. (roughly 0.4 kg CO2/kWh)
      const co2Savings = savings * 0.4;
      // 1 DCC token = 1 kg CO2 saved (placeholder)
      setCarbonCredits(Math.round(co2Savings));
    } else {
      setCarbonCredits(0);
    }
  }

  // Handle occupant count & building area changes
  const handleOccupantChange = (e) => setOccupantCount(Number(e.target.value));
  const handleBuildingAreaChange = (e) => setBuildingArea(Number(e.target.value));

  // Geolocate button
  const handleGeolocate = () => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          alert(`Location found:\nLatitude: ${pos.coords.latitude}\nLongitude: ${pos.coords.longitude}`);
        },
        (error) => {
          alert("Unable to retrieve location.");
          console.error(error);
        }
      );
    } else {
      alert("Geolocation is not supported by this browser.");
    }
  };

  // UI for scanning sensors
  const scanForSmartMeter = () => {
    alert("Scanning for Smart Meter...");
    // Real logic would go here
  };
  const scanForSensors = () => {
    alert("Scanning for Sensors...");
    // Real logic would go here
  };

  // "Sell" carbon credits
  const handleSellCredits = () => {
    alert(`You sold ${carbonCredits} DCC!`);
  };

  // -- 7) Render UI --
  return (
    <div className="min-h-screen bg-white p-4 flex flex-col space-y-6">

      {/* DATA SECTION */}
      <div className="bg-gray-100 p-4 rounded shadow">
        <h2 className="text-lg font-bold mb-2">Data</h2>

        {/* Smart Meter & Sensor Connection */}
        <div className="flex items-center space-x-4 mb-4">
          <select className="border p-2"
                  defaultValue="auto-scan">
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

        {/* Internal Area & Occupants */}
        <div className="flex items-center space-x-4 mb-4">
          <label className="font-semibold">Internal Area:</label>
          <select className="border p-2"
                  value={buildingArea}
                  onChange={handleBuildingAreaChange}>
            {[50, 100, 150, 200, 250, 300].map((areaVal) => (
              <option key={areaVal} value={areaVal}>
                {areaVal} m²
              </option>
            ))}
          </select>

          <label className="font-semibold">Occupants:</label>
          <select className="border p-2"
                  value={occupantCount}
                  onChange={handleOccupantChange}>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
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

            {/* Placeholder gauge - you can replace with a real gauge library */}
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

