/**
 * The Terms of Use page (compliance backlog item: "Terms of Use page +
 * acceptance, drafted for IDX legal review").
 *
 * One page for the whole product, served by every brand: the wording comes from
 * `src/lib/tou.ts`, which interpolates the radiology network's name from the
 * brand config, so the page names the network whose instance the player is on
 * and nothing else about it is per-brand.
 *
 * Reached three ways:
 *   * "Read the full terms" on the first-run gate,
 *   * "Terms of Use" in Settings, and
 *   * the footer link at the bottom of this page.
 *
 * It is also the one screen the gate deliberately does not cover, because a
 * player must be able to read the terms BEFORE agreeing to them. A player who
 * arrives here before accepting therefore gets an accept button at the foot of
 * the page, which stores the same flag the gate stores and drops them into the
 * games. A player who has already accepted just reads, or goes back.
 *
 * Presentation follows the app's existing conventions: the shared white `card`
 * on the navy theme, the page container and the primary button class.
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import brand from "~/lib/brand";
import { acceptToU, isToUAccepted, touFor } from "~/lib/tou";

export const Route = createFileRoute("/terms")({
  component: TermsOfUsePage,
});

function TermsOfUsePage() {
  const tou = touFor();
  const navigate = useNavigate();
  // Optimistic start, matching the root route's gate: the accept button is only
  // for a device that has not accepted, and it appears after the check below.
  const [accepted, setAccepted] = useState(true);

  useEffect(() => {
    setAccepted(isToUAccepted());
  }, []);

  const handleAccept = () => {
    acceptToU();
    setAccepted(true);
    void navigate({ to: "/" });
  };

  return (
    <div className="page-container">
      <div className="mb-4 mt-2">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm text-secondary font-medium"
        >
          <span aria-hidden="true">←</span> Back
        </Link>
        <h1 className="text-xl font-bold text-primary mt-3">{tou.title}</h1>
        <p className="text-xs text-mutedText mt-1">
          Last updated {tou.updated} · {brand.brandName}
        </p>
      </div>

      <div className="card mb-4">
        <p className="text-sm text-darkText leading-relaxed">{tou.intro}</p>
      </div>

      <div className="card">
        {tou.sections.map((section, index) => (
          <section
            key={section.heading}
            className={index === 0 ? "" : "mt-5 pt-5 border-t border-lightGrey"}
          >
            <h2 className="text-sm font-bold text-primary mb-1.5">
              {section.heading}
            </h2>
            <p className="text-sm text-darkText leading-relaxed">
              {section.body}
            </p>
          </section>
        ))}
      </div>

      {!accepted && (
        <div className="card mt-4">
          <p className="text-sm text-darkText mb-3">
            Happy with these terms? Tap below to start playing.
          </p>
          <button
            type="button"
            onClick={handleAccept}
            className="btn-primary w-full"
          >
            I agree, let&rsquo;s play
          </button>
        </div>
      )}

      <p className="text-white/50 text-center text-xs mt-4 leading-relaxed">
        {brand.brandName}. Built to make your wait a little brighter.
      </p>
    </div>
  );
}
