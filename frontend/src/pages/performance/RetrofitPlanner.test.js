import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import RetrofitPlanner from "./RetrofitPlanner";

const Surface = ({ children, title, onClose }) => <div role="dialog" aria-label={title}>{children}<button onClick={onClose}>Close</button></div>;

test("keeps retrofit planning locked until baseline is complete", () => {
  render(<RetrofitPlanner ready={false} annualEui={120} area={100} DetailSurface={Surface} />);
  expect(screen.getByRole("tab", { name: /Retrofit/ })).toBeDisabled();
  expect(screen.queryByText("Fabric first")).not.toBeInTheDocument();
});

test("shows assumption-based scenarios and opens the selected pack", () => {
  render(<RetrofitPlanner ready annualEui={120} area={100} DetailSurface={Surface} />);
  fireEvent.click(screen.getByRole("tab", { name: "Retrofit" }));
  expect(screen.getByText("102.0 kWh/m²/yr")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Whole-home retrofit/ }));
  expect(screen.getByText("66.0 kWh/m²/yr")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "View retrofit pack" }));
  expect(screen.getByRole("dialog", { name: "Whole-home retrofit plan" })).toBeInTheDocument();
  expect(screen.getByText(/No WBP design or build profile has a verified/)).toBeInTheDocument();
});
