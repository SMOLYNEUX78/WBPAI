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

test("uses tab navigation without a redundant dialog heading", () => {
  const onClose = jest.fn();
  render(<DetailSurface modal title="" onClose={onClose} headerExtra={<div role="tablist"><button role="tab">Seasonal Charts</button><button role="tab">Deep Dive</button></div>}><p>Chart</p></DetailSurface>);
  const dialog = screen.getByRole("dialog", { name: "Building performance details" });
  expect(dialog.querySelector("h2")).toBeNull();
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Seasonal Charts", "Deep Dive"]);
  fireEvent.click(screen.getByRole("button", { name: "Close building performance details" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});
