import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * E1 slice 3 — THE PORTFOLIO GATE. A labelled contact sheet the ORCHESTRATOR grades.
 *
 * ## WHY A SHEET AND NOT ANOTHER NUMBER
 *
 * E1 slice 1 landed (`d9d8a95c`) and classed 16 cached `.mhclo` rows from geometry:
 *
 *     crudegown.mhclo          evening_dress   hem 0.0299   strap
 *     Scrub_Shirt.mhclo        scrub           hem 0.5544   sleeve
 *     crudelabcoatopen.mhclo   labcoat         hem 0.2684   sleeve
 *     cargo_pants.mhclo        street          hem 0.0411   no_shoulder_contact
 *     toigo_flats.mhclo        footwear        hem 0.0159   no_shoulder_contact
 *
 * **hospital_gown: NOT FOUND.** No row carries it.
 *
 * The numbers independently reproduced the pixel grade that killed S2 — `crudegown` at 3% of body
 * height with straps is a floor-length evening dress, exactly what the render showed. That agreement
 * is encouraging and it is NOT sufficient: hem and shoulder-contact are two scalars, and the whole
 * lesson of this campaign is that a scalar cannot see a garment (§6e — two instruments agreeing is
 * not correctness; both are blind to the same thing).
 *
 * **So the class verdicts get looked at before any of them is trusted to gate a mapping.** The
 * superagent named this sheet the only mid-portfolio gate: when it exists, E1 STOPS and reports
 * before anyone maps `hospital_gown` again.
 *
 * ## WHAT THIS CONTRACT CAN AND CANNOT DO
 *
 * It bounds that the sheet EXISTS, covers EVERY unique garment, and carries the class each garment
 * was actually assigned by the landed inventory. It cannot and does not assert that any verdict is
 * RIGHT — that is a pixel judgement and it is the orchestrator's, not a worker's and not a clause's.
 * §8n: `exists:` plus a byte floor teaches "the capture ran" and nothing more, so no byte floor is
 * set here (§9l: a floor chosen to exclude a stub also reshapes an honest artifact).
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                                 | (1) | (2) | (3) | (4) | result
 *   -----------------------------------------------------------|-----|-----|-----|-----|--------
 *   a) today — no sheet                                       |FAIL |FAIL |FAIL | pass| REFUSED
 *   b) render only the interesting garments (gown + scrubs)   |pass |pass |FAIL | pass| REFUSED
 *   c) re-class in the sheet instead of reading the inventory |pass |FAIL | pass| pass| REFUSED
 *   d) render every garment, labels from the landed inventory |pass |pass | pass| pass| ALL PASS
 *
 * **(b) is the one to watch.** A five-cell sheet of the garments someone already suspects is how a
 * survey confirms its author. Clause (3) requires a cell for every unique garment the inventory
 * classed, so a garment nobody is thinking about still has to be looked at.
 *
 * **(c)** would let the sheet disagree with the artifact that gates the mapping. The labels must come
 * FROM the landed inventory, so what I grade is what the factory believes.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): **(1), (2) and (3) are the REDs** — no sheet exists.
 * **(4) passes today** — it reads the landed inventory, not the absent sheet, and refuses a run where
 * the inventory has collapsed to one class.
 *
 * NOT TESTED:
 *   - That any class verdict is correct. The orchestrator grades the pixels; no clause asserts it.
 *   - That the sheet is legible, well-framed or lit. Also a pixel judgement.
 *   - Fit, drape, coverage, poke-through, licence. Measured elsewhere or not at all.
 *   - Whether a hospital gown exists. The inventory says NOT FOUND; this sheet is how that verdict
 *     gets looked at before it is believed.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const INVENTORY = join(REPO_ROOT, "tools/openclinxr/evidence/garment-class-inventory.json");
const SHEET = join(REPO_ROOT, "tools/openclinxr/evidence/garment-class-sheet.png");
const SHEET_INDEX = join(REPO_ROOT, "tools/openclinxr/evidence/garment-class-sheet.json");

type InvRow = { basename: string; class: string };
type CellRow = { basename: string; class: string; cell?: number };

function inventoryRows(): InvRow[] {
  expect(existsSync(INVENTORY), `${INVENTORY} — landed by E1 slice 1 (d9d8a95c)`).toBe(true);
  const inv = JSON.parse(readFileSync(INVENTORY, "utf8")) as { rows: InvRow[] };
  return inv.rows;
}

/** Unique by basename — the inventory carries four garments twice under an `extracted/` path. */
function uniqueGarments(): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of inventoryRows()) if (!m.has(r.basename)) m.set(r.basename, r.class);
  return m;
}

function sheetIndex(): { cells: CellRow[]; renderer?: string; sheet?: string } {
  expect(
    existsSync(SHEET_INDEX),
    `${SHEET_INDEX} — the sidecar naming what is in each cell; a PNG alone cannot be checked`,
  ).toBe(true);
  return JSON.parse(readFileSync(SHEET_INDEX, "utf8")) as ReturnType<typeof sheetIndex>;
}

describe("the garment class sheet shows every classed garment", () => {
  it("(1) RED: the sheet and its cell index both exist", () => {
    expect(existsSync(SHEET), `${SHEET} — the artifact the orchestrator grades`).toBe(true);
    // No byte floor (§9l): a floor picked to exclude a stub also reshapes an honest artifact, and
    // §8n — exists+min-bytes teaches a worker that "the capture ran" is the obligation. It is not.
    expect(statSync(SHEET).size, "a zero-byte PNG is not a render").toBeGreaterThan(0);
    const idx = sheetIndex();
    expect(Array.isArray(idx.cells) && idx.cells.length > 0, "cells").toBe(true);
    expect(typeof idx.renderer, "the sheet must name the renderer that produced it (§10y)").toBe("string");
  });

  it("(2) RED: every cell's label is the class the landed inventory assigned", () => {
    // Refuses (c). What I grade must be what the factory believes, or the grade gates nothing.
    const inv = uniqueGarments();
    for (const cell of sheetIndex().cells) {
      const expected = inv.get(cell.basename);
      expect(expected, `${cell.basename} appears in the sheet but not in the inventory`).toBeTruthy();
      expect(cell.class, `${cell.basename} label must match the inventory`).toBe(expected);
    }
  });

  it("(3) RED: every unique classed garment has a cell — no silent truncation", () => {
    // Refuses (b). A sheet of only the suspicious garments is a survey that confirms its author.
    const inv = uniqueGarments();
    const shown = new Set(sheetIndex().cells.map((c) => c.basename));
    const missing = [...inv.keys()].filter((b) => !shown.has(b));
    expect(missing, `garments classed but never rendered: ${missing.join(", ")}`).toEqual([]);
  });

  it("(4) VACUITY GUARD: the landed inventory still discriminates", () => {
    // Reads the inventory, not the absent sheet, so it passes today. If the inventory ever collapses
    // to a single class, clauses (2) and (3) become unfalsifiable together.
    const inv = uniqueGarments();
    expect(inv.size, "unique garments classed by E1 slice 1").toBeGreaterThanOrEqual(12);
    expect(new Set(inv.values()).size, "distinct classes").toBeGreaterThan(1);
  });
});
