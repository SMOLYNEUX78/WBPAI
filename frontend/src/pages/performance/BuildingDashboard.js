// BuildingDashboard.js
import React, { useState, useEffect } from "react";
import AnalogGauge from "../../components/AnalogGauge";
import supabase from "../../supabaseClient";

const BuildingDashboard = () => {
  const [buildingArea, setBuildingArea] = useState(50);
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
  const [location, setLocation] = useState(null);

  const fetchLatestData = async () => {
    try {
      const { data, error } = await supabase
        .from('Readings')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(1)
        .single();

      if (error) throw error;

      console.log("Fetched latest reading:", data); // See what comes back

      if (data) {
        setSensorData({
          energyUse: data.energy_usage || 0,
          temperature: data.temperature_inside || 0,
          externalTemp: data.temperature_outside || 0,
          humidity: data.humidity || 0,
          co2: data.co2_level || 0,
          vocs: data.voc_level || 0,
          pm25: data.pm25_level || 0,
        });

        setPerformanceValue(data.energy_usage || 0);
      }
    } catch (err) {
      console.error("Error fetching latest data:", err.message);
    }
  };

  const fetchHistoricalAverage = async () => {
    try {
      const { data, error } = await supabase
        .from('Readings')
        .select('energy_usage')
        .gte('timestamp', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      if (error) throw error;

      const values = data.map(row => row.energy_usage || 0);
      const avg = values.length > 0
        ? values.reduce((sum, val) => sum + val, 0) / values.length
        : 0;

      setHistoricalPerformance(avg);
    } catch (err) {
      console.error("Error fetching historical performance:", err.message);
    }
  };

  // 🔥 Fetch data when page loads
  useEffect(() => {
    fetchLatestData();
    fetchHistoricalAverage();
  }, []);

  const handleGeolocate = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          setLocation({ latitude: coords.latitude, longitude: coords.longitude });
          console.log(`📍 Latitude: ${coords.latitude}, Longitude: ${coords.longitude}`);
        },
        (err) => console.error("Geolocation error:", err)
      );
    }
  };

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
        <div className="flex items-center gap-2 mb-4">
          <label className="font-semibold">Internal Area:</label>
          <input
            type="number"
            className="border p-2 w-24"
            value={buildingArea}
            onChange={(e) =>
              setBuildingArea(Math.max(20, Number(e.target.value)))
            }
          />
          <span>m²</span>
          <button
            className="bg-green-500 text-white px-3 py-2 rounded"
            onClick={handleGeolocate}
          >
            Geolocate
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
            <p><strong>Energy Use:</strong> {sensorData.energyUse.toFixed(4)} kWh</p>
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

