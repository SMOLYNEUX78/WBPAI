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
import { isProfessionalEmailAllowed, TEST_PROFESSIONAL_EMAIL } from "./professionalEmail";
import { hasFullWorkspaceAccess, loadLinkedHistoricOutline } from "./workspaceAccess";

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
  const [existingSessionEmail, setExistingSessionEmail] = useState("");
  const [testSession, setTestSession] = useState(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [useTestEmailLink, setUseTestEmailLink] = useState(false);
  const [passwordSetupOpen, setPasswordSetupOpen] = useState(false);
  const [passwordSetupStatus, setPasswordSetupStatus] = useState("");
  const activeRole = ACCESS_ROLES.find((role) => role.id === selectedRole);
  const testPasswordSignIn = authMode === "signin" && email.trim().toLowerCase() === TEST_PROFESSIONAL_EMAIL && !useTestEmailLink;

  const setTestPassword = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const password = formData.get("password");
    if (password.length < 12 || password !== formData.get("confirmPassword")) {
      setPasswordSetupStatus("Use at least 12 characters and make sure both passwords match.");
      return;
    }
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData.session?.user.email?.toLowerCase() !== TEST_PROFESSIONAL_EMAIL) {
      setPasswordSetupStatus("Sign in to the test account on this device first.");
      return;
    }
    setPasswordSetupStatus("Saving password...");
    const { error } = await supabase.auth.updateUser({ password });
    setPasswordSetupStatus(error ? error.message : "Password saved. You can now sign in on your phone without an email link.");
    if (!error) form.reset();
  };

  const finishAuthenticatedAccess = useCallback(async (session, intent) => {
    if (!session?.user || !intent?.role) return;
    if (intent.role !== "homeowner" && !isProfessionalEmailAllowed(session.user.email)) {
      window.localStorage.removeItem(AUTH_INTENT_KEY);
      setAuthStatus("error");
      setAuthMessage("Use a company email address for Design or Build access.");
      return;
    }
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
      window.localStorage.setItem(`wbp-${intent.role}-profile-${session.user.id}`, JSON.stringify(intent.profile));
      window.localStorage.setItem(`wbp-organisation-profile-${session.user.id}`, JSON.stringify(intent.profile));
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
      if (!mounted) return;
      setTestSession(data.session?.user.email?.toLowerCase() === TEST_PROFESSIONAL_EMAIL ? data.session : null);
      setSessionReady(true);
      if (!data.session) return;
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
      setTestSession(session?.user.email?.toLowerCase() === TEST_PROFESSIONAL_EMAIL ? session : null);
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
    if (selectedRole !== "homeowner" && !isProfessionalEmailAllowed(email)) {
      setAuthStatus("error");
      setAuthMessage("Use a company email address for Design or Build access.");
      return;
    }
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
      requestedStages: formData.getAll("workspaceStages"),
    };
    const intent = {
      role: selectedRole,
      occupyMode,
      email: email.trim(),
      profile,
      authMode,
      createdAt: new Date().toISOString(),
    };
    const { data: currentSession } = await supabase.auth.getSession();
    if (currentSession.session) {
      const signedInEmail = currentSession.session.user.email || "";
      if (authMode === "signup" || signedInEmail.toLowerCase() !== email.trim().toLowerCase()) {
        setExistingSessionEmail(signedInEmail);
        setAuthStatus("error");
        setAuthMessage(`You're already signed in as ${signedInEmail}. Sign out before using another account.`);
        return;
      }
      await finishAuthenticatedAccess(currentSession.session, intent);
      return;
    }

    if (testPasswordSignIn) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: formData.get("password"),
      });
      if (error || !data.session) {
        setAuthStatus("error");
        setAuthMessage(error?.message || "Sign in failed. Check your password and try again.");
        return;
      }
      await finishAuthenticatedAccess(data.session, intent);
      return;
    }

    window.localStorage.setItem(AUTH_INTENT_KEY, JSON.stringify(intent));
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
      window.localStorage.removeItem(AUTH_INTENT_KEY);
      setAuthStatus("error");
      setAuthMessage(error.message);
      return;
    }
    setExistingSessionEmail("");
    setAuthStatus("sent");
    setAuthMessage(`We sent a secure sign-in link to ${email.trim()}. Open it on this device to continue.`);
  };

  return (
    <main className="wbp-access-shell">
      <section className="wbp-access-header">
        <span className="wbp-access-mark">Whole Build Profile</span>
        {testSession && <button type="button" className="wbp-test-password-trigger" onClick={() => { setPasswordSetupOpen(true); setPasswordSetupStatus(""); }}>Set test password</button>}
      </section>

      {passwordSetupOpen && testSession && (
        <div className="wbp-auth-backdrop" role="presentation" onMouseDown={() => setPasswordSetupOpen(false)}>
          <section className="wbp-auth-modal" role="dialog" aria-modal="true" aria-labelledby="wbp-password-title" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="wbp-auth-close" aria-label="Close" onClick={() => setPasswordSetupOpen(false)}>&#215;</button>
            <div className="wbp-auth-heading"><h2 id="wbp-password-title">Set test password</h2><span>For wbpai25@gmail.com. Use this password to sign in on other devices without an email link.</span></div>
            <form className="wbp-auth-form" onSubmit={setTestPassword}>
              <label className="wbp-access-field"><span>New password</span><input name="password" type="password" autoComplete="new-password" minLength="12" required /></label>
              <label className="wbp-access-field"><span>Confirm password</span><input name="confirmPassword" type="password" autoComplete="new-password" minLength="12" required /></label>
              {passwordSetupStatus && <p className="wbp-test-password-status" role="status">{passwordSetupStatus}</p>}
              <button className="wbp-access-submit" type="submit">Save password</button>
            </form>
          </section>
        </div>
      )}

      <section className="wbp-access-intro">
        <p>Building Trust</p>
        <h1>A digital ecosystem incentivising better outcomes</h1>
      </section>

      <section className="wbp-route-bands" aria-label="Choose a building lifecycle stage">
        {ACCESS_ROLES.map((role, index) => (
          <button
            type="button"
            disabled={!sessionReady}
            className={`wbp-route-band is-${role.position}`}
            key={role.id}
            onClick={() => {
              if (testSession) {
                finishAuthenticatedAccess(testSession, {
                  role: role.id,
                  email: testSession.user.email,
                  occupyMode: "new",
                });
              } else {
                setSelectedRole(role.id);
              }
            }}
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
                  <fieldset className="wbp-access-field wbp-field-wide">
                    <legend>Stages managed by your organisation</legend>
                    <div className="mt-2 flex flex-wrap gap-4 text-sm">
                      <label><input type="checkbox" name="workspaceStages" value="architect" defaultChecked={selectedRole === "architect"} /> Design</label>
                      <label><input type="checkbox" name="workspaceStages" value="builder" defaultChecked={selectedRole === "builder"} /> Build</label>
                      <label><input type="checkbox" name="workspaceStages" value="homeowner" /> Occupy</label>
                    </div>
                    <p className="mt-2 text-xs">Multiple stages can be requested, but switching is enabled only after organisation access is verified.</p>
                  </fieldset>
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
                <span>{selectedRole === "homeowner" ? "Email address" : "Company email address"}</span>
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder={selectedRole === "homeowner" ? "you@example.com" : "name@organisation.co.uk"} required />
              </label>

              {testPasswordSignIn && <label className="wbp-access-field"><span>Password</span><input name="password" type="password" autoComplete="current-password" required /></label>}
              {authMode === "signin" && email.trim().toLowerCase() === TEST_PROFESSIONAL_EMAIL && (
                <button type="button" className="wbp-test-link-toggle" onClick={() => { setUseTestEmailLink(!useTestEmailLink); setAuthStatus("idle"); setAuthMessage(""); }}>
                  {useTestEmailLink ? "Use password instead" : "Use email link instead"}
                </button>
              )}

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

              {authStatus === "error" && existingSessionEmail ? (
                <button type="button" className="wbp-access-submit" onClick={async () => {
                  await supabase.auth.signOut();
                  window.localStorage.removeItem(AUTH_INTENT_KEY);
                  setExistingSessionEmail("");
                  setAuthStatus("idle");
                  setAuthMessage("");
                }}>
                  Sign out of {existingSessionEmail}
                </button>
              ) : null}

              <button className="wbp-access-submit" type="submit" disabled={authStatus === "sending"}>
                {authStatus === "sending" ? (testPasswordSignIn ? "Signing in..." : "Sending secure link...") : testPasswordSignIn ? "Sign in with password" : authMode === "signin" ? "Email me a sign-in link" : "Create account"}
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

const WorkspaceSwitcher = ({ historicalOnly = false }) => {
  const navigate = useNavigate();
  const [access, setAccess] = useState({ loading: true, full: false, history: [], error: "" });
  const openRole = (role, path) => {
    window.localStorage.setItem("wbp-user-role", role);
    navigate(path);
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data, error } = await supabase.auth.getUser();
      if (!active) return;
      if (error || !data.user) {
        setAccess({ loading: false, full: false, history: [], error: "Your session has expired. Sign in again." });
        return;
      }
      try {
        const full = hasFullWorkspaceAccess(data.user);
        const history = full && !historicalOnly ? [] : await loadLinkedHistoricOutline(data.user);
        if (active) setAccess({ loading: false, full, history, error: "" });
      } catch (historyError) {
        if (active) setAccess({ loading: false, full: hasFullWorkspaceAccess(data.user), history: [], error: historyError.message });
      }
    };
    load();
    return () => { active = false; };
  }, [historicalOnly]);

  if (access.loading) return <main className="p-6 text-sm">Checking workspace access...</main>;
  if (historicalOnly && !access.history.length) return <main className="mx-auto max-w-5xl p-6"><h1 className="text-xl font-bold">Historic record unavailable</h1><p className="mt-2 text-sm">Link source evidence to your saved home profile before opening this view.</p><button type="button" className="mt-4 border px-4 py-2" onClick={() => openRole("homeowner", "/dashboard/new")}>Return to Occupy</button></main>;

  return <main className="mx-auto max-w-5xl space-y-6 p-5 sm:p-8">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
      <div><p className="text-xs font-semibold uppercase text-emerald-700">Whole Build Profile</p><h1 className="text-2xl font-bold">{historicalOnly ? "Historic building outline" : "Switch workspace"}</h1></div>
      <button type="button" className="border px-4 py-2 text-sm" onClick={() => openRole("homeowner", "/dashboard/new")}>Back to Occupy</button>
    </header>
    {access.error ? <p role="alert" className="border border-amber-300 bg-amber-50 p-3 text-sm">{access.error}</p> : null}
    {historicalOnly ? <>
      <p className="text-sm text-gray-600">Owner-linked source material only. These records are not a verified design, construction or professional handover record.</p>
      {access.history.map(({ building, links }) => <section key={building.id} className="border p-4">
        <h2 className="font-semibold">{building.address?.address || building.record_reference}</h2>
        <p className="text-xs text-gray-600">{building.record_reference} · Designer and builder identities remain unverified unless stated in a source.</p>
        <div className="mt-4 divide-y">{links.map((link, index) => <div key={`${link.documentationUrl}-${index}`} className="py-3 text-sm">
          <p className="font-semibold">{link.name}</p>
          <p className="text-gray-600">{link.stage === "build" ? "Build" : "Design"}{link.provider ? ` · ${link.provider} (owner supplied)` : " · Organisation not identified"}</p>
          <a href={link.documentationUrl} target="_blank" rel="noopener noreferrer" className="break-all text-blue-700 underline">View source</a>
        </div>)}</div>
      </section>)}
    </> : <div className="grid gap-3 sm:grid-cols-2">
      <button type="button" className="border p-5 text-left hover:border-emerald-600" onClick={() => openRole("homeowner", "/dashboard/new?role=homeowner&phase=occupy")}><strong className="block">Occupy</strong><span className="text-sm text-gray-600">Your home and measured performance</span></button>
      {access.full ? <>
        <button type="button" className="border p-5 text-left hover:border-emerald-600" onClick={() => openRole("architect", "/workspace/architect")}><strong className="block">Design</strong><span className="text-sm text-gray-600">Organisation design portfolio</span></button>
        <button type="button" className="border p-5 text-left hover:border-emerald-600" onClick={() => openRole("builder", "/workspace/builder")}><strong className="block">Build</strong><span className="text-sm text-gray-600">Organisation build portfolio</span></button>
      </> : null}
      {access.history.length ? <button type="button" className="border p-5 text-left hover:border-emerald-600" onClick={() => openRole("homeowner", "/workspace/history")}><strong className="block">Historic design &amp; build</strong><span className="text-sm text-gray-600">Read-only outline from sources linked to your home</span></button> : null}
    </div>}
  </main>;
};

const ProfessionalWorkspace = () => {
  const { role } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const isBuilder = role === "builder";
  const [profile, setProfile] = useState(location.state?.profile?.organisationName ? location.state.profile : {});
  const [profileUserId, setProfileUserId] = useState("");
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileDraft, setProfileDraft] = useState({});
  const [profileStatus, setProfileStatus] = useState("");
  const [isTestAccount, setIsTestAccount] = useState(false);
  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!active || !data.user) return;
      setProfileUserId(data.user.id);
      setIsTestAccount(data.user.email?.toLowerCase() === TEST_PROFESSIONAL_EMAIL);
      try {
        const cached = JSON.parse(window.localStorage.getItem(`wbp-${role}-profile-${data.user.id}`) || window.localStorage.getItem(`wbp-organisation-profile-${data.user.id}`) || "{}");
        setProfile(location.state?.profile?.organisationName ? location.state.profile : cached);
      } catch {
        setProfile({});
      }
    });
    return () => { active = false; };
  }, [role, location.state]);
  const organisationName = profile.organisationName || (isBuilder ? "Build organisation" : "Design organisation");
  const startProfileEdit = () => {
    setProfileDraft({ ...profile });
    setProfileStatus("");
    setEditingProfile(true);
  };
  const saveProfile = (event) => {
    event.preventDefault();
    if (!profileUserId) {
      setProfileStatus("Sign in again before saving your profile.");
      return;
    }
    const updated = Object.fromEntries(Object.entries(profileDraft).map(([key, value]) => [key, typeof value === "string" ? value.trim() : value]));
    window.localStorage.setItem(`wbp-${role}-profile-${profileUserId}`, JSON.stringify(updated));
    setProfile(updated);
    setEditingProfile(false);
    setProfileStatus("Profile saved in this browser. Organisation details remain unverified.");
  };
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
        <div className="wbp-professional-nav-actions">
          <button type="button" onClick={() => navigate("/login")}>Switch workspace</button>
          <button type="button" onClick={logOut}>Log out</button>
        </div>
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
          <span>{isTestAccount ? "Test account · Organisation not verified" : "Self-declared · Organisation not verified"}</span>
          <span>{profile.registrationNumber || "Registration pending"}</span>
          <span>{profile.city || "Head office pending"}</span>
          <button type="button" onClick={startProfileEdit} className="wbp-profile-edit-button">Edit profile</button>
        </div>
      </section>

      {editingProfile ? <form className="wbp-professional-profile-editor" onSubmit={saveProfile}>
        <div className="wbp-profile-editor-heading"><h2>Edit organisation profile</h2><p>Changes are saved in this browser and do not verify the organisation.</p></div>
        <div className="wbp-profile-editor-grid">
          {[
            ["organisationName", "Organisation name", true],
            ["organisationType", "Organisation type", true],
            ["registrationNumber", "Companies House / statutory registration", true],
            ["professionalRegistration", isBuilder ? "CIOB / FMB / professional registration" : "ARB / RIBA / professional registration"],
            ["vatNumber", "VAT number"],
            ["contactName", "Primary contact name"],
            ["jobTitle", "Primary contact role"],
            ["phone", "Telephone"],
            ["website", "Website"],
            ["address", "Head office address"],
            ["city", "Town / city"],
            ["postcode", "Postcode"],
            ["serviceArea", "Operating area"],
          ].map(([field, label, required]) => <label key={field} className="wbp-access-field"><span>{label}</span><input type={field === "website" ? "url" : field === "phone" ? "tel" : "text"} required={Boolean(required)} value={profileDraft[field] || ""} onChange={(event) => setProfileDraft((current) => ({ ...current, [field]: event.target.value }))} /></label>)}
        </div>
        <div className="wbp-profile-editor-actions"><button type="button" onClick={() => setEditingProfile(false)}>Cancel</button><button type="submit" className="is-primary">Save profile</button></div>
      </form> : null}
      {profileStatus ? <p className="wbp-profile-save-status" role="status">{profileStatus}</p> : null}

      <section className="wbp-workspace-actions">
        <button type="button" className="is-primary" onClick={() => navigate(`/dashboard/new?role=${role}&phase=${isBuilder ? "build" : "design"}`)}>
          + New project
        </button>
        {isBuilder ? (
          <button type="button" disabled title="Organisation verification is required before accepting a handover" onClick={() => setShowLinkRecord((current) => !current)}>Link design record</button>
        ) : (
          <button type="button" disabled title="Organisation verification is required before issuing a handover" onClick={() => setShowIssueHandover((current) => !current)}>Issue build handover</button>
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
          <div><p>Example projects</p><h2>{projects.length} sample records</h2></div>
          <input type="search" placeholder="Search projects" aria-label="Search projects" />
        </div>
        <div className="wbp-project-table" role="table" aria-label="Example projects">
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

const AuthenticatedRoute = ({ children, requireProfessionalEmail = false }) => {
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
      if (requireProfessionalEmail && !isProfessionalEmailAllowed(data.session.user.email)) {
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
      } else if (requireProfessionalEmail && !isProfessionalEmailAllowed(session.user.email)) {
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
  }, [navigate, requireProfessionalEmail]);

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
      <Route path="/workspaces" element={<AuthenticatedRoute><WorkspaceSwitcher /></AuthenticatedRoute>} />
      <Route path="/workspace/history" element={<AuthenticatedRoute><WorkspaceSwitcher historicalOnly /></AuthenticatedRoute>} />
      <Route path="/workspace/:role" element={<AuthenticatedRoute requireProfessionalEmail><ProfessionalWorkspace /></AuthenticatedRoute>} />
      <Route path="/dashboard/*" element={<AuthenticatedRoute><BuildingDashboard /></AuthenticatedRoute>} />
    </Routes>
  </Router>
);

export default App;
