import { describe, expect, it } from "vitest";
import {
  type InferenceObservation,
  parseCheckpointSkeletonClass,
  parseGateStatus,
  parseModelCardOutputJoints,
  parseReadmeIoSkeletonClaim,
  parseSkeletonExports,
  parseSkeletonJoints,
  qualifyingInferenceObservations,
  type ScreeningInput,
  screenCandidate,
} from "./candidate-screening.js";
import { loadRetrievedSources, measureHostFacts } from "./load-retrieved-sources.js";

/**
 * SC-10's named behavior test.
 *
 * It runs the card's independent research operation against the ACTUAL first-party bytes retrieved
 * by `retrieve-candidate-sources.ts` and stored in the owner-controlled evidence store. It is not a
 * verdict fixture: nothing here tells the engine what to conclude, and the assertions below fail if
 * the engine can be persuaded to say `executed` without a motion-inference observation, or to call
 * the README/model-card joint-count divergence an incompatibility.
 *
 * Recorded baseline control (`sc-10/controls/red-baseline-accepts-fabricated-executed.txt`): at
 * 27efa3d2 the card's evidence verifier returned `{"ok":true}` for a report claiming `executed`
 * with a fabricated 1.18x quality delta and 4200 ms latency, because it graded the report's own
 * `outcome: "satisfied"` flags and never recomputed anything. The fixed revision rejects the same
 * bytes with 5 unmet requirements (`green-fix-rejects-fabricated-executed.txt`).
 */

/** The real screening input. A missing registry fails loudly; it never degrades to a fixture. */
function actualScreeningInput(observations: readonly InferenceObservation[] = []): ScreeningInput {
  const registryPath = process.env["OPENCLINXR_SC_EVIDENCE_REGISTRY"];
  const loaded = loadRetrievedSources(registryPath);
  expect(loaded.problems, "retrieved sources failed their receipts").toEqual([]);
  expect(loaded.sources.size).toBeGreaterThan(0);
  return { sources: loaded.sources, host: measureHostFacts(), observations };
}

describe("SC-10 A13 research eligibility", () => {
  it("SC-10-required-behavior", () => {
    const input = actualScreeningInput();
    const result = screenCandidate(input);

    // The screening ran against real retrieved bytes, not a verdict handed in.
    expect(result.refusals).toEqual([]);
    expect(input.sources.has("soma-rp-checkpoint-config")).toBe(true);
    expect(input.sources.has("kimodo-skeleton-definitions")).toBe(true);

    // --- The candidate is the right project, at pinned revisions ---
    const identity = result.dimensions.find((entry) => entry.id === "candidate-identity");
    expect(identity?.outcome).toBe("eligible");
    expect(identity?.label).toBe("VERIFIED");
    expect(result.dimensions.find((entry) => entry.id === "pinned-revisions")?.outcome).toBe("eligible");

    // --- The skeleton mapping was READ, not inferred from weights ---
    const configText = input.sources.get("soma-rp-checkpoint-config")?.toString("utf8") ?? "";
    const declaredClass = parseCheckpointSkeletonClass(configText);
    expect(declaredClass).toBe("SOMASkeleton30");
    const joints = parseSkeletonJoints(
      input.sources.get("kimodo-skeleton-definitions")?.toString("utf8") ?? "",
      "SOMASkeleton30",
    );
    expect(joints).toHaveLength(30);
    expect(joints[0]).toEqual(["Hips", null]);
    expect(joints.map(([joint]) => joint)).toContain("LeftToeBase");
    // The count the model card publishes must agree with the chain that was parsed.
    expect(parseModelCardOutputJoints(input.sources.get("soma-rp-model-card")?.toString("utf8") ?? "")).toBe(30);
    expect(result.dimensions.find((entry) => entry.id === "skeleton-mapping")?.outcome).toBe("eligible");

    // --- The README77 / model-card30 relationship is RESOLVED, and is not an incompatibility ---
    const readmeClaim = parseReadmeIoSkeletonClaim(
      input.sources.get("kimodo-repo-readme")?.toString("utf8") ?? "",
    );
    expect(readmeClaim?.skeleton).toBe("somaskel77");
    const exported = parseSkeletonExports(input.sources.get("kimodo-skeleton-exports")?.toString("utf8") ?? "");
    expect(exported).toContain("SOMASkeleton30");
    expect(exported).toContain("SOMASkeleton77");
    const divergence = result.dimensions.find((entry) => entry.id === "documentation-divergence");
    expect(divergence?.outcome).toBe("eligible");
    expect(divergence?.finding).toContain("NOT an incompatibility");
    expect(divergence?.finding).toContain("output_to_SOMASkeleton77");

    // --- The verdict is HOLD, for a first-party reason, with a next unblock ---
    expect(result.verdict).toBe("held");
    expect(result.holdReasons.length).toBeGreaterThan(0);
    expect(result.nextUnblock.trim()).not.toBe("");

    // The blocking term is the gated text encoder base model, quoted from HuggingFace's own index.
    const encoder = result.dimensions.find((entry) => entry.id === "body-and-encoder-terms");
    expect(encoder?.outcome).toBe("blocked");
    expect(encoder?.finding).toContain("meta-llama/Meta-Llama-3-8B-Instruct");
    const baseGate = parseGateStatus(input.sources.get("hf-index-text-encoder-base")?.toString("utf8") ?? "");
    expect(baseGate.gated).not.toBe(false);
    expect(baseGate.licence).toBe("llama3");

    // And there is no local execution path on this host.
    const execution = result.dimensions.find((entry) => entry.id === "local-execution");
    expect(execution?.outcome).toBe("blocked");
    expect(execution?.quote).toContain("TEXT_ENCODER_DEVICE=cpu");

    // --- A HOLD is not a completed comparison, and cannot be dressed as one ---
    expect(result.verdict).not.toBe("executed");
    expect(qualifyingInferenceObservations(input.observations)).toHaveLength(0);
  });

  it("refuses a similarly named project rather than screening it as this candidate", () => {
    const input = actualScreeningInput();
    // The MPI project `nghorbani/soma` shares the SOMA name and is released for non-commercial
    // research only. Its bytes carry none of this project's identity markers.
    const impostor = new Map(input.sources);
    impostor.set(
      "kimodo-repo-readme",
      Buffer.from("# SOMA\n\nSolving Optical MoCap Automatically.\nNon-commercial scientific research purposes.\n"),
    );
    impostor.set("kimodo-skeleton-exports", Buffer.from('__all__ = ["SomaMoshppModel"]\n'));
    const result = screenCandidate({ ...input, sources: impostor });
    expect(result.dimensions.find((entry) => entry.id === "candidate-identity")?.outcome).toBe("blocked");
    expect(result.verdict).toBe("held");
  });

  it("will not call the joint-count divergence resolved when the conversion is absent", () => {
    const input = actualScreeningInput();
    const withoutBridge = new Map(input.sources);
    // Remove only the 30-to-77 conversion. Everything else about the sources is unchanged, so the
    // divergence is real again and the honest answer is `unresolved` — not "incompatible".
    withoutBridge.set(
      "kimodo-skeleton-definitions",
      Buffer.from(
        (input.sources.get("kimodo-skeleton-definitions")?.toString("utf8") ?? "").replaceAll(
          "output_to_SOMASkeleton77",
          "removed_for_control",
        ),
      ),
    );
    const dimension = screenCandidate({ ...input, sources: withoutBridge }).dimensions.find(
      (entry) => entry.id === "documentation-divergence",
    );
    expect(dimension?.outcome).toBe("unresolved");
    expect(dimension?.finding).toContain("must not");
    expect(dimension?.finding).not.toContain("NOT an incompatibility");
  });

  it("does not accept a CPU text-encoder offload as evidence of motion inference", () => {
    // The repo README offers TEXT_ENCODER_DEVICE=cpu, which moves only the text embedding model.
    // A successful offload says nothing about the denoiser, and must not raise the verdict.
    const offload: InferenceObservation = {
      observationId: "obs-offload",
      kind: "text-encoder-offload",
      metric: "text encoding wall time on CPU",
      unit: "ms",
      value: 812,
      source: "hypothetical control",
    };
    expect(qualifyingInferenceObservations([offload])).toHaveLength(0);
    const result = screenCandidate(actualScreeningInput([offload]));
    expect(result.verdict).toBe("held");
  });

  it("refuses to screen when a required first-party source was never retrieved", () => {
    const input = actualScreeningInput();
    const missing = new Map(input.sources);
    missing.delete("soma-rp-model-licence");
    const result = screenCandidate({ ...input, sources: missing });
    expect(result.verdict).toBe("held");
    expect(result.refusals).toContain("required source soma-rp-model-licence was not retrieved");
  });

  it("reports unresolved training-data rights rather than inheriting the model card's assertion", () => {
    const dimension = screenCandidate(actualScreeningInput()).dimensions.find(
      (entry) => entry.id === "training-data-rights",
    );
    expect(dimension?.outcome).toBe("unresolved");
    expect(dimension?.finding).toContain("not independently verified");
  });
});
