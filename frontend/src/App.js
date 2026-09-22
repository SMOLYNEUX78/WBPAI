import React, { useCallback, useEffect, useState } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import BuildingDashboard from "./pages/performance/BuildingDashboard";
import supabase from "./supabaseClient";

const AUTH_INTENT_KEY = "wbp-auth-intent:v1";

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
  const [authStatus, setAuthStatus] = useState("idle");
  const [authMessage, setAuthMessage] = useState("");
  const activeRole = ACCESS_ROLES.find((role) => role.id === selectedRole);

  const finishAuthenticatedAccess = useCallback(async (session, intent) => {
    if (!session?.user || !intent?.role) return;
    window.localStorage.setItem("wbp-user-role", intent.role);
    window.localStorage.setItem("wbp-user-email", session.user.email || intent.email || "");

    if (intent.profile?.contactName) {
      await supabase.from("WBPUserProfiles").upsert({
        user_id: session.user.id,
        display_name: intent.profile.contactName,
        updated_at: new Date().toISOString(),
      });
    }

    if (intent.profile?.organisationName && intent.role !== "homeowner") {
      window.localStorage.setItem(`wbp-${intent.role}-profile`, JSON.stringify(intent.profile));
    }

    window.localStorage.removeItem(AUTH_INTENT_KEY);
    if (intent.role !== "homeowner") {
      navigate(`/workspace/${intent.role}`, { state: { profile: intent.profile || {} } });
      return;
    }

    navigate(`/dashboard/new?role=homeowner&phase=occupy&record=${intent.occupyMode || "new"}`);
  }, [navigate]);

  useEffect(() => {
    let mounted = true;
    const resumeAuthenticatedAccess = async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted || !data.session) return;
      let intent = null;
      try {
        intent = JSON.parse(window.localStorage.getItem(AUTH_INTENT_KEY) || "null");
      } catch {
        intent = null;
      }
      if (intent?.role) {
        await finishAuthenticatedAccess(data.session, intent);
      }
    };
    resumeAuthenticatedAccess();
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== "SIGNED_IN" || !session) return;
      let intent = null;
      try {
        intent = JSON.parse(window.localStorage.getItem(AUTH_INTENT_KEY) || "null");
      } catch {
        intent = null;
      }
      if (intent?.role) {
        window.setTimeout(() => finishAuthenticatedAccess(session, intent), 0);
      }
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [finishAuthenticatedAccess]);

  const openWorkspace = async (event) => {
    event.preventDefault();
    setAuthStatus("sending");
    setAuthMessage("");
    const formData = new FormData(event.currentTarget);
    const profile = {
      organisationName: formData.get("organisationName") || "",
      organisationType: formData.get("organisationType") || "",
      registrationNumber: formData.get("registrationNumber") || "",
      professionalRegistration: formData.get("professionalRegistration") || "",
      vatNumber: formData.get("vatNumber") || "",
      contactName: formData.get("fullName") || "",
      jobTitle: formData.get("jobTitle") || "",
      phone: formData.get("phone") || "",
      website: formData.get("website") || "",
      address: formData.get("address") || "",
      city: formData.get("city") || "",
      postcode: formData.get("postcode") || "",
      serviceArea: formData.get("serviceArea") || "",
      logoName: formData.get("logo")?.name || "",
    };
    const intent = {
      role: selectedRole,
      occupyMode,
      email: email.trim(),
      profile,
      authMode,
      createdAt: new Date().toISOString(),
    };
    window.localStorage.setItem(AUTH_INTENT_KEY, JSON.stringify(intent));

    const { data: currentSession } = await supabase.auth.getSession();
    if (currentSession.session) {
      await finishAuthenticatedAccess(currentSession.session, intent);
      return;
    }

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        shouldCreateUser: authMode === "signup",
        emailRedirectTo: `${window.location.origin}/login`,
        data: {
          role: selectedRole,
          display_name: profile.contactName || undefined,
        },
      },
    });
    if (error) {
      setAuthStatus("error");
      setAuthMessage(error.message);
      return;
    }
    setAuthStatus("sent");
    setAuthMessage(`We sent a secure sign-in link to ${email.trim()}. Open it on this device to continue.`);
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

            {authStatus === "sent" ? (
              <div className="wbp-auth-form" role="status">
                <div className="wbp-link-success">
                  <strong>Check your email</strong>
                  <p>{authMessage}</p>
                </div>
                <button type="button" className="wbp-access-submit" onClick={() => { setAuthStatus("idle"); setAuthMessage(""); }}>
                  Use a different email
                </button>
              </div>
            ) : (
            <form className="wbp-auth-form" onSubmit={openWorkspace}>
              {authMode === "signup" ? (
                <label className="wbp-access-field">
                  <span>Full name</span>
                  <input name="fullName" type="text" placeholder="Your name" required />
                </label>
              ) : null}

              {authMode === "signup" && selectedRole !== "homeowner" ? (
                <fieldset className="wbp-organisation-fields">
                  <legend>Organisation profile</legend>
                  <label className="wbp-access-field wbp-field-wide">
                    <span>Organisation name</span>
                    <input name="organisationName" type="text" placeholder="Registered organisation name" required />
                  </label>
                  <label className="wbp-access-field">
                    <span>Organisation type</span>
                    <select name="organisationType" required defaultValue="">
                      <option value="" disabled>Select type</option>
                      {selectedRole === "architect" ? (
                        <>
                          <option>Architectural practice</option>
                          <option>Local authority</option>
                          <option>Housing association</option>
                          <option>Design consultancy</option>
                          <option>Developer</option>
                        </>
                      ) : (
                        <>
                          <option>Main contractor</option>
                          <option>Specialist contractor</option>
                          <option>Developer / contractor</option>
                          <option>Local authority</option>
                          <option>Housing association</option>
                        </>
                      )}
                    </select>
                  </label>
                  <label className="wbp-access-field">
                    <span>Companies House / statutory registration</span>
                    <input name="registrationNumber" type="text" placeholder="Registration number" required />
                  </label>
                  <label className="wbp-access-field">
                    <span>{selectedRole === "architect" ? "ARB / RIBA / professional registration" : "CIOB / FMB / professional registration"}</span>
                    <input name="professionalRegistration" type="text" placeholder="Body and membership number" />
                  </label>
                  <label className="wbp-access-field">
                    <span>VAT number</span>
                    <input name="vatNumber" type="text" placeholder="Optional" />
                  </label>
                  <label className="wbp-access-field">
                    <span>Primary contact role</span>
                    <input name="jobTitle" type="text" placeholder="Director, project lead, contracts manager" required />
                  </label>
                  <label className="wbp-access-field">
                    <span>Telephone</span>
                    <input name="phone" type="tel" placeholder="Organisation telephone" required />
                  </label>
                  <label className="wbp-access-field wbp-field-wide">
                    <span>Website</span>
                    <input name="website" type="url" placeholder="https://" />
                  </label>
                  <label className="wbp-access-field wbp-field-wide">
                    <span>Head office address</span>
                    <input name="address" type="text" placeholder="Building and street" required />
                  </label>
                  <label className="wbp-access-field">
                    <span>Town / city</span>
                    <input name="city" type="text" required />
                  </label>
                  <label className="wbp-access-field">
                    <span>Postcode</span>
                    <input name="postcode" type="text" required />
                  </label>
                  <label className="wbp-access-field wbp-field-wide">
                    <span>Operating area</span>
                    <input name="serviceArea" type="text" placeholder="Regions or local authority areas served" required />
                  </label>
                  <label className="wbp-access-field wbp-field-wide">
                    <span>Company logo / profile image</span>
                    <input name="logo" type="file" accept="image/png,image/jpeg,image/webp" />
                  </label>
                </fieldset>
              ) : null}

              <label className="wbp-access-field">
                <span>Email address</span>
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@organisation.co.uk" required />
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

              {authStatus === "error" ? <p className="wbp-link-success" role="alert">{authMessage}</p> : null}

              <button className="wbp-access-submit" type="submit" disabled={authStatus === "sending"}>
                {authStatus === "sending" ? "Sending secure link..." : authMode === "signin" ? "Email me a sign-in link" : "Create account"}
                <span aria-hidden="true">&#8594;</span>
              </button>
            </form>
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
};

const ProfessionalWorkspace = () => {
  const { role } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const isBuilder = role === "builder";
  const storedProfile = (() => {
    try {
      return JSON.parse(window.localStorage.getItem(`wbp-${role}-profile`) || "{}");
    } catch {
      return {};
    }
  })();
  const profile = location.state?.profile?.organisationName ? location.state.profile : storedProfile;
  const organisationName = profile.organisationName || (isBuilder ? "Build organisation" : "Design organisation");
  const [showLinkRecord, setShowLinkRecord] = useState(false);
  const [showIssueHandover, setShowIssueHandover] = useState(false);
  const [linkCode, setLinkCode] = useState("");
  const [linkedRecord, setLinkedRecord] = useState("");
  const [handoverRecipient, setHandoverRecipient] = useState("");
  const [issuedHandover, setIssuedHandover] = useState(null);
  const projects = isBuilder
    ? [
        { id: "WBP-001", name: "14 Bridgewood Road", stage: "Pre-construction", status: "Design record available" },
        { id: "WBP-018", name: "Rendlesham Housing Phase 1", stage: "Build", status: "Evidence in progress" },
      ]
    : [
        { id: "WBP-001", name: "14 Bridgewood Road", stage: "Technical design", status: "Design record active" },
        { id: "WBP-014", name: "Felixstowe Homes Programme", stage: "Planning", status: "Client review" },
      ];

  const logOut = async () => {
    await supabase.auth.signOut();
    window.localStorage.removeItem("wbp-user-role");
    window.localStorage.removeItem("wbp-user-email");
    navigate("/login");
  };

  const issueDesignHandover = () => {
    const handover = {
      code: `WBP-HO-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      recordId: "WBP-001",
      from: organisationName,
      to: handoverRecipient.trim(),
      type: "design-to-build",
      status: "offered",
      issuedAt: new Date().toISOString(),
      transferableEvidence: [
        "Design intent",
        "Drawings and specifications",
        "Planning and compliance evidence",
        "Energy and performance model",
      ],
      excludedData: ["Personal client correspondence", "Occupant-private data"],
    };
    window.localStorage.setItem("wbp-pending-handover", JSON.stringify(handover));
    setIssuedHandover(handover);
  };

  const acceptDesignHandover = () => {
    let offeredHandover = null;
    try {
      offeredHandover = JSON.parse(window.localStorage.getItem("wbp-pending-handover") || "null");
    } catch {
      offeredHandover = null;
    }
    const acceptedCode = linkCode.trim();
    const isVerified = offeredHandover?.code === acceptedCode;
    const receipt = {
      ...(offeredHandover || {}),
      code: acceptedCode,
      status: isVerified ? "accepted" : "pending-verification",
      acceptedBy: organisationName,
      acceptedAt: new Date().toISOString(),
    };
    window.localStorage.setItem("wbp-latest-handover-receipt", JSON.stringify(receipt));
    setLinkedRecord(`${receipt.recordId || "WBP record"} · ${receipt.status.replaceAll("-", " ")}`);
  };

  return (
    <main className={`wbp-professional-shell is-${isBuilder ? "build" : "design"}`}>
      <header className="wbp-professional-nav">
        <strong>Whole Build Profile</strong>
        <button type="button" onClick={logOut}>Log out</button>
      </header>

      <section className="wbp-professional-hero">
        <div className="wbp-organisation-logo" aria-hidden="true">
          {profile.logoName ? profile.logoName.slice(0, 2).toUpperCase() : organisationName.slice(0, 2).toUpperCase()}
        </div>
        <div>
          <p>{isBuilder ? "Build portfolio" : "Design portfolio"}</p>
          <h1>{organisationName}</h1>
          <span>{profile.organisationType || (isBuilder ? "Contractor profile" : "Design practice profile")}</span>
        </div>
        <div className="wbp-organisation-meta">
          <span>{profile.registrationNumber || "Registration pending"}</span>
          <span>{profile.city || "Head office pending"}</span>
        </div>
      </section>

      <section className="wbp-workspace-actions">
        <button type="button" className="is-primary" onClick={() => navigate(`/dashboard/new?role=${role}&phase=${isBuilder ? "build" : "design"}`)}>
          + New project
        </button>
        {isBuilder ? (
          <button type="button" onClick={() => setShowLinkRecord((current) => !current)}>Link design record</button>
        ) : (
          <button type="button" onClick={() => setShowIssueHandover((current) => !current)}>Issue build handover</button>
        )}
      </section>

      {!isBuilder && showIssueHandover ? (
        <section className="wbp-link-record wbp-handover-panel">
          <div>
            <strong>Issue a controlled Design → Build handover</strong>
            <p>The building record remains intact while the selected evidence manifest is offered to the appointed contractor.</p>
          </div>
          <div>
            <input value={handoverRecipient} onChange={(event) => setHandoverRecipient(event.target.value)} placeholder="Appointed contractor organisation" />
            <button type="button" disabled={!handoverRecipient.trim()} onClick={issueDesignHandover}>Generate handover</button>
          </div>
          <div className="wbp-handover-manifest">
            <div><span>Transferable property evidence</span><p>Design intent · Drawings and specifications · Planning/compliance · Performance model</p></div>
            <div><span>Excluded private information</span><p>Personal correspondence · Occupant-private data</p></div>
          </div>
          {issuedHandover ? (
            <p className="wbp-link-success">Handover offered to {issuedHandover.to}. Code: <strong>{issuedHandover.code}</strong></p>
          ) : null}
        </section>
      ) : null}

      {isBuilder && showLinkRecord ? (
        <section className="wbp-link-record">
          <div>
            <strong>Continue an awarded design</strong>
            <p>Enter the WBP handover code supplied by the architect, client, local authority or housing association.</p>
          </div>
          <div>
            <input value={linkCode} onChange={(event) => setLinkCode(event.target.value)} placeholder="WBP design record code" />
            <button type="button" disabled={!linkCode.trim()} onClick={acceptDesignHandover}>Link record</button>
          </div>
          {linkedRecord ? <p className="wbp-link-success">{linkedRecord} linked to this Build portfolio.</p> : null}
        </section>
      ) : null}

      <section className="wbp-project-register">
        <div className="wbp-register-heading">
          <div><p>Registered projects</p><h2>{projects.length} active records</h2></div>
          <input type="search" placeholder="Search projects" aria-label="Search projects" />
        </div>
        <div className="wbp-project-table" role="table" aria-label="Registered projects">
          <div className="wbp-project-row is-heading" role="row">
            <span>WBP ID</span><span>Project</span><span>Stage</span><span>Status</span><span aria-hidden="true" />
          </div>
          {projects.map((project) => (
            <button className="wbp-project-row" type="button" role="row" key={project.id} onClick={() => navigate("/dashboard/new")}>
              <span>{project.id}</span><strong>{project.name}</strong><span>{project.stage}</span><span>{project.status}</span><span aria-hidden="true">&#8594;</span>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
};

const AuthenticatedRoute = ({ children }) => {
  const navigate = useNavigate();
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (!data.session) {
        navigate("/login", { replace: true });
        return;
      }
      setAuthReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      if (!session) {
        setAuthReady(false);
        navigate("/login", { replace: true });
      } else {
        setAuthReady(true);
      }
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [navigate]);

  if (!authReady) {
    return <main className="flex min-h-screen items-center justify-center bg-white text-sm font-semibold text-gray-600">Checking secure access...</main>;
  }
  return children;
};

const App = () => (
  <Router>
    <Routes>
      <Route path="/" element={<SplashScreen />} />
      <Route path="/login" element={<RoleGateway />} />
      <Route path="/workspace/:role" element={<AuthenticatedRoute><ProfessionalWorkspace /></AuthenticatedRoute>} />
      <Route path="/dashboard/*" element={<AuthenticatedRoute><BuildingDashboard /></AuthenticatedRoute>} />
    </Routes>
  </Router>
);

export default App;
