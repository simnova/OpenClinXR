import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * E6 slice 3 gate (#327 / #423) — THE LEDGER RECORDS A FALSE ABSENCE.
 *
 * ## THE DEFECT, MEASURED — do not re-derive this
 *
 * `docs/openclinxr/third-party-asset-licence-ledger.md:32`, dated 2026-08-11, states verbatim:
 *
 *     "UNSPECIFIED — no licence stated anywhere. Not in `packs/visemes02.json`, not on the pack
 *      page, no CC/GPL/public-domain string in the HTML."
 *
 * Measured on the cached pack:
 *
 * | | |
 * |---|---|
 * | json files in the pack | exactly one — `packs/visemes02.json` |
 * | entries | 15 |
 * | `license` values | **`CC0` on all 15** |
 * | author | Mika Suominen on all 15 |
 * | mtime | **2026-08-11 17:11 — the same day the row was written**, never re-downloaded |
 * | cached page HTML | **none anywhere in the pack** |
 *
 * So the row's first clause is FALSE against the file that existed when it was written. Its other
 * two clauses concern the PAGE, which this tree cannot substantiate either way because no HTML is
 * cached.
 *
 * **That clause is load-bearing.** It is the stated basis for "unspecified is a refusal" being
 * overridden by an operator assumption, for #327 staying open, and for E6.3 being blocked. A worker
 * who fetches the page, finds nothing, and re-affirms the row would be re-asserting something
 * already disproven.
 *
 * ## THE DISTINCTION THIS SLICE EXISTS TO HOLD
 *
 * A **packager claim** is a string in a manifest the packager wrote. A **page/author statement** is
 * the grant. They are different questions and the first does not answer the second — the same shape
 * as the standing crudegown lesson, where presence, placement and provenance were three questions
 * and none of them was CLASS.
 *
 * `pageVerdict` must come from an actual fetch. A run that never fetches and writes
 * `pageVerdict: "CC0"` is the failure mode; clause (2) requires a fetch record and a quoted line.
 *
 * ## NOT_FOUND IS A SUCCESSFUL OUTCOME
 *
 * `NOT_FOUND` closes the MEASUREMENT. It does **not** unblock E6.3 — only a quoted page/author
 * grant, or an operator restatement, does. Clause (3) is written so the contract goes green on
 * `NOT_FOUND`: nothing here may be satisfiable only by concluding CC0 (SS7c — a closed vocabulary
 * with no value for the honest outcome forces a misreport).
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                                      | (1) | (2) | (3) | (4) | result
 *   -----------------------------------------------------------------|-----|-----|-----|-----|--------
 *   a) today — no artifact, ledger clause still false              |FAIL |FAIL |FAIL | pass| REFUSED
 *   b) copy the JSON's CC0 into pageVerdict, never fetch           | pass|FAIL |FAIL | pass| REFUSED
 *   c) fetch, find nothing, re-affirm the row unchanged            | pass| pass|FAIL | pass| REFUSED
 *   d) strike the clause but flip the row to "finding: CC0"        | pass| pass|FAIL | pass| REFUSED
 *   e) fetch + record both columns + correct the clause only       | pass| pass| pass| pass| ALL PASS
 *
 * Row (b) col (1) was corrected from probe output: a copied verdict still populates both fields,
 * so clause (1) cannot catch it — only the missing fetch record does. That is clause (2)'s whole
 * job, and the reason it asks for bytes and a status rather than a value.
 *
 * **(d) is the one to watch.** Once the false clause is struck, promoting the packager string to a
 * licence finding is one edit away and would delete the very distinction this slice exists to hold.
 * Clause (3) requires the operator-assumption paragraph AND the re-bake revisit trigger to survive.
 *
 * ## KNOWN-GOOD COLUMN — the mhair02 row, two lines above, untouched
 *
 * `makehuman-community-mhair02` already models the correct shape: **PAGE CC0 / HEADER AGPL3**,
 * recorded as an assumption with the contradiction named and the override scoped to one uuid. It
 * is the pattern to copy and clause (4) requires it to remain intact.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (SS227): **(1), (2) and (3) are RED** — no artifact exists and
 * the false clause is still on main. **(4) passes today** and is the net that stops this slice
 * damaging the row it is modelled on.
 *
 * NOT TESTED: whether the pack is actually CC0 — that is what the fetch decides, and either answer
 * closes this measurement. Nothing about visemes01 or faceunits01. No bake, no apply, no
 * materializer edit. E6.3 stays blocked until a quoted grant exists.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const LEDGER = join(REPO_ROOT, "docs/openclinxr/third-party-asset-licence-ledger.md");
const ARTIFACT = join(REPO_ROOT, "tools/openclinxr/evidence/visemes02-licence-provenance.json");

const FALSE_CLAUSE = "Not in `packs/visemes02.json`";
const ASSUMPTION_MARKER = "STAGED UNDER AN EXPLICIT OPERATOR ASSUMPTION";
const REVISIT_TRIGGER = "must be re-baked without them";
const MHAIR02_PATTERN = "PAGE CC0 / HEADER AGPL3";
const PACK_PAGE = "https://static.makehumancommunity.org/assets/assetpacks/visemes02.html";

type Doc = {
  packagerClaim?: { source: string; license: string; entries: number; author: string };
  pageVerdict?: "CC0" | "NOT_FOUND" | string;
  pageFetch?: { url: string; httpStatus: number; bytes: number; fetchedAt: string };
  quotedLine?: string | null;
};

function doc(): Doc {
  expect(existsSync(ARTIFACT), `${ARTIFACT} — this slice writes it`).toBe(true);
  return JSON.parse(readFileSync(ARTIFACT, "utf8")) as Doc;
}
const ledger = (): string => readFileSync(LEDGER, "utf8");

describe("the visemes02 licence is a page statement, not a packager claim", () => {
  it("(1) RED: the packager claim and the page verdict are recorded as SEPARATE fields", () => {
    const d = doc();
    expect(d.packagerClaim?.source, "packager claim must name the manifest it came from").toMatch(/visemes02\.json$/);
    expect(d.packagerClaim?.license, "the manifest says CC0 — record it as a CLAIM").toBe("CC0");
    expect(d.packagerClaim?.entries, "15 entries carry it").toBe(15);
    expect(d.pageVerdict, "page verdict must be present and may be NOT_FOUND").toBeTruthy();
  });

  it("(2) COUNTERWEIGHT: the page verdict comes from a real fetch, never copied from the manifest", () => {
    // Refuses (b). A run that never fetches and writes pageVerdict: "CC0" has no fetch record.
    const d = doc();
    expect(d.pageFetch?.url, "the URL actually fetched").toBe(PACK_PAGE);
    expect(typeof d.pageFetch?.httpStatus, "HTTP status of the fetch").toBe("number");
    expect(d.pageFetch?.bytes, "bytes received — a fetch that returned nothing is not a fetch").toBeGreaterThan(0);
    if (d.pageVerdict === "NOT_FOUND") {
      expect(d.quotedLine, "NOT_FOUND means there was no licence sentence to quote").toBeNull();
    } else {
      expect(typeof d.quotedLine === "string" && d.quotedLine.length > 0, "a non-NOT_FOUND verdict needs the quoted sentence").toBe(true);
      expect(d.quotedLine, "the quote must actually mention a licence").toMatch(/licen[cs]e|CC0|public domain|creative commons/i);
    }
  });

  it("(3) RED: the false clause is struck, and the assumption survives", () => {
    // Refuses (c) — re-affirming a disproven clause — and (d) — promoting a packager string to a
    // finding. Both halves are required: strike the falsehood, keep the assumption honest.
    const src = ledger();
    expect(src.includes(FALSE_CLAUSE), `"${FALSE_CLAUSE}" is false against a same-day file and must be struck`).toBe(false);
    expect(src, "the corrected row must record what the manifest actually says").toMatch(/packs\/visemes02\.json/);
    expect(src.includes(ASSUMPTION_MARKER), "the operator-assumption paragraph must NOT be deleted").toBe(true);
    expect(src.includes(REVISIT_TRIGGER), "the re-bake revisit trigger must NOT be deleted").toBe(true);
  });

  it("(4) NET: the mhair02 row this is modelled on is left intact", () => {
    // Passes today. Stops the slice damaging the known-good pattern while editing its neighbour.
    const src = ledger();
    expect(src.includes(MHAIR02_PATTERN), "mhair02's page-vs-header separation is the pattern to copy").toBe(true);
    expect(src.includes(PACK_PAGE), "the pack page URL stays on the row").toBe(true);
  });
});
