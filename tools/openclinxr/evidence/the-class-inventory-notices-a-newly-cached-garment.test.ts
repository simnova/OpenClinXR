import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * E5 slice, 2026-08-21 — THE CLASS INVENTORY'S POPULATION GUARD IS BLIND.
 *
 * ## THE DEFECT, MEASURED — do not re-derive the control/treatment table
 *
 * `cached-garments-have-a-measured-class.test.ts` clause (4) is titled *"the population is
 * enumerated from the cache, not hardcoded"* and its docstring promises: *"a newly staged garment
 * is IN the population the day it lands rather than the day someone remembers to add it."*
 *
 * It cannot keep that promise. Clause (4) asserts that `inv.enumeratedFrom` is a string matching
 * /provider-cache/ and that each row's `sourcePath` contains "provider-cache". Both are properties
 * of the JSON FILE. Nothing in that test opens a directory. Measured 2026-08-21, two-sided, by
 * staging one 70-byte `.mhclo` under
 * `.openclinxr-local/provider-cache/garments/sources/makehuman-pants01/cortu_cargo_pants/`:
 *
 *   cache state                                  | in-scope garments | that contract
 *   ---------------------------------------------|-------------------|----------------
 *   control  (clean)                             | 16 files, 13 uniq | 4/4 pass, exit 0
 *   treatment (one garment never inventoried)    | 17 files, 14 uniq | 4/4 pass, exit 0
 *
 * The treatment is the exact scenario clause (4) names as refused — cheap fix (c), "hardcode the
 * paths measured today". A hardcoded list carrying the right `enumeratedFrom` string passes it.
 *
 * ## THE POPULATION, MEASURED 2026-08-21 (floors, not equalities — the cache grows)
 *
 *   44 `*.mhclo` under `.openclinxr-local/provider-cache/`
 *  −27 hair   (cortu_*, culturalibre_hair_*, elvs_*braid*, toigo_*bob*, mhair02, ... — these have
 *              their own inventory: `the-hair-pack-has-a-two-column-licence-inventory.test.ts`)
 *  − 1 eyes   (`eyes/makehuman-default/low-poly.mhclo` — excluded BY PATH, not by name)
 *  ─────────
 *   16 files / 13 unique in-scope garments == exactly the 16 rows / 13 unique the inventory ships.
 *
 * THE DATA IS CORRECT AND IS NOT THE DEFECT. I nearly filed `low-poly.mhclo` as uninventoried; it
 * is the eyes asset and its exclusion is right. Do not "fix" the inventory's contents.
 *
 * ## THE EXCLUSION RULE IS ENGLISH, NOT CODE — this is why the guard cannot exist yet
 *
 * "every `*.mhclo` ... that is not hair and not eyes" appears ONLY in a docstring. No module
 * applies it. So there is nothing for a population guard to call, and no way to check that the
 * rule being applied is the rule that was written down. The rule must become DATA OR CODE that
 * both the guard and a later reader can execute.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                                     | (1) | (2) | (3) | (4) | result
 *   ---------------------------------------------------------------|-----|-----|-----|-----|--------
 *   a) today — assert strings in the JSON, never open a directory |FAIL |FAIL |FAIL |pass | REFUSED
 *   b) walk the cache, exclude by a list of today's 13 basenames  |pass |FAIL |FAIL |pass | REFUSED
 *   c) widen the exclusion until any surprise file drops out      |FAIL |pass |pass |FAIL | REFUSED
 *   d) exclude nothing — call hair a garment so coverage is total |FAIL |pass |pass |FAIL | REFUSED
 *   e) walk the cache, apply a RECORDED exclusion rule, cover it  |pass |pass |pass |pass | ALL PASS
 *
 * **(c) is the one to watch.** The cheapest way to make a coverage check green is to widen the
 * exclusion until the uncovered thing is no longer in the population. Clause (4) is the
 * counterweight: the 13 known in-scope basenames must SURVIVE whatever rule is written, and hair
 * and eyes must stay out. A rule that swallows the probe also swallows a real garment.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): **(1)(2)(3) are RED today** — no enumeration module
 * exists to import. **(4) is a NET** — it is green the moment (1) works and stays green forever
 * unless someone widens the rule to buy a green coverage check.
 *
 * KNOWN-GOOD COLUMN (§9h): the three garments whose class has never been in dispute, already the
 * calibration column of the contract this repairs — Scrub_Shirt (scrub), cargo_pants (street),
 * toigo_basic_tucked_t-shirt (street). Any exclusion rule that drops one of these is wrong.
 *
 * NO SCALAR THRESHOLD APPEARS IN THIS CONTRACT. The assertion is set membership over an enumerated
 * population, so there is no epsilon to fit (§9s) and no number for an implementation to aim at.
 *
 * NOT TESTED:
 *   - Whether any class VERDICT is right. That is the contact sheet the orchestrator grades.
 *   - Whether a hospital gown exists. `hospitalGownFound: false`, measured 2026-08-18, stands.
 *   - Hair and eyes coverage. Hair has its own two-column licence inventory; eyes are out of scope.
 *   - Behaviour on a clean clone. `.openclinxr-local/` is gitignored; this contract follows the
 *     in-tree idiom (`the-hair-pack-...test.ts:233`) and HARD-REQUIRES the cache rather than
 *     skipping, because a population guard that silently passes when it cannot see the population
 *     is the #64 second-order bite and would reintroduce exactly the vacuity being repaired.
 *
 * ## FIXED (#512)
 *
 *   Module: tools/openclinxr/evidence/cached-garment-population.ts — `enumerateCachedGarments`
 *     walks the cache with readdirSync and applies GARMENT_EXCLUSION_RULE (eyes/ by directory,
 *     hair/ by directory), returning the 16 files / 13 unique in-scope garments measured above.
 *     All four clauses flipped it.fails → it.
 *   Exclusion rule: directory-based for BOTH eyes and hair. The plant preferred a filename
 *     token for hair, but o4saken_long01.mhclo and sonntag78_blond_with_headband.mhclo are hair
 *     styles whose filenames carry no hair/bob/braid/bangs/mhair token — a filename-token rule
 *     leaks them as garments and clause (3) refuses. Directory (`hair/`) is the recorded rule.
 *   Repaired: clause (4) of cached-garments-have-a-measured-class.test.ts now delegates to the
 *     enumerator (coverage: every enumerated in-scope garment must carry a class) instead of
 *     string-matching the JSON.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const CACHE = join(REPO_ROOT, ".openclinxr-local/provider-cache");
const INVENTORY = join(REPO_ROOT, "tools/openclinxr/evidence/garment-class-inventory.json");

/** Measured 2026-08-21. Floors, never equalities — the cache is expected to grow. */
const IN_SCOPE_UNIQUE_FLOOR = 13;
const HAIR_FILES_MEASURED = 27;

/** §9h — the calibration column. Any exclusion rule that drops one of these is wrong. */
const KNOWN_GOOD = ["Scrub_Shirt.mhclo", "cargo_pants.mhclo", "toigo_basic_tucked_t-shirt.mhclo"];

type CachedGarment = { basename: string; sourcePath: string };
type Enumerator = {
  enumerateCachedGarments: (cacheRoot: string) => CachedGarment[];
  GARMENT_EXCLUSION_RULE: { reason: string; test: (relPath: string) => boolean }[];
};

/**
 * The module E5 must create. Named here so the contract has something to import; the implementer
 * chooses the filename's home under `tools/openclinxr/evidence/` and records it.
 */
async function loadEnumerator(): Promise<Enumerator> {
  return (await import("./cached-garment-population.ts")) as unknown as Enumerator;
}

describe("the class inventory notices a newly cached garment", () => {
  it("(1) RED: the in-scope population is enumerated from disk by an importable module", async () => {
    expect(existsSync(CACHE), "the provider cache must be readable for any of this to mean anything").toBe(true);
    const { enumerateCachedGarments } = await loadEnumerator();
    const found = enumerateCachedGarments(CACHE);
    const names = new Set(found.map((g) => g.basename));
    expect(names.size, `unique in-scope garments (13 cached 2026-08-21; floor, cache may grow)`)
      .toBeGreaterThanOrEqual(IN_SCOPE_UNIQUE_FLOOR);
    for (const kg of KNOWN_GOOD) expect(names.has(kg), `${kg} is a known-good garment and must be in scope`).toBe(true);
    for (const g of found) expect(g.sourcePath.includes("provider-cache"), `${g.basename} path`).toBe(true);
  });

  it("(2) RED: staging a garment in the cache CHANGES the enumerated population", async () => {
    // This is the measured blindness, automated. Refuses (a) and (b): a list that cannot grow is
    // indistinguishable from a hardcoded one, which is what clause (4) of the repaired contract
    // claims to refuse and cannot see.
    const { enumerateCachedGarments } = await loadEnumerator();
    const before = new Set(enumerateCachedGarments(CACHE).map((g) => g.basename));
    const probeDir = join(CACHE, "garments/sources/zzz-population-probe");
    const probe = join(probeDir, "zzz_population_probe.mhclo");
    try {
      mkdirSync(probeDir, { recursive: true });
      writeFileSync(probe, "name ZzzPopulationProbe\nobj_file zzz.obj\nz_depth 55\n", "utf8");
      const during = new Set(enumerateCachedGarments(CACHE).map((g) => g.basename));
      expect(during.has("zzz_population_probe.mhclo"), "a staged garment must enter the population").toBe(true);
      expect(during.size, "the population must grow by exactly the staged file").toBe(before.size + 1);
    } finally {
      rmSync(probeDir, { recursive: true, force: true });
    }
    const after = new Set(enumerateCachedGarments(CACHE).map((g) => g.basename));
    expect(after.size, "removing the probe must restore the population").toBe(before.size);
  });

  it("(3) RED: the inventory is checked against that population, and the check BITES", async () => {
    const { enumerateCachedGarments } = await loadEnumerator();
    const rows = JSON.parse(readFileSync(INVENTORY, "utf8")).rows as { basename: string }[];
    const classed = new Set(rows.map((r) => r.basename));

    // Green on the real cache: the inventory covers it today (16 files / 13 unique, measured).
    for (const g of enumerateCachedGarments(CACHE)) {
      expect(classed.has(g.basename), `${g.basename} is cached and in scope but carries no class`).toBe(true);
    }

    // And it must FAIL when it should. A coverage check that cannot go red is the defect restated.
    const probeDir = join(CACHE, "garments/sources/zzz-coverage-probe");
    const probe = join(probeDir, "zzz_coverage_probe.mhclo");
    try {
      mkdirSync(probeDir, { recursive: true });
      writeFileSync(probe, "name ZzzCoverageProbe\nobj_file zzz.obj\nz_depth 55\n", "utf8");
      const uncovered = enumerateCachedGarments(CACHE).filter((g) => !classed.has(g.basename));
      expect(uncovered.map((g) => g.basename), "an uninventoried cached garment must be reported").toContain(
        "zzz_coverage_probe.mhclo",
      );
    } finally {
      rmSync(probeDir, { recursive: true, force: true });
    }
  });

  it("(4) NET: the exclusion rule is recorded, and does not swallow a real garment", async () => {
    // Refuses (c) and (d). The cheapest green for clause (3) is to widen the exclusion until the
    // uncovered file leaves the population — so the rule must be inspectable data, hair and eyes
    // must stay out, and every known-good garment must survive it.
    const { enumerateCachedGarments, GARMENT_EXCLUSION_RULE } = await loadEnumerator();
    expect(Array.isArray(GARMENT_EXCLUSION_RULE) && GARMENT_EXCLUSION_RULE.length > 0,
      "the not-hair-not-eyes rule must be executable data, not a docstring").toBe(true);
    for (const r of GARMENT_EXCLUSION_RULE) {
      expect(typeof r.reason === "string" && r.reason.length > 0, "each exclusion must record WHY").toBe(true);
    }
    const names = new Set(enumerateCachedGarments(CACHE).map((g) => g.basename));
    for (const kg of KNOWN_GOOD) expect(names.has(kg), `exclusion rule must not swallow ${kg}`).toBe(true);
    expect(names.has("low-poly.mhclo"), "the eyes asset must be excluded (it is not a garment)").toBe(false);
    const hairLeaked = [...names].filter((n) => /hair|braid|bob|bangs|mhair/i.test(n));
    expect(hairLeaked, `hair has its own inventory and must stay out (${HAIR_FILES_MEASURED} cached)`).toEqual([]);
  });
});
