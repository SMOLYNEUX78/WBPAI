import React, { useState, useEffect } from "react";
import AnalogGauge from "../../components/AnalogGauge";
import supabase from "../../supabaseClient";

const BuildingDashboard = () => {
  // 🔒 Helper: get boolean from localStorage safely
  const getPersistentBoolean = (key, fallback = false) => {
    const val = localStorage.getItem(key);
    return val === null ? fallback : val === 'true';
  };

  const [buildingArea, setBuildingArea] = useState(() => {
    const savedArea = localStorage.getItem('buildingArea');
    return savedArea ? Number(savedArea) : 50;
  });

  const [isAreaLocked, setIsAreaLocked] = useState(() => getPersistentBoolean('isAreaLocked'));
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

  // 🔁 Sync lock states to localStorage
  useEffect(() => {
    localStorage.setItem('isAreaLocked', isAreaLocked);
  }, [isAreaLocked]);

  // 🌡️ Fetch external temperature from Supabase
  const fetchLatestExternalTemperature = async () => {
    try {
      const { data, error } = await supabase
        .from('Readings')
        .select('temperature_outside, timestamp')
        .order('timestamp', { ascending: false })
        .limit(1)
        .single();

      if (error) throw error;

      if (data) {
        const latestExternalTemp = data.temperature_outside || 0;
        setSensorData(prev => ({ ...prev, externalTemp: latestExternalTemp }));
      } else {
        console.log("No external temperature data found.");
      }
    } catch (err) {
      console.error("Error fetching latest external temperature:", err.message);
    }
  };

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
      } else {
        console.log("No historical data found.");
      }
    } catch (err) {
      console.error("Error fetching historical performance data:", err.message);
    }
  };

  useEffect(() => {
    fetchLongTermAverage();
    fetchLatestExternalTemperature(); // Fetch the latest external temperature on load
  }, []);

  useEffect(() => {
    if (historicalPerformance && buildingArea > 0) {
      const energyPerSqM = historicalPerformance / buildingArea;
      const invertedPerformance = energyPerSqM > 0 ? (1 / energyPerSqM) : 0;
      const scaledPerformanceValue = Math.min(invertedPerformance * 10, 100);
      setPerformanceValue(scaledPerformanceValue);
    }
  }, [historicalPerformance, buildingArea]);

  const handleAreaChange = (e) => {
    if (isAreaLocked) return;
    const newArea = Number(e.target.value);
    setBuildingArea(newArea);
    localStorage.setItem('buildingArea', newArea);
  };

  const handleAreaLockToggle = () => {
    setIsAreaLocked(prev => !prev);
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
              <strong>External Temp:</strong> {sensorData.externalTemp !== null ? sensorData.externalTemp.toFixed(1) : 'No Data'} °C
            </p>
            <hr className="my-2" />
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

