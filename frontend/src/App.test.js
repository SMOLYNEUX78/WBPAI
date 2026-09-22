import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import supabase from "./supabaseClient";

jest.mock("./supabaseClient", () => ({
  from: jest.fn(() => ({ select: jest.fn(() => ({ order: jest.fn().mockResolvedValue({ data: [], error: null }) })) })),
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
  supabase.from.mockImplementation(() => ({ select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }));
});

test.each(["architect", "builder"])("%s portfolio profile can be edited and saved", async (role) => {
  const session = { user: { id: "profile-test-user", email: "wbpai25@gmail.com" } };
  supabase.auth.getSession.mockResolvedValue({ data: { session } });
  supabase.auth.getUser.mockResolvedValue({ data: { user: session.user } });
  supabase.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  window.localStorage.setItem(`wbp-${role}-profile-${session.user.id}`, JSON.stringify({ organisationName: "Original organisation", registrationNumber: "12345" }));
  window.history.pushState({}, "", `/workspace/${role}`);

  render(<App />);
  expect(await screen.findByRole("heading", { name: "Original organisation" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Organisation name" }), { target: { value: "Updated organisation" } });
  fireEvent.click(screen.getByRole("button", { name: "Save profile" }));

  expect(screen.getByRole("heading", { name: "Updated organisation" })).toBeInTheDocument();
  expect(JSON.parse(window.localStorage.getItem(`wbp-${role}-profile-${session.user.id}`)).organisationName).toBe("Updated organisation");
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
  fireEvent.click(screen.getByRole("button", { name: "Evidence" }));
  expect(screen.getByRole("heading", { name: "Drawings, models and evidence" })).toBeInTheDocument();
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
