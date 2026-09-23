import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PrototypeTabs from "./PrototypeTabs";

test("occupant prototype navigation starts with New and has no design or build tabs", () => {
  render(<MemoryRouter><PrototypeTabs activePath="/dashboard/new" /></MemoryRouter>);
  const tabs = screen.getByRole("navigation", { name: "Prototype pages" });
  expect(tabs.querySelector("button")).toHaveTextContent("New");
  expect(screen.queryByRole("button", { name: "Design" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Build" })).not.toBeInTheDocument();
});
