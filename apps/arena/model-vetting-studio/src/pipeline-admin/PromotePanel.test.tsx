// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { PipelineCandidate } from "@openclinxr/model-vetting";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "./jsdom-setup.js";
import { PromotePanel } from "./PromotePanel.js";

const candidate: PipelineCandidate = {
  candidateId: "photoreal-skin-rung-2026-08-03/nurse_winner",
  group: "photoreal-skin-rung-2026-08-03",
  manifestId: "nurse_winner",
  role: "nurse",
  glbPath: ".openclinxr/asset-production/anny/photoreal-skin-rung-2026-08-03/nurse_winner.glb",
  sizeBytes: 1024 * 1024,
  modifiedAt: "2026-08-03T00:00:00.000Z",
  visionScore: null,
  riggingSummary: null,
  thumbnailPath: null,
  notEvidenceFor: ["clinical_validity", "exam_equivalence", "scoring", "learner_readiness"],
};

afterEach(() => cleanup());

describe("PromotePanel", () => {
  it("builds a claim-scoped promotion record with copy command + gates", async () => {
    render(<PromotePanel candidate={candidate} />);
    fireEvent.click(screen.getByTestId("promote-build"));
    const json = await screen.findByTestId("promote-record-json");
    expect(json.textContent).toContain("copyCommand");
    expect(json.textContent).toContain("not_production_or_clinical_readiness");
    expect(json.textContent).toContain("learner_readiness");
    expect(json.textContent).toContain("apps/ui-xr/public/generated-humanoids/nurse_winner.glb");
    // notEvidenceFor tags surfaced in the UI.
    expect(screen.getAllByText(/not evidence for: learner readiness/i).length).toBeGreaterThan(0);
  });
});
