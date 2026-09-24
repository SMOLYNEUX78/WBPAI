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
  supabase.from.mockImplementation(() => ({
    select: () => ({
      order: () => Promise.resolve({ data: [], error: null }),
      eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
    }),
    upsert: () => Promise.resolve({ error: null }),
  }));
  supabase.rpc.mockResolvedValue({ data: [], error: null });
});

test.each(["architect", "builder"])("%s portfolio shows saved organisation details without an edit control", async (role) => {
  const session = { user: { id: "profile-test-user", email: "wbpai25@gmail.com" } };
  supabase.auth.getSession.mockResolvedValue({ data: { session } });
  supabase.auth.getUser.mockResolvedValue({ data: { user: session.user } });
  supabase.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  window.localStorage.setItem(`wbp-${role}-profile-${session.user.id}`, JSON.stringify({ organisationName: "Original organisation", registrationNumber: "12345", phone: "01234 567890", address: "1 High Street", city: "Woodbridge", postcode: "IP12 1AA", serviceArea: "Suffolk" }));
  window.history.pushState({}, "", `/workspace/${role}`);

  render(<App />);
  expect(await screen.findByRole("heading", { name: "Original organisation" })).toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: "Prototype pages" })).not.toBeInTheDocument();
  expect(screen.getByText("WBP Prototype").closest(".wbp-professional-sticky")).toContainElement(screen.getByText(role === "architect" ? "Design intent and specification" : "Delivery, quality and commissioning"));
  expect(screen.getByText(role === "architect" ? "Design intent and specification" : "Delivery, quality and commissioning").closest(".wbp-professional-stage-banner")).toHaveClass(role === "architect" ? "is-design" : "is-build");
  expect(screen.queryByText(role === "architect" ? "Design portfolio" : "Build portfolio")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Edit profile" })).not.toBeInTheDocument();
  expect(screen.getByText("01234 567890")).toBeInTheDocument();
  expect(screen.getByText("1 High Street, Woodbridge, IP12 1AA")).toBeInTheDocument();
  expect(screen.getByText("Suffolk")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Original organisation" })).toBeInTheDocument();
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
