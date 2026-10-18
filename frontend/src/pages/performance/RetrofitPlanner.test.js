import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import RetrofitPlanner from "./RetrofitPlanner";

const Surface = ({ children, title, onClose }) => <div role="dialog" aria-label={title}>{children}<button onClick={onClose}>Close</button></div>;

test("upper works scope keeps the annual value separate from works cost", () => {
  render(<RetrofitPlanner ready annualEui={41.47} area={99.2} electricityDailyKwh={5} gasDailyKwh={7} DetailSurface={Surface} />);
  fireEvent.change(screen.getByRole("slider", { name: "Extent of retrofit works" }), { target: { value: "100" } });
  const range = screen.getByText("Potential annual value").nextElementSibling;
  expect(range.textContent).toMatch(/^£[\d,]+–£[\d,]+\/yr$/);
  expect(screen.getByText("Estimated works cost")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Adjust assumptions" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("slider", { name: "Extent of retrofit works" }), { target: { value: "0" } });
  expect(screen.getByText("Estimated works cost")).toBeInTheDocument();
});

test("keeps retrofit planning locked until baseline is complete", () => {
  render(<RetrofitPlanner ready={false} annualEui={120} area={100} DetailSurface={Surface} />);
  expect(screen.queryByRole("slider", { name: "Extent of retrofit works" })).not.toBeInTheDocument();
});

test("recalculates the EnerPHit forecast when the measured baseline changes", () => {
  const props = { ready: true, area: 99.2, electricityDailyKwh: 5, gasDailyKwh: 7, DetailSurface: Surface };
  const { rerender } = render(<RetrofitPlanner {...props} annualEui={41.47} />);
  fireEvent.change(screen.getByRole("slider", { name: "Extent of retrofit works" }), { target: { value: "100" } });
  expect(screen.getByText(/1,634 kWh\/yr energy saved/)).toBeInTheDocument();

  rerender(<RetrofitPlanner {...props} annualEui={60} />);
  expect(screen.getByText(/3,472 kWh\/yr energy saved/)).toBeInTheDocument();
});

test("shows assumption-based scenarios and opens the selected pack", () => {
  render(<RetrofitPlanner ready annualEui={120} area={100} electricityDailyKwh={5} gasDailyKwh={7} DetailSurface={Surface} />);
  expect(screen.getByText("Do we need a retrofit?")).toBeInTheDocument();
  expect(screen.getByText(/Target EUI 102\.0 kWh\/m²\/yr/)).toBeInTheDocument();
  expect(screen.queryByRole("table", { name: /retrofit cost and annual value scenarios/i })).not.toBeInTheDocument();
  expect(screen.getByText("Potential annual value")).toBeInTheDocument();
  expect(screen.getByText("Data licences")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: /Data licences £222/i })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Other occupant value" })).not.toBeInTheDocument();
  expect(screen.queryByText("Potential funding input")).not.toBeInTheDocument();
  expect(screen.queryByRole("spinbutton", { name: /current annual buildings insurance premium/i })).not.toBeInTheDocument();
  expect(screen.getByRole("img", { name: /Insurance £15/i })).toBeInTheDocument();
  expect(screen.getByText(/ABI UK buildings-only average of £309\/year/)).toBeInTheDocument();
  expect(screen.queryByText(/Illustrative insurance saving:/)).not.toBeInTheDocument();
  expect(screen.getByText("Estimated works cost")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Adjust assumptions" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("slider", { name: "Extent of retrofit works" }), { target: { value: "75" } });
  expect(screen.getByText(/Target EUI 78\.0 kWh\/m²\/yr/)).toBeInTheDocument();
  fireEvent.change(screen.getByRole("slider", { name: "Extent of retrofit works" }), { target: { value: "100" } });
  expect(screen.getByText(/Target EUI 25\.0 kWh\/m²\/yr/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "View retrofit pack" }));
  expect(screen.getByRole("dialog", { name: "EnerPHit design pathway plan" })).toBeInTheDocument();
  expect(screen.getByText(/No WBP design or build profile has a verified/)).toBeInTheDocument();
});

test("uses the saved Suffolk council for local funding routes without treating a loan as a grant", () => {
  render(<RetrofitPlanner ready embedded postcode="IP1 1AA" localAuthority="Ipswich" annualEui={120} area={100} electricityDailyKwh={5} gasDailyKwh={7} DetailSurface={Surface} />);
  expect(screen.getByText(/No award is assumed or deducted from the works cost/)).toBeInTheDocument();
  expect(screen.getByText("Suffolk Warm Homes Loan")).toBeInTheDocument();
  expect(screen.getByText(/windows or doors; amount follows eligibility and a survey/i)).toBeInTheDocument();
  fireEvent.change(screen.getByRole("slider", { name: "Extent of retrofit works" }), { target: { value: "50" } });
  expect(screen.queryByText("Potential funding input")).not.toBeInTheDocument();
  expect(screen.getByText(/repayable, not a grant/i)).toBeInTheDocument();
});

test("does not infer Suffolk funding from the postcode alone", () => {
  render(<RetrofitPlanner ready embedded postcode="IP1 1AA" annualEui={120} area={100} electricityDailyKwh={5} gasDailyKwh={7} DetailSurface={Surface} />);
  expect(screen.queryByText("Suffolk Warm Homes Loan")).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("slider", { name: "Extent of retrofit works" }), { target: { value: "50" } });
  expect(screen.getByText(/No award is assumed or deducted from the works cost/)).toBeInTheDocument();
});
