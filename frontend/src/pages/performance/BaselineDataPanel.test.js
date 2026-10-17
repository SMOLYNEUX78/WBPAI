import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import BaselineDataPanel from "./BaselineDataPanel";

test("baseline prototype keeps assumed readiness separate from a real sale", () => {
  const onOpenPathway = jest.fn();
  render(<BaselineDataPanel onOpenPathway={onOpenPathway} />);
  expect(screen.getByRole("progressbar", { name: "Assumed baseline confidence" })).toHaveAttribute("aria-valuenow", "100");
  expect(screen.getByText(/does not mark the live WBP-001 baseline as verified/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Finance and due-diligence pack" }));
  expect(screen.getByText(/bill tariff context/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Preview draft offer" }));
  expect(screen.getByText(/No data is shared and no revenue is booked/)).toBeInTheDocument();
  expect(screen.getByText(/partner candidates, not connected buyers/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Explore retrofit pathway" }));
  expect(onOpenPathway).toHaveBeenCalledTimes(1);
});
