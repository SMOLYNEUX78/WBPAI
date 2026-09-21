import React, { useEffect, useState } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  useNavigate,
} from "react-router-dom";
import BuildingDashboard from "./pages/performance/BuildingDashboard";

const PROFILE_SIGNALS = ["Building", "Energy", "Health", "Evidence"];

const ACCESS_ROLES = [
  {
    id: "architect",
    label: "Architect",
    phase: "Design",
    detail: "Design intent, specifications and compliance evidence",
  },
  {
    id: "builder",
    label: "Builder",
    phase: "Build",
    detail: "Delivery records, materials, quality checks and commissioning",
  },
  {
    id: "homeowner",
    label: "Homeowner",
    phase: "Occupancy",
    detail: "Handover, operation, comfort and post-occupancy performance",
  },
];

const BUILDING_PHASES = ["Design", "Procurement", "Build", "Commission", "Occupancy"];

const SplashScreen = () => {
  const navigate = useNavigate();
  const [stage, setStage] = useState(0);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    const assembleTimer = setTimeout(() => setStage(1), 350);
    const resolveTimer = setTimeout(() => setStage(2), 1750);
    const signalTimer = setTimeout(() => setStage(4), 2500);
    const verifyTimer = setTimeout(() => setStage(5), 4450);
    const exitTimer = setTimeout(() => setFadeOut(true), 5700);
    const navigationTimer = setTimeout(() => navigate("/login"), 6100);

    return () => {
      clearTimeout(assembleTimer);
      clearTimeout(resolveTimer);
      clearTimeout(signalTimer);
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
      <img
        className="wbp-splash-image"
        src="/images/wbp-architecture-splash.jpg"
        alt=""
        aria-hidden="true"
      />
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
          <div className="wbp-profile-status">
            <span className="wbp-status-marker" aria-hidden="true" />
            <span>Building Confidence</span>
          </div>
        </div>
      </main>
    </div>
  );
};

const RoleGateway = () => {
  const navigate = useNavigate();
  const [selectedRole, setSelectedRole] = useState("architect");
  const [email, setEmail] = useState("");
  const activeRole = ACCESS_ROLES.find((role) => role.id === selectedRole);

  const openWorkspace = (event) => {
    event.preventDefault();
    window.localStorage.setItem("wbp-user-role", selectedRole);
    window.localStorage.setItem("wbp-user-email", email.trim());
    navigate(`/dashboard/new?role=${selectedRole}&phase=${activeRole.phase.toLowerCase()}`);
  };

  return (
    <main className="wbp-access-shell">
      <section className="wbp-access-header">
        <div>
          <span className="wbp-access-mark">WBP</span>
          <p>Whole Build Profile</p>
        </div>
        <span className="wbp-access-state">Building record access</span>
      </section>

      <section className="wbp-access-layout">
        <div className="wbp-access-intro">
          <p className="wbp-access-kicker">One building. One continuous record.</p>
          <h1>Continue the profile from design to post-occupancy.</h1>
          <p className="wbp-access-copy">
            Each project contributor records the decisions, evidence and measured
            outcomes they are responsible for.
          </p>

          <ol className="wbp-lifecycle" aria-label="Building lifecycle">
            {BUILDING_PHASES.map((phase, index) => (
              <li className={phase === activeRole.phase ? "is-active" : ""} key={phase}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                {phase}
              </li>
            ))}
          </ol>
        </div>

        <form className="wbp-access-panel" onSubmit={openWorkspace}>
          <div>
            <p className="wbp-access-kicker">Sign in as</p>
            <h2>Select your project role</h2>
          </div>

          <div className="wbp-role-selector" role="radiogroup" aria-label="Project role">
            {ACCESS_ROLES.map((role) => (
              <button
                type="button"
                role="radio"
                aria-checked={selectedRole === role.id}
                className={selectedRole === role.id ? "is-selected" : ""}
                key={role.id}
                onClick={() => setSelectedRole(role.id)}
              >
                {role.label}
              </button>
            ))}
          </div>

          <div className="wbp-role-summary">
            <span>{activeRole.phase} workspace</span>
            <p>{activeRole.detail}</p>
          </div>

          <label className="wbp-access-field">
            <span>Email address</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@organisation.co.uk"
              required
            />
          </label>

          <label className="wbp-access-field">
            <span>Password</span>
            <input type="password" placeholder="Enter password" required />
          </label>

          <button className="wbp-access-submit" type="submit">
            Open workspace
            <span aria-hidden="true">&#8594;</span>
          </button>

          <p className="wbp-access-note">
            Prototype access screen. Secure organisation accounts will be connected
            before live project use.
          </p>
        </form>
      </section>
    </main>
  );
};

const App = () => (
  <Router>
    <Routes>
      <Route path="/" element={<SplashScreen />} />
      <Route path="/login" element={<RoleGateway />} />
      <Route path="/dashboard/*" element={<BuildingDashboard />} />
    </Routes>
  </Router>
);

export default App;
