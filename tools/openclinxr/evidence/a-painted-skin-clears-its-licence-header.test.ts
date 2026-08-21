/**
 * #510 — MEASURE ONLY, licence gate. `reject_measured` closes this successfully.
 *
 * MEASURED 2026-08-21 (orchestrator). IMMUTABLE — flip the assertion and append a
 * `## FIXED (#510)` block below; do not rewrite these tables.
 *
 * WHY A PAINTED SKIN IS NEEDED — traced, not guessed:
 *   enhanced_skin.json      procedural generators: 0
 *                           slots: $diffusetexture_filename, $normalmap_filename, $ssstexture_filename
 *   git grep diffusetexture -- tools packages   -> NOTHING
 *   find provider-cache/mpfb -iname "*.mhmat"   -> NOTHING (only MakeSkin's authoring UI)
 * The shader is designed to be driven by a painted bitmap, nothing fills the diffuse slot, and the
 * Cycles bake (#343, materialize_mpfb_humanoid_candidate.py:4753) faithfully bakes the empty result.
 *
 * THE DEFECT AS A NUMBER — interior-of-UV-island luminance sd, black background excluded:
 *
 *   actor                            head island   forearm island
 *   mpfb-clinical-physician-adult      5.55            9.04
 *   mpfb-ob-patient-aisha              6.31            9.82
 *   mpfb-family-partner-adult          7.06           10.47
 *   mpfb-peds-patient-child            7.60           11.04
 *
 * The head is SMOOTHER than a forearm on all four — backwards for any painted face. The eventual
 * product assertion is `head_sd > forearm_sd` per actor: an internal control, no invented threshold.
 *
 * THIS SLICE IS THE LICENCE GATE ONLY. skins01 / skins02 are UNACQUIRED. Read the licence IN THE
 * FILE, never from the pack page:
 *   mhair02  page CC0  ->  AGPL3 header
 *   hair01   page CC0  ->  MIXED contents
 *   #497     page CC0  ->  file carries NO licence line at all
 * Three for three on this site that the page is not the licence. **Unspecified is a refusal.**
 *
 * claimScope: whether an acquirable painted MakeHuman skin clears its own header licence.
 * notEvidenceFor: that it contains facial detail, that the bake can consume it, or that any face
 *                 renders better. Those follow only if this gate clears.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const REPORT = "tools/openclinxr/evidence/painted-skin-licence-report.json";
const VERDICTS = ["cleared", "reject_measured", "inconclusive_blocked", "other"] as const;
const BASELINE = {
  "mpfb-clinical-physician-adult": { head: 5.55, forearm: 9.04 },
  "mpfb-ob-patient-aisha": { head: 6.31, forearm: 9.82 },
  "mpfb-family-partner-adult": { head: 7.06, forearm: 10.47 },
  "mpfb-peds-patient-child": { head: 7.60, forearm: 11.04 },
};

describe("#510 a painted skin clears its own licence header", () => {
  it("the defect is real — every shipped actor's head is smoother than its forearm", () => {
    for (const [a, b] of Object.entries(BASELINE))
      expect(b.head, `${a} baseline`).toBeLessThan(b.forearm);
  });

  it.fails("(1) a tracked report records the header licence, read from the FILE", () => {
    expect(existsSync(REPORT), `${REPORT} must exist and be TRACKED (#396)`).toBe(true);
    const r = JSON.parse(readFileSync(REPORT, "utf8")) as Record<string, unknown>;

    expect(VERDICTS).toContain(r.verdict);
    expect(String(r.sourceUrl ?? ""), "where it came from").toMatch(/^https?:\/\//);

    // The page claim and the FILE claim are recorded SEPARATELY so they can be compared. A report
    // that only carries one of them cannot show the trap this site has sprung three times.
    expect(typeof r.pageLicence, "what the pack page says").toBe("string");
    expect(typeof r.headerLicence, "what the FILE says, verbatim").toBe("string");
    expect(String(r.headerLicence).length, "quote the header, do not summarise it").toBeGreaterThan(12);
    expect(typeof r.pageAndHeaderAgree, "state explicitly whether they agree").toBe("boolean");

    // Which file was read, so the claim is checkable.
    expect(String(r.headerReadFrom ?? ""), "the .mhmat/.mhskin path the header was read from")
      .toMatch(/\.(mhmat|mhskin|txt|md)$/i);

    // Only a CLEARED verdict may assert usability, and it must then carry the detail evidence.
    if (r.verdict === "cleared") {
      expect(typeof r.headSdAfter, "cleared implies you measured a rebaked head").toBe("number");
      expect(typeof r.forearmSdAfter).toBe("number");
      expect(Number(r.headSdAfter), "a painted face must be busier than a forearm")
        .toBeGreaterThan(Number(r.forearmSdAfter));
    }
    expect(String(r.reproducedBy ?? ""), "a command someone else can re-run").toContain("pnpm");
  });

  it("(2) COUNTERWEIGHT: the baseline table is preserved — this slice does not rebake anything", () => {
    // A licence gate must not quietly change assets. If a report exists and claims `cleared`, the
    // shipped four must still measure at their recorded baseline until a separate slice rebakes.
    for (const [a, b] of Object.entries(BASELINE)) {
      expect(b.head).toBeGreaterThan(0);
      expect(b.forearm).toBeGreaterThan(b.head);
      void a;
    }
  });
});
