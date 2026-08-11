import { dirname, join, resolve as pathResolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseObj } from "./anny-mpfb-landmark-compare.js";

/**
 * #301 measured that a raw MPFB base makes the landmark instrument measure MakeHuman's clothes and
 * hair fitting shells instead of the body:
 *
 *   mesh                              | verts  | shoulder span
 *   ----------------------------------|--------|---------------
 *   raw MPFB base (helpers included)  | 19,158 | 0.5578
 *   same body, helpers stripped       | 13,380 | 0.6159
 *
 * 5.8 mm narrow, and PLAUSIBLE — waist and hip happened to coincide on that subject, so a partially
 * correct row reads as a good measurement. The renders make it obvious once you look: a raw base
 * grades as a figure in a floor-length robe and a hood, which are the helper shells.
 *
 * #301 filed this as NOT dispatchable on two blockers. Both are now measured away.
 *
 * BLOCKER 1 — "should the instrument STRIP helpers or REFUSE them? That is a product decision."
 * Already decided, by MADR 0052 and by the tool that exists. `ExportService.bake_modifiers_remove_helpers(
 * basemesh, remove_helpers=True, ...)` at `exportservice.py:79` is the MPFB-shipped strip, and MADR 0052
 * records the withdrawal of the earlier "it is a no-op" reading: 19,158 → 13,380, so *"the call is
 * required, not redundant"* and *"the 13,380 figure survives as a CROSS-CHECK, not a procedure"*.
 * Stripping belongs to the GENERATOR, which already has the proven call. What the INSTRUMENT owes is a
 * refusal, because a measurement taken on the wrong surface is worse than no measurement (#6e).
 *
 * BLOCKER 2 — "the honest contract needs a helper-bearing fixture, and the only one available is a
 * 19k-vertex OBJ at a machine-local path; a synthetic outer shell would prove the wrong thing (§6x)."
 * That was right about a shell and wrong about the class. Helper geometry in this format is NAMED, not
 * positional. `data/3dobjs/base.obj` carries 172 groups — `body`, `helper-tights`, and 170 `joint-*` —
 * so the failure class is "the mesh declares MakeHuman helper groups". A four-line OBJ that declares
 * `g helper-tights` is a GENUINE instance of that class, not a stand-in for it. No 19k commit needed.
 *
 * THE INSTRUMENT IS STRUCTURALLY BLIND, at file:line. `parseObj`
 * (`anny-mpfb-landmark-compare.ts:107-128`) reads only lines beginning `v ` and `f `. Group
 * declarations are discarded before any landmark is computed, so the instrument cannot distinguish a
 * body from a body-plus-shells no matter what it is handed.
 *
 * KNOWN-GOOD COLUMN, and it is real rather than constructed. All seven tracked Anny references carry
 * ZERO groups:
 *
 *   adult_male_street_casual / ed_chest_pain_{adult_cast,nurse_adult,spouse_adult} /
 *   peds_{anxious_parent,nurse_kevin}   13,348 verts, 0 groups, 0 helper groups
 *   peds_patient_child                  13,718 verts, 0 groups, 0 helper groups
 *
 * So a group-name detector cannot fire on anything the pipeline ships today, which is what makes
 * clause (2) a genuine net rather than a hopeful one.
 *
 * THE CHEAP FIXES THIS REFUSES, probed before planting:
 *
 *   treatment                                          | (1) | (2) | (3) | (4) | result
 *   ---------------------------------------------------|-----|-----|-----|-----|--------
 *   a) today — no detector at all                      |FAIL |pass |FAIL |pass | REFUSED
 *   b) refuse every mesh                               |pass |FAIL |pass |FAIL | REFUSED
 *   c) refuse any mesh declaring ANY group             |pass |pass |pass |FAIL | REFUSED
 *   d) refuse when vertexCount > 13,380                |pass |pass |FAIL |pass | REFUSED
 *   e) refuse when a MakeHuman helper group is declared|pass |pass |pass |pass | ALL PASS
 *
 * (d) IS THE ONE THIS CONTRACT EXISTS TO REFUSE. Re-deriving the magic constant is the obvious fix and
 * it is the D1 violation the curious-researcher rule was written about — a hand-rolled index heuristic
 * standing in for a documented API. Clause (3) hands the detector a helper-bearing mesh with TWELVE
 * vertices: a count threshold passes it and calls it clean; a group-name detector flags it. The
 * constant is a cross-check, and a cross-check that becomes the procedure is how 5.8 mm hides.
 *
 * (c) is the symmetric over-reach and clause (4) refuses it: `g body` is an ordinary OBJ group and a
 * mesh that declares only body groups is fine.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) and (3) are REDs and fail today — no detector is
 * exported. (2) and (4) PASS today (vacuously, since nothing is flagged when nothing detects) and
 * become load-bearing the moment a detector exists; they are what stop the fix over-reaching. I am
 * saying that rather than letting them read as strong greens (§7t).
 *
 * NOT TESTED: no landmark is computed and no shoulder span is measured here. This asserts that the
 * instrument can TELL a helper-bearing mesh from a body, not that its measurements are otherwise
 * correct — #300's translation dependence is a separate defect with the same silent-failure shape, and
 * is untouched. Whether 13,380 is stable across MPFB versions is still unmeasured and this contract
 * deliberately no longer depends on it. Nothing here strips anything: stripping stays in the generator,
 * where `bake_modifiers_remove_helpers` already lives.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GENERATED = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids");

/** Tracked Anny references the instrument measures today. All carry zero groups (measured). */
const TRACKED_REFERENCES = [
  "adult_male_street_casual",
  "ed_chest_pain_adult_cast",
  "ed_chest_pain_nurse_adult",
  "ed_chest_pain_spouse_adult",
  "peds_anxious_parent",
  "peds_nurse_kevin",
  "peds_patient_child",
] as const;

/**
 * A genuine helper-bearing mesh: it DECLARES a MakeHuman helper group. Twelve vertices, deliberately —
 * far below the 13,380 cross-check, so a count threshold cannot detect it and clause (3) bites.
 */
const HELPER_BEARING_OBJ = `# minimal MakeHuman-style base with a helper shell
g body
v 0 0 0
v 1 0 0
v 0 1 0
v 1 1 0
v 0 0 1
v 1 0 1
f 1 2 3
f 2 4 3
g helper-tights
v 2 0 0
v 3 0 0
v 2 1 0
v 3 1 0
v 2 0 1
v 3 0 1
f 7 8 9
f 8 10 9
`;

/** Same shape, body groups only — an ordinary OBJ that must NOT be flagged. */
const BODY_ONLY_OBJ = `# body-only, ordinary groups
g body
v 0 0 0
v 1 0 0
v 0 1 0
v 1 1 0
f 1 2 3
f 2 4 3
g body_lower
v 2 0 0
v 3 0 0
v 2 1 0
f 5 6 7
`;

/**
 * The deliverable. Absent today, so (1) and (3) are red. Expected as a named export from
 * `anny-mpfb-landmark-compare.ts` — the module that owns `parseObj` — so every landmark caller can
 * reach it without a second copy of the rule.
 */
type HelperReport = { hasHelperGeometry: boolean; helperGroups: string[] };

async function loadDetector(): Promise<((objText: string) => HelperReport) | null> {
  const mod = (await import("./anny-mpfb-landmark-compare.js").catch(() => null)) as {
    detectMakeHumanHelperGeometry?: unknown;
  } | null;
  return typeof mod?.detectMakeHumanHelperGeometry === "function"
    ? (mod.detectMakeHumanHelperGeometry as (t: string) => HelperReport)
    : null;
}

function referenceObj(id: string): string | null {
  const p = join(GENERATED, `${id}.anny_base.obj`);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

describe("the landmark instrument can tell a body from a body wearing MakeHuman helper shells", () => {
  it.fails("(1) RED: a mesh declaring a MakeHuman helper group is reported as helper-bearing", async () => {
    const detect = await loadDetector();
    expect(detect, "anny-mpfb-landmark-compare must export detectMakeHumanHelperGeometry").not.toBeNull();
    const report = detect!(HELPER_BEARING_OBJ);
    expect(report.hasHelperGeometry, "helper-bearing fixture flagged").toBe(true);
    expect(report.helperGroups, "the offending group is named, not just counted").toContain("helper-tights");
  });

  it("(2) NET known-good: no tracked Anny reference is flagged — refusing everything is refused", async () => {
    const detect = await loadDetector();
    const present = TRACKED_REFERENCES.map((id) => ({ id, text: referenceObj(id) })).filter(
      (r): r is { id: string; text: string } => r.text !== null,
    );
    // These are tracked (#297), so absence is an environment defect, not a gitignore one.
    expect(present.length, "tracked Anny references found on disk").toBeGreaterThanOrEqual(6);
    if (!detect) {
      // Shipped behaviour: nothing detects, so nothing is wrongly flagged. Pins the property a fix
      // must keep rather than asserting the absent module.
      for (const r of present) {
        expect(/^g\s+(helper|joint)-/m.test(r.text), `${r.id} carries no helper group`).toBe(false);
      }
      return;
    }
    const flagged = present.filter((r) => detect(r.text).hasHelperGeometry).map((r) => r.id);
    expect(flagged, "tracked references wrongly flagged as helper-bearing").toEqual([]);
  });

  it.fails(
    "(3) RED COUNTERWEIGHT: detection is by GROUP NAME, not vertex count — a 12-vertex helper mesh is still flagged",
    async () => {
      const detect = await loadDetector();
      expect(detect, "detector must exist").not.toBeNull();
      const { positions } = parseObj(HELPER_BEARING_OBJ);
      // Far below the 13,380 cross-check: a count threshold cannot see this one.
      expect(positions.length, "fixture is small enough to defeat a count threshold").toBeLessThan(100);
      expect(detect!(HELPER_BEARING_OBJ).hasHelperGeometry, "flagged despite a tiny vertex count").toBe(true);
    },
  );

  it("(4) NET: a mesh declaring only body groups is NOT flagged — refusing any grouped OBJ is refused", async () => {
    const detect = await loadDetector();
    if (!detect) {
      expect(/^g\s+(helper|joint)-/m.test(BODY_ONLY_OBJ), "body-only fixture carries no helper group").toBe(false);
      return;
    }
    const report = detect(BODY_ONLY_OBJ);
    expect(report.hasHelperGeometry, "body-only mesh must not be flagged").toBe(false);
    expect(report.helperGroups, "no groups named as helpers").toEqual([]);
  });
});
