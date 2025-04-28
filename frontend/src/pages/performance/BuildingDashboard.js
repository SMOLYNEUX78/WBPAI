import React, { useState, useEffect } from "react";
import AnalogGauge from "../../components/AnalogGauge";
import supabase from "../../supabaseClient";

const BuildingDashboard = () => {
  const [buildingArea, setBuildingArea] = useState(() => {
    const savedArea = localStorage.getItem('buildingArea');
    return savedArea ? Number(savedArea) : 50;
  });

  const [location, setLocation] = useState(() => {
    const savedLocation = localStorage.getItem('location');
    return savedLocation ? JSON.parse(savedLocation) : null;
  });

  const [isAreaLocked, setIsAreaLocked] = useState(() => {
    return localStorage.getItem('isAreaLocked') === 'true';
  });

  const [isLocationLocked, setIsLocationLocked] = useState(() => {
    return localStorage.getItem('isLocationLocked') === 'true';
  });

  const [sensorData, setSensorData] = useState({
    energyUse: 0,
    temperature: 0,
    externalTemp: 0,
    humidity: 0,
    co2: 0,
    vocs: 0,
    pm25: 0,
  });

  const [performanceValue, setPerformanceValue] = useState(0);
  const [historicalPerformance, setHistoricalPerformance] = useState(0);
  const [carbonCredits, setCarbonCredits] = useState(0);

  const fetchLongTermAverage = async () => {
    try {
      const { data, error } = await supabase
        .from('DailyEnergyTotals')
        .select('total_energy_kwh, day')
        .order('day', { ascending: false })
        .limit(1)
        .single();

      if (error) throw error;

      if (data) {
        const dailyTotalEnergy = data.total_energy_kwh || 0;
        setHistoricalPerformance(dailyTotalEnergy);
        console.log("Fetched historical performance (daily total energy):", dailyTotalEnergy);
      } else {
        console.log("No historical data found.");
      }
    } catch (err) {
      console.error("Error fetching historical performance data:", err.message);
    }
  };

  useEffect(() => {
    fetchLongTermAverage();
  }, []);

  useEffect(() => {
    if (historicalPerformance && buildingArea > 0) {
      const energyPerSqM = historicalPerformance / buildingArea;
      const invertedPerformance = energyPerSqM > 0 ? (1 / energyPerSqM) : 0;
      const scaledPerformanceValue = Math.min(invertedPerformance * 10, 100);
      setPerformanceValue(scaledPerformanceValue);
      console.log("Performance Value updated:", scaledPerformanceValue);
    }
  }, [historicalPerformance, buildingArea]);

  const handleAreaChange = (e) => {
    if (isAreaLocked) return;
    const newArea = Number(e.target.value);
    setBuildingArea(newArea);
    localStorage.setItem('buildingArea', newArea);
  };

  const handleAreaLockToggle = () => {
    const newLockState = !isAreaLocked;
    setIsAreaLocked(newLockState);
    localStorage.setItem('isAreaLocked', newLockState);
    console.log(`Building area lock toggled: ${newLockState}`);
  };

  const handleGeolocate = () => {
    if (isLocationLocked) return;

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          const newLocation = { latitude: coords.latitude, longitude: coords.longitude };
          setLocation(newLocation);
          localStorage.setItem('location', JSON.stringify(newLocation));
          console.log(`📍 Latitude: ${coords.latitude}, Longitude: ${coords.longitude}`);
        },
        (err) => console.error("Geolocation error:", err)
      );
    }
  };

  const handleLocationLockToggle = () => {
    const newLockState = !isLocationLocked;
    setIsLocationLocked(newLockState);
    localStorage.setItem('isLocationLocked', newLockState);
    console.log(`Location lock toggled: ${newLockState}`);
  };

  console.log("Sensor Data:", sensorData);
  console.log("Performance Value:", performanceValue);
  console.log("Historical Performance:", historicalPerformance);

  return (
    <div className="min-h-screen bg-white p-4 flex flex-col space-y-6">
      {/* Input Section */}
      <div className="bg-gray-100 p-4 rounded shadow">
        <h2 className="text-lg font-bold mb-2">Data Input</h2>
        <div className="flex flex-wrap items-center gap-4 mb-4">
          <button className="bg-green-500 text-white px-3 py-2 rounded">
            Scan for Smart Meter
          </button>
          <button className="bg-green-500 text-white px-3 py-2 rounded">
            Scan for Sensors
          </button>
        </div>

        {/* Building Area */}
        <div className="flex items-center gap-2 mb-4">
          <label className="font-semibold">Internal Area:</label>
          <input
            type="number"
            className="border p-2 w-24"
            value={buildingArea}
            onChange={handleAreaChange}
            disabled={isAreaLocked}
          />
          <span>m²</span>
          <button
            onClick={handleAreaLockToggle}
            className={`ml-2 px-2 py-1 rounded ${isAreaLocked ? 'bg-red-500' : 'bg-green-500'} text-white`}
          >
            {isAreaLocked ? "🔓 Unlock" : "🔒 Lock"}
          </button>
        </div>

        {/* Geolocation */}
        <div className="flex items-center gap-2 mb-4">
          <button
            className={`px-3 py-2 rounded ${isLocationLocked ? 'bg-gray-400' : 'bg-green-500'} text-white`}
            onClick={handleGeolocate}
            disabled={isLocationLocked}
          >
            Geolocate
          </button>
          <button
            onClick={handleLocationLockToggle}
            className={`ml-2 px-2 py-1 rounded ${isLocationLocked ? 'bg-red-500' : 'bg-green-500'} text-white`}
          >
            {isLocationLocked ? "🔓 Unlock" : "🔒 Lock"}
          </button>
        </div>

        {location && (
          <div className="text-sm text-gray-600">
            📍 Lat: {location.latitude.toFixed(5)}, Lng: {location.longitude.toFixed(5)}
          </div>
        )}
      </div>

      {/* Performance Section */}
      <div className="bg-gray-100 p-4 rounded shadow">
        <h2 className="text-lg font-bold">Performance</h2>
        <div className="flex items-center">
          <AnalogGauge
            value={performanceValue}
            historicalValue={historicalPerformance}
          />
          <div className="ml-4 text-sm">
            <p>
              <strong>Daily Average Energy Use:</strong> {historicalPerformance ? historicalPerformance.toFixed(4) : 'No Data'} kWh
            </p>
            <p>
              <strong>Temperature:</strong> {sensorData.temperature !== null ? sensorData.temperature.toFixed(1) : 'No Data'} °C
            </p>
            <p>
              <strong>External Temp:</strong> {sensorData.externalTemp !== null ? sensorData.externalTemp.toFixed(1) : 'No Data'} °C
            </p>
            <hr className="my-2" />
            <p><strong>Humidity:</strong> {sensorData.humidity !== null ? sensorData.humidity.toFixed(1) : 'No Data'}%</p>
            <p><strong>CO2:</strong> {sensorData.co2 !== null ? sensorData.co2.toFixed(1) : 'No Data'} ppm</p>
            <p><strong>VOCs:</strong> {sensorData.vocs !== null ? sensorData.vocs.toFixed(2) : 'No Data'} ppm</p>
            <p><strong>PM2.5:</strong> {sensorData.pm25 !== null ? sensorData.pm25.toFixed(1) : 'No Data'} µg/m³</p>
          </div>
        </div>
      </div>

      {/* Carbon Credit Section */}
      <div className="bg-gray-100 p-4 rounded shadow">
        <h2 className="text-lg font-bold">Digital Carbon Credits</h2>
        <p><strong>{carbonCredits}</strong> DCC</p>
        <button className="bg-red-500 text-white px-4 py-2 w-32 rounded">
          SELL CREDITS
        </button>
      </div>
    </div>
  );
};

export default BuildingDashboard;

