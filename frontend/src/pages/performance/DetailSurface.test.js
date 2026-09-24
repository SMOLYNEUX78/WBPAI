import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { DetailSurface } from "./BuildingDashboard";

test("opens detail in a dialog and closes with its button", () => {
  const onClose = jest.fn();
  render(<DetailSurface modal title="Performance deep dive" onClose={onClose}><p>HLA details</p></DetailSurface>);
  expect(screen.getByRole("dialog", { name: "Performance deep dive" })).toContainElement(screen.getByText("HLA details"));
  fireEvent.click(screen.getByRole("button", { name: "Close Performance deep dive" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});
