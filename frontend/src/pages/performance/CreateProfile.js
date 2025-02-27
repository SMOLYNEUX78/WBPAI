import React, { useState } from "react";

const CreateProfile = () => {
  const [profile, setProfile] = useState({
    forename: "",
    surname: "",
    address: "",
    occupantCount: "",
    uniqueReference: Math.floor(100000 + Math.random() * 900000),
    connectionMethod: "auto",
    smartMeterDetected: false,
    sensorDetected: false,
  });

  const handleChange = (e) => {
    setProfile({ ...profile, [e.target.name]: e.target.value });
  };

  const scanForSmartMeter = () => {
    setTimeout(() => {
      setProfile({ ...profile, smartMeterDetected: true });
      alert("Smart meter detected!");
    }, 2000);
  };

  const scanForSensors = () => {
    setTimeout(() => {
      setProfile({ ...profile, sensorDetected: true });
      alert("Sensors detected and linked to Performance section!");
    }, 2000);
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center p-6">
      <div className="w-full max-w-3xl bg-white p-6 shadow-lg rounded-xl">
        <h1 className="text-2xl font-bold text-blue-600 text-center">Create Profile</h1>

        <div className="grid grid-cols-2 gap-4 mt-4 text-lg">
          <label>Forename</label> 
          <input type="text" name="forename" value={profile.forename} onChange={handleChange} className="border p-2" />
          
          <label>Surname</label> 
          <input type="text" name="surname" value={profile.surname} onChange={handleChange} className="border p-2" />
          
          <label>Address</label> 
          <input type="text" name="address" value={profile.address} onChange={handleChange} className="border p-2" />
          
          <label>Number of Occupants</label> 
          <input type="number" name="occupantCount" value={profile.occupantCount} onChange={handleChange} className="border p-2" />
          
          <label>Unique Reference Number</label>
          <input type="text" value={profile.uniqueReference} readOnly className="border p-2 bg-gray-200" />
        </div>

        <h2 className="mt-6 text-xl font-semibold text-blue-600">Smart Meter & Sensor Connection</h2>
        <select name="connectionMethod" value={profile.connectionMethod} onChange={handleChange} className="border p-2 mt-2">
          <option value="auto">Auto-Scan</option>
          <option value="manual">Manual Setup</option>
        </select>

        {profile.connectionMethod === "auto" && (
          <div>
            <button onClick={scanForSmartMeter} className="mt-4 bg-green-500 text-white px-4 py-2 rounded">Scan for Smart Meter</button>
            <button onClick={scanForSensors} className="mt-4 bg-blue-500 text-white px-4 py-2 rounded ml-2">Scan for Sensors</button>
          </div>
        )}

        {profile.smartMeterDetected && <p className="mt-4 text-green-600">Smart Meter Found!</p>}
        {profile.sensorDetected && <p className="mt-4 text-green-600">Sensors Linked to Performance Section!</p>}

        <button className="mt-6 bg-blue-600 text-white px-6 py-3 rounded">Create Profile</button>
      </div>
    </div>
  );
};

export default CreateProfile;

