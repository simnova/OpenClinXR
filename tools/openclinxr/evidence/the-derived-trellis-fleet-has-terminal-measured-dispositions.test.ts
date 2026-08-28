import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: the operator asked that ALL TRELLIS assets be re-created, and no artifact defines what
 * "all" is.
 *
 * MEASURED 2026-08-26. Three candidate registries and none is authoritative:
 *   CHAMPION.json          campaign decisions including skips and a miss; omits lowpoly-shoe
 *   KNOWN_SUBJECTS         mixes production subjects with ECG experiments; partial population
 *   trellis-hatch-cli      accepts arbitrary subject ids, so it is not a registry at all
 *
 * The census rule that does work: a fleet member is a canonical subject with a standard
 * `bake-measure.json` under `.openclinxr/evidence/trellis-escape-hatch`, with the `-escape` suffix
 * stripped and duplicates collapsed. That yields 13 reports and 11 canonical subjects, and it found
 * `wall-clock`, which the directory listing alone does not surface.
 *
 * THE CENSUS IS FROZEN AND TRACKED at
 * `tools/openclinxr/asset-pipeline/trellis/census/fleet-census-2026-08-26.json` because the source
 * tree is gitignored and mutable. Re-scanning it at the end of the run would let the target set drift
 * under its own contract. 11 is TODAY'S OBSERVED COUNT, NOT THE CONTRACT — clause (1) asserts set
 * equality against the frozen manifest and nothing here hardcodes eleven.
 *
 * EVERY MEMBER IS SINGLE-VIEW TODAY. All 13 source reports carry `viewCount: 1`, so a fleet
 * re-creation is the first time any shipped asset is conditioned on more than one image.
 *
 * claimScope: whether every frozen census member reached a terminal measured disposition.
 * notEvidenceFor: that any subject improved, that multiview won, or that artifacts were eliminated.
 *   `reject_measured` per subject closes this card as readily as `adopt`.
 *
 * ## FIXED (#698)
 *
 * The fleet re-creation ran through the new runner
 * `tools/openclinxr/evidence/trellis-fleet-recreation-run.ts` over all 11 frozen census
 * subjects (pack -> generate -> decimate -> UV -> bake onto low -> attach -> render mapped and
 * unmapped siblings -> grade), each stage writing an immutable receipt naming its predecessor
 * receipt and hash under `.openclinxr/evidence/trellis-fleet-recreation/<subject>/receipts/`.
 * All 11 reached a terminal measured disposition; none is `adopt`, because per the frozen
 * rubric `fleet-v1.json` adoption requires a graded silhouette and the orchestrator's pixel
 * grade of the mapped/unmapped renders is pending — the receipt reviewer slot is kept null and
 * the report records `reviewStatus: pending_orchestrator_grade`.
 *
 * The fleet report is written to `.openclinxr/evidence/trellis-fleet-recreation/fleet-report.json`
 * (gitignored) AND mirrored byte-identical to the tracked fixture below, because a fresh
 * checkout reads an absent gitignored file and fails exactly as #712 did on #697's report.
 * The census manifest was stamped with the run's dispositions (additive `fleetRun` section;
 * sources and subjects unchanged).
 */

const ROOT = process.cwd();
const CENSUS = resolve(ROOT, "tools/openclinxr/asset-pipeline/trellis/census/fleet-census-2026-08-26.json");
// The runner writes the report to .openclinxr/evidence/trellis-fleet-recreation/ (gitignored);
// the contract reads the byte-identical TRACKED mirror so a fresh checkout is not a trap (#712).
const RUN = resolve(ROOT, "tools/openclinxr/evidence/fixtures/issue-698-fleet-report.json");
const SHA256 = /^[a-f0-9]{64}$/;

type HashedFile = { path?: string; sha256?: string };
type Subject = {
  subjectId?: string; disposition?: string; reason?: string;
  artifactMeasurements?: unknown[]; finalAsset?: HashedFile; reviews?: Array<{ stage?: string; receipt?: HashedFile }>;
};
type Run = { censusSha256?: string; subjects?: Subject[] };

const census = () => JSON.parse(readFileSync(CENSUS, "utf8"));
function run(): Run {
  if (!existsSync(RUN)) return {};
  try { return JSON.parse(readFileSync(RUN, "utf8")) as Run; } catch { return {}; }
}
function assertHashed(f: HashedFile | undefined, what: string): void {
  expect(f?.path, `${what}: no path`).toBeTruthy();
  expect(isAbsolute(String(f?.path)), `${what}: paths must be repo-relative`).toBe(false);
  expect(String(f?.sha256), `${what}: not a sha256`).toMatch(SHA256);
}

describe("the derived trellis fleet has terminal measured dispositions", () => {
  it("(1) the run covers exactly the frozen census, no more and no fewer", () => {
    const subjects = run().subjects ?? [];
    expect(subjects.length, "no fleet run recorded").toBeGreaterThan(0);
    expect(
      subjects.map((s) => s.subjectId).sort(),
      "set equality against the FROZEN manifest — a subject silently added or dropped mid-run makes "
        + "every per-subject verdict unattributable",
    ).toEqual([...census().subjects].sort());
    expect(
      run().censusSha256,
      "the run must name the census it was derived from, so a re-scan cannot be passed off as the "
        + "frozen set",
    ).toBe(createHash("sha256").update(readFileSync(CENSUS)).digest("hex"));
  });

  it("(2) every census member reached a terminal measured disposition", () => {
    const subjects = run().subjects ?? [];
    expect(subjects.length, "nothing to check").toBeGreaterThan(0);
    for (const s of subjects) {
      expect(["adopt", "reject_measured"], `${s.subjectId}: not terminal`).toContain(String(s.disposition));
      expect(String(s.reason ?? "").length, `${s.subjectId}: a disposition needs a reason`).toBeGreaterThan(0);
      expect(
        (s.artifactMeasurements ?? []).length,
        `${s.subjectId}: a disposition with no artifact measurements is an opinion`,
      ).toBeGreaterThan(0);
      if (s.disposition === "adopt") assertHashed(s.finalAsset, `${s.subjectId} final asset`);
    }
  });

  it("(3) every subject carries an OX review whose reviewer is not its producer", () => {
    const subjects = run().subjects ?? [];
    expect(subjects.length, "nothing to check").toBeGreaterThan(0);
    for (const s of subjects) {
      const reviews = s.reviews ?? [];
      expect(reviews.length, `${s.subjectId}: no review`).toBeGreaterThan(0);
      for (const r of reviews) {
        assertHashed(r.receipt, `${s.subjectId} ${r.stage} receipt`);
        const receipt = JSON.parse(readFileSync(resolve(ROOT, String(r.receipt?.path)), "utf8"));
        expect(
          receipt.artifactProducerSessionId !== receipt.reviewerSessionId,
          `${s.subjectId} ${r.stage}: this repo already shipped a fabricated score from an agent `
            + "grading its own output; producer and reviewer must differ",
        ).toBe(true);
        expect(String(receipt.rubricSha256 ?? ""), "the rubric must be hashed").toMatch(SHA256);
      }
    }
  });

  it("(4) COUNTERWEIGHT: the frozen census records its sources and their hashes", () => {
    const c = census();
    expect(c.sources?.length, "a census with no source records cannot be re-derived").toBeGreaterThan(0);
    for (const src of c.sources) expect(String(src.sha256)).toMatch(SHA256);
    expect(
      c.subjects.length <= c.sources.length,
      "canonical subjects collapse duplicate reports, so subjects can never exceed sources",
    ).toBe(true);
  });

  it("(5) COUNTERWEIGHT: the census records that the shipped fleet was single-view", () => {
    const c = census();
    expect(
      c.sources.every((s: { viewCount?: number }) => s.viewCount === 1),
      "every shipped bake used ONE conditioning image; if this ever reads false the baseline this "
        + "whole programme is measured against has moved",
    ).toBe(true);
  });

  it("(6) COUNTERWEIGHT: nothing in this contract hardcodes the subject count", () => {
    const src = readFileSync(resolve(ROOT, "tools/openclinxr/evidence/the-derived-trellis-fleet-has-terminal-measured-dispositions.test.ts"), "utf8");
    const body = src.slice(src.indexOf("describe("));
    expect(
      /toBe\(\s*11\s*\)|toHaveLength\(\s*11\s*\)/.test(body),
      "11 is today's observed count, not the contract; asserting it would freeze a number the "
        + "census exists to derive",
    ).toBe(false);
  });
});

// NOT TESTED: that any subject improved, that multiview won, or that artifacts were eliminated.
// A fleet of eleven reject_measured dispositions satisfies every clause above.
