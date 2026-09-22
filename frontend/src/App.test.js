import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import supabase from "./supabaseClient";

jest.mock("./supabaseClient", () => ({
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
