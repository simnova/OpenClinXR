// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { PipelineCandidate } from "@openclinxr/model-vetting";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  promotion: null,
  notEvidenceFor: ["clinical_validity", "exam_equivalence", "scoring", "learner_readiness"],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PromotePanel", () => {
  it("builds a claim-scoped promotion record with copy command + gates", async () => {
    render(<PromotePanel candidate={candidate} />);
    fireEvent.click(screen.getByTestId("promote-build"));
    const json = await screen.findByTestId("promote-record-json");
    expect(json.textContent).toContain("copyCommand");
    expect(json.textContent).toContain("not_production_or_clinical_readiness");
    expect(json.textContent).toContain("learner_readiness");
    expect(json.textContent).toContain("apps/ui-xr/public/generated-humanoids/nurse_winner.glb");
    expect(json.textContent).toContain("cagematch/anny-real-garment/current");
    expect(json.textContent).toContain("deployTargets");
    // notEvidenceFor tags surfaced in the UI.
    expect(screen.getAllByText(/not evidence for: learner readiness/i).length).toBeGreaterThan(0);
  });

  it("Deploy now posts to /__promote and shows success with deploy paths", async () => {
    const onDeployed = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain("/__promote");
      return new Response(
        JSON.stringify({
          ok: true,
          deployTargets: [
            "apps/ui-xr/public/generated-humanoids/nurse_winner.glb",
            "apps/ui-xr/public/cagematch/anny-real-garment/current/nurse_winner.glb",
          ],
          record: {
            candidateId: candidate.candidateId,
            deployTargets: [
              "apps/ui-xr/public/generated-humanoids/nurse_winner.glb",
              "apps/ui-xr/public/cagematch/anny-real-garment/current/nurse_winner.glb",
            ],
            claimScope: "aesthetic_metadata_promotion_record_not_production_or_clinical_readiness",
            notEvidenceFor: candidate.notEvidenceFor,
          },
          stdout: "copied",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    render(<PromotePanel candidate={candidate} onDeployed={onDeployed} />);
    fireEvent.click(screen.getByTestId("promote-deploy-now"));

    await waitFor(() => {
      expect(screen.getByTestId("promote-deploy-success")).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalled();
    const call = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit?];
    expect(String(call[0])).toContain("/__promote");
    const init = call[1] ?? {};
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body)) as { candidateId: string };
    expect(body.candidateId).toBe(candidate.candidateId);
    expect(screen.getAllByText(/generated-humanoids\/nurse_winner\.glb/).length).toBeGreaterThan(0);
    expect(onDeployed).toHaveBeenCalled();
  });

  it("shows offline fallback when /__promote fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: false, error: "not in dev" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
      ) as unknown as typeof fetch,
    );

    render(<PromotePanel candidate={candidate} />);
    fireEvent.click(screen.getByTestId("promote-deploy-now"));
    await waitFor(() => {
      expect(screen.getByTestId("promote-deploy-error")).toBeInTheDocument();
    });
    expect(screen.getByText(/promote-candidate\.ts/)).toBeInTheDocument();
  });
});
