import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: six pixel grades show a face markedly flatter than the neck and hands with a hard
 * boundary at the jaw, on assets whose WHOLE-MAP normal detail contract is green.
 *
 * MEASURED 2026-08-26 at head 7e110e8d. IMMUTABLE — flip the assertion and append a `## FIXED (#671)`
 * block below; do not rewrite these paths or numbers.
 *
 * `the-skin-normal-map-carries-surface-detail.test.ts` passes 5/5 on this tree. #369's
 * `configure_skin_normal_detail` (materialize_mpfb_humanoid_candidate.py:1373) repaired the dermal
 * Voronoi scale chain and lifted the map off the floor GLOBALLY. That contract samples the WHOLE map
 * and cannot see a region, so a map can satisfy it while the face island stays flat.
 *
 * THE REGIONAL GAP IS ALREADY MEASURED ON A DIFFERENT CHANNEL. #510 recorded interior-of-UV-island
 * luminance sd on the BASE COLOUR, background excluded
 * (`a-painted-skin-clears-its-licence-header.test.ts:60-65`):
 *
 *   actor                            head island   forearm island
 *   mpfb-clinical-physician-adult      5.55            9.04
 *   mpfb-ob-patient-aisha              6.31            9.82
 *   mpfb-family-partner-adult          7.06           10.47
 *   mpfb-peds-patient-child            7.60           11.04
 *
 * Head smoother than forearm on four of four, and that file states the intended product assertion in
 * as many words: *"The eventual product assertion is `head_sd > forearm_sd` per actor: an internal
 * control, no invented threshold."*
 *
 * ## WHY THIS CONTRACT MOVES THAT ASSERTION TO THE NORMAL MAP, AND WHY THAT IS NOT A DODGE
 *
 * #510's numbers are ALBEDO. The licence-clean mechanism is NOT. Three measurements in the tree,
 * none of them re-derived here:
 *
 *   - `enhanced_skin.json` procedural generators: **0** (#510 header). The shader has no procedural
 *     COLOUR generation; it is designed to be driven by a painted bitmap.
 *   - Every MakeHuman skin bitmap route is licence-refused: 3 files AGPLv3, 33 with no licence line,
 *     `verdict: reject_measured` (`painted-skin-licence-report.json`).
 *   - The channels #369 proved are BUMP channels. They bake to the NORMAL map. Driving them cannot
 *     move an albedo luminance sd at all.
 *
 * So #671 as filed — "drive more of enhanced_skin's procedural channels" against a defect measured on
 * the albedo — pairs a normal-map mechanism with an albedo oracle. This contract measures the channel
 * the mechanism can actually reach. **If the head/forearm inversion turns out NOT to hold on the
 * normal map, that is a finding and closes this card**: it would mean the face flatness the grades
 * show is an albedo defect with no licence-clean route, and the honest outcome is to say so rather
 * than to drive a knob that cannot help.
 *
 * ## THE THRESHOLD IS AN INTERNAL CONTROL
 *
 * No absolute face number appears in this file. The forearm island of the SAME actor's SAME map is
 * the reference, so a bake that adds noise everywhere moves both terms and buys nothing (#671 cheat
 * table row 1), and a darker or lighter tone moves neither (row 2 — a spread statistic, never a mean).
 *
 * ## KNOWN-GOOD COLUMN
 *
 * The forearm island itself. `the-skin-normal-map-carries-surface-detail.test.ts` records that no
 * garment, footwear or library asset in this tree binds a normal map at all, so no external reference
 * exists and the internal control is the only one available. That absence is declared, not papered
 * over.
 *
 * claimScope: whether the head UV island of a shipped MPFB skin normal map carries as much surface
 *   relief as the forearm island of the same map.
 * notEvidenceFor: that any face LOOKS right — a spread statistic cannot grade an appearance, and the
 *   orchestrator's pixel grade remains the oracle for that; that the albedo face/forearm gap in #510's
 *   table is closed, which this contract does not touch; that 5 degrees of slope is the right
 *   perceptual floor, which was derived from the encoding and never validated against a viewer.
 */

const REPO = join(import.meta.dirname, "../../..");
const DIR = join(REPO, "apps/ui-xr/public/generated-humanoids");
const REPORT = join(REPO, "tools/openclinxr/evidence/head-vs-forearm-normal-detail.json");
const LICENCE_REPORT = join(REPO, "tools/openclinxr/evidence/painted-skin-licence-report.json");

type IslandRow = {
  actor: string;
  headSd: number;
  forearmSd: number;
  headTexels: number;
  forearmTexels: number;
};

/** Shipped cast assets, enumerated from what ships. `*-inspect` are fixtures, not cast. */
function shippedActors(): string[] {
  return readdirSync(DIR)
    .filter((f) => f.startsWith("mpfb-") && f.endsWith(".glb") && !f.includes("-inspect"))
    .map((f) => f.replace(/\.glb$/u, ""))
    .sort();
}

/** Clause (1) requires this. Clauses (2)-(4) are counterweights and must PASS on the planting tree,
 *  so they guard the artifact only once it exists — they are deliberately vacuous until then, and
 *  clause (1) is the thing that is red. */
function reportOrNull(): { rows: IslandRow[] } | null {
  if (!existsSync(REPORT)) return null;
  return JSON.parse(readFileSync(REPORT, "utf8")) as { rows: IslandRow[] };
}

function report(): { rows: IslandRow[] } {
  const r = reportOrNull();
  expect(
    r !== null,
    `${REPORT} must exist and be TRACKED — a deliverable under a gitignored path has no land path `
      + "(#64). Write one row per shipped actor with head and forearm island spread and texel counts.",
  ).toBe(true);
  return r!;
}

describe("the face carries as much relief as the forearm (#671)", () => {
  it.fails("(1) every shipped actor's head island is at least as detailed as its forearm island", () => {
    const rows = report().rows;
    const inverted = rows
      .filter((r) => r.headSd < r.forearmSd)
      .map((r) => `${r.actor}: head ${r.headSd.toFixed(2)} < forearm ${r.forearmSd.toFixed(2)}`);
    expect(
      inverted,
      "the head is smoother than the forearm on the SAME map — backwards for a face, and the "
        + "internal control means no absolute threshold is being asserted",
    ).toEqual([]);
  });

  it("(2) COUNTERWEIGHT: both islands are sampled, so neither term is trivially empty", () => {
    const rep = reportOrNull();
    if (rep === null) return;
    for (const r of rep.rows) {
      expect(r.headTexels, `${r.actor}: head island sampled no texels`).toBeGreaterThan(0);
      expect(r.forearmTexels, `${r.actor}: forearm island sampled no texels`).toBeGreaterThan(0);
    }
  });

  it("(3) COUNTERWEIGHT: the population is every shipped cast actor, not a chosen subset", () => {
    const shipped = shippedActors();
    expect(shipped.length, "shipped cast population").toBeGreaterThanOrEqual(9);
    const rep = reportOrNull();
    if (rep === null) return;
    const measured = new Set(rep.rows.map((r) => r.actor));
    expect(
      shipped.filter((a) => !measured.has(a)),
      "fixing one asset and measuring only that one is the cheapest way to clear clause (1) "
        + "(#671 cheat table row 3); the report must cover every shipped cast actor",
    ).toEqual([]);
  });

  it("(4) COUNTERWEIGHT: the licence refusal on painted skins is not overturned", () => {
    const licence = JSON.parse(readFileSync(LICENCE_REPORT, "utf8")) as { verdict?: string };
    expect(
      licence.verdict,
      "filling $diffusetexture with a MakeHuman skin bitmap is the refused route (#510: 3 files "
        + "AGPLv3, 33 with no licence line). Clearing clause (1) by acquiring one would overturn a "
        + "settled licence refusal rather than drive the shader's own channels.",
    ).toBe("reject_measured");
  });
});

// NOT TESTED: whether any face LOOKS better — the orchestrator's pixel grade is the oracle for
// appearance and this file cannot substitute for it. Nor the albedo head/forearm gap in #510's
// table, which no licence-clean mechanism can currently reach. Nor whether the head and forearm UV
// islands are correctly identified: the instrument's region assignment is itself unverified, and a
// mislabelled island would invert the reading without failing any clause here.
