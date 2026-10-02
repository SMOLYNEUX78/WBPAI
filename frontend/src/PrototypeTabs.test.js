import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import PrototypeTabs from "./PrototypeTabs";

test("occupant prototype navigation starts with New and has no design or build tabs", () => {
  render(<MemoryRouter><PrototypeTabs activePath="/dashboard/new" /></MemoryRouter>);
  const tabs = screen.getByRole("navigation", { name: "Prototype pages" });
  expect(tabs.querySelector("button")).toHaveTextContent("New");
  expect(screen.queryByRole("button", { name: "Design" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Build" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Portfolio" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Exchange" })).not.toBeInTheDocument();
});

test("design prototype navigation contains the portfolio and exchange", () => {
  render(<MemoryRouter><PrototypeTabs scope="design" activePath="/workspace/architect" /></MemoryRouter>);
  expect(screen.getByRole("button", { name: "Portfolio" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Exchange" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "WBP-001cc" })).not.toBeInTheDocument();
});

test("Design New opens the stepped project setup route", () => {
  const CurrentPath = () => <p data-testid="current-path">{useLocation().pathname}</p>;
  render(<MemoryRouter initialEntries={["/workspace/architect"]}>
    <Routes><Route path="*" element={<><PrototypeTabs scope="design" activePath="/workspace/architect" /><CurrentPath /></>} /></Routes>
  </MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "New" }));
  expect(screen.getByTestId("current-path")).toHaveTextContent("/workspace/architect/project/new");
});
