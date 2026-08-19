import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HELPER_STRIP_VERTEX } from "./lib/mhclo-topology.js";

/**
 * # THE GAP, MEASURED 2026-08-19 on main 41cb8231 — do not re-derive these rows
 *
 * 27 hair `.mhclo` files are cached and exactly ONE is mapped to an actor (`mhair02` on kevin,
 * under a named page-CC0 / header-AGPL3 uuid allowlist). Nothing records what the other 26 are.
 *
 * ## THE HEADER CENSUS — measured from the cached files
 *
 *   header licence                          count
 *   AGPL3 (two URL variants)                  12
 *   CC0                                        7
 *   CC-0                                       2
 *   CC BY 4.0                                  1
 *   CC_by                                      1
 *   NONE — no licence line at all               4
 *
 * ## THE PAGE SAYS SOMETHING ELSE — and the superagent fetched it, not a worker
 *
 * `https://static.makehumancommunity.org/assets/assetpacks/index.html` -> `hair01.html` lists
 * **every** included style as **CC0**, including the four headerless Cortu styles and the whole
 * AGPL3-header set. That is the `mhair02` contradiction at pack scale: page CC0 vs header
 * AGPL3/BY/NONE.
 *
 * **This inventory RECORDS the contradiction. It does not resolve it and it allows nothing.**
 * The ledger already forbids globbing this pack; only the named `mhair02` uuid keeps the
 * page-overrides-header exception. Do not widen `read_hair_mhclo_licence`.
 *
 * ## TOPOLOGY, measured with the PROVEN reader — and it removes a candidate
 *
 * `the-gown-mhclo-fits-the-stripped-basemesh.test.ts:84-97` walks the whole `verts` block and
 * maxes every index. My own first attempt used a regex assuming `^verts <n>` and returned **0
 * for all 27** — the block is a bare `verts` header followed by index rows. That instrument was
 * discarded, not reported. Re-measured with the proven logic against MADR 0052's 13,380
 * helper-strip boundary:
 *
 *   24 of 27 fit.  THREE DO NOT:
 *     culturalibre_hair_01        19143   (AGPL3 header)
 *     faydaen_hair_1              18772   (CC0 header)     <- was on the "mappable" shortlist
 *     sonntag78_junglebook_hair   14533   (AGPL3 header)
 *
 * `faydaen_hair_1` was named as mappable once header and page agreed. **Topology refuses it**,
 * which is the gate doing exactly the job it was specced for. Header/page agreement AND
 * topology leaves `culturalibre_hair_05` (12366) and `culturalibre_hair_06` (12366).
 *
 * ## THE KNOWN-GOOD COLUMN (SS9h)
 *
 * `mhair02` is the one style whose two columns are already known to disagree AND which ships on
 * a real actor: page CC0, header AGPL3, `maxVertRef` 12367, mapped to kevin. Clause (5) pins it,
 * so an inventory that collapses the two columns goes red on the one row we can check by hand.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                          | (1) | (2) | (3) | (4) | result
 *   ---------------------------------------------------|-----|-----|-----|-----|--------
 *   a) today — no inventory                            |FAIL |FAIL |FAIL |pass | REFUSED
 *   b) one licence column, copied from the header      |pass |pass |**FAIL**|pass| REFUSED  (+5 fires)
 *   c) inventory, then map the CC0-header styles       |pass |pass |pass |**FAIL**| REFUSED
 *   d) two columns, page recorded, nothing mapped      |pass |pass |pass |pass | ALL PASS
 *
 * **(b) is the whole point.** A single `licence` column loses the contradiction, and the
 * contradiction IS the finding — a pack page that says CC0 over headers that say AGPL3 is
 * exactly what made visemes02 and mhair02 hard. Clause (3) requires rows where the two columns
 * DIFFER, so a copied column cannot pass.
 *
 * **(c) is the tempting follow-on.** Seven styles carry a CC0 header and four more are headerless
 * with a CC0 page; mapping them is one table edit away. Clause (4) refuses any change to
 * `HAIR_STYLE_BY_REFERENCE` or the uuid allowlist. **This slice inventories. It maps nothing.**
 *
 * ## DESTRUCTIVE PROBE, RUN 2026-08-19 — the substitution MATCHED and caught more than predicted
 *
 * Wrote a full 27-row inventory from the real cache — real paths, real header licences, real
 * `maxVertRef` from the proven walker — with `pageLicence` COPIED from `headerLicence`. Reverted after.
 *
 *   before: 3 failed | 2 passed
 *   after:  2 failed | 3 passed   clauses (1) and (2) GREEN, clauses (3) AND (5) red
 *
 * Clause (3) refused on the mechanism:
 *   "no row has headerLicence != pageLicence ... expected 0 to be greater than or equal to 12"
 *
 * So a worker really can satisfy existence and topology with a plausible artifact that loses the
 * finding — the cheat is not a strawman. **My table predicted only (3) would fire; (5) fired too**,
 * because a copied column gives `mhair02` a page licence of AGPL3 when it is CC0. Corrected in the
 * row above rather than appended (SS7q); the counterweight is stronger than advertised.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227):
 *   (1)(2)(3) are REDS — no artifact exists, so every clause reading it fails.
 *   (4) PASSES TODAY — its mapping-table half runs unconditionally; the inventory half is
 *       guarded on rows existing. Pure net against (c). It was RED on first run because it
 *       called requireRows(), which is the #447 defect repeated — a 'net' that depends on the
 *       absent artifact is a red. Fixed before dispatch, not declared away.
 *   (5) PASSES TODAY as a vacuity guard on the cache; it becomes a real check once (1) lands.
 *
 * NOT TESTED:
 *   - **Which licence column wins.** Recording both is the deliverable; deciding is
 *     licence-provenance's call and is deliberately out of scope.
 *   - **That the page really says CC0.** The superagent read `hair01.html`; I did not re-fetch it,
 *     and no worker may (a worker reaching the network to decide a licence is what produced the
 *     visemes02 mess).
 *   - **The three oversized styles' usability.** `maxVertRef` above 13,380 means they reference
 *     helper geometry the stripped basemesh does not have. Whether an apply-before-strip path
 *     could still fit them is unmeasured.
 *   - **Anything about how the hair LOOKS.** No sheet, no render, no grade. That is E7.2.
 *   - Eyes, eyebrows, faceunits, MB-Lab, CharMorph. Separate lanes, unstarted.
 *
 * ## FIXED (#450)
 *
 *   Artifact: tools/openclinxr/evidence/hair-pack-licence-inventory.json — tracked, 27 rows,
 *   generated by tools/openclinxr/evidence/hair-pack-licence-inventory.ts from the cache.
 *   No assertion was flipped: the five clauses were written as the end-state and the
 *   artifact is what turns them green (3 failed | 2 passed -> 5 passed).
 *   Reader: `maxBodyVertexRef` extracted VERBATIM to
 *     tools/openclinxr/evidence/lib/mhclo-topology.ts (shared with the gown contract, D1);
 *     both this test and the gown test import `HELPER_STRIP_VERTEX` from that module.
 *   headerLicence: the raw `# license` token via `readHairLicenceLine`
 *     (tools/openclinxr/asset-pipeline/makeclothes/hair-licence-classify.ts:131) — the
 *     PROVEN reader, not a new parser — or the literal `NONE` when no licence line exists.
 *   pageLicence: `CC0` for every row — hair01.html for the 25 pack styles; mhair02 and
 *     male_short_hair from their community pages per the ledger's page-grant records.
 *     No network was touched; no page was re-fetched.
 *   maxVertRef: `null` + `fitsStrippedBasemesh: false` when a verts block is absent or
 *     unparseable (fails closed — unmeasured is not fit). All 27 cached files parsed
 *     today; 24 fit the 13,380 boundary; the three oversized rows match the table above.
 *   mappedToReference: "peds_nurse_kevin, adult_male_street_casual" on `mhair02` ONLY
 *     (HAIR_STYLE_BY_REFERENCE, materialize_mpfb_humanoid_candidate.py:56-70). Nothing
 *     else is mapped and no uuid is allowlisted — clause (4) fires on any other row.
 *   Row order: alphabetical by style (deterministic).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const INVENTORY = join(HERE, "hair-pack-licence-inventory.json");
const CACHE = join(REPO_ROOT, ".openclinxr-local/provider-cache/hair/sources");
const MAPPING = join(REPO_ROOT, "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py");

/** Cached hair .mhclo files, counted from disk at plant time. */
const CACHED_STYLE_COUNT = 27;

type Row = {
  style: string;
  sourcePath: string;
  headerLicence: string;
  pageLicence: string;
  maxVertRef: number | null;
  fitsStrippedBasemesh: boolean;
  mappedToReference: string | null;
};

const inventory: { rows?: Row[] } | null = existsSync(INVENTORY)
  ? (JSON.parse(readFileSync(INVENTORY, "utf8")) as { rows?: Row[] })
  : null;
const rows: Row[] = inventory?.rows ?? [];

/** SS7t: an absent or empty inventory must FAIL, never pass vacuously. */
function requireRows(): Row[] {
  expect(
    rows.length,
    `tools/openclinxr/evidence/hair-pack-licence-inventory.json must exist with a row per cached `
      + `style — ${String(CACHED_STYLE_COUNT)} .mhclo files are cached and only mhair02 is recorded anywhere`,
  ).toBeGreaterThanOrEqual(CACHED_STYLE_COUNT);
  return rows;
}

describe("the hair pack has a two-column licence inventory", () => {
  it("(1) RED: every cached style has a row with both licence columns", () => {
    for (const r of requireRows()) {
      expect(typeof r.headerLicence, `${r.style} headerLicence`).toBe("string");
      expect(typeof r.pageLicence, `${r.style} pageLicence`).toBe("string");
      expect(r.sourcePath, `${r.style} must record where it was read from`).toBeTruthy();
    }
  });

  it("(2) RED: maxVertRef is really parsed, and the boundary is applied", () => {
    // My own regex returned 0 for all 27 because the block is a bare `verts` header followed by
    // index rows. Reuse the proven walker at the-gown-mhclo-fits-the-stripped-basemesh:84-97 (D1).
    const parsed = requireRows().filter((r) => typeof r.maxVertRef === "number" && (r.maxVertRef ?? 0) > 0);
    expect(
      parsed.length,
      `maxVertRef is 0 or missing on most rows — that is the broken-regex signature, not a finding`,
    ).toBeGreaterThanOrEqual(24);
    for (const r of parsed) {
      expect(
        r.fitsStrippedBasemesh,
        `${r.style} maxVertRef ${String(r.maxVertRef)} vs boundary ${String(HELPER_STRIP_VERTEX)} — the flag must follow the number`,
      ).toBe((r.maxVertRef as number) < HELPER_STRIP_VERTEX);
    }
    const oversized = parsed.filter((r) => (r.maxVertRef as number) >= HELPER_STRIP_VERTEX).map((r) => r.style);
    expect(oversized.sort(), "the three measured oversized styles must be recorded as such").toEqual(
      ["culturalibre_hair_01", "faydaen_hair_1", "sonntag78_junglebook_hair"],
    );
  });

  it("(3) COUNTERWEIGHT: the page column is not a copy of the header column", () => {
    // Refuses (b). A single collapsed column loses the contradiction, and the contradiction is
    // the finding: 12 AGPL3 headers and 4 headerless styles against a pack page that says CC0.
    const differ = requireRows().filter((r) => r.headerLicence !== r.pageLicence);
    expect(
      differ.length,
      `no row has headerLicence != pageLicence — the page/header disagreement is the whole point `
        + `of two columns and 16 rows are measured to disagree`,
    ).toBeGreaterThanOrEqual(12);
  });

  it("(4) COUNTERWEIGHT: nothing new is mapped and no uuid is allowlisted", () => {
    // Refuses (c). Seven CC0 headers plus four CC0-page headerless styles are one table edit from
    // shipping. This slice inventories; mapping is a later, graded slice.
    const py = readFileSync(MAPPING, "utf8");
    const mapped = [...py.matchAll(/^\s*"([a-z0-9_]+)":\s*"([a-z0-9_]+)",/gmu)]
      .filter(([, , style]) => /hair|bob|braid|mhair/u.test(style ?? ""));
    expect(
      mapped.some(([, , style]) => style === "mhair02"),
      "kevin's mhair02 mapping must still be there",
    ).toBe(true);
    // The mapping-table half above runs UNCONDITIONALLY — it is a real net from day one.
    // The inventory half can only speak once the artifact exists; guarding it on `rows.length`
    // rather than requireRows() is what keeps this clause a net instead of a fourth red.
    // (SS: #447 shipped a "net" that called requireRows() and was therefore red on a clean tree.)
    if (rows.length === 0) return;
    const inventoryMapped = rows.filter((r) => r.mappedToReference !== null).map((r) => r.style);
    expect(
      inventoryMapped.sort(),
      `the inventory records a NEW mapped style — this slice maps nothing`,
    ).toEqual(["mhair02"]);
  });

  it("(5) KNOWN-GOOD: the cache is readable and mhair02 is the disagreeing exemplar", () => {
    // Reads the cache, not the absent artifact, so it passes today and keeps passing.
    expect(existsSync(CACHE), "the hair cache must be readable for any of this to mean anything").toBe(true);
    expect(existsSync(join(CACHE, "makehuman-community-male/mhair02/mhair02.mhclo")), "mhair02 is cached").toBe(true);
    if (rows.length === 0) return;
    const m = rows.find((r) => r.style === "mhair02");
    expect(m, "mhair02 must be in the inventory").toBeDefined();
    expect((m as Row).headerLicence, "mhair02 header is AGPL3").toMatch(/AGPL/iu);
    expect((m as Row).pageLicence, "mhair02 page is CC0").toMatch(/CC-?0/iu);
  });
});
