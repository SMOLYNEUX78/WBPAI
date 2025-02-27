import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

const SplashScreen = () => {
  const navigate = useNavigate();
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setFadeOut(true);
      setTimeout(() => navigate("/create-profile"), 500);
    }, 2000);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div
      className={`min-h-screen flex items-center justify-center bg-gray-100 relative transition-opacity duration-500 ${
        fadeOut ? "opacity-0" : "opacity-100"
      }`}
    >
      <img
        src="/images/house.jpg"
        alt="House"
        className="absolute inset-0 w-full h-full object-cover"
      />
      <h1 className="text-4xl font-bold text-blue-600 relative z-10">
        WHOLE BUILD PROFILE
      </h1>
    </div>
  );
};

export default SplashScreen;

