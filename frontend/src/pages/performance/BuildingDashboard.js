import React, { useState, useEffect } from "react";
import AnalogGauge from "../../components/AnalogGauge";
import mqtt from "mqtt";
import { openDB } from "idb";
import { ethers } from "ethers";
import { getEthereumContract, connectWallet } from "../../utils/ethers";

const TTN_BROKER = "wss://eu1.cloud.thethings.network";
const TTN_USERNAME = process.env.REACT_APP_TTN_USERNAME;
const TTN_PASSWORD = process.env.REACT_APP_TTN_PASSWORD;
const CLOUD_DB_API = process.env.REACT_APP_CLOUD_DB_API;

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
  const [wallet, setWallet] = useState(null);
  const [contract, setContract] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(CLOUD_DB_API, {
          headers: {
            Authorization: `Bearer ${process.env.REACT_APP_CLOUD_DB_TOKEN}`,
          },
        });
        const data = await response.json();
        setSensorData((prev) => ({ ...prev, ...data }));
      } catch (error) {
        console.error("Error fetching data:", error);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 300000); // Fetch every 5 minutes
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const client = mqtt.connect(TTN_BROKER, {
      username: TTN_USERNAME,
      password: TTN_PASSWORD,
    });

    client.on("connect", () => {
      console.log("Connected to TTN");
      client.subscribe("v3/+/devices/+/up");
    });

    client.on("message", (topic, message) => {
      const payload = JSON.parse(message.toString());
      setSensorData((prev) => ({ ...prev, ...payload }));
    });

    return () => client.end();
  }, []);

  useEffect(() => {
    const fetchHistoricalData = async () => {
      try {
        const response = await fetch(`${CLOUD_DB_API}/historical`, {
          headers: {
            Authorization: `Bearer ${process.env.REACT_APP_CLOUD_DB_TOKEN}`,
          },
        });
        const data = await response.json();
        setHistoricalPerformance(data.averagePerformance);
      } catch (error) {
        console.error("Error fetching historical data:", error);
      }
    };
    fetchHistoricalData();
  }, []);

  useEffect(() => {
    const initBlockchain = async () => {
      const walletAddress = await connectWallet();
      if (walletAddress) {
        setWallet(walletAddress);
        setContract(getEthereumContract());
      }
    };
    initBlockchain();
  }, []);

  const sellCredits = async () => {
    if (contract && wallet) {
      try {
        const tx = await contract.sellCredits(ethers.utils.parseUnits(carbonCredits.toString(), "ether"));
        await tx.wait();
        alert("Credits sold successfully!");
      } catch (error) {
        console.error("Error selling credits:", error);
      }
    }
  };

  return (
    <div className="min-h-screen bg-white p-4 flex flex-col space-y-6">
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
          <button className="bg-green-500 text-white px-3 py-2 rounded">Geolocate</button>
        </div>
      </div>
      <div className="bg-gray-100 p-4 rounded shadow">
        <h2 className="text-lg font-bold">Performance</h2>
        <div className="flex items-center">
          <AnalogGauge value={performanceValue} historicalValue={historicalPerformance} />
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
        <button onClick={sellCredits} className="bg-red-500 text-white px-4 py-2 w-32 rounded">SELL CREDITS</button>
      </div>
    </div>
  );
};

export default BuildingDashboard;

