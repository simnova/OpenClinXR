import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import * as runner from "../../../tools/openclinxr/dark-factory/multi-case-runner.js";

/**
 * OBSERVABLE: the dark-factory chain produces viseme timing for a speaking actor, offline, at BUILD
 * time — so an examination can run with no LLM in the path (D9).
 *
 * MEASURED 2026-08-23, verified by me end to end, do not re-derive.
 *
 * EVERY PIECE EXISTS AND NOTHING JOINS THEM:
 *
 *   rhubarb binary      ~/.openclinxr-tools/rhubarb/rhubarb, 8,425,288 bytes, NOT on PATH
 *   proven offline      say -> afconvert -> rhubarb on the authored line
 *                       "It feels heavy, like someone is sitting on my chest."
 *                       (ed-chest-pain.ts, patient_robert_hayes_v1)
 *                       EXIT=0, 22 cues, 8 distinct shapes [A B C D F G H X]
 *   visemes baked       all 11 cast MPFB actors carry viseme morph targets
 *   runtime driver      #552 landed jawOpenRadians + applyJawOpenToRoot (apps/ui-xr)
 *   factory station     ABSENT
 *
 * DARK_FACTORY_CHAIN_STATIONS has EIGHT entries and none is lip_sync:
 *   case_to_actor_params, body, clothing, rigging, room, equipment, staging_placement, render
 *
 * The only factory reference to rhubarb is a provenance STRING at
 * generated-ed-station-runtime-bundle.ts:526 — "rhubarb-lip-sync-compatible-mouth-cue-contract" —
 * with the next line reading "requires-offline-audio-aligned-viseme-generation-before-production-
 * readiness". The factory DECLARES the precondition and never fulfils it.
 *
 * WHY THIS IS A D9 SLICE, not polish: with no build-time station, viseme timing must be produced at
 * runtime. D9 requires an examination to run "with no further LLM involvement", and sanctions an LLM
 * only for dynamic dialogue. Timing that could be baked and is not is a runtime dependency the
 * factory chose.
 *
 * KNOWN-GOOD COLUMN: the eight existing stations. Clause (3) pins them, so adding a ninth cannot pass
 * by renaming or displacing one.
 *
 * COUNTERWEIGHT: a station that "runs" and emits nothing is the cheap fix. Clause (4) requires real
 * timed cues — more than one cue, more than one distinct shape, and strictly increasing start times —
 * so an empty or single-shape artifact fails.
 *
 * claimScope: whether the dark-factory chain contains a lip_sync station that produces viseme timing.
 * notEvidenceFor: whether the timing is ACCURATE for the audio; whether the mouth looks right (no
 * pixel grade exists); any clinical or voice-quality claim; the runtime playback path.
 */

const CHAIN = (runner as unknown as { DARK_FACTORY_CHAIN_STATIONS: readonly string[] })
  .DARK_FACTORY_CHAIN_STATIONS;

/** Measured 2026-08-23: the chain as it ships today. Clause (3) pins every one. */
const STATIONS_BEFORE = [
  "case_to_actor_params", "body", "clothing", "rigging",
  "room", "equipment", "staging_placement", "render",
] as const;

/** Where the binary actually is. It is NOT on PATH, so a station must resolve it explicitly. */
const RHUBARB = `${process.env.HOME}/.openclinxr-tools/rhubarb/rhubarb`;

type Cue = { start: number; end: number; value: string };

describe("the factory bakes viseme timing for every speaking actor", () => {
  it("(1) RED: the dark-factory chain has a lip_sync station", () => {
    // Eight stations today, none of them lip_sync. Timing therefore has no build-time producer.
    expect(CHAIN, "DARK_FACTORY_CHAIN_STATIONS must include a lip_sync station").toContain("lip_sync");
  });

  it("(2) RED: the chain exposes a runnable, offline viseme-timing step", () => {
    // Requires an exported station runner that takes an utterance and returns timed cues WITHOUT a
    // network call or a model. Named explicitly so the seam is not invented: the export must be
    // `runLipSyncStation({ utterance, outDir })` returning `{ cues: Cue[]; tool: string }`.
    const fn = (runner as unknown as {
      runLipSyncStation?: (o: { utterance: string; outDir: string }) => Promise<{ cues: Cue[]; tool: string }>;
    }).runLipSyncStation;
    expect(typeof fn, "export runLipSyncStation({ utterance, outDir }) from the chain runner")
      .toBe("function");
  });

  it("(3) KNOWN-GOOD COLUMN: the eight shipped stations survive unchanged", () => {
    // Pins the reference. Adding a ninth station must not rename, reorder away, or drop any of these.
    for (const s of STATIONS_BEFORE) {
      expect(CHAIN, `station ${s} shipped before this slice and must remain`).toContain(s);
    }
  });

  it("(4) COUNTERWEIGHT: the station must emit REAL timed cues, not an empty artifact", async () => {
    // Refuses the cheap fix — a station that returns [] or one flat shape and reports success.
    // Calibrated against my own measured run of the shipped binary on an authored line:
    // 22 cues, 8 distinct shapes. The bar here is deliberately far below that so it pins the
    // FAILURE MODE (empty / single-shape / unordered), not my observation.
    const fn = (runner as unknown as {
      runLipSyncStation?: (o: { utterance: string; outDir: string }) => Promise<{ cues: Cue[]; tool: string }>;
    }).runLipSyncStation;
    if (typeof fn !== "function") return; // clause (2) owns the missing-seam failure

    expect(existsSync(RHUBARB), `the offline tool must be resolved explicitly; it is NOT on PATH (${RHUBARB})`)
      .toBe(true);

    const out = await fn({
      utterance: "It feels heavy, like someone is sitting on my chest.",
      outDir: `${process.env.TMPDIR ?? "/tmp"}/openclinxr-lipsync-contract`,
    });
    expect(out.cues.length, "an empty cue list is not lip-sync").toBeGreaterThan(1);
    expect(new Set(out.cues.map((c) => c.value)).size, "one flat shape is not lip-sync").toBeGreaterThan(1);
    const starts = out.cues.map((c) => c.start);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  }, 120000);
});

/*
## FIXED (#608)

- `DARK_FACTORY_CHAIN_STATIONS` now has a ninth entry, `lip_sync`, appended after
  `render` (multi-case-runner.ts): the eight shipped stations keep their order and
  names, so clause (3)'s known-good column is untouched.
- The chain runner exports `runLipSyncStation({ utterance, outDir })` returning
  `{ cues: LipSyncCue[]; tool: string; binary: string; audioDurationSeconds: number;
  cueArtifactPath: string; manifestArtifactPath: string }`. The seam is exactly the
  one named in clause (2): no PATH lookup, no network call, no model.
- The station resolves the rhubarb binary EXPLICITLY at
  `~/.openclinxr-tools/rhubarb/rhubarb` (honouring `OPENCLINXR_RHUBARB_BIN` when
  set) and runs the measured offline pipeline: macOS `say` -> `afconvert`
  (16-bit mono WAV) -> `rhubarb --exportFormat json`, parsing `mouthCues[]` into
  `{ start, end, value }` cues. Same utterance -> same artifact names (sha1 content
  hash), so the bake is deterministic (D9).
- `runCaseChain` gains a ninth station row (`stage-lip-sync`): it bakes the case's
  first authored spoken line (`openingUtterance`, else the first touch-response
  `dialogueLine`), classified `deterministic` with on-disk cue artifacts, `absent`
  when the case authors no spoken line, `error` when the offline pipeline fails on
  a case that does speak.
*/
