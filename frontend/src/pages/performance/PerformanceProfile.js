import React from "react";

const PerformanceProfile = () => {
  return (
    <div className="min-h-screen bg-white p-6">
      {/* Top Section */}
      <div className="flex justify-between items-start border-b pb-4">
        {/* Left: Check building */}
        <div>
          <p className="text-blue-600 cursor-pointer hover:underline">
            &#128205; Check building
          </p>
        </div>

        {/* Right: Whole Build Profile + Building Efficiency */}
        <div className="text-right">
          <h1 className="text-2xl font-bold">Whole Build Profile</h1>
          <p className="text-gray-600">Building efficiency</p>
        </div>
      </div>

      {/* Middle: House image + Address */}
      <div className="flex items-center mt-4">
        <img
          src="https://via.placeholder.com/150x100.png?text=House+Image"
          alt="House"
          className="border mr-4"
        />
        <div>
          <p className="font-bold">Unity Wharf</p>
          <p>13 Mill Street</p>
          <p>London</p>
          <p>SE1 2BH</p>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mt-4 bg-gray-300 w-full h-6 rounded relative">
        <div
          className="absolute left-0 top-0 bg-green-500 h-6 rounded"
          style={{ width: "100%" }}
        >
          <span className="text-white ml-2">100% complete</span>
        </div>
      </div>

      {/* Tabs: Performance, Build, Design */}
      <div className="flex justify-around text-xl font-semibold mt-4">
        <div className="cursor-pointer hover:text-blue-600">Performance</div>
        <div className="cursor-pointer hover:text-blue-600">Build</div>
        <div className="cursor-pointer hover:text-blue-600">Design</div>
      </div>

      {/* Performance Gauge + Deep-Dive */}
      <div className="mt-8 flex flex-col items-center">
        <img
          src="https://via.placeholder.com/200x150.png?text=Performance+Gauge"
          alt="Gauge"
          className="border"
        />
        <button className="mt-4 bg-orange-500 text-white px-4 py-2 rounded">
          Deep-dive
        </button>
      </div>
    </div>
  );
};

export default PerformanceProfile;
