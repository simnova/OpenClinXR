import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#368, remaining half). The face-detail capture could not tell anyone
 * whether its in-page reframe actually found the patient mesh, so no face-framed capture
 * could evidence a face.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT, LOCATED — the artifact records intent, never outcome
 *
 * `ui-xr-viseme-drive-capture.ts` wrote
 *   framing: "in-page head-and-shoulders reframe on patient face (fov=32, z≈1.15)"
 * unconditionally. `reframeCameraOnPatientFace` returned a string that was printed to stdout
 * and discarded — even its failure codes (no-camera / no-patient-mesh) never reached the
 * artifact, so a broken reframe looked identical to a good one. Separately, `actor:`
 * hardcoded "peds_patient_child (Anny base in the peds station...)" while the driven mesh was
 * already `mpfb_peds_patient_child_body` (#366) — a stale literal that becomes someone's
 * false premise. The #368 gate fix (df6f16a4) is in main; this pins the instrument's
 * self-report.
 *
 * WHY THE THREE PULL APART
 * (1) asserts the artifact records the reframe OUTCOME — target mesh name + world position on
 *     success, failure code on failure. (2) COUNTERWEIGHT: the recorded target mesh name must
 *     equal `liveVisemeSamples[0].meshName` — one derived from the reframe traversal, the
 *     other from the viseme sampler, so a hardcoded literal cannot satisfy both. (3) VACUITY:
 *     the artifact exists with ≥8 samples and a non-empty first mesh name — a crashed capture
 *     must fail loudly, not let the RED pass on an empty object. (4) the actor label is
 *     derived from the live scene, not the stale Anny literal.
 */

const INSPECTION_PATH = ".openclinxr/evidence/viseme-drive-2026-08-06/inspection.json";

const load = async () =>
  import("./ui-xr-viseme-drive-capture.js") as Promise<Record<string, unknown>>;

type LiveVisemeSample = {
  t: number;
  targetName: string;
  influence: number;
  meshName: string;
  framePath: string | null;
};

type WorldPosition = { x: number; y: number; z: number };

type ReframeRecord = {
  status: "ok" | "no-scene" | "no-camera" | "no-patient-mesh";
  targetMeshName: string | null;
  targetWorldPosition: WorldPosition | null;
  framingDescription: string;
  reappliedCount: number;
  reappliedFailures: string[];
};

type Inspection = {
  actor?: string;
  framing?: string;
  reframe?: ReframeRecord;
  liveVisemeSamples: LiveVisemeSample[];
};

describe("the capture records what it framed (#368 remaining half)", () => {
  let captureError: unknown = null;
  let inspection: Inspection | null = null;

  beforeAll(async () => {
    const mod = await load();
    const run = mod.runVisemeCapture as (() => Promise<unknown>) | undefined;
    if (typeof run !== "function") {
      captureError = new Error(
        "runVisemeCapture is not exported by ui-xr-viseme-drive-capture.ts",
      );
      return;
    }
    try {
      await run();
      inspection = JSON.parse(await readFile(INSPECTION_PATH, "utf8")) as Inspection;
    } catch (error) {
      captureError = error;
    }
  }, 1_800_000);

  const artifact = (): Inspection => {
    if (captureError !== null) {
      throw captureError;
    }
    if (inspection === null) {
      throw new Error(`capture completed but did not write ${INSPECTION_PATH}`);
    }
    return inspection;
  };

  it("(1) RED: the artifact records the reframe outcome — the framed mesh and its world position", async () => {
    const data = artifact();
    const reframe = data.reframe;
    expect(
      reframe,
      "reframe outcome is not recorded — framing was the hardcoded string written whether or not the reframe found anything",
    ).toBeTruthy();
    expect(
      reframe!.status,
      "the reframe must have succeeded for this capture to evidence a face",
    ).toBe("ok");
    expect(reframe!.targetMeshName ?? "").not.toBe("");
    expect(reframe!.targetWorldPosition).not.toBeNull();
    expect(typeof reframe!.targetWorldPosition!.x).toBe("number");
    expect(typeof reframe!.targetWorldPosition!.y).toBe("number");
    expect(typeof reframe!.targetWorldPosition!.z).toBe("number");
    // The derived framing description must name the actual target, not a fixed literal.
    expect(data.framing ?? "").toContain(reframe!.targetMeshName!);
  }, 1_800_000);

  it("(2) COUNTERWEIGHT: the recorded target mesh equals the mesh the viseme sampler read", async () => {
    const data = artifact();
    const reframe = data.reframe!;
    const firstSampleMesh = data.liveVisemeSamples[0]?.meshName ?? "";
    expect(
      firstSampleMesh,
      "first live sample has no mesh name — a capture that read nothing cannot be evidence",
    ).not.toBe("");
    expect(
      reframe.targetMeshName,
      "reframe target and sampler meshName are derived independently (one from the reframe traversal, one from the viseme sampler) — a hardcoded literal cannot satisfy both",
    ).toBe(firstSampleMesh);
  }, 1_800_000);

  it("(3) VACUITY GUARD: at least 8 samples with a non-empty mesh name on the first", async () => {
    const data = artifact();
    expect(
      data.liveVisemeSamples.length,
      `a crashed or empty run must fail loudly; got ${data.liveVisemeSamples.length} samples`,
    ).toBeGreaterThanOrEqual(8);
    expect(data.liveVisemeSamples[0].meshName).not.toBe("");
  }, 1_800_000);

  it("(4) the actor label is derived from the live scene, not the stale Anny literal", async () => {
    const data = artifact();
    const actor = data.actor ?? "";
    expect(actor).not.toContain("Anny base in the peds station");
    expect(actor).toContain(data.liveVisemeSamples[0].meshName);
  }, 1_800_000);
});
