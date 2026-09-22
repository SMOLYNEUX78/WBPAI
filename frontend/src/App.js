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
    label: "Design",
    phase: "Design",
    detail: "Create the building record, design intent and compliance evidence",
    position: "left",
  },
  {
    id: "builder",
    label: "Build",
    phase: "Build",
    detail: "Continue the record through delivery, quality checks and commissioning",
    position: "center",
  },
  {
    id: "homeowner",
    label: "Occupy",
    phase: "Occupy",
    detail: "Start or import a record for handover and post-occupancy performance",
    position: "right",
  },
];

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
            <span>Whole Build Profile</span>
          </div>
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
  const [selectedRole, setSelectedRole] = useState("");
  const [authMode, setAuthMode] = useState("signin");
  const [occupyMode, setOccupyMode] = useState("new");
  const [email, setEmail] = useState("");
  const activeRole = ACCESS_ROLES.find((role) => role.id === selectedRole);

  const openWorkspace = (event) => {
    event.preventDefault();
    window.localStorage.setItem("wbp-user-role", selectedRole);
    window.localStorage.setItem("wbp-user-email", email.trim());
    navigate(`/dashboard/new?role=${selectedRole}&phase=${activeRole.phase.toLowerCase()}&record=${occupyMode}`);
  };

  return (
    <main className="wbp-access-shell">
      <section className="wbp-access-header">
        <span className="wbp-access-mark">Whole Build Profile</span>
      </section>

      <section className="wbp-access-intro">
        <p>Building Trust</p>
        <h1>A digital ecosystem incentivising better outcomes</h1>
      </section>

      <section className="wbp-route-bands" aria-label="Choose a building lifecycle stage">
        {ACCESS_ROLES.map((role, index) => (
          <button
            type="button"
            className={`wbp-route-band is-${role.position}`}
            key={role.id}
            onClick={() => setSelectedRole(role.id)}
          >
            <span className="wbp-route-number">0{index + 1}</span>
            <span className="wbp-route-copy">
              <strong>{role.label}</strong>
              <small>{role.detail}</small>
            </span>
            <span className="wbp-route-arrow" aria-hidden="true">&#8594;</span>
          </button>
        ))}
      </section>

      {activeRole ? (
        <div className="wbp-auth-backdrop" role="presentation" onMouseDown={() => setSelectedRole("")}>
          <section
            className="wbp-auth-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wbp-auth-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="wbp-auth-close"
              aria-label="Close"
              onClick={() => setSelectedRole("")}
            >
              &#215;
            </button>

            <div className="wbp-auth-heading">
              <p>{activeRole.label} workspace</p>
              <h2 id="wbp-auth-title">
                {authMode === "signin" ? "Welcome back" : "Create your account"}
              </h2>
              <span>{activeRole.detail}</span>
            </div>

            <div className="wbp-auth-tabs" role="tablist" aria-label="Account access">
              <button type="button" className={authMode === "signin" ? "is-active" : ""} onClick={() => setAuthMode("signin")}>Sign in</button>
              <button type="button" className={authMode === "signup" ? "is-active" : ""} onClick={() => setAuthMode("signup")}>Sign up</button>
            </div>

            <form className="wbp-auth-form" onSubmit={openWorkspace}>
              {authMode === "signup" ? (
                <label className="wbp-access-field">
                  <span>Full name</span>
                  <input type="text" placeholder="Your name" required />
                </label>
              ) : null}

              <label className="wbp-access-field">
                <span>Email address</span>
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@organisation.co.uk" required />
              </label>

              <label className="wbp-access-field">
                <span>Password</span>
                <input type="password" placeholder="Enter password" required />
              </label>

              {selectedRole === "homeowner" ? (
                <fieldset className="wbp-record-choice">
                  <legend>Building record</legend>
                  <label className={occupyMode === "new" ? "is-selected" : ""}>
                    <input type="radio" name="record" value="new" checked={occupyMode === "new"} onChange={() => setOccupyMode("new")} />
                    <span><strong>Start a new record</strong><small>Create a profile for an existing home.</small></span>
                  </label>
                  <label className={occupyMode === "import" ? "is-selected" : ""}>
                    <input type="radio" name="record" value="import" checked={occupyMode === "import"} onChange={() => setOccupyMode("import")} />
                    <span><strong>Import a handed-over record</strong><small>Continue a profile created during Design or Build.</small></span>
                  </label>
                  {occupyMode === "import" ? <input className="wbp-record-code" type="text" placeholder="WBP record or handover code" required /> : null}
                </fieldset>
              ) : null}

              <button className="wbp-access-submit" type="submit">
                {authMode === "signin" ? "Open workspace" : "Create account"}
                <span aria-hidden="true">&#8594;</span>
              </button>
            </form>
          </section>
        </div>
      ) : null}
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
