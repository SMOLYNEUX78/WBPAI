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
  const [stage, setStage] = useState(0);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    const profileTimer = setTimeout(() => setStage(1), 500);
    const identityTimer = setTimeout(() => setStage(2), 1500);
    const completionTimer = setTimeout(() => setStage(3), 2500);
    const exitTimer = setTimeout(() => setFadeOut(true), 3400);
    const navigationTimer = setTimeout(() => navigate("/dashboard/new"), 3900);

    return () => {
      clearTimeout(profileTimer);
      clearTimeout(identityTimer);
      clearTimeout(completionTimer);
      clearTimeout(exitTimer);
      clearTimeout(navigationTimer);
    };
  }, [navigate]);

  return (
    <div
      className={`relative min-h-screen overflow-hidden bg-[#f4f5f3] transition-opacity duration-500 ${
        fadeOut ? "opacity-0" : "opacity-100"
      }`}
    >
      <main className="flex min-h-screen flex-col items-center justify-center px-6 py-10">
        <section className="flex w-full max-w-xl flex-col items-center" aria-label="Whole Build Profile loading">
          <div className={`wbp-corporate-mark stage-${stage}`} aria-hidden="true">
            <div className="wbp-mark-grid">
              {Array.from({ length: 12 }).map((_, index) => (
                <span key={index} style={{ "--cell-delay": `${index * 55}ms` }} />
              ))}
            </div>
            <div className="wbp-building-form">
              <span className="wbp-building-column wbp-building-column-a" />
              <span className="wbp-building-column wbp-building-column-b" />
              <span className="wbp-building-column wbp-building-column-c" />
            </div>
            <span className="wbp-scan-line" />
            <span className="wbp-mark-corner wbp-mark-corner-tl" />
            <span className="wbp-mark-corner wbp-mark-corner-tr" />
            <span className="wbp-mark-corner wbp-mark-corner-bl" />
            <span className="wbp-mark-corner wbp-mark-corner-br" />
            <span className="wbp-profile-code">WBP-001</span>
          </div>

          <div className="mt-8 text-center sm:mt-10">
            <h1 className="text-3xl font-bold text-gray-950 sm:text-5xl">
              Whole Build Profile
            </h1>
            <p className="mt-3 text-[10px] font-semibold uppercase text-gray-500 sm:text-xs">
              Building intelligence
            </p>
          </div>

          <div className="mt-8 w-full max-w-xs sm:mt-10">
            <div className="flex items-center justify-between text-[10px] font-semibold uppercase text-gray-500">
              <span>{stage < 2 ? "Building profile" : stage < 3 ? "Registering evidence" : "Profile ready"}</span>
              <span>{stage < 1 ? "00" : stage < 2 ? "38" : stage < 3 ? "76" : "100"}%</span>
            </div>
            <div className="mt-2 h-1 overflow-hidden bg-gray-300">
              <span
                className="block h-full bg-emerald-700 transition-[width] duration-700 ease-out"
                style={{ width: stage < 1 ? "0%" : stage < 2 ? "38%" : stage < 3 ? "76%" : "100%" }}
              />
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

const App = () => {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<SplashScreen />} />
        <Route path="/dashboard/*" element={<BuildingDashboard />} />
      </Routes>
    </Router>
  );
};

export default App;
