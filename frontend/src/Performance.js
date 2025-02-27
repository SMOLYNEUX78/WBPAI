import React, { useState, useEffect } from "react";
import axios from "axios";

const BuildingProfile = () => {
  const [data, setData] = useState(null);

  useEffect(() => {
    axios.get("http://localhost:5000/api/sensors")
      .then(response => setData(response.data))
      .catch(error => console.error("Error fetching data:", error));
  }, []);

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center p-6">
      <div className="w-full max-w-3xl bg-white p-6 shadow-lg rounded-xl">
        <div className="flex justify-between border-b pb-4">
          <div className="text-left text-sm text-gray-700">
            <p className="font-bold">Reliance House,</p>
            <p>Huddersfield</p>
            <p>HD1 6PZ</p>
            <p className="text-blue-600 mt-2">COMMERCIAL</p>
            <p className="text-blue-600">RATING LEVEL</p>
            <div className="mt-1 bg-green-500 text-white px-3 py-1 inline-block rounded-md">7</div>
          </div>
          <h1 className="text-2xl font-bold text-blue-600">WHOLE BUILD PROFILE</h1>
        </div>

        <h2 className="mt-4 text-xl font-semibold text-blue-600">Performance</h2>

        {data ? (
          <div className="grid grid-cols-2 gap-4 mt-4 text-lg">
            <p>Temperature</p> <p className="text-right">{data.temperature} °C</p>
            <p>Humidity</p> <p className="text-right">{data.humidity} %</p>
            <p>CO₂ Levels</p> <p className="text-right">{data.co2} ppm</p>
            <p>Occupancy</p> <p className="text-right">{data.occupancy}</p>
            <p>Energy Consumption</p> <p className="text-right">{data.energyConsumption} kWh</p>
            <p>Efficiency</p> <p className="text-right">{data.efficiency}</p>
            <p>Health</p> <p className="text-right">{data.health}</p>
            <p>Carbon Footprint</p> <p className="text-right">{data.carbonFootprint} kg CO₂</p>
          </div>
        ) : (
          <p className="text-center mt-4">Loading data...</p>
        )}
      </div>
    </div>
  );
};

export default BuildingProfile;

