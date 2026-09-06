import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FactoryRunProgressPanel } from "@openclinxr/ui-shared/factory-run-progress-panel";

/**
 * OBSERVABLE: faculty has no view of whether the factory ran. The admin app
 * renders four queue shapes (EnvironmentGenerationQueue,
 * EnvironmentGenerationWorkOrderQueue, ScenarioSceneGenerationPipelineWorkOrderQueue,
 * ScenarioSceneGenerationRequestQueue) and not one is keyed by station, while the
 * artifact that records per-station outcomes has no UI consumer at all.
 *
 * MEASURED 2026-09-06 on main 5553652b: grep of apps/ui-admin/src and
 * packages/openclinxr/ui-shared/src for 'classification' or 'stationTable'
 * -> 0 matches.
 *
 * KNOWN-GOOD COLUMN: FactoryStationCards
 * (packages/openclinxr/ui-shared/src/admin-factory-station-cards.tsx) is the same
 * shape done right — a station-keyed surface living in ui-shared, mounted by
 * ui-admin, derived from data rather than from a hand-written station list.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails -> it and append ## FIXED.
 *
 * claimScope: rendering a recorded station table so a reader can see per-station
 * outcome per case.
 * notEvidenceFor: that the run is current; that `deterministic` means the artifact
 * is usable (the body stage is classified deterministic on a stub OBJ in all 15
 * recorded cases); live Blender; Quest readiness.
 */

const CASES = [
  {
    caseId: "ed_chest_pain_priority_v2",
    stations: [
      { stationId: "body", classification: "deterministic" as const },
      { stationId: "render", classification: "error" as const },
      { stationId: "world_compile", classification: "not_run" as const },
    ],
  },
  {
    caseId: "peds_asthma_parent_anxiety_v1",
    stations: [
      { stationId: "body", classification: "deterministic" as const },
      { stationId: "render", classification: "error" as const },
      { stationId: "world_compile", classification: "deterministic" as const },
    ],
  },
];

describe("the factory run progress panel shows station classifications", () => {
  it("(1) every case id in the run record is rendered", () => {
    render(<FactoryRunProgressPanel cases={CASES} />);
    expect(screen.getByText("ed_chest_pain_priority_v2")).toBeTruthy();
    expect(screen.getByText("peds_asthma_parent_anxiety_v1")).toBeTruthy();
  });

  it("(2) every station id in the run record is rendered", () => {
    render(<FactoryRunProgressPanel cases={CASES} />);
    for (const stationId of ["body", "render", "world_compile"]) {
      expect(screen.getAllByText(stationId).length).toBeGreaterThan(0);
    }
  });

  it("(3) a failing station is distinguishable from a passing one in the DOM", () => {
    const { container } = render(<FactoryRunProgressPanel cases={CASES} />);
    const errorCells = container.querySelectorAll('[data-classification="error"]');
    const okCells = container.querySelectorAll('[data-classification="deterministic"]');
    expect(errorCells.length).toBe(2);
    expect(okCells.length).toBe(3);
  });

  it("(4) COUNTERWEIGHT: an empty run record renders a stated empty state, not a crash", () => {
    render(<FactoryRunProgressPanel cases={[]} />);
    expect(screen.getByText(/no .*run/i)).toBeTruthy();
  });

  it("(5) COUNTERWEIGHT: station rows come from the data, not a hard-coded list", () => {
    render(<FactoryRunProgressPanel cases={[{ caseId: "solo_v1", stations: [{ stationId: "lip_sync", classification: "deterministic" }] }]} />);
    expect(screen.getAllByText("lip_sync").length).toBeGreaterThan(0);
    expect(screen.queryByText("render")).toBeNull();
  });
});

// NOT TESTED: that ui-admin fetches /internal/factory-run-table (that wire is asserted by
// the app-level suite); pixel appearance; that the classifications are current.
