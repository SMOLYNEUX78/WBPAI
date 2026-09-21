import React, { useEffect, useState } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  useNavigate,
} from "react-router-dom";
import BuildingDashboard from "./pages/performance/BuildingDashboard";

const PROFILE_SIGNALS = ["Building", "Energy", "Health", "Evidence"];

const SplashScreen = () => {
  const navigate = useNavigate();
  const [stage, setStage] = useState(0);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    const assembleTimer = setTimeout(() => setStage(1), 700);
    const resolveTimer = setTimeout(() => setStage(2), 1450);
    const verifyTimer = setTimeout(() => setStage(3), 4200);
    const exitTimer = setTimeout(() => setFadeOut(true), 5700);
    const navigationTimer = setTimeout(() => navigate("/dashboard/new"), 6100);

    return () => {
      clearTimeout(assembleTimer);
      clearTimeout(resolveTimer);
      clearTimeout(verifyTimer);
      clearTimeout(exitTimer);
      clearTimeout(navigationTimer);
    };
  }, [navigate]);

  return (
    <div
      className={`wbp-splash-shell ${fadeOut ? "is-exiting" : ""}`}
      aria-label="Whole Build Profile loading"
    >
      <video
        className="wbp-splash-video"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        aria-hidden="true"
        onCanPlay={(event) => {
          event.currentTarget.playbackRate = 1.35;
          event.currentTarget.play().catch(() => {});
        }}
      >
        <source src="/videos/wbp-architecture.mp4" type="video/mp4" />
      </video>
      <div className="wbp-splash-video-treatment" aria-hidden="true" />
      <main className={`wbp-splash-ident stage-${stage}`}>
        <div className="wbp-signal-stack" aria-hidden="true">
          {PROFILE_SIGNALS.map((signal, index) => (
            <div
              key={signal}
              className="wbp-signal-row"
              style={{ "--signal-index": index }}
            >
              <span className="wbp-signal-label">{signal}</span>
              <span className="wbp-signal-rule" />
              <span className="wbp-signal-state">0{index + 1}</span>
            </div>
          ))}
        </div>

        <div className="wbp-profile-lockup">
          <div className="wbp-profile-name">
            <strong>WBP</strong>
            <span>001</span>
          </div>
          <p>Whole Build Profile</p>
          <div className="wbp-verified-rule" aria-hidden="true">
            <span />
          </div>
          <div className="wbp-profile-status">
            <span className="wbp-status-marker" aria-hidden="true" />
            <span>{stage >= 3 ? "Profile verified" : "Assembling profile"}</span>
          </div>
        </div>
      </main>
    </div>
  );
};

const App = () => (
  <Router>
    <Routes>
      <Route path="/" element={<SplashScreen />} />
      <Route path="/dashboard/*" element={<BuildingDashboard />} />
    </Routes>
  </Router>
);

export default App;
