import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "./App";
import supabase from "./supabaseClient";

jest.mock("./supabaseClient", () => ({
  from: jest.fn(() => ({ select: jest.fn(() => ({ order: jest.fn().mockResolvedValue({ data: [], error: null }) })) })),
  rpc: jest.fn().mockResolvedValue({ data: [], error: null }),
  auth: {
    getSession: jest.fn(),
    getUser: jest.fn(),
    onAuthStateChange: jest.fn(),
    signInWithOtp: jest.fn(),
    signInWithPassword: jest.fn(),
    updateUser: jest.fn(),
    signOut: jest.fn(),
  },
}));
jest.mock("./pages/performance/BuildingDashboard", () => () => "Dashboard test view");

beforeEach(() => {
  window.localStorage.removeItem("wbp-auth-intent:v1");
  supabase.from.mockImplementation(() => ({
    select: () => ({
      order: () => Promise.resolve({ data: [], error: null }),
      eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
    }),
    upsert: () => Promise.resolve({ error: null }),
  }));
  supabase.rpc.mockResolvedValue({ data: [], error: null });
});

test.each(["architect", "builder"])("%s portfolio shows saved organisation details", async (role) => {
  const session = { user: { id: "profile-test-user", email: "wbpai25@gmail.com" } };
  supabase.auth.getSession.mockResolvedValue({ data: { session } });
  supabase.auth.getUser.mockResolvedValue({ data: { user: session.user } });
  supabase.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  window.localStorage.setItem(`wbp-${role}-profile-${session.user.id}`, JSON.stringify({ organisationName: "Original organisation", registrationNumber: "12345", phone: "01234 567890", address: "1 High Street", city: "Woodbridge", postcode: "IP12 1AA", serviceArea: "Suffolk" }));
  window.history.pushState({}, "", `/workspace/${role}`);

  render(<App />);
  expect(await screen.findByRole("heading", { name: "Original organisation" })).toBeInTheDocument();
  if (role === "builder") expect(screen.getByText("WBP Prototype").closest(".wbp-professional-sticky")).toContainElement(screen.getByText("Delivery, quality and commissioning"));
  else expect(screen.getByRole("navigation", { name: "Prototype pages" })).toBeInTheDocument();
  expect(screen.getByText(role === "architect" ? "Design intent and specification" : "Delivery, quality and commissioning").closest(".wbp-professional-stage-banner")).toHaveClass(role === "architect" ? "is-design" : "is-build");
  expect(screen.queryByText(role === "architect" ? "Design portfolio" : "Build portfolio")).not.toBeInTheDocument();
  if (role === "builder") expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  else expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  expect(screen.getByText("01234 567890")).toBeInTheDocument();
  expect(screen.getByText("1 High Street, Woodbridge, IP12 1AA")).toBeInTheDocument();
  expect(screen.getByText("Suffolk")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Original organisation" })).toBeInTheDocument();
});

test("Design banner edits are saved to the account profile", async () => {
  const session = { user: { id: "edit-user", email: "wbpai25@gmail.com" } };
  supabase.auth.getSession.mockResolvedValue({ data: { session } });
  supabase.auth.getUser.mockResolvedValue({ data: { user: session.user } });
  supabase.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  const upsert = jest.fn().mockResolvedValue({ error: null });
  supabase.from.mockImplementation((table) => table === "WBPWorkspaceProfiles"
    ? { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { profile: { organisationName: "Old Studio", address: "1 High Street", city: "Woodbridge", postcode: "IP12 1AA" } }, error: null }) }) }) }), upsert }
    : { select: () => ({ order: async () => ({ data: [], error: null }) }) });
  window.history.pushState({}, "", "/workspace/architect");
  render(<App />);
  await screen.findByRole("heading", { name: "Old Studio" });
  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  const form = screen.getByRole("form", { name: "Edit Design profile" });
  fireEvent.change(within(form).getByLabelText("Organisation name"), { target: { value: "New Studio" } });
  fireEvent.click(within(form).getByRole("button", { name: "Save profile" }));
  expect(await screen.findByRole("heading", { name: "New Studio" })).toBeInTheDocument();
  expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "edit-user", workspace_role: "architect", profile: expect.objectContaining({ organisationName: "New Studio" }) }), { onConflict: "user_id,workspace_role" });
});

test("Design profile image and requested stages can be changed", async () => {
  const session = { user: { id: "image-edit-user", email: "wbpai25@gmail.com" } };
  supabase.auth.getSession.mockResolvedValue({ data: { session } });
  supabase.auth.getUser.mockResolvedValue({ data: { user: session.user } });
  supabase.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  const upsert = jest.fn().mockResolvedValue({ error: null });
  supabase.from.mockImplementation((table) => table === "WBPWorkspaceProfiles"
    ? { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { profile: { organisationName: "Old Studio", requestedStages: ["architect"] } }, error: null }) }) }) }), upsert }
    : { select: () => ({ order: async () => ({ data: [], error: null }) }) });
  window.history.pushState({}, "", "/workspace/architect");
  render(<App />);
  await screen.findByRole("heading", { name: "Old Studio" });
  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  const form = screen.getByRole("form", { name: "Edit Design profile" });
  fireEvent.change(within(form).getByLabelText("Company logo / profile image"), { target: { files: [new File(["image"], "logo.png", { type: "image/png" })] } });
  fireEvent.click(within(form).getByLabelText("Build"));
  await waitFor(() => expect(within(form).getByAltText("Current profile")).toBeInTheDocument());
  fireEvent.click(within(form).getByRole("button", { name: "Save profile" }));
  await waitFor(() => expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ profile: expect.objectContaining({ logoName: "logo.png", logoDataUrl: expect.stringContaining("data:image/png;base64,"), requestedStages: ["architect", "builder"] }) }), { onConflict: "user_id,workspace_role" }));
});

test("saved provisional designer shows account matches and records an owner selection", async () => {
  const session = { user: { id: "home-owner", email: "owner@example.com" } };
  supabase.auth.getSession.mockResolvedValue({ data: { session } });
  supabase.auth.getUser.mockResolvedValue({ data: { user: session.user } });
  supabase.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  const candidate = { profile_ref: "00000000-0000-0000-0000-000000000001", organisation_name: "A. W. J. Mullins", city: "Woodbridge", postcode: "IP12 1AA", registration_number: "12345" };
  supabase.rpc.mockResolvedValue({ data: [candidate], error: null });
  const upsert = jest.fn().mockResolvedValue({ error: null });
  supabase.from.mockImplementation((table) => table === "WBPProvisionalOrganisationProjects"
    ? { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { organisation_name: "A. W. J. Mullins" }, error: null }) }) }) }) }) }
    : { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { setup_data: { historicalStages: { design: { architectPractice: "A. W. J. Mullins" } } } }, error: null }) }) }), upsert });
  window.history.pushState({}, "", "/workspace/design-match/00000000-0000-0000-0000-000000000002");
  render(<App />);
  expect(await screen.findByRole("heading", { name: "Potential Design account matches" })).toBeInTheDocument();
  expect(await screen.findByRole("link", { name: "View account profile" })).toHaveAttribute("href", "/workspace/design-profile/00000000-0000-0000-0000-000000000001");
  fireEvent.click(screen.getByRole("button", { name: "Use this practice" }));
  await waitFor(() => expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ setup_data: expect.objectContaining({ historicalStages: expect.objectContaining({ design: expect.objectContaining({ designProfileRef: candidate.profile_ref }) }) }) }), { onConflict: "building_record_id" }));
  expect(await screen.findByText(/Its involvement is still unverified/)).toBeInTheDocument();
});

test("opening your own matched Design profile goes to the full portfolio", async () => {
  const session = { user: { id: "00000000-0000-0000-0000-000000000001", email: "wbpai25@gmail.com" } };
  supabase.auth.getSession.mockResolvedValue({ data: { session } });
  supabase.auth.getUser.mockResolvedValue({ data: { user: session.user } });
  supabase.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  window.localStorage.setItem(`wbp-architect-profile-${session.user.id}`, JSON.stringify({ organisationName: "Mullins Dowse" }));
  window.history.pushState({}, "", `/workspace/design-profile/${session.user.id}`);

  render(<App />);
  expect(await screen.findByRole("heading", { name: "Mullins Dowse" })).toBeInTheDocument();
  expect(window.location.pathname).toBe("/workspace/architect");
  expect(supabase.rpc).not.toHaveBeenCalledWith("wbp_design_profile_preview", expect.anything());
});

test("architect profile loads from the account without browser cache", async () => {
  const session = { user: { id: "cloud-user", email: "wbpai25@gmail.com" } };
  supabase.auth.getSession.mockResolvedValue({ data: { session } });
  supabase.auth.getUser.mockResolvedValue({ data: { user: session.user } });
  supabase.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  supabase.from.mockImplementation((table) => table === "WBPWorkspaceProfiles"
    ? { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { profile: { organisationName: "Cloud Studio", phone: "01234 000000" } }, error: null }) }) }) }) }
    : { select: () => ({ order: async () => ({ data: [], error: null }) }) });
  window.history.pushState({}, "", "/workspace/architect");

  render(<App />);
  expect(await screen.findByRole("heading", { name: "Cloud Studio" })).toBeInTheDocument();
  expect(screen.getByText("01234 000000")).toBeInTheDocument();
});

test("owner-linked home appears in the Design project register without private access", async () => {
  const session = { user: { id: "linked-designer", email: "wbpai25@gmail.com" } };
  supabase.auth.getSession.mockResolvedValue({ data: { session } });
  supabase.auth.getUser.mockResolvedValue({ data: { user: session.user } });
  supabase.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  supabase.rpc.mockImplementation((name) => Promise.resolve({ data: name === "wbp_design_linked_projects"
    ? [{ building_record_id: "home-1", record_reference: "WBP-001", site_address: "14 Bridgewood Road" }] : [], error: null }));
  window.localStorage.setItem(`wbp-architect-profile-${session.user.id}`, JSON.stringify({ organisationName: "Mullins Dowse" }));
  window.history.pushState({}, "", "/workspace/architect");

  render(<App />);
  const register = await screen.findByRole("table", { name: "Design projects" });
  expect(await within(register).findByText("14 Bridgewood Road")).toBeInTheDocument();
  expect(within(register).getByText("Owner linked · unverified")).toBeInTheDocument();
  fireEvent.click(within(register).getByText("14 Bridgewood Road"));
  expect(window.location.pathname).toBe("/workspace/occupy-profile/home-1");
});

test("Occupy sign-up collects the property draft before secure login", async () => {
  supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
  supabase.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  supabase.auth.signInWithOtp.mockResolvedValue({ error: null });
  window.history.pushState({}, "", "/login?role=homeowner&mode=signup");

  render(<App />);
  const dialog = await screen.findByRole("dialog", { name: "New property profile" });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Full name" }), { target: { value: "Alex Owner" } });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Property address" }), { target: { value: "14 Bridgewood Road" } });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Postcode" }), { target: { value: "IP12 4HA" } });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Email address" }), { target: { value: "alex@example.com" } });
  fireEvent.click(within(dialog).getByRole("button", { name: /Create account/ }));
  await waitFor(() => expect(supabase.auth.signInWithOtp).toHaveBeenCalled());
  expect(JSON.parse(window.localStorage.getItem("wbp-auth-intent:v1"))).toEqual(expect.objectContaining({
    propertyDraft: { address: "14 Bridgewood Road", postcode: "IP12 4HA" },
    profile: expect.objectContaining({ contactName: "Alex Owner" }),
  }));
});

test("Occupy entry opens the new property form ahead of sign-in", async () => {
  supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
  supabase.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  window.history.pushState({}, "", "/login");
  render(<App />);
  const occupy = await screen.findByRole("button", { name: /Occupy/ });
  await waitFor(() => expect(occupy).toBeEnabled());
  fireEvent.click(occupy);
  const dialog = screen.getByRole("dialog", { name: "New property profile" });
  expect(within(dialog).getByRole("textbox", { name: "Property address" })).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Sign in" })).toBeInTheDocument();
});

test("linked Occupy profile stays read-only for a separate Design account", async () => {
  const session = { user: { id: "designer-1", email: "designer@example.com" } };
  supabase.auth.getSession.mockResolvedValue({ data: { session } });
  supabase.auth.getUser.mockResolvedValue({ data: { user: session.user } });
  supabase.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  supabase.rpc.mockResolvedValue({ data: [{ building_record_id: "home-1", record_reference: "WBP-001", site_address: "14 Bridgewood Road" }], error: null });
  supabase.from.mockImplementation(() => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }));
  window.history.pushState({}, "", "/workspace/occupy-profile/home-1");

  render(<App />);
  expect(await screen.findByRole("heading", { name: "14 Bridgewood Road" })).toBeInTheDocument();
  expect(screen.getByText(/private evidence remain inaccessible/)).toBeInTheDocument();
});

test("saved portfolio image appears in the banner", async () => {
  const session = { user: { id: "logo-test-user", email: "wbpai25@gmail.com" } };
  supabase.auth.getSession.mockResolvedValue({ data: { session } });
  supabase.auth.getUser.mockResolvedValue({ data: { user: session.user } });
  supabase.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  window.localStorage.setItem(`wbp-architect-profile-${session.user.id}`, JSON.stringify({ organisationName: "Example Studio", organisationType: "Architectural practice", registrationNumber: "12345", logoDataUrl: "data:image/png;base64,iVBORw0KGgo=" }));
  window.history.pushState({}, "", "/workspace/architect");

  const { container } = render(<App />);
  expect(await screen.findByRole("heading", { name: "Example Studio" })).toBeInTheDocument();
  expect(container.querySelector(".wbp-organisation-logo img")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Edit profile" })).not.toBeInTheDocument();
});

test("Design new project opens a design-stage intake rather than the homeowner form", async () => {
  const session = { user: { id: "design-test-user", email: "wbpai25@gmail.com" } };
  supabase.auth.getSession.mockResolvedValue({ data: { session } });
  supabase.auth.getUser.mockResolvedValue({ data: { user: session.user } });
  supabase.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  window.history.pushState({}, "", "/workspace/architect");

  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: /New project/i }));
  expect(await screen.findByRole("heading", { name: "New design project" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Import existing project" })).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole("navigation", { name: "Design project sections" })).getByRole("button", { name: "Evidence" }));
  expect(screen.getByRole("heading", { name: "Existing documents" })).toBeInTheDocument();
  expect(window.location.pathname).toBe("/workspace/architect/project/new");
});

test("test account switches workspaces without requesting another email link", async () => {
  const session = { user: { id: "test-user", email: "wbpai25@gmail.com" } };
  supabase.auth.getSession.mockResolvedValue({ data: { session } });
  supabase.auth.getUser.mockResolvedValue({ data: { user: session.user } });
  supabase.auth.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: jest.fn() } },
  });
  window.history.pushState({}, "", "/login");

  render(<App />);
  const design = await screen.findByRole("button", { name: /Design Create the building record/i });
  await waitFor(() => expect(design).toBeEnabled());
  fireEvent.click(design);
  fireEvent.click(await screen.findByRole("button", { name: "Switch workspace" }));
  expect(window.location.pathname).toBe("/login");
  const occupy = await screen.findByRole("button", { name: /Occupy Start or import a record/i });
  await waitFor(() => expect(occupy).toBeEnabled());
  fireEvent.click(occupy);

  expect(await screen.findByText("Dashboard test view")).toBeInTheDocument();
  expect(supabase.auth.signInWithOtp).not.toHaveBeenCalled();
  expect(supabase.auth.signOut).not.toHaveBeenCalled();
});

test("test account signs in with a password without sending an email", async () => {
  const session = { user: { id: "test-user", email: "wbpai25@gmail.com" } };
  supabase.auth.getSession.mockResolvedValueOnce({ data: { session: null } }).mockResolvedValueOnce({ data: { session: null } }).mockResolvedValue({ data: { session } });
  supabase.auth.getUser.mockResolvedValue({ data: { user: session.user } });
  supabase.auth.signInWithPassword.mockResolvedValue({ data: { session }, error: null });
  supabase.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  window.history.pushState({}, "", "/login");

  render(<App />);
  const design = await screen.findByRole("button", { name: /Design Create the building record/i });
  await waitFor(() => expect(design).toBeEnabled());
  fireEvent.click(design);
  fireEvent.change(screen.getByRole("textbox", { name: "Company email address" }), { target: { value: "wbpai25@gmail.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a-long-test-password" } });
  fireEvent.click(screen.getByRole("button", { name: /Sign in with password/i }));

  expect(await screen.findByRole("button", { name: "Switch workspace" })).toBeInTheDocument();
  expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({ email: "wbpai25@gmail.com", password: "a-long-test-password" });
  expect(supabase.auth.signInWithOtp).not.toHaveBeenCalled();
});

test("signed-in test account can set a password", async () => {
  const session = { user: { id: "test-user", email: "wbpai25@gmail.com" } };
  supabase.auth.getSession.mockResolvedValue({ data: { session } });
  supabase.auth.updateUser.mockResolvedValue({ error: null });
  supabase.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  window.history.pushState({}, "", "/login");

  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Set test password" }));
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "a-long-test-password" } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "a-long-test-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Save password" }));

  await waitFor(() => expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: "a-long-test-password" }));
  expect(screen.getByText(/Password saved/)).toBeInTheDocument();
});

test("unapproved professional email cannot open a design workspace", async () => {
  const session = { user: { id: "pending-user", email: "person@example-studio.co.uk" } };
  supabase.auth.getSession.mockResolvedValue({ data: { session } });
  supabase.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  supabase.rpc.mockResolvedValue({ data: [{ request_status: "pending" }], error: null });
  window.history.pushState({}, "", "/workspace/architect/project/new");

  render(<App />);
  expect(await screen.findByRole("heading", { name: "Organisation access" })).toBeInTheDocument();
  expect(screen.getByText(/awaiting approval/)).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "New design project" })).not.toBeInTheDocument();
});
