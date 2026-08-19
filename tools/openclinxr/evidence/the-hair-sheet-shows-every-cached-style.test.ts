import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * # THE GAP, MEASURED 2026-08-19 on main 56a97b41 — do not re-derive these rows
 *
 * #450 landed a 27-row licence and topology inventory for the cached hair pack. **Nobody has
 * looked at any of it.** There is no sheet, no still, no render — `ls` for a hair sheet or a
 * hair still returns nothing.
 *
 * The inventory says what the files CLAIM. It cannot say what they LOOK like, and this repo's
 * standing lesson is that those are different questions: S0/S1/S2 landed three green contracts
 * on crudegown's licence and vertex indices and the pixel grade showed a floor-length evening
 * dress. **Presence, placement and provenance are three questions and none of them is CLASS.**
 * A licence column is provenance. A `maxVertRef` is topology. Neither is "this is a bob".
 *
 * ## WHAT THE INVENTORY ALREADY GIVES THE SHEET, measured
 *
 *   rows                                   27
 *   pageLicence                            CC0 x27
 *   headerLicence   AGPL3 x12 | CC0 x7 | CC-0 x2 | CC BY 4.0 x1 | CC_by x1 | NONE x4
 *   rows where the two columns DISAGREE    20
 *   fitsStrippedBasemesh                   24 of 27
 *   oversized (>= 13,380)  culturalibre_hair_01 19143 | faydaen_hair_1 18772 | sonntag78_junglebook_hair 14533
 *   mapped                                 ["mhair02"]
 *
 * **Labels are READ from `hair-pack-licence-inventory.json`, never re-derived here.** That is
 * how `garment-class-sheet.ts` treats the E1 inventory and it is the same discipline: one
 * measurement, one owner, the sheet quotes it.
 *
 * ## THE INPUTS EXIST — measured, so "we cannot render these" is not available
 *
 *   styles with a sibling `.obj` next to their `.mhclo`:  27 / 27
 *
 * `garment-class-sheet.ts` is the proven builder: OBJ -> GLB in Node via three.js OBJLoader +
 * GLTFExporter, served from a portless dev server, rendered through the isolated-subject lab's
 * existing `glb` subject kind, composed with `buildContactSheet` (#163) — ONE dev-server boot,
 * ONE browser, N subjects, plus a sidecar the contract reads. **Wire that. Do not author a
 * second sheet builder (D1).**
 *
 * ## THE KNOWN-GOOD COLUMN (SS9h)
 *
 * `mhair02` is the only style mapped to a shipped actor, and I have already graded it in a
 * station render: kevin's fitted hair reads as a short male cut, ears visible, cropped crown —
 * recorded in the 2026-08-14 handoff. It is the one cell whose correct appearance is known
 * independently of this sheet, so clause (4) requires it present and content-bearing. If the
 * pipeline is broken, the cell we can check by hand goes dark first.
 *
 * ## CONTENT IS LUMINANCE sd, NOT BYTES — measured, #431
 *
 * Two BLANK GREY frames cleared a 20,000-byte floor, one of them at **134,991 B**, reading sd
 * **0.96** and **1.82**. Real content measured 26.90-45.56; #442's viseme stills 59.79-59.85.
 * `nonBlackPct` was tried and is useless — 100% on every frame including the empties.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                          | (1) | (2) | (3) | (4) | result
 *   ---------------------------------------------------|-----|-----|-----|-----|--------
 *   a) today — no sheet at all                         |FAIL |FAIL |FAIL |FAIL | REFUSED
 *   b) a sheet of the 6 toigo bobs the rail already has|FAIL |pass |pass |**FAIL**| REFUSED
 *   c) cells rendered but labels re-derived here       |pass |pass |**FAIL**|pass| REFUSED
 *   d) one sheet image, no per-cell sidecar            |pass |**FAIL**|pass |pass | REFUSED
 *   e) all 27, labels quoted from the inventory        |pass |pass |pass |pass | ALL PASS
 *
 * **(b) is the tempting one.** Six of the 27 are toigo bobs the library rail already proves, and
 * a sheet of those would look like progress while telling us nothing new. Clause (1) requires a
 * cell for **every** row in the inventory, including the three oversized styles — a style that
 * cannot be fitted can still be looked at, and knowing what we are refusing is worth a cell.
 *
 * **(c) is the subtle one.** If the sheet re-reads the `.mhclo` headers to label itself, the
 * sheet and the inventory can drift and the page/header contradiction gets re-litigated per
 * consumer. Clause (3) requires the labels to match the inventory exactly, field for field.
 *
 * ## DESTRUCTIVE PROBE, RUN 2026-08-19 — both substitutions MATCHED; one row under-called
 *
 * Wrote a >20 KB sheet image and a plausible sidecar, twice, reverting between.
 *
 *   cheat (b) six toigo-bob cells only, labels correct
 *             -> 2 failed: clauses (1) AND (4). My table said (4) would pass; it does not,
 *                because mhair02 is not a toigo bob and so the known-good cell is simply
 *                ABSENT. Corrected in the row above rather than appended (SS7q) — the
 *                counterweight is stronger than advertised.
 *
 *   cheat (c) all 27 cells, pageLicence RE-DERIVED by copying headerLicence
 *             -> 1 failed: clause (3), reporting exactly 20 drift entries, which is the
 *                measured number of rows where the two columns disagree. Table matched exactly.
 *
 * Clause (2) passed under BOTH cheats, and that is correct: it asks whether a sheet exists with
 * per-cell luminance recorded. Catching a fake is (3) and (4)'s job, and they did it.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227):
 *   (1)(2)(3)(4) are ALL REDS today — no sheet and no sidecar exist, so every clause reading
 *                them fails. (3) and (4) are additionally NETS thereafter: they are what refuse
 *                (c) and a dark known-good cell.
 *   (5) PASSES TODAY — it reads the landed inventory and the cache, not the absent sheet.
 *
 * NOT TESTED:
 *   - **Whether any style looks correct.** This buys the sheet; the orchestrator grades it.
 *     No clause here asserts appearance, and a green contract is not a verdict on a hairstyle.
 *   - **Which licence column wins.** Still licence-provenance's call, still out of scope, and
 *     rendering a style permits nothing.
 *   - **Whether a style FITS an actor.** `fitsStrippedBasemesh` is a vertex-index bound, not a
 *     fitting result. Nothing here bakes or fits anything.
 *   - Eyes, eyebrows, faceunits, MB-Lab, CharMorph. Separate lanes, unstarted.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const INVENTORY = join(HERE, "hair-pack-licence-inventory.json");
const SHEET = join(HERE, "hair-style-sheet.png");
const SIDECAR = join(HERE, "hair-style-sheet.json");

/** #431: blanks read 0.96 / 1.82; content 26.90-45.56; #442's stills 59.79-59.85. */
const MIN_CONTENT_SD = 8;
const MIN_SHEET_BYTES = 20_000;
/** The one style already graded in a station render (2026-08-14 handoff). */
const KNOWN_GOOD_STYLE = "mhair02";

type InvRow = {
  style: string;
  headerLicence: string;
  pageLicence: string;
  maxVertRef: number | null;
  fitsStrippedBasemesh: boolean;
};
type Cell = {
  style: string;
  headerLicence: string;
  pageLicence: string;
  maxVertRef: number | null;
  fitsStrippedBasemesh: boolean;
  luminance?: { mean: number; sd: number };
};

const inventory: InvRow[] = existsSync(INVENTORY)
  ? ((JSON.parse(readFileSync(INVENTORY, "utf8")) as { rows?: InvRow[] }).rows ?? [])
  : [];
const sidecar: { cells?: Cell[] } | null = existsSync(SIDECAR)
  ? (JSON.parse(readFileSync(SIDECAR, "utf8")) as { cells?: Cell[] })
  : null;
const cells: Cell[] = sidecar?.cells ?? [];

/** SS7t: an absent sheet must FAIL loudly, never pass vacuously. */
function requireCells(): Cell[] {
  expect(
    cells.length,
    `tools/openclinxr/evidence/hair-style-sheet.json must exist with a cell per inventory row — `
      + `27 styles are cached, all 27 have a renderable .obj, and nobody has looked at any of them`,
  ).toBeGreaterThan(0);
  return cells;
}

describe("the hair sheet shows every cached style", () => {
  it("(1) RED: one cell per inventory row, including the oversized three", () => {
    // Refuses (b). Six of the 27 are toigo bobs the library rail already proves; a sheet of
    // those looks like progress and tells us nothing. A style we are refusing on topology is
    // still worth a cell — knowing what we are refusing has value.
    const invStyles = inventory.map((r) => r.style).sort();
    expect(invStyles.length, "the landed inventory must be readable").toBe(27);
    expect(requireCells().map((c) => c.style).sort(), "every inventory row needs a cell").toEqual(invStyles);
  });

  it("(2) RED: the sheet image exists and carries content", () => {
    // Refuses (d) and a blank render. #431: two grey frames cleared a 20 KB floor, one at
    // 134,991 B, reading sd 0.96 and 1.82. Bound sd, not bytes.
    expect(existsSync(SHEET), `${SHEET} missing`).toBe(true);
    expect(statSync(SHEET).size, "sheet bytes").toBeGreaterThanOrEqual(MIN_SHEET_BYTES);
    const withLum = requireCells().filter((c) => typeof c.luminance?.sd === "number");
    expect(withLum.length, "every cell must record its own luminance").toBe(cells.length);
  });

  it("(3) COUNTERWEIGHT: labels are QUOTED from the inventory, not re-derived", () => {
    // Refuses (c). If the sheet re-reads the .mhclo headers it can drift from the inventory and
    // the page/header contradiction gets re-litigated per consumer. One measurement, one owner.
    const byStyle = new Map(inventory.map((r) => [r.style, r]));
    const drift: string[] = [];
    for (const c of requireCells()) {
      const r = byStyle.get(c.style);
      if (!r) { drift.push(`${c.style}: not in the inventory`); continue; }
      if (c.headerLicence !== r.headerLicence) drift.push(`${c.style}: headerLicence "${c.headerLicence}" != "${r.headerLicence}"`);
      if (c.pageLicence !== r.pageLicence) drift.push(`${c.style}: pageLicence "${c.pageLicence}" != "${r.pageLicence}"`);
      if (c.maxVertRef !== r.maxVertRef) drift.push(`${c.style}: maxVertRef ${String(c.maxVertRef)} != ${String(r.maxVertRef)}`);
      if (c.fitsStrippedBasemesh !== r.fitsStrippedBasemesh) drift.push(`${c.style}: fits flag disagrees`);
    }
    expect(drift, `sheet labels drifted from the landed inventory`).toEqual([]);
  });

  it("(4) COUNTERWEIGHT: the known-good cell is not dark", () => {
    // mhair02 is the only style mapped to a shipped actor and already graded in a station render
    // (short male cut, ears visible, cropped crown — 2026-08-14). If the pipeline is broken, the
    // one cell whose correct appearance is independently known goes dark first.
    const m = requireCells().find((c) => c.style === KNOWN_GOOD_STYLE);
    expect(m, `${KNOWN_GOOD_STYLE} must have a cell — it is the only independently graded style`).toBeDefined();
    expect(
      (m as Cell).luminance?.sd,
      `${KNOWN_GOOD_STYLE} rendered blank; blanks measure sd 0.96-1.82 and real content 26.90+`,
    ).toBeGreaterThan(MIN_CONTENT_SD);
  });

  it("(5) VACUITY GUARD: the inventory and the .obj inputs are both really there", () => {
    // Reads the landed inventory and the cache, not the absent sheet, so it passes today and
    // keeps passing: if the inventory is trimmed, this goes red before (1) becomes unfalsifiable.
    expect(inventory.length, "#450's inventory must still hold 27 rows").toBe(27);
    const cache = join(REPO_ROOT, ".openclinxr-local/provider-cache/hair/sources");
    expect(existsSync(cache), "the hair cache must be readable").toBe(true);
    expect(
      inventory.filter((r) => r.fitsStrippedBasemesh).length,
      "24 of 27 fit the 13,380 boundary — if this moves, the inventory changed under us",
    ).toBe(24);
  });
});
