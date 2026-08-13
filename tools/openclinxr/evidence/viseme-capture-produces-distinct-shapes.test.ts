import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#365) — visemes resolve 9/9 on paper and nobody has ever watched a mouth move.
 *
 * THE CHAIN IS COMPLETE AND UNVERIFIED IN MOTION. Measured 2026-08-13 11:15 on main: all three
 * shipped actors (ob-patient-aisha, peds-nurse-kevin, peds-patient-child) resolve 9/9 visemes
 * through the real runtime resolver with 8 distinct shapes, and the drive chain is wired
 * (main.ts:8889 — phonemes → driveVisemeTimeline → applyVisemeWeights). Gaze looked exactly like
 * this at 08:20 and turned out to hide a live defect (#362): 1 of 3 case literals resolved to a
 * silent null. This is the same gap check for the mouth.
 *
 * THE CAPTURE TOOL EXISTED AND COULD NOT RUN. At 11:40 the tool crashed before a single frame:
 * `page.evaluate: ReferenceError: __name is not defined`. tsx/esbuild's keepNames transform wraps
 * named const arrows inside evaluate callbacks (`isRecord`, `hasPositionApi`) in a `__name` helper
 * that does not exist in the browser page. PROTO_VERIFY_DELEGATION §6k recorded the fix from the
 * #72 retro: pass the evaluate body as a STRING IIFE. Applied; the tool now runs.
 *
 * MEASURED AFTER THE CRASH FIX (live scene probe, peds_asthma_parent_anxiety_v1):
 *   - The peds patient renders as the Anny `peds_patient_child` base — 9 viseme_* morphs, driven
 *     to weight 1.0 by the named drive (viseme_E, viseme_AA, viseme_OH, viseme_L, viseme_FV,
 *     viseme_silence all observed at 1.0).
 *   - The parent/nurse are MPFB FACS bodies (hm08) driven through the #353 alias map —
 *     `mouth-protusion` and `mouth-compression` observed at 1.0 — so an MPFB mouth DOES move in
 *     this station; it is just not the framed subject.
 *   - Screenshots cost ~500 ms each on the slow headless render loop (~6 fps). When screenshots
 *     sat between samples they throttled the states timeline to ~700 ms/sample and the dominant
 *     viseme showed only {silence, L, AA}. The tool now samples STATES densely (no screenshots on
 *     the states pass) and takes FRAMES on a separate sparse pass, each frame labelled with the
 *     dominant value at its instant.
 *
 * WHAT THIS CONTRACT PROVES, AND WHAT IT DOES NOT: the runtime drives the patient's mouth through
 * ≥5 distinct morph shapes at non-trivial weight, and every dominant shape is a mouth/lip/jaw
 * morph (never a brow/eye/cheek target — the #308 failure class). It does NOT say the mouth shapes
 * LOOK right — that is the orchestrator's pixel grade of the captured frames, and possibly a
 * clinician's. claimScope: mouth morph drive. notEvidenceFor: phoneme timing, facial animation
 * quality, clinical affect.
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

type Inspection = {
  liveVisemeSamples: LiveVisemeSample[];
  maxInfluence?: number;
};

/** Mouth/lip/jaw shapes across the Anny (viseme_*) and MPFB FACS (mouth-*) rails. */
const isMouthShape = (name: string): boolean => {
  const lower = name.toLowerCase();
  return (
    lower.startsWith("viseme_") ||
    lower.startsWith("mouth") ||
    lower.startsWith("openclinxr_mouth")
  );
};

describe("viseme capture produces distinct mouth shapes (#365)", () => {
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

  it("capture runs to completion and the dominant viseme takes ≥5 distinct values (RED)", async () => {
    const data = artifact();
    const samples = data.liveVisemeSamples;
    const dominant = samples
      .map((s) => s.targetName)
      .filter((name) => name !== "none");
    const distinct = new Set(dominant);
    expect(
      distinct.size,
      `dominant viseme took only ${distinct.size} distinct values across ${samples.length} samples: ${[...distinct].join(", ")} — need ≥5`,
    ).toBeGreaterThanOrEqual(5);
  }, 1_800_000);

  it("states artifact holds at least 8 samples (VACUITY GUARD)", async () => {
    const data = artifact();
    expect(
      data.liveVisemeSamples.length,
      `a crashed or empty run must fail loudly; got ${data.liveVisemeSamples.length} samples`,
    ).toBeGreaterThanOrEqual(8);
  }, 1_800_000);

  it("weights are non-trivial: max influence above the floor (COUNTERWEIGHT a)", async () => {
    const data = artifact();
    const maxWeight = Math.max(...data.liveVisemeSamples.map((s) => s.influence), 0);
    expect(
      maxWeight,
      "a sequence of near-zero weights is 'distinct' by float noise and is not speech",
    ).toBeGreaterThan(0.5);
  }, 1_800_000);

  it("every dominant target is a mouth/lip/jaw morph (COUNTERWEIGHT b — #308)", async () => {
    const data = artifact();
    const offenders = data.liveVisemeSamples
      .filter((s) => s.influence >= 0.5)
      .filter((s) => !isMouthShape(s.targetName))
      .map((s) => `${s.targetName}@${s.influence}`);
    expect(
      offenders,
      "a resolver returning some name for every request while driving the wrong region",
    ).toHaveLength(0);
  }, 1_800_000);
});
