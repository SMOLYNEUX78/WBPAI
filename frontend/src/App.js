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
      <main className="flex min-h-screen items-center justify-center px-5 py-8 sm:px-10">
        <section className={`wbp-plan-ident stage-${stage}`} aria-label="Whole Build Profile loading">
          <div className="wbp-plan-meta wbp-plan-meta-top" aria-hidden="true">
            <span>52.0945</span>
            <span>1.30488</span>
            <span>99.2 m2</span>
          </div>

          <div className="wbp-plan-canvas" aria-hidden="true">
            <span className="wbp-plan-line wbp-plan-line-top" />
            <span className="wbp-plan-line wbp-plan-line-right" />
            <span className="wbp-plan-line wbp-plan-line-bottom" />
            <span className="wbp-plan-line wbp-plan-line-left" />
            <span className="wbp-plan-line wbp-plan-line-room-a" />
            <span className="wbp-plan-line wbp-plan-line-room-b" />
            <span className="wbp-plan-line wbp-plan-line-room-c" />
            <span className="wbp-plan-line wbp-plan-line-room-d" />
            <span className="wbp-plan-node wbp-plan-node-a" />
            <span className="wbp-plan-node wbp-plan-node-b" />
            <span className="wbp-plan-node wbp-plan-node-c" />
            <span className="wbp-plan-node wbp-plan-node-d" />
            <span className="wbp-plan-axis wbp-plan-axis-x">01—04</span>
            <span className="wbp-plan-axis wbp-plan-axis-y">A—D</span>
            <div className="wbp-plan-wordmark">
              <strong>WBP</strong>
              <span>001</span>
            </div>
          </div>

          <div className="wbp-plan-copy">
            <p>Whole Build Profile</p>
            <span>{stage < 2 ? "Measuring building" : stage < 3 ? "Assembling evidence" : "Profile established"}</span>
          </div>

          <div className="wbp-plan-status" aria-hidden="true">
            <span className={stage >= 1 ? "is-complete" : ""}>Structure</span>
            <span className={stage >= 2 ? "is-complete" : ""}>Performance</span>
            <span className={stage >= 3 ? "is-complete" : ""}>Evidence</span>
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
