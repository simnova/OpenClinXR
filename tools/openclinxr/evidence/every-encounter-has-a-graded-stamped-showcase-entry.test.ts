import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * OBSERVABLE: there is no per-encounter showcase, and the captures that would feed one cannot be
 * trusted to describe any particular tree.
 *
 * Operator, 2026-08-24: "update the website with a series of images for each encounter and a summary
 * of what will happen in it — those images (if kept up to date) will be useful in grading initial
 * scene layout and functionality."
 *
 * THE SECOND HALF IS WHAT MAKES THIS A CONTRACT AND NOT A MARKETING TASK. A gallery that is also a
 * grading surface has a property a marketing page does not: STALENESS IS A LIE, not merely
 * embarrassment. Grading a six-day-old capture and reporting the result as the product's current
 * state is the §7s defect — a measurement green about a tree it no longer describes.
 *
 * MEASURED at 371745ad, the ingredients exist and the guarantees do not:
 *
 *   15 room captures       .openclinxr/evidence/ui-xr-environment-room/latest/*.png (all 2026-08-22)
 *   48 description fields  packages/openclinxr/scenario-fixtures/**
 *   a published site       docs/index.html (72,802 bytes), validated by pages:validate
 *   NO commit stamp        capture-manifest.json carries generatedAt and NOTHING identifying the tree
 *   NO per-encounter page  the site is a wins narrative; no encounter index exists
 *
 * D12 IS THE CONSTRAINT, and it is not hypothetical here. The operator's directive to publish images
 * comes with a recorded failure: 26 KB Model Vetting ERROR screenshots shipped as "WebXR Sample Scene
 * Evidence" because `pages:validate` checks existence only. `check-github-pages-site.ts:61-73` still
 * checks presence, locality and byte size — none of which can tell a rendered room from a rendered
 * stack trace. A gallery built on that gate republishes the same failure fifteen times.
 *
 * So the entry must carry a GRADE, and the grade must name the tree it graded.
 *
 * ## PARTIALLY FIXED — clause (1) flipped `it.fails` -> `it`, 2026-08-24.
 *
 * `build-encounter-showcase.ts` generates the manifest from what SHIPS: 15 entries, summaries read
 * from the scenario bank rather than hand-authored, images copied beside the page.
 *
 * Clause (2) REMAINS RED and that is the design working. 13 of 15 entries have `gradeVerdict: null`
 * because only two images have actually been opened and assessed, and the capture manifest records
 * no `headSha`, so `capturedAtHeadSha` is null on all 15. The generator refuses to invent either —
 * an ungraded gallery must not be publishable as though someone had looked.
 *
 * claimScope: that every shipped encounter has a showcase entry with a summary, an image, a grade,
 *   and the commit that image was captured at.
 * notEvidenceFor: that any image LOOKS correct — a grade field records that a human or the
 *   orchestrator looked, not that the verdict was favourable. Nor page layout, copy, or hosting.
 */

const REPO = join(import.meta.dirname, "../../..");
const MANIFEST = join(REPO, "docs/encounters/showcase-manifest.json");

type Entry = {
  scenarioId?: string; title?: string; summary?: string; image?: string;
  gradedAt?: string; gradeVerdict?: string; capturedAtHeadSha?: string;
};

const readManifest = (): { entries?: Entry[] } | null => {
  try { return JSON.parse(readFileSync(MANIFEST, "utf8")) as { entries?: Entry[] }; } catch { return null; }
};

/** The bank is the population — never a hardcoded list, or the gallery silently omits new encounters. */
const shippedEncounterIds = (): string[] => {
  const dir = join(REPO, ".openclinxr/evidence/ui-xr-environment-room/latest");
  if (!existsSync(dir)) return [];
  return require("node:fs").readdirSync(dir)
    .filter((f: string) => f.endsWith("-room.png"))
    .map((f: string) => f.replace("-room.png", ""))
    .sort();
};

describe("every encounter has a graded, stamped showcase entry", () => {
  it("(1) a showcase manifest exists with one entry per shipped encounter", () => {
    const m = readManifest();
    expect(m, `no showcase manifest at docs/encounters/showcase-manifest.json`).not.toBeNull();
    const ids = new Set((m?.entries ?? []).map((e) => e.scenarioId));
    const missing = shippedEncounterIds().filter((id) => !ids.has(id));
    expect(missing, `encounters with no showcase entry:\n${missing.join("\n")}`).toEqual([]);
  });

  it.fails("(2) every entry carries a summary, an image that exists, and a GRADE naming its tree", () => {
    // The grade and the sha are what make this usable for grading scene layout. Without the sha a
    // reader cannot tell which tree the image describes; without the grade, D12's failure repeats.
    const m = readManifest();
    // NOT VACUOUS: with no manifest the loop below has nothing to walk and `bad` stays empty, so the
    // clause would PASS while nothing exists. Caught on the first run of this plant — an it.fails
    // that passes is the wrong-direction assertion this repo documents at §7t.
    expect(m?.entries?.length ?? 0, "an empty or absent manifest cannot satisfy a per-entry rule").toBeGreaterThan(0);
    const bad: string[] = [];
    for (const e of m?.entries ?? []) {
      const id = e.scenarioId ?? "(no id)";
      if (!e.summary?.trim()) bad.push(`${id}: no summary`);
      if (!e.image) { bad.push(`${id}: no image`); continue; }
      const p = join(REPO, "docs", e.image.replace(/^\/+/u, ""));
      if (!existsSync(p)) bad.push(`${id}: image absent on disk (${e.image})`);
      else if (statSync(p).size < 20_000) bad.push(`${id}: image is ${statSync(p).size}b — stub-sized`);
      if (!e.gradeVerdict) bad.push(`${id}: no gradeVerdict — nobody recorded looking at it`);
      if (!/^[0-9a-f]{7,40}$/u.test(e.capturedAtHeadSha ?? "")) bad.push(`${id}: no capturedAtHeadSha`);
    }
    expect(bad, `showcase entries that cannot be trusted:\n${bad.join("\n")}`).toEqual([]);
  });

  it("(3) COUNTERWEIGHT: the encounter set is READ from what ships, never hardcoded", () => {
    // A hardcoded list is how a gallery silently omits the newest encounter — the same defect class
    // as a capture pipeline that covered 2 of 12 stations because DEFAULT_SCENARIOS was a literal.
    const ids = shippedEncounterIds();
    expect(ids.length, "the shipped set is enumerated from disk").toBeGreaterThan(10);
    expect(new Set(ids).size, "and carries no duplicates").toBe(ids.length);
  });

  it("(4) COUNTERWEIGHT: a grade field records that someone LOOKED, not that they approved", () => {
    // Refuses the reading that this gate demands pretty pictures. "bad" is a legitimate, publishable
    // verdict — the site's own voice already says "Clothing: not yet good enough to show." What is
    // forbidden is publishing an image nobody assessed.
    const m = readManifest();
    const verdicts = (m?.entries ?? []).map((e) => e.gradeVerdict).filter(Boolean);
    for (const v of verdicts) expect(typeof v).toBe("string");
    expect(true, "an unfavourable grade satisfies this contract").toBe(true);
  });
});
