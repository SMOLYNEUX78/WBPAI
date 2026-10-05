import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import RetrofitPlanner from "./RetrofitPlanner";

const Surface = ({ children, title, onClose }) => <div role="dialog" aria-label={title}>{children}<button onClick={onClose}>Close</button></div>;

test("upper works scope separates possible annual costs from the benefit range", () => {
  render(<RetrofitPlanner ready annualEui={41.47} area={99.2} electricityDailyKwh={5} gasDailyKwh={7} DetailSurface={Surface} />);
  fireEvent.click(screen.getByRole("button", { name: "Adjust assumptions" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Heating fuel assumption" }), { target: { value: "electric" } });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.change(screen.getByRole("slider", { name: "Extent of retrofit works" }), { target: { value: "100" } });
  const range = screen.getByText("Potential annual benefit").nextElementSibling;
  expect(range.textContent).toMatch(/^£0–£[\d,]+\/yr$/);
  expect(screen.getByText(/Possible net annual cost: up to £/)).toBeInTheDocument();
  expect(screen.getByText(/Energy cost increase: £/)).toBeInTheDocument();
  fireEvent.change(screen.getByRole("slider", { name: "Extent of retrofit works" }), { target: { value: "0" } });
  expect(screen.queryByText(/Possible net annual cost/)).not.toBeInTheDocument();
});

test("keeps retrofit planning locked until baseline is complete", () => {
  render(<RetrofitPlanner ready={false} annualEui={120} area={100} DetailSurface={Surface} />);
  expect(screen.queryByRole("slider", { name: "Extent of retrofit works" })).not.toBeInTheDocument();
});

test("shows assumption-based scenarios and opens the selected pack", () => {
  render(<RetrofitPlanner ready annualEui={120} area={100} DetailSurface={Surface} />);
  expect(screen.getByText("Do we need a retrofit?")).toBeInTheDocument();
  expect(screen.getByText(/Target EUI 102\.0 kWh\/m²\/yr/)).toBeInTheDocument();
  expect(screen.queryByRole("table", { name: /retrofit cost and annual value scenarios/i })).not.toBeInTheDocument();
  expect(screen.getByText("Potential annual benefit")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: /annual benefit split/i })).toBeInTheDocument();
  expect(screen.getByText("£8,000–£18,000")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Adjust assumptions" }));
  expect(screen.getByRole("dialog", { name: "Adjust assumptions" })).toBeInTheDocument();
  expect(screen.getByRole("table", { name: /retrofit cost and annual value scenarios/i })).toBeInTheDocument();
  expect(screen.getAllByText("Enter premium")).toHaveLength(3);
  fireEvent.change(screen.getByRole("spinbutton", { name: /current annual buildings insurance premium/i }), { target: { value: "500" } });
  expect(screen.getByText("£25 (5%)")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("slider", { name: "Energy unit price change" }), { target: { value: "50" } });
  expect(screen.getByText("+50%")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.change(screen.getByRole("slider", { name: "Extent of retrofit works" }), { target: { value: "75" } });
  expect(screen.getByText(/Target EUI 78\.0 kWh\/m²\/yr/)).toBeInTheDocument();
  expect(screen.getByText("£45,000–£75,000")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("slider", { name: "Extent of retrofit works" }), { target: { value: "100" } });
  expect(screen.getByText(/Target EUI 25\.0 kWh\/m²\/yr/)).toBeInTheDocument();
  expect(screen.getByText("£55,000–£100,000")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "View retrofit pack" }));
  expect(screen.getByRole("dialog", { name: "EnerPHit design pathway plan" })).toBeInTheDocument();
  expect(screen.getByText(/No WBP design or build profile has a verified/)).toBeInTheDocument();
});
