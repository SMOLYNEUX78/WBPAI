import React from "react";
import { useNavigate } from "react-router-dom";

const TABS = [
  { label: "New", path: "/dashboard/new" },
  { label: "WBP-001", path: "/dashboard/home" },
  { label: "WBP-001cc", path: "/dashboard/cc" },
  { label: "Portfolio", path: "/dashboard/portfolio" },
  { label: "Exchange", path: "/dashboard/exchange" },
  { label: "Museum", path: "/dashboard/museum" },
];

export default function PrototypeTabs({ activePath, onDashboardTab }) {
  const navigate = useNavigate();
  return (
    <nav aria-label="Prototype pages" className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
      {TABS.map(({ label, path }) => (
        <React.Fragment key={path}>
          {label === "Museum" ? <span className="mx-2 h-9 w-px shrink-0 self-center bg-gray-300" aria-hidden="true" /> : null}
          <button type="button" aria-current={activePath === path ? "page" : undefined}
            className={`shrink-0 rounded border px-3 py-2 text-sm font-semibold sm:px-4 ${activePath === path ? "border-black bg-black text-white" : "border-gray-300 bg-white text-black"}`}
            onClick={() => {
              if (path.startsWith("/dashboard/") && onDashboardTab) onDashboardTab(path.slice("/dashboard/".length));
              else navigate(path);
            }}>
            {label}
          </button>
        </React.Fragment>
      ))}
    </nav>
  );
}
