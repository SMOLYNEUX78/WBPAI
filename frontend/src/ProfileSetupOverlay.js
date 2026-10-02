import React from "react";

export default function ProfileSetupOverlay({ title, phase, step, total, children }) {
  return <div className={`wbp-project-setup-backdrop is-${phase.toLowerCase()}`}>
    <section className="wbp-project-setup-dialog" role="dialog" aria-modal="true" aria-label={title}>
      <header className="wbp-project-setup-heading">
        <span>{phase} · {step} of {total}</span>
        <h2>{title}</h2>
      </header>
      <div key={step} className="wbp-setup-step-enter">{children}</div>
    </section>
  </div>;
}
