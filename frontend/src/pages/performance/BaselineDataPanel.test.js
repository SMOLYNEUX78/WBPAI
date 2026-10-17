import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import BaselineDataPanel from "./BaselineDataPanel";

const Surface = ({ title, children, onClose }) => <div role="dialog" aria-label={title}>{children}<button type="button" onClick={onClose}>Close</button></div>;

test("sell baseline data opens a buyer-fit window without claiming a live sale", () => {
  render(<BaselineDataPanel DetailSurface={Surface} />);
  expect(screen.getByText(/live WBP-001 record is unchanged/)).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Sell baseline data" }));
  expect(screen.getByRole("dialog", { name: "Sell baseline data" })).toBeInTheDocument();
  expect(screen.getByText(/not live matches or offers/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Grid and flexibility partners" }));
  expect(screen.getByText(/baseline alone does not prove dispatchable flexibility/)).toBeInTheDocument();
  expect(screen.getByText(/working smart meter, controllable load/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
