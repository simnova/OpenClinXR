import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EncounterBundlePromotionPanel } from "./encounter-bundle-promotion-panel.js";
import {
  FACULTY_ENCOUNTER_BUNDLE_FACTORY_KINDS,
  learnerLaunchHref,
  type FacultyEncounterBundleMemberSelection,
  type FacultyEncounterBundlePromotionSelection,
} from "./faculty-encounter-bundle-promotion.js";

afterEach(() => {
  cleanup();
});

describe("EncounterBundlePromotionPanel", () => {
  it("surfaces blocking review and provenance reasons and refuses stale or partial selections", () => {
    const onPromote = vi.fn();
    render(
      <EncounterBundlePromotionPanel
        selection={partialStaleSelection()}
        onPromote={onPromote}
      />,
    );
    const panel = screen.getByLabelText("Encounter bundle promotion");
    expect(within(panel).getByRole("heading", { name: "Encounter bundle promotion" })).toBeInTheDocument();
    expect(panel).toHaveTextContent("no automatic approval");
    expect(within(panel).getByLabelText("Promotion blockers")).toHaveTextContent("selection:partial");
    expect(within(panel).getByLabelText("Promotion blockers")).toHaveTextContent("selection:stale_scenario_review");
    expect(within(panel).getByLabelText("Promotion blockers")).toHaveTextContent("missing_factory_member:voice");
    expect(within(panel).getByLabelText("Promotion blockers")).toHaveTextContent("humanoid:patient_humanoid_v1:stale");
    expect(within(panel).getByLabelText("Promotion blockers")).toHaveTextContent("room:exam_bay_room_v1:missing_provenance");
    expect(within(panel).getByLabelText("Promotion blockers")).toHaveTextContent("equipment:ecg_cart_v1:missing_review_attestation:security_privacy");
    expect(within(panel).getByLabelText("Review and provenance attestations")).toHaveTextContent("equipment:ecg_cart_v1:provenance:provenance:ecg_cart_v1");
    expect(within(panel).getByRole("button", { name: "Promote encounter bundle" })).toBeDisabled();
    fireEvent.click(within(panel).getByRole("button", { name: "Promote encounter bundle" }));
    expect(onPromote).not.toHaveBeenCalled();
  });

  it("submits one atomic promotion and renders a learner launch link with only the opaque bundle identity", () => {
    const onPromote = vi.fn();
    const bundleId = "bdl_0123456789abcdef0123456789abcdef";
    render(
      <EncounterBundlePromotionPanel
        selection={completeSelection()}
        onPromote={onPromote}
        submitStatus="submitted"
        launchIdentity={{ bundleId, href: learnerLaunchHref(bundleId) }}
      />,
    );
    const panel = screen.getByLabelText("Encounter bundle promotion");
    expect(within(panel).getByLabelText("Promotion blockers")).toHaveTextContent("No blocking attestations");
    const button = within(panel).getByRole("button", { name: "Promote encounter bundle" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onPromote).toHaveBeenCalledOnce();
    const launch = within(panel).getByLabelText("Learner launch identity");
    expect(launch).toHaveAttribute("href", `/runtime/asset-bundles/${bundleId}`);
    expect(launch).toHaveTextContent(bundleId);
    expect(panel.textContent).not.toMatch(/tenantId|examRunId|encounterId/u);
  });
});

function completeSelection(): FacultyEncounterBundlePromotionSelection {
  return {
    scenarioId: "ed_chest_pain_priority_v1",
    stationId: "ed_chest_pain_station_v1",
    scenarioReviewIdentity: "scenario-review:ed_chest_pain_priority_v1:v7",
    expectedScenarioReviewIdentity: "scenario-review:ed_chest_pain_priority_v1:v7",
    members: FACULTY_ENCOUNTER_BUNDLE_FACTORY_KINDS.map((memberKind) => member(memberKind)),
  };
}

function partialStaleSelection(): FacultyEncounterBundlePromotionSelection {
  return {
    scenarioId: "",
    stationId: "ed_chest_pain_station_v1",
    scenarioReviewIdentity: "scenario-review:current",
    expectedScenarioReviewIdentity: "scenario-review:approved",
    members: [
      member("humanoid", { contentHash: "humanoid-hash-v1", expectedContentHash: "other-hash" }),
      member("room", { provenanceRefs: [] }),
      member("equipment", { missingReviewAttestations: ["security_privacy"] }),
      member("motion"),
      member("interaction"),
    ],
  };
}

function member(
  memberKind: FacultyEncounterBundleMemberSelection["memberKind"],
  patch: Partial<FacultyEncounterBundleMemberSelection> = {},
): FacultyEncounterBundleMemberSelection {
  const assetId = `${memberKind === "humanoid" ? "patient_humanoid_v1" : memberKind === "room" ? "exam_bay_room_v1" : memberKind === "equipment" ? "ecg_cart_v1" : `${memberKind}_asset_v1`}`;
  return {
    memberKind,
    assetId,
    pipelineState: "reviewed",
    reviewStatus: "approved_for_local_runtime",
    provenanceRefs: [`provenance:${assetId}`],
    contentHash: `${memberKind}-hash-v1`,
    expectedContentHash: `${memberKind}-hash-v1`,
    missingReviewAttestations: [],
    ...patch,
  };
}
