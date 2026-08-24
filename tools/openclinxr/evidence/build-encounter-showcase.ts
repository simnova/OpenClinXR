/**
 * Generates `docs/encounters/showcase-manifest.json` — one entry per shipped encounter.
 *
 * WHY GENERATED. #643: the showcase is also the surface the orchestrator grades scene layout from,
 * so staleness is a lie rather than an embarrassment. A hand-maintained gallery drifts the first time
 * an encounter changes, and a drifted grading surface reports the product's state wrongly. The site
 * went 3 days without an update while 10 product fixes landed; that is the failure mode.
 *
 * WHAT IT REFUSES TO DO. It does NOT invent a grade. An entry whose image has not been graded gets
 * `gradeVerdict: null`, and the contract (#643 clause 2) fails on null — so an ungraded gallery
 * cannot be published as if someone had looked. D12's recorded failure is exactly that: 26 KB Model
 * Vetting ERROR screenshots shipped as evidence because `pages:validate` checks existence only.
 *
 * The commit stamp is per entry and comes from the capture, not from now: an image describes the tree
 * it was rendered from, and a reader grading it must be able to tell which.
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const REPO = join(dirname(new URL(import.meta.url).pathname), "../../..");
const CAPTURES = join(REPO, ".openclinxr/evidence/ui-xr-environment-room/latest");
const OUT_DIR = join(REPO, "docs/encounters");
const IMG_DIR = join(OUT_DIR, "images");
const MANIFEST = join(OUT_DIR, "showcase-manifest.json");
/** Grades live here, written by a human/orchestrator who opened the image. Never invented. */
const GRADES = join(REPO, ".openclinxr/evidence/encounter-showcase-grades.json");

export type ShowcaseEntry = {
  scenarioId: string;
  title: string;
  summary: string;
  image: string;
  gradeVerdict: string | null;
  gradedAt: string | null;
  capturedAtHeadSha: string | null;
};

/** Encounter ids come from what SHIPS — never a literal list, or the gallery silently omits the newest. */
export function shippedEncounterIds(capturesDir = CAPTURES): string[] {
  if (!existsSync(capturesDir)) return [];
  return readdirSync(capturesDir).filter((f) => f.endsWith("-room.png"))
    .map((f) => f.replace("-room.png", "")).sort();
}

/** Summary from the scenario bank, never hand-authored — hand copy drifts from the case it describes. */
export function summaryFor(scenarioId: string, repo = REPO): string {
  const dirs = [join(repo, "packages/openclinxr/scenario-fixtures/src")];
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))) {
      const src = readFileSync(join(d, f), "utf8");
      const at = src.indexOf(`"${scenarioId}"`);
      if (at < 0) continue;
      const seg = src.slice(at, at + 12_000);
      const m = /description:\s*"([^"]{20,400})"/u.exec(seg);
      if (m) return m[1]!;
    }
  }
  return "";
}

const titleFor = (id: string): string =>
  id.replace(/_v\d+$/u, "").split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

const readGrades = (): Record<string, { verdict: string; at: string }> => {
  try { return JSON.parse(readFileSync(GRADES, "utf8")) as Record<string, { verdict: string; at: string }>; }
  catch { return {}; }
};

const captureHeadSha = (): string | null => {
  // The manifest beside the captures records when they were generated; the sha is the tree they
  // describe. Absent rather than guessed when the capture pipeline did not record one.
  try {
    const m = JSON.parse(readFileSync(join(CAPTURES, "capture-manifest.json"), "utf8")) as Record<string, unknown>;
    const sha = m["headSha"] ?? m["commit"] ?? null;
    return typeof sha === "string" ? sha : null;
  } catch { return null; }
};

export function buildShowcase(): { entries: ShowcaseEntry[]; ungraded: string[]; missingSha: number } {
  const grades = readGrades();
  const sha = captureHeadSha();
  const entries: ShowcaseEntry[] = [];
  mkdirSync(IMG_DIR, { recursive: true });
  for (const id of shippedEncounterIds()) {
    const src = join(CAPTURES, `${id}-room.png`);
    const rel = `encounters/images/${id}.png`;
    if (existsSync(src)) copyFileSync(src, join(IMG_DIR, `${id}.png`));
    const g = grades[id];
    entries.push({
      scenarioId: id, title: titleFor(id), summary: summaryFor(id), image: `/${rel}`,
      gradeVerdict: g?.verdict ?? null, gradedAt: g?.at ?? null, capturedAtHeadSha: sha,
    });
  }
  const ungraded = entries.filter((e) => !e.gradeVerdict).map((e) => e.scenarioId);
  writeFileSync(MANIFEST, `${JSON.stringify({
    schemaVersion: "openclinxr.encounter-showcase.v1",
    generatedAt: new Date().toISOString(),
    generatorHeadSha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim(),
    entries,
  }, null, 2)}\n`, "utf8");
  return { entries, ungraded, missingSha: entries.filter((e) => !e.capturedAtHeadSha).length };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const r = buildShowcase();
  console.log(`SHOWCASE  entries=${r.entries.length}  ungraded=${r.ungraded.length}  missing capture sha=${r.missingSha}`);
  if (r.ungraded.length) console.log(`  ungraded (contract stays RED until a human grades these):\n    ${r.ungraded.join("\n    ")}`);
}
