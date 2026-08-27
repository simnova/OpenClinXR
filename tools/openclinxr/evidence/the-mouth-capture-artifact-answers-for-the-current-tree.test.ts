import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findStaleMeasuredGeometry } from "../../../packages/openclinxr/asset-registry/src/measured-station-geometry-freshness.js";

/**
 * #726 / xr-systems-architect.
 *
 * ## THE DEFECT, MEASURED 2026-08-27 at main `cf81b894` — IMMUTABLE. Flip assertions and append
 * `## FIXED (#N)` below. Do not rewrite these paths or numbers.
 *
 * `capture-aims-at-the-mouth.json` is a COMMITTED snapshot with no record of what it measured, so
 * `the-capture-aims-at-the-mouth.test.ts` is green about 2026-08-20 and cannot see the tree it runs
 * against. Re-running the producer (`pnpm asset:ui-xr:viseme-drive-capture`) and reading the same
 * assertions gives the opposite answer:
 *
 *                        committed artifact              live run 2026-08-27
 *   subject mesh         mpfb_ob_patient_aisha_body_1    mpfb_peds_patient_child_body
 *   aimWorldY (jaw)      1.5306                          0.6705
 *   crownApexWorldY      1.7284                          0.7502
 *   drop                 0.1978                          0.0797
 *   subjectVisible       true                            FALSE
 *   firstHitMeshName     mpfb_ob_patient_aisha_body_1    openclinxr.equipment.
 *                                                        pediatric_stretcher_equipment.rail_right
 *
 * Two clauses of that file then red on a live run and are green on main: `:122` (drop under its
 * 0.08 m band) and `:128` (subjectVisible). All eight captured frames render as an opaque slab —
 * graded at native resolution, no head, no face, no mouth in any of them.
 *
 * The subject changed because `ui-xr-viseme-drive-capture.ts:71-81` keeps the FIRST traversed mesh
 * whose `morphTargetDictionary` holds a `viseme_` key. The variable is named `parentMesh`; nothing
 * in that selection establishes the identity the name asserts. The child now carries driven visemes
 * (5 distinct strong targets at influence 1.0 across 48 live samples), so traversal order decides.
 *
 * ## WHAT THIS CONTRACT DOES AND DOES NOT DECIDE
 *
 * It requires the artifact to answer for the tree it is read against. It does NOT prescribe how the
 * camera clears the rail. Pinning the subject by actor id, reframing for a supine subject, and
 * making the older file's band a ratio are all open; none is pre-refused here.
 *
 * ## KNOWN-GOOD COLUMN — the mechanism already ships and already passes
 *
 * `packages/openclinxr/asset-registry/src/measured-station-geometry.json` carries `sources` (3) and
 * `fingerprints` (3, bytes + sha256) and `findStaleMeasuredGeometry` returns `[]` for it on main.
 * Clause (4) pins that, so clause (1) cannot be satisfied by an instrument that reports `[]` for
 * everything. This is #707's helper reused rather than a second freshness mechanism (D1).
 *
 * ## MY OWN CORRECTED PREMISE — do not act on the withdrawn version
 *
 * I first wrote that the 0.08 m band was "derived from a 1.73 m standing adult". That is FALSE.
 * `the-capture-aims-at-the-mouth.test.ts:80-86` derives it from a constant already in the capture
 * (the lookAt sits 0.04 m below the apex) and doubles it because probe D3 found `1.6669 - 1.6269`
 * is `0.04000000000000004` in IEEE. It is an input-derived bound, not a fitted one. What remains
 * true is narrower: it is an ABSOLUTE metre value, and a supine child whose whole crown sits at
 * 0.75 m clears it by -0.3 mm.
 *
 * claimScope: whether the committed mouth-capture artifact describes the current tree, and whether
 *   the camera->anchor ray reaches the subject on an artifact that does.
 * notEvidenceFor: that a viseme is legible; that the mouth reads at all; that the child is the
 *   right subject; Quest; clinical validity.
 */

const REPO = process.cwd();
const MOUTH = "tools/openclinxr/evidence/capture-aims-at-the-mouth.json";
const KNOWN_GOOD = "packages/openclinxr/asset-registry/src/measured-station-geometry.json";
const OLDER_CONTRACT = "tools/openclinxr/evidence/the-capture-aims-at-the-mouth.test.ts";

/** The producer. If it changes, a snapshot taken before the change cannot answer for it. */
const PRODUCER = "tools/openclinxr/evidence/ui-xr-viseme-drive-capture.ts";

type Doc = {
  sources?: Record<string, string>;
  fingerprints?: Record<string, { bytes?: number; sha256?: string }>;
  subjectVisible?: boolean;
  aimWorldY?: number;
  crownApexWorldY?: number;
  firstHitMeshName?: string | null;
};

function mouth(): Doc {
  if (!existsSync(MOUTH)) throw new Error(`${MOUTH} does not exist — the capture must write it.`);
  return JSON.parse(readFileSync(MOUTH, "utf8")) as Doc;
}

describe("the mouth capture artifact answers for the current tree (#726)", () => {
  /**
   * RED. The artifact records nothing about its inputs today, so this cannot pass without the
   * producer writing `sources` + `fingerprints`. The producer path is required among the sources
   * because a change to the capture invalidates a snapshot taken before it; at least one `.glb` is
   * required because a rebaked subject does the same. Both are facts about what the measurement
   * depends on, not a prescription of the fix.
   */
  it.fails("(1) the artifact declares what it measured, and it still matches the tree", () => {
    const doc = mouth();
    const sources = doc.sources ?? {};
    const paths = Object.values(sources);
    expect(
      paths,
      "an artifact that records nothing can never be verified — that is the same lie one layer along",
    ).not.toHaveLength(0);
    expect(
      paths.includes(PRODUCER),
      `${PRODUCER} must be a recorded source: a change to the capture invalidates a snapshot taken before it`,
    ).toBe(true);
    expect(
      paths.some((p) => p.endsWith(".glb")),
      "at least one subject GLB must be recorded: a rebake changes what the camera sees",
    ).toBe(true);
    expect(
      findStaleMeasuredGeometry(doc, REPO),
      "every recorded source must still match its fingerprint on disk; re-run the capture rather than editing the record",
    ).toEqual([]);
  });

  /**
   * COUNTERWEIGHT, and it is the one that costs something. It passes today ONLY because the
   * committed snapshot predates the subject change. Once clause (1) forces the artifact to describe
   * the current tree, this becomes the live assertion the older contract's `:128` could not be:
   * refreshing the record and shipping a blind capture fails here.
   */
  it("(2) the camera->anchor ray reaches the subject", () => {
    const doc = mouth();
    expect(
      doc.subjectVisible,
      "refreshing the artifact while the camera sits inside the stretcher rail is the cheapest way "
        + "to satisfy clause (1); measured false on 2026-08-27 with first hit "
        + "openclinxr.equipment.pediatric_stretcher_equipment.rail_right",
    ).toBe(true);
    expect(doc.firstHitMeshName, "something must actually be hit").not.toBeNull();
  });

  /**
   * COUNTERWEIGHT against a NAMED failure mode, not a decorative floor (SS11o). #470 and #472 record
   * the capture anchoring on the crown apex, where the surface is tangent to a horizontal ray so it
   * grazes the silhouette and reports whatever is behind — measured `kitchen_00exterior` at 4.42 m.
   * Raising the anchor back to the apex is the other way to make clause (2) pass, and it undoes both
   * of those cards. The margin is deliberately only `> 0`: the older contract owns the size of the
   * drop, and a body-size-independent reformulation of its band must not be pre-refused here.
   */
  it("(3) the anchor stays below the crown apex", () => {
    const doc = mouth();
    expect(typeof doc.aimWorldY, "aimWorldY must be recorded").toBe("number");
    expect(typeof doc.crownApexWorldY, "crownApexWorldY must be recorded").toBe("number");
    expect(
      doc.crownApexWorldY! - doc.aimWorldY!,
      "anchoring back on the crown apex makes clause (2) pass by grazing the silhouette and undoes #470/#472",
    ).toBeGreaterThan(0);
  });

  /**
   * KNOWN-GOOD. Without this, clause (1) is satisfiable by an instrument that returns `[]` for
   * every input, including one that reads nothing at all.
   */
  it("(4) KNOWN-GOOD: the same helper reports the shipped measured-geometry artifact as fresh", () => {
    const doc = JSON.parse(readFileSync(KNOWN_GOOD, "utf8"));
    expect(Object.keys(doc.sources ?? {}), "the known-good records its sources").toHaveLength(3);
    expect(Object.keys(doc.fingerprints ?? {}), "the known-good records a fingerprint per source").toHaveLength(3);
    expect(
      findStaleMeasuredGeometry(doc, REPO),
      "if this reports stale, the instrument is broken and clause (1) proves nothing",
    ).toEqual([]);
  });

  /**
   * COUNTERWEIGHT. Gutting the older contract is the way to make its two live-red clauses stop
   * mattering without fixing the camera. merge-kill refuses a DELETED test; this refuses an emptied
   * one.
   */
  it("(5) the older mouth-anchor contract still exists and still reads the artifact", () => {
    expect(existsSync(OLDER_CONTRACT), `${OLDER_CONTRACT} must not be deleted`).toBe(true);
    const src = readFileSync(OLDER_CONTRACT, "utf8");
    expect(src, "its subjectVisible assertion is what this card makes live").toContain("subjectVisible");
    expect(src, "its anchor-vs-apex comparison must survive").toContain("crownApexWorldY");
  });
});

// NOT TESTED — AND THE FIRST ITEM IS THE ONE THAT MATTERS. Nothing here distinguishes an artifact
// WRITTEN BY THE CAPTURE from one hand-edited to carry correct fingerprints. Two sha256 values and a
// JSON edit satisfy clause (1) while leaving the camera inside the rail and clause (2) green on the
// stale `true`. That forgery is not mechanically refusable at this layer; the orchestrator re-runs
// `pnpm asset:ui-xr:viseme-drive-capture` and diffs the artifact before integrating, and that re-run
// is the gate, not this file.
//
// Also not tested: whether the mouth is legible, or whether the child is the subject the capture
// should have. Whether a fresh artifact's `subjectVisible` can be made true WITHOUT hiding or deleting the
// pediatric stretcher — nothing here can distinguish a camera that clears the rail from a scene
// that lost it, and that distinction is left to the orchestrator's pixel grade.
