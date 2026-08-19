import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { regionLuminance } from "./lib/png-region-luminance.js";
import { describe, expect, it } from "vitest";

/**
 * E6 (#423) — THE STILLS THE LEAD NEEDS TO GRADE `mpfb-viseme-inspect.glb`.
 *
 * E6.3 (`02a9526a`) landed the asset: 47 morph targets (32 FACS + 15 viseme), `viseme_aa`
 * displacing 18.16 mm at vertex 494 whose dominant joint is `oris01` (lip weight 0.99), `viseme_sil`
 * at rest. That is a MEASUREMENT. Nobody has looked at it.
 *
 * 18 mm on a lip-weighted vertex is necessary and not sufficient — the standing crudegown lesson,
 * where licence and vertex indices were green across three contracts and the pixels showed a
 * floor-length evening dress. Presence, placement and provenance are three questions and none of
 * them is CLASS. This slice produces the artifact that answers the fourth.
 *
 * ## THREE FRAMES, ONE CAMERA
 *
 * `viseme_aa` / `viseme_PP` / `viseme_sil`, each at weight 1.0 with the others at 0, same camera,
 * head AABB framing with the mouth in the middle third. `sil` is the rest control — #426 measured it
 * at 0 vertices, so it must look like a closed neutral mouth.
 *
 * ## CONTENT IS LUMINANCE sd, NEVER BYTES
 *
 * Measured on this repo's own frames while grading #431:
 *
 *   frame                       mean     sd      nonBlackPct
 *   EMPTY grey still           142.7    0.96      100.0%
 *   EMPTY grey still           184.3    1.82      100.0%
 *   real rendered head          54.9   45.56      100.0%
 *   known-good contact sheet    35.8   26.90      100.0%
 *
 * A 134,991-byte blank cleared a 20,000-byte floor, and `nonBlackPct` is 100% on every row because
 * the empties are grey rather than black. Only `sd` separates them. Floor 8 sits 4.4x above the
 * worst observed empty and far below observed content.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                                  | (1) | (2) | (3) | (4) | result
 *   -------------------------------------------------------------|-----|-----|-----|-----|--------
 *   a) today — no stills                                       |FAIL |FAIL |FAIL |FAIL | REFUSED
 *   b) three blank/grey frames that exist                      | pass|FAIL | pass| pass| REFUSED
 *   c) the same frame written three times                      | pass| pass|FAIL | pass| REFUSED
 *   d) full-body framing where the mouth is a few pixels       | pass| pass| pass|FAIL | REFUSED
 *   e) three distinct head-framed frames with content          | pass| pass| pass| pass| ALL PASS
 *
 * **(d) is the one to watch.** A correct-looking full-body render makes the mouth unreadable, which
 * is how an ungradeable artifact passes every mechanical check. Clause (4) requires the recorded
 * head AABB to occupy a real fraction of the frame.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (SS227): **all four RED** — no stills exist.
 *
 * NOT TESTED: whether the shapes are correct speech — **the lead grades these three**, on a closed
 * checklist (`mouth_moves_aa` / `lips_close_PP` / `sil_is_rest`). Nothing here asserts appearance.
 * No rebake, no shipped actor touched, no runtime wiring.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const ARTIFACT = join(REPO_ROOT, "tools/openclinxr/evidence/viseme-inspect-stills.json");
const SUBJECT = "mpfb-viseme-inspect.glb";
const REQUIRED = ["viseme_aa", "viseme_PP", "viseme_sil"] as const;
/** Calibrated while grading #431 — see the table above. */
const MIN_CONTENT_SD = 8;
/** A head framed for mouth reading occupies a real share of the frame, not a few pixels. */
const MIN_HEAD_FRAME_FRACTION = 0.15;

type Shot = { target: string; weight: number; still: string; sha256: string; headFrameFraction: number };
type Doc = { subject?: string; camera?: string; shots?: Shot[] };
const doc = (): Doc => {
  expect(existsSync(ARTIFACT), `${ARTIFACT} — this slice writes it`).toBe(true);
  return JSON.parse(readFileSync(ARTIFACT, "utf8")) as Doc;
};

describe("the viseme inspect stills are gradeable", () => {
  it("(1) RED: three stills exist, one per target, each at weight 1.0", () => {
    const d = doc();
    expect(d.subject, "the subject asset").toMatch(new RegExp(SUBJECT.replace(".", "\\.")));
    expect(d.shots?.length, "one shot per target").toBe(REQUIRED.length);
    for (const t of REQUIRED) {
      const s = d.shots!.find((x) => x.target === t);
      expect(s, `${t} must be captured`).toBeTruthy();
      expect(s!.weight, `${t} must be driven to full weight`).toBe(1);
      expect(existsSync(join(REPO_ROOT, s!.still)), `${s!.still} must exist`).toBe(true);
    }
  });

  it("(2) COUNTERWEIGHT: every frame carries content — luminance sd, not bytes", () => {
    // Refuses (b). A 134,991-byte blank cleared a byte floor while grading #431; sd caught it.
    for (const s of doc().shots!) {
      const lum = regionLuminance(readFileSync(join(REPO_ROOT, s.still)));
      expect(lum, `${s.still} must be a readable PNG`).toBeTruthy();
      expect(
        lum!.sd,
        `${s.target}: flat field (mean ${lum!.mean.toFixed(1)}, sd ${lum!.sd.toFixed(2)}) — nothing rendered`,
      ).toBeGreaterThan(MIN_CONTENT_SD);
    }
  });

  it("(3) COUNTERWEIGHT: the three frames are different images", () => {
    // Refuses (c). Driving a morph that does not bind produces three identical frames, which would
    // read as "the visemes look the same" when nothing was applied.
    const sh = doc().shots!.map((s) => s.sha256);
    expect(new Set(sh).size, `three distinct stills; got ${sh.length - new Set(sh).size} duplicate(s)`).toBe(3);
  });

  it("(4) COUNTERWEIGHT: the head fills enough of the frame to read a mouth", () => {
    // Refuses (d). A full-body render passes every other clause and is ungradeable for this question.
    for (const s of doc().shots!) {
      expect(
        s.headFrameFraction,
        `${s.target}: head occupies ${(s.headFrameFraction * 100).toFixed(1)}% of the frame — too small to grade a mouth`,
      ).toBeGreaterThan(MIN_HEAD_FRAME_FRACTION);
    }
  });
});
