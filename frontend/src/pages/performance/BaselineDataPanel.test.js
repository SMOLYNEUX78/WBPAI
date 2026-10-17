import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import BaselineDataPanel from "./BaselineDataPanel";

const Surface = ({ title, children, onClose }) => <div role="dialog" aria-label={title}>{children}<button type="button" onClick={onClose}>Close</button></div>;

test("sell baseline data explains the status without claiming a live sale", () => {
  render(<BaselineDataPanel DetailSurface={Surface} baseline={{ annualEui: 42.3, energyScore: 74, healthScore: 80, meteredDays: 90, auditScore: 70, authorityReady: false }} />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Sell baseline data" }));
  expect(screen.getByRole("dialog", { name: "Sell baseline data" })).toBeInTheDocument();
  expect(screen.getByText("Not for sale yet")).toBeInTheDocument();
  expect(screen.getByText(/No data has been shared/)).toBeInTheDocument();
  expect(screen.getByText(/not interested buyers or offers/)).toBeInTheDocument();
  expect(screen.getByText(/Nothing is sent automatically/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("owner export needs a saved building record", () => {
  render(<BaselineDataPanel DetailSurface={Surface} />);
  fireEvent.click(screen.getByRole("button", { name: "Sell baseline data" }));
  fireEvent.click(screen.getByText("View my energy readings"));
  fireEvent.click(screen.getByRole("button", { name: "Load readings" }));
  expect(screen.getByRole("alert")).toHaveTextContent(/Save this home profile/);
});
