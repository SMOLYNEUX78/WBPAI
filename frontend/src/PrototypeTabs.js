import React from "react";
import { useNavigate } from "react-router-dom";

const OCCUPY_TABS = [
  { label: "New", path: "/dashboard/new" },
  { label: "WBP-001", path: "/dashboard/home" },
  { label: "WBP-001cc", path: "/dashboard/cc" },
  { label: "Museum", path: "/dashboard/museum" },
];
const DESIGN_TABS = [
  { label: "New", path: "/workspace/architect/new" },
  { label: "Profile", path: "/workspace/architect" },
  { label: "Portfolio", path: "/dashboard/portfolio?role=architect" },
  { label: "Exchange", path: "/dashboard/exchange?role=architect" },
];
const BUILD_TABS = [
  { label: "New", path: "/workspace/builder/new" },
  { label: "Profile", path: "/workspace/builder" },
];

export default function PrototypeTabs({ activePath, onDashboardTab, scope = "occupy" }) {
  const navigate = useNavigate();
  const tabs = scope === "design" ? DESIGN_TABS : scope === "build" ? BUILD_TABS : OCCUPY_TABS;
  return (
    <nav aria-label="Prototype pages" className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
      {tabs.map(({ label, path }) => (
        <React.Fragment key={path}>
          {label === "Museum" ? <span className="mx-2 h-9 w-px shrink-0 self-center bg-gray-300" aria-hidden="true" /> : null}
          <button type="button" aria-current={activePath === path.split("?")[0] ? "page" : undefined}
            className={`shrink-0 rounded border px-3 py-2 text-sm font-semibold sm:px-4 ${activePath === path.split("?")[0] ? "border-black bg-black text-white" : "border-gray-300 bg-white text-black"}`}
            onClick={() => {
              if (path.startsWith("/dashboard/") && onDashboardTab) onDashboardTab(path.split("?")[0].slice("/dashboard/".length));
              else navigate(path);
            }}>
            {label}
          </button>
        </React.Fragment>
      ))}
    </nav>
  );
}
