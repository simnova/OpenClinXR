/**
 * #737 — head crops of the ED cast actors for the lash-LOD pixel grade.
 *
 * The lash decimation rung (ratio 0.12, error 0.005) is a derived number, not a visual
 * one: the ED lash allowance is 1,761 triangles across all four actors and meshopt lands
 * at 1,556. Whether the decimated lashes still READ as lashes at conversational distance
 * is a pixel verdict only the orchestrator can give — this run produces the crops through
 * the SAME product path as the #358 head-focus station (isolated-subject lab, focus=head,
 * 1024x1024 viewport, subject-only).
 *
 * The physician is run separately and its failure is recorded, not fatal: the lab REFUSES
 * focus=head on mpfb-clinical-physician-adult (measured neck-constriction ratio 0.871 vs
 * the 0.85 threshold; the hair-excluded silhouette's neck does not constrict enough).
 *
 * Run: pnpm exec tsx tools/openclinxr/evidence/issue-737/render-ed-head-crops.ts
 */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { renderHeadFocusCrops, type HeadCropSpec } from "../isolated-subject-harness.js";

const ED_ACTORS: HeadCropSpec[] = [
  {
    rail: "mpfb",
    role: "ED gown patient",
    glb: "generated-humanoids/mpfb-gown-adult-patient.glb",
    outName: "ed-gown-patient-head-front.png",
  },
  {
    rail: "mpfb",
    role: "ED clinical nurse",
    glb: "generated-humanoids/mpfb-clinical-nurse-adult.glb",
    outName: "ed-clinical-nurse-head-front.png",
  },
  {
    rail: "mpfb",
    role: "ED family partner",
    glb: "generated-humanoids/mpfb-family-partner-adult.glb",
    outName: "ed-family-partner-head-front.png",
  },
  {
    rail: "mpfb",
    role: "ED clinical physician",
    glb: "generated-humanoids/mpfb-clinical-physician-adult.glb",
    outName: "ed-clinical-physician-head-front.png",
  },
];

const OUT_ROOT = "tools/openclinxr/evidence/issue-737/head-crops";

const failures: Array<{ role: string; glb: string; error: string }> = [];
const produced: unknown[] = [];
for (const spec of ED_ACTORS) {
  try {
    const run = await renderHeadFocusCrops({ outputRoot: OUT_ROOT, specs: [spec] });
    produced.push(...run.crops.map((c) => ({ role: c.role, imagePath: c.imagePath, bytes: c.bytes, pngDimensions: c.pngDimensions, focusRegion: c.focusRegion })));
  } catch (err) {
    failures.push({ role: spec.role, glb: spec.glb, error: err instanceof Error ? err.message.slice(0, 400) : String(err) });
  }
}
await mkdir(path.dirname(`${OUT_ROOT}/refusals.json`), { recursive: true });
await writeFile(`${OUT_ROOT}/refusals.json`, `${JSON.stringify({ failures, note: "focus=head lab refusal is a measured derivation outcome, not a renderer failure" }, null, 2)}\n`);
console.log(JSON.stringify({ produced, failures }, null, 2));
