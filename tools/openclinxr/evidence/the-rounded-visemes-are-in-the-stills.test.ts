import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * # THE GAP, MEASURED 2026-08-19 on main 2d547031 — do not re-derive these rows
 *
 * #434 landed three stills of `mpfb-viseme-inspect.glb`, each with one viseme at
 * weight 1.0 and the other 46 targets at 0. From `viseme-inspect-stills.json`:
 *
 *   target        still                        bytes   lum.mean  lum.sd  targetMax  otherMax
 *   viseme_aa     stills/viseme-inspect-aa.png  162405   60.47    59.81      1          0
 *   viseme_PP     stills/viseme-inspect-pp.png  161722   60.46    59.79      1          0
 *   viseme_sil    stills/viseme-inspect-sil.png 161718   60.49    59.84      1          0
 *
 * The orchestrator graded those three: **lip-only. No jaw drop.** `viseme_aa` displaces
 * 18.16 mm at `oris01` — the lip muscle ring — and the jaw does not move.
 *
 * ## WHY THAT IS NOT YET A CLAIM ABOUT THE PACK
 *
 * `aa`, `PP` and `sil` are an OPEN vowel, a BILABIAL and REST. All three are producible
 * by the lip ring alone. The two shapes that cannot be faked by lips are the ROUNDED
 * pair — `viseme_O` and `viseme_U` — which need protrusion and, for `O`, jaw travel.
 * The GLB carries both (measured, all 15 present):
 *
 *   viseme_CH DD E FF I O PP RR SS TH U aa kk nn sil     (15 of the 47 targets)
 *
 * Until `O` and `U` are rendered at 1.0, "the visemes02 pack is lip-only" is an
 * inference from three shapes, not a finding about the pack. **The two most likely to
 * falsify it are exactly the two nobody has rendered.**
 *
 * ## THE BYTE FLOOR IS NOT A CONTENT CHECK — MEASURED, #431
 *
 * Two BLANK GREY frames cleared a 20,000-byte floor in #431, one of them at 134,991 B.
 * `regionLuminance().sd` separated them cleanly: empties 0.96 and 1.82, content
 * 26.90-45.56. The three shipped stills sit at sd 59.79-59.84. Clause (2) therefore
 * bounds sd, not bytes. (`nonBlackPct` was ALSO tried and is useless here — it reads
 * 100% on every frame including the empties.)
 *
 * ## THE KNOWN-GOOD COLUMN (SS9h)
 *
 * The three shipped stills ARE the known-good: same GLB, same camera (derived once from
 * the lab head AABB and verified identical to 1 mm across loads), same probe, same
 * reader. Clause (4) asserts they still clear every bound the new pair must clear, so a
 * later edit that blinds the metric turns this file red instead of vacuous.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                          | (1) | (2) | (3) | result
 *   ---------------------------------------------------|-----|-----|-----|--------
 *   a) today — no O/U stills at all                    |FAIL |FAIL |FAIL | REFUSED
 *   b) copy aa.png to o.png and u.png                  |pass |pass |**FAIL**| REFUSED
 *   c) render O and U at weight 0 (nothing applied)    |pass |pass |**FAIL**| REFUSED
 *   d) render O and U at 1.0 against the real targets  |pass |pass |pass  | ALL PASS
 *
 * **(b) is the obvious one.** Two `cp`s satisfy existence and luminance instantly, and
 * the frames are byte-identical to a shape already graded. Clause (3) requires each new
 * still's sha256 to differ from every other still in the set AND requires the recorded
 * `morphReadback.targetMax === 1` with `otherMax === 0` for its own named target — the
 * same readback shape #434 already emits, so this asks for no new instrument.
 *
 * **(c) is why targetMax is in clause (3).** A weight-0 render produces a perfectly
 * valid, well-lit, high-sd frame of a face at rest. It is `sil` with a different name.
 *
 * ## DESTRUCTIVE PROBE, RUN 2026-08-19 — the substitution MATCHED
 *
 * Planted row (b) exactly: `cp viseme-inspect-aa.png` to both new paths, appended two
 * shot rows carrying aa's own sha256 and morphReadback, re-ran, reverted with
 * `git checkout --` (the record is TRACKED — SS11a/SS11q).
 *
 *   before the copy: 3 failed | 2 passed   (1)(2)(3) red, (4)(5) green
 *   with the copy:   1 failed | 4 passed   (1)(2) GREEN, (3) red
 *
 * Clause (3) refused on the predicted line and with the predicted mechanism:
 *   `viseme_O is byte-identical to viseme_aa - that is a copy, not a render`
 *
 * So (1) and (2) are satisfiable by two `cp`s, and (3) is the only thing between this
 * contract and two renamed copies of a shape already graded. Prediction and outcome
 * agree on every cell of row (b).
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227):
 *   (1)(2)(3) are ALL REDS today — every one reads `shots[]` rows for `viseme_O` /
 *             `viseme_U` that do not exist, and the two PNGs are absent.
 *             (3) is additionally a NET thereafter: it is what refuses (b) and (c).
 *   (4) PASSES TODAY — it reads the three shipped stills, not the absent pair.
 *   (5) PASSES TODAY — vacuity guard on the record itself.
 *
 * NOT TESTED:
 *   - **Whether the jaw moves.** No clause here grades appearance. Geometry and
 *     luminance cannot answer it; the orchestrator grades the two stills and says
 *     jaw-drop yes or no. This contract buys the EVIDENCE, not the verdict.
 *   - The other 10 visemes (CH DD E FF I RR SS TH kk nn). Two shapes, one slice.
 *   - Anything about the runtime. This is the isolated subject lab (D3/D4), not a
 *     station. No scenario, no room, no speaking actor.
 *   - The visemes02 LICENCE, which remains UNSPECIFIED-on-the-page (#327/#430) and is
 *     unchanged by rendering two more frames of an already-staged asset.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const RECORD = join(HERE, "viseme-inspect-stills.json");

/** The pair this slice adds. Both are present in the GLB's 47 targets (measured). */
const NEW_TARGETS = ["viseme_O", "viseme_U"] as const;
/** #434's shipped three — the known-good column. */
const SHIPPED_TARGETS = ["viseme_aa", "viseme_PP", "viseme_sil"] as const;

/**
 * Floors derived from #431's measured separation, not picked to clear an observation:
 * blank frames read sd 0.96 / 1.82; real content 26.90-45.56; these stills 59.79-59.84.
 * 8.0 sits an order of magnitude above the empties and ~3x below the weakest content
 * ever measured, so it refuses a blank and cannot be met by dimming a real frame.
 */
const MIN_LUMINANCE_SD = 8;
/** #431's own floor, kept so a truncated PNG fails on size before it fails on content. */
const MIN_STILL_BYTES = 20_000;

type Shot = {
  target: string;
  weight: number;
  still: string;
  bytes: number;
  sha256: string;
  luminance?: { mean: number; sd: number };
  morphReadback?: { targetIndex: number | null; targetMax: number; otherMax: number };
};

const record = existsSync(RECORD)
  ? (JSON.parse(readFileSync(RECORD, "utf8")) as { shots?: Shot[] })
  : null;
const shots: Shot[] = record?.shots ?? [];
const byTarget = new Map(shots.map((s) => [s.target, s]));

/** SS7t: an empty enumeration must FAIL, never pass vacuously. */
function requireShot(target: string): Shot {
  expect(
    byTarget.get(target),
    `viseme-inspect-stills.json has no shot for ${target} — today it records only ${shots.map((s) => s.target).join(", ") || "(nothing)"}`,
  ).toBeDefined();
  return byTarget.get(target) as Shot;
}

describe("the rounded visemes are rendered, not inferred", () => {
  it("(1) RED: a still exists on disk for viseme_O and viseme_U", () => {
    for (const target of NEW_TARGETS) {
      const shot = requireShot(target);
      expect(shot.weight, `${target} must be applied at full weight`).toBe(1);
      const abs = join(REPO_ROOT, shot.still);
      expect(existsSync(abs), `${shot.still} missing on disk`).toBe(true);
      expect(statSync(abs).size, `${shot.still} bytes`).toBeGreaterThanOrEqual(MIN_STILL_BYTES);
    }
  });

  it("(2) RED: each new still carries image content, measured by luminance sd not bytes", () => {
    // #431: two blank grey frames cleared the byte floor, one at 134,991 B. sd separates
    // them (0.96 / 1.82 empty vs 26.90-45.56 content). nonBlackPct does NOT — 100% on both.
    for (const target of NEW_TARGETS) {
      const shot = requireShot(target);
      expect(shot.luminance, `${target} shot records no luminance`).toBeDefined();
      expect(
        (shot.luminance as { sd: number }).sd,
        `${target} still reads as blank; the three shipped stills sit at sd 59.79-59.84`,
      ).toBeGreaterThan(MIN_LUMINANCE_SD);
    }
  });

  it("(3) COUNTERWEIGHT: each new still is its own render of its own target", () => {
    // Refuses (b) `cp aa.png o.png` and (c) a weight-0 render that is `sil` renamed.
    const seen = new Map<string, string>();
    for (const shot of shots) {
      const prior = seen.get(shot.sha256);
      expect(prior, `${shot.target} is byte-identical to ${String(prior)} — that is a copy, not a render`).toBeUndefined();
      seen.set(shot.sha256, shot.target);
    }
    for (const target of NEW_TARGETS) {
      const shot = requireShot(target);
      expect(shot.morphReadback, `${target} records no morphReadback`).toBeDefined();
      const rb = shot.morphReadback as { targetIndex: number | null; targetMax: number; otherMax: number };
      expect(rb.targetIndex, `${target} was never located in the morph target list`).not.toBeNull();
      expect(rb.targetMax, `${target} must be applied at 1.0 on the live mesh`).toBe(1);
      expect(rb.otherMax, `no other target may be non-zero when ${target} is under test`).toBe(0);
    }
  });

  it("(4) KNOWN-GOOD: the three shipped stills still clear every bound the new pair must clear", () => {
    for (const target of SHIPPED_TARGETS) {
      const shot = requireShot(target);
      expect(existsSync(join(REPO_ROOT, shot.still)), `${target} still missing`).toBe(true);
      expect(shot.bytes, `${target} bytes`).toBeGreaterThanOrEqual(MIN_STILL_BYTES);
      expect((shot.luminance as { sd: number }).sd, `${target} sd`).toBeGreaterThan(MIN_LUMINANCE_SD);
      expect((shot.morphReadback as { targetMax: number }).targetMax, `${target} targetMax`).toBe(1);
    }
  });

  it("(5) VACUITY GUARD: the record is readable and holds the shipped three", () => {
    // Reads the record, not the absent pair, so it passes today and keeps passing: if
    // someone trims the record, (4) becomes unfalsifiable and this goes red first.
    expect(record, "viseme-inspect-stills.json must be readable").not.toBeNull();
    expect(shots.length, "shots recorded").toBeGreaterThanOrEqual(SHIPPED_TARGETS.length);
    expect(
      SHIPPED_TARGETS.every((t) => byTarget.has(t)),
      "the three #434 shots are the known-good column and must remain in the record",
    ).toBe(true);
  });
});
