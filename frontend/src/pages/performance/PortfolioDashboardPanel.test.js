import { fireEvent, render, screen, within } from "@testing-library/react";
import { PortfolioDashboardPanel } from "./BuildingDashboard";

test("property register headers sort in both directions and search sits by the title", () => {
  render(<PortfolioDashboardPanel bridgewoodTokens={0} onOpenBuilding={jest.fn()} onOpenExchange={jest.fn()} />);
  const title = screen.getByRole("heading", { name: "Property register" });
  const search = screen.getByRole("searchbox", { name: "Search homes" });
  expect(search.parentElement).toContainElement(title);

  const register = screen.getByRole("table", { name: "Property register" });
  const health = within(register).getByRole("columnheader", { name: "Health" });
  const rows = () => within(screen.getByRole("group", { name: "Property register results" })).getAllByRole("button");
  fireEvent.click(within(health).getByRole("button", { name: "Health" }));
  expect(health).toHaveAttribute("aria-sort", "descending");
  expect(rows()[0]).toHaveTextContent("WBP-005");

  fireEvent.click(within(health).getByRole("button", { name: "Health" }));
  expect(health).toHaveAttribute("aria-sort", "ascending");
  expect(rows()[0]).toHaveTextContent("WBP-004");

  fireEvent.change(search, { target: { value: "Kyson" } });
  expect(rows()).toHaveLength(2);
  expect(rows()[0]).toHaveTextContent("WBP-004");
});
