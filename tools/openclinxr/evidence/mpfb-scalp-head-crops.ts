/**
 * #359 scalp port — head-framed grade crops for the three MPFB cast actors.
 *
 * factory_step: instrument. Renders each regenerated MPFB actor through the SAME
 * product path as every other isolated subject — one dev-server boot, one
 * browser, three crops — at the #358 `focus=head` framing (head box derived from
 * the body's own bounds, `head-box-from-geometry.ts`), so the orchestrator can
 * grade the shipped scalp region against the Anny known-good crop at
 * `.openclinxr/evidence/head-focus/anny-head-front.png` at MATCHED framing.
 * The region's per-polygon boundary, face-band clearance and crown coverage are
 * what the orchestrator grades; this run produces the crops and records the
 * framing actually used (focusRegion).
 *
 * claimScope: deterministic render run + framing record. notEvidenceFor: the
 * pixel verdict itself (orchestrator grades captures).
 */

import path from "node:path";
import { renderHeadFocusCrops, type HeadCropSpec } from "./isolated-subject-harness.js";

export const MPFB_SCALP_CROP_SPECS: HeadCropSpec[] = [
  {
    rail: "mpfb",
    role: "adult_female (MPFB rail)",
    glb: "generated-humanoids/mpfb-ob-patient-aisha.glb",
    outName: "mpfb-head-front-aisha.png",
  },
  {
    rail: "mpfb",
    role: "adult_male (MPFB rail)",
    glb: "generated-humanoids/mpfb-peds-nurse-kevin.glb",
    outName: "mpfb-head-front-kevin.png",
  },
  {
    rail: "mpfb",
    role: "child (MPFB rail)",
    glb: "generated-humanoids/mpfb-peds-patient-child.glb",
    outName: "mpfb-head-front-child.png",
  },
];

export async function renderMpfbScalpHeadCrops(cwd = process.cwd()): Promise<unknown> {
  const run = await renderHeadFocusCrops({
    cwd,
    outputRoot: ".openclinxr/evidence/mpfb-scalp",
    specs: MPFB_SCALP_CROP_SPECS,
  });
  return {
    schemaVersion: run.schemaVersion,
    measuredAt: run.measuredAt,
    summary: run.summary,
    crops: run.crops.map((c) => ({
      rail: c.rail,
      role: c.role,
      view: c.view,
      imagePath: c.imagePath,
      bytes: c.bytes,
      pngDimensions: c.pngDimensions,
      frameCoverage: c.frameCoverage,
      frameSpanFraction: c.frameSpanFraction,
      focusRegion: c.focusRegion,
      subjectOnly: c.subjectOnly,
    })),
  };
}

const isMain = Boolean(
  process.argv[1]
  && (import.meta.url === `file://${path.resolve(process.argv[1])}`
    || import.meta.url.endsWith(process.argv[1]!.replaceAll("\\", "/"))),
);

if (isMain) {
  renderMpfbScalpHeadCrops()
    .then((run: any) => {
      console.log(JSON.stringify({
        crops: run.crops.map((c: any) => ({
          rail: c.rail,
          view: c.view,
          imagePath: c.imagePath,
          bytes: c.bytes,
          pngDimensions: c.pngDimensions,
          frameSpanFraction: c.frameSpanFraction,
          focusRegion: c.focusRegion,
        })),
        devServerBoots: run.summary.devServerBoots,
        browserLaunches: run.summary.browserLaunches,
        wallClockMs: run.summary.wallClockMs,
      }, null, 2));
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exitCode = 1;
    });
}
