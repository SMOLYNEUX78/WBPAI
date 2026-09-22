import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import supabase from "./supabaseClient";

jest.mock("./supabaseClient", () => ({
  auth: {
    getSession: jest.fn(),
    getUser: jest.fn(),
    onAuthStateChange: jest.fn(),
    signInWithOtp: jest.fn(),
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
