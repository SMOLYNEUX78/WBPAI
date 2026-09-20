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
    const profileTimer = setTimeout(() => setStage(1), 900);
    const identityTimer = setTimeout(() => setStage(2), 1900);
    const exitTimer = setTimeout(() => setFadeOut(true), 3600);
    const navigationTimer = setTimeout(() => navigate("/dashboard/new"), 4100);

    return () => {
      clearTimeout(profileTimer);
      clearTimeout(identityTimer);
      clearTimeout(exitTimer);
      clearTimeout(navigationTimer);
    };
  }, [navigate]);

  return (
    <div
      className={`relative min-h-screen overflow-hidden bg-black transition-opacity duration-500 ${
        fadeOut ? "opacity-0" : "opacity-100"
      }`}
    >
      <img
        src="/images/house.jpg"
        alt="Whole Build Profile property"
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-0 bg-white/80" />

      <main className="relative z-10 flex min-h-screen flex-col justify-between px-6 py-8 sm:px-10 sm:py-10 lg:px-16 lg:py-14">
        <header className="flex items-center justify-between border-b border-black pb-4">
          <p className="text-xs font-bold uppercase sm:text-sm">
            Whole Build Profile
          </p>
          <p className="text-[10px] font-semibold uppercase text-gray-600 sm:text-xs">
            Building intelligence
          </p>
        </header>

        <section className="mx-auto w-full max-w-6xl py-12 sm:py-16">
          <p className="mb-3 text-xs font-semibold uppercase text-gray-600 sm:text-sm">
            From property to verified profile
          </p>
          <h1 className="max-w-4xl text-4xl font-bold leading-tight sm:text-6xl lg:text-7xl">
            Whole Build Profile
          </h1>

          <div className="mt-10 grid max-w-4xl grid-cols-[1fr_auto_1fr] items-center gap-3 sm:mt-14 sm:gap-6">
            <div className={`wbp-landing-stage ${stage >= 1 ? "is-active" : ""}`}>
              <span className="text-[10px] font-semibold uppercase text-gray-500">01</span>
              <strong className="mt-1 block text-lg sm:text-2xl">New profile</strong>
              <span className="mt-2 block h-1 bg-black" />
            </div>
            <div className="relative h-px w-8 overflow-hidden bg-gray-400 sm:w-24">
              <span className={`absolute inset-y-0 left-0 bg-black transition-[width] duration-700 ${stage >= 2 ? "w-full" : "w-0"}`} />
            </div>
            <div className={`wbp-landing-stage ${stage >= 2 ? "is-active" : ""}`}>
              <span className="text-[10px] font-semibold uppercase text-gray-500">02</span>
              <strong className="mt-1 block text-lg sm:text-2xl">WBP-001</strong>
              <span className="mt-2 block h-1 bg-emerald-700" />
            </div>
          </div>

          <div className="mt-10 flex flex-wrap gap-3 sm:mt-12">
            <button
              type="button"
              onClick={() => navigate("/dashboard/new")}
              className="border border-black bg-black px-5 py-3 text-sm font-semibold text-white hover:bg-gray-800"
            >
              Create new profile
            </button>
            <button
              type="button"
              onClick={() => navigate("/dashboard/cc")}
              className="border border-black bg-white px-5 py-3 text-sm font-semibold text-black hover:bg-gray-100"
            >
              Open WBP-001
            </button>
          </div>
        </section>

        <footer className="flex items-end justify-between gap-5 border-t border-black pt-4 text-[10px] font-semibold uppercase text-gray-600 sm:text-xs">
          <span>Evidence-led retrofit intelligence</span>
          <span>New → WBP-001</span>
        </footer>
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
