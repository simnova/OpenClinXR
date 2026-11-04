/**
 * st-viteye r2 H4 — eye-focused crops of the three rebaked GLBs, the same
 * three at origin/main bytes, and the pack-blue nurse reference, through the
 * SAME product path (isolated-subject-lab focus=eyes, derived eye box).
 *
 * Baseline bytes cannot be served from /tmp: the lab resolves bodyGlb
 * against the served ui-xr tree, so the driver stages the origin/main GLBs
 * as __stviteye_r2_base_*.glb inside generated-humanoids, captures, and
 * removes them in a finally (verified absent afterwards). One dev-server
 * boot for all seven crops.
 *
 * Run: pnpm exec tsx tools/openclinxr/evidence/st-viteye-r2-eye-crops.ts
 */

import { copyFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  renderMpfbEyeFocusCrops,
  type EyeCropSpec,
} from "./isolated-subject-harness.js";

const OUT = ".openclinxr/openclaw/ceo/st-viteye/after-r2";
const SERVED_DISK = "apps/ui-xr/public/generated-humanoids";
// Server-relative prefix: the lab resolves bodyGlb against the ui-xr server
// root (public/), so specs carry generated-humanoids/... (DEFAULT_BODY form),
// while staging writes go to the on-disk path above.
const SERVED_URL = "generated-humanoids";

const BASELINES: Array<{ tag: string; tmp: string; staged: string }> = [
  { tag: "aisha", tmp: "/tmp/base-aisha.glb", staged: `${SERVED_DISK}/__stviteye_r2_base_aisha.glb` },
  { tag: "kevin", tmp: "/tmp/base-kevin.glb", staged: `${SERVED_DISK}/__stviteye_r2_base_kevin.glb` },
  { tag: "family", tmp: "/tmp/base-family.glb", staged: `${SERVED_DISK}/__stviteye_r2_base_family.glb` },
];

const SPECS = [
  { actorId: "after-aisha", role: "patient/brown", glb: `${SERVED_URL}/mpfb-ob-patient-aisha.glb`, view: "front", outName: "after-aisha-eye-front.png" },
  { actorId: "after-kevin", role: "nurse/case-brown", glb: `${SERVED_URL}/mpfb-peds-nurse-kevin.glb`, view: "front", outName: "after-kevin-eye-front.png" },
  { actorId: "after-family", role: "family/green", glb: `${SERVED_URL}/mpfb-family-partner-adult.glb`, view: "front", outName: "after-family-eye-front.png" },
  { actorId: "base-aisha", role: "patient/brown", glb: `${SERVED_URL}/__stviteye_r2_base_aisha.glb`, view: "front", outName: "base-aisha-eye-front.png" },
  { actorId: "base-kevin", role: "nurse/case-brown", glb: `${SERVED_URL}/__stviteye_r2_base_kevin.glb`, view: "front", outName: "base-kevin-eye-front.png" },
  { actorId: "base-family", role: "family/green", glb: `${SERVED_URL}/__stviteye_r2_base_family.glb`, view: "front", outName: "base-family-eye-front.png" },
  { actorId: "ref-nurse-blue", role: "nurse/pack-blue-unchanged", glb: `${SERVED_URL}/mpfb-clinical-nurse-adult.glb`, view: "front", outName: "ref-nurse-blue-eye-front.png" },
// EyeCropSpec.actorId is a #354 union ("aisha"|"kevin"|"child"); r2 needs
// after/base tags, which the runner only uses for subjectId/label. Cast is
// runtime-safe (tsx strips types; fields used: actorId/role/glb/view/outName).
] as unknown as EyeCropSpec[];

async function main(): Promise<void> {
  for (const b of BASELINES) await copyFile(b.tmp, path.resolve(b.staged));
  try {
    const run = await renderMpfbEyeFocusCrops({ outputRoot: OUT, specs: SPECS });
    console.log(JSON.stringify({
      crops: run.crops.map((c) => ({
        actorId: c.actorId, imagePath: c.imagePath, bytes: c.bytes,
        pngDimensions: c.pngDimensions, focusRegion: c.focusRegion,
      })),
      wallClockMs: run.summary.wallClockMs,
    }, null, 2));
  } finally {
    for (const b of BASELINES) await rm(path.resolve(b.staged), { force: true });
  }
}

void 0;

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
