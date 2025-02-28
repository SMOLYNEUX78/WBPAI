import React, { useEffect, useState } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  useNavigate
} from "react-router-dom";
import BuildingDashboard from "./pages/performance/BuildingDashboard";


const SplashScreen = () => {
  const navigate = useNavigate();
  const [fadeOut, setFadeOut] = useState(false); // State to handle fade effect

  useEffect(() => {
    const timer = setTimeout(() => {
      setFadeOut(true); // Start fade-out animation
      setTimeout(() => navigate("/dashboard"), 500); // Wait for fade-out to complete before navigating
    }, 2000);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div
      className={`min-h-screen flex items-center justify-center bg-gray-100 relative transition-opacity duration-500 ${
        fadeOut ? "opacity-0" : "opacity-100"
      }`}
    >
      {/* Image as Background */}
      <img
        src="/images/house.jpg"
        alt="House"
        className="absolute inset-0 w-full h-full object-cover"
      />

      {/* Overlay Text */}
      <h1 className="text-4xl font-bold text-blue-600 relative z-10">
        WHOLE BUILD PROFILE
      </h1>
    </div>
  );
};

const App = () => {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<SplashScreen />} />
        <Route path="/dashboard" element={<BuildingDashboard />} />
      </Routes>
    </Router>
  );
};

export default App;
