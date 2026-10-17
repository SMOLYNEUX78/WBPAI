import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import BaselineDataPanel from "./BaselineDataPanel";

const Surface = ({ title, children, onClose }) => <div role="dialog" aria-label={title}>{children}<button type="button" onClick={onClose}>Close</button></div>;

test("sell baseline data opens a buyer-fit window without claiming a live sale", () => {
  render(<BaselineDataPanel DetailSurface={Surface} baseline={{ annualEui: 42.3, energyScore: 74, healthScore: 80, meteredDays: 90, auditScore: 70, authorityReady: false }} />);
  expect(screen.getByText(/live confidence and sale permissions are unchanged/)).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Sell baseline data" }));
  expect(screen.getByRole("dialog", { name: "Sell baseline data" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Baseline sales stages" })).toBeInTheDocument();
  expect(screen.getByText(/independent audit is not assumed for an ordinary data licence/)).toBeInTheDocument();
  expect(screen.getByText(/42.3 kWh\/m²\/yr/)).toBeInTheDocument();
  expect(screen.getByText(/Verify ownership or delegated authority/)).toBeInTheDocument();
  expect(screen.getByText(/Complete the audit evidence pack/)).toBeInTheDocument();
  expect(screen.getByText(/not live matches or offers/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Grid and flexibility partners" }));
  expect(screen.getByText(/baseline alone does not prove dispatchable flexibility/)).toBeInTheDocument();
  expect(screen.getByText(/working smart meter, controllable load/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("owner export needs a saved building record", () => {
  render(<BaselineDataPanel DetailSurface={Surface} />);
  fireEvent.click(screen.getByRole("button", { name: "Sell baseline data" }));
  fireEvent.click(screen.getByRole("button", { name: "Review measured export" }));
  expect(screen.getByRole("alert")).toHaveTextContent(/Save this building profile/);
});
