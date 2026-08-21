import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { enumerateCachedGarments } from "./cached-garment-population.ts";

/**
 * E1 slice 1 of the superagent portfolio, 2026-08-18 — CLASS, THE FOURTH QUESTION.
 *
 * ## WHY THIS EFFORT EXISTS
 *
 * S0/S1/S2 (`bf64ff70`, `364a5b6d`, `436ea17f`) landed three green contracts consuming
 * `crudegown.mhclo` as the hospital gown. They asserted, in order: index range below the 13,380
 * helper-strip boundary; resolver id and `kind: library`; presence, PLACEMENT and provenance on the
 * baked mesh. Every assertion was true. The pixel grade showed a **floor-length cyan
 * spaghetti-strap evening dress**, and `#413` (`2987fc1b`) withdrew the whole mapping.
 *
 * The asset said so in its own header the entire time — `name CrudeGown`, author Joel Palmius.
 * "Gown" in the MakeHuman wardrobe vocabulary means a FORMAL DRESS.
 *
 *   question     | who asked it | can it see "hospital gown"?
 *   -------------|--------------|----------------------------
 *   licence      | S0 / ledger  | no
 *   index range  | S0           | no
 *   identity     | S1           | no
 *   presence     | S2           | no
 *   placement    | S2 (§11s)    | no — a floor-length dress straddles body mid-height
 *   **CLASS**    | **nobody**   | **this**
 *
 * ## WHAT THIS SLICE IS AND IS NOT
 *
 * It is an INVENTORY. It classes what is already cached from GEOMETRY, so that a name can never
 * again be mistaken for a class. It maps nothing, bakes nothing, and fits nothing — the portfolio
 * gate is a contact sheet the orchestrator grades before any `hospital_gown` mapping is proposed
 * again.
 *
 * ## POPULATION — enumerated, never hardcoded
 *
 * Every `*.mhclo` under `.openclinxr-local/provider-cache/` that is not hair and not eyes. Measured
 * 2026-08-18: **16 files, 12 unique garments** (four are duplicated under an `extracted/` path).
 * The inventory must enumerate from the cache, so a newly staged garment is IN the population the
 * day it lands rather than the day someone remembers to add it.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                                    | (1) | (2) | (3) | (4) | result
 *   --------------------------------------------------------------|-----|-----|-----|-----|--------
 *   a) today — no inventory at all                               |FAIL |FAIL |FAIL |FAIL | REFUSED
 *   b) class every garment by its FILENAME                       |pass |FAIL |FAIL |pass | REFUSED
 *   c) hardcode the 16 paths measured today                      |pass |pass |pass |FAIL | REFUSED
 *   d) call everything "other" so nothing is ever wrong          |pass |FAIL |pass |pass | REFUSED
 *   e) measure geometry per garment, enumerate from the cache    |pass |pass |pass |pass | ALL PASS
 *
 * **(b) is the one to watch and it is the exact S2 failure.** `crudegown` would be classed
 * `hospital_gown` by its name for the second time. Clause (2) is the guard: the file that is NAMED
 * gown must NOT be classed `hospital_gown`, because it is measurably ankle-length.
 *
 * **(d)** is the vacuity escape — an inventory where every row is `other` is green and useless.
 * Clause (3) requires the known-good garments to land on their correct non-`other` classes.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): **(1)–(4) are ALL RED** — no inventory exists. There is
 * no known-good column in the tree for a CLASS verdict, and that absence is itself the finding
 * (§9h): nothing here has ever been classed before, so the calibration comes from the three
 * garments whose class is not in dispute (scrub shirt, cargo pants, t-shirt).
 *
 * NOT TESTED:
 *   - That any class verdict is CLINICALLY right. The orchestrator grades a labelled contact sheet;
 *     this contract bounds only that the measurement exists, discriminates, and enumerates.
 *   - Fit, coverage, drape, poke-through, licence. All measured elsewhere.
 *   - Whether a hospital gown exists. If the inventory says NOT FOUND, that is a successful outcome.
 *
 * ## FIXED (#512)
 *
 *   Clause (4) was blind: it asserted `inv.enumeratedFrom` matches /provider-cache/ and each row's
 *   `sourcePath` contains "provider-cache" — both properties of the JSON FILE, so a hardcoded list
 *   carrying the right strings passed it and a newly staged garment stayed invisible. It now
 *   delegates to tools/openclinxr/evidence/cached-garment-population.ts and asserts the
 *   RELATIONSHIP: every in-scope garment the enumerator walks out of the cache carries a class in
 *   the inventory. No absolute count is asserted, so the guard holds on a worktree's provisioned
 *   partial cache (7 files) and on a full machine cache (44 files) alike.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const INVENTORY = join(REPO_ROOT, "tools/openclinxr/evidence/garment-class-inventory.json");
const CACHE = join(REPO_ROOT, ".openclinxr-local/provider-cache");

/** The three garments whose class is not in dispute — the calibration column (§9h). */
const KNOWN_GOOD: Readonly<Record<string, string>> = {
  "Scrub_Shirt.mhclo": "scrub",
  "cargo_pants.mhclo": "street",
  "toigo_basic_tucked_t-shirt.mhclo": "street",
};

type Row = {
  basename: string;
  sourcePath: string;
  class: string;
  hemFractionOfBody?: number;
  shoulderCoverage?: string;
  evidence?: string;
};

function inventory(): { rows: Row[]; enumeratedFrom?: string; classVocabulary?: string[] } {
  expect(
    existsSync(INVENTORY),
    `${INVENTORY} — E1 writes this; nothing in the tree has ever classed a garment`,
  ).toBe(true);
  return JSON.parse(readFileSync(INVENTORY, "utf8")) as ReturnType<typeof inventory>;
}

describe("every cached garment has a measured class", () => {
  it("(1) RED: the inventory exists and covers every cached non-hair, non-eye garment", () => {
    const inv = inventory();
    expect(Array.isArray(inv.rows) && inv.rows.length > 0, "rows").toBe(true);
    // 12 unique garments were measured on 2026-08-18; the count may grow as the cache does, so this
    // is a floor, not an equality — an inventory that shrinks below the known population is refused.
    const unique = new Set(inv.rows.map((r) => r.basename));
    expect(unique.size, `unique garments classed (12 were cached on 2026-08-18)`).toBeGreaterThanOrEqual(12);
    for (const r of inv.rows) {
      expect(typeof r.class, `${r.basename} must carry a class`).toBe("string");
      expect(r.class.length, `${r.basename} class must not be empty`).toBeGreaterThan(0);
    }
  });

  it("(2) RED: the file NAMED gown is not classed as a hospital gown", () => {
    // Refuses (b), and it is the exact S2 failure. crudegown.mhclo is measurably ankle-length; its
    // NAME is the only thing about it that says gown.
    const inv = inventory();
    const gown = inv.rows.find((r) => /crudegown/i.test(r.basename));
    expect(gown, "crudegown.mhclo must appear in the inventory").toBeTruthy();
    expect(
      gown?.class,
      `crudegown is a floor-length evening dress — classing it hospital_gown by name is the S2 defect`,
    ).not.toBe("hospital_gown");
  });

  it("(3) RED: the three undisputed garments land on their correct non-'other' classes", () => {
    // Refuses (d). An inventory where everything is "other" is green and useless.
    const inv = inventory();
    for (const [basename, expected] of Object.entries(KNOWN_GOOD)) {
      const row = inv.rows.find((r) => r.basename === basename);
      expect(row, `${basename} must appear in the inventory`).toBeTruthy();
      expect(row?.class, `${basename} calibration`).toBe(expected);
    }
    const distinct = new Set(inv.rows.map((r) => r.class));
    expect(distinct.size, "an inventory with one class for everything cannot discriminate").toBeGreaterThan(1);
  });

  it("(4) RED: the population is enumerated from the cache, not hardcoded", () => {
    // Refuses (c). A hardcoded list is wrong the day a garment is staged — which is exactly how the
    // rooms lane's crudegown sat unnoticed. §7j: whenever a check names its subjects explicitly,
    // that list is the thing that will be wrong later.
    //
    // ## FIXED (#512) — the guard was BLIND. It asserted strings in the JSON (`enumeratedFrom`
    // matches /provider-cache/, each `sourcePath` contains "provider-cache") — both properties of
    // the FILE. Nothing opened a directory, so a hardcoded list carrying the right strings passed
    // it and a newly staged garment stayed invisible. Delegate to the enumerator and assert the
    // RELATIONSHIP: the inventory covers whatever cache is actually present.
    const inv = inventory();
    expect(
      typeof inv.enumeratedFrom === "string" && /provider-cache/.test(inv.enumeratedFrom),
      "the inventory must record the cache root it walked",
    ).toBe(true);
    expect(
      Array.isArray(inv.classVocabulary) && inv.classVocabulary.length >= 3,
      "a closed class vocabulary must be recorded so a later reader knows what the verdicts mean",
    ).toBe(true);
    for (const r of inv.rows) {
      expect(
        r.sourcePath?.includes("provider-cache"),
        `${r.basename} must record the cache path it was measured from`,
      ).toBe(true);
    }
    // The population is enumerated from disk, never taken from the JSON. Every in-scope cached
    // garment must carry a class; a newly staged garment is IN the population today (#512).
    // Portable across a worktree's provisioned partial cache AND the full machine cache: this
    // asserts the relationship (coverage), never an absolute count.
    expect(existsSync(CACHE), "the provider cache must be readable for the population guard").toBe(true);
    const classed = new Set(inv.rows.map((r) => r.basename));
    for (const g of enumerateCachedGarments(CACHE)) {
      expect(classed.has(g.basename), `${g.basename} is cached and in scope but carries no class`).toBe(true);
    }
  });
});
