/**
 * Footstep-plan S1 O3 emitter: build-time contact phases of the bound
 * physician walk, for the S2 footstep planner.
 *
 * Samples the shipped physician GLB's walk clip through sampleWalkClip,
 * reduces it through walkContactPhases (same strike/liftoff crossing logic
 * as the symmetry gate), and writes physician-walk-contact-phases.json
 * beside the gate. Fails loud unless each foot carries exactly one contact
 * window (the S2 half-cycle mapping assumes it).
 *
 * Run from packages/openclinxr/factory-stations:
 *   pnpm exec tsx src/motion_retarget/emit-walk-contact-phases.ts
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MPFB_WALK_JOINTS,
  sampleWalkClip,
} from "./walk_symmetry_gate.js";
import { footBaseRowsFor, walkContactPhases } from "./walk_contact_phases.js";

const PHYSICIAN_GLB = "../../../apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb";
const CLIP = "openclinxr_retarget_walk_source";
async function main(): Promise<void> {
  const { sample, frames, durationS, sha256 } = await sampleWalkClip({
    glbPath: PHYSICIAN_GLB,
    clipName: CLIP,
    joints: MPFB_WALK_JOINTS,
  });
  const phases = walkContactPhases(sample, MPFB_WALK_JOINTS);
  if (phases.contactWindows.left !== 1 || phases.contactWindows.right !== 1) {
    throw new Error(
      `expected 1 contact window per foot, got L=${phases.contactWindows.left} R=${phases.contactWindows.right}; refusing to emit`,
    );
  }
  const here = dirname(fileURLToPath(import.meta.url));
  // GLB paths resolve against the package cwd (same convention as the gate
  // tests); run from packages/openclinxr/factory-stations.
  const glbBytes = readFileSync(resolve(PHYSICIAN_GLB));
  const glbSha256 = createHash("sha256").update(glbBytes).digest("hex");
  if (glbSha256 !== sha256) throw new Error("GLB changed mid-read; refusing to emit");
  const doc = {
    schema: "openclinxr.walk-contact-phases.v1",
    provenance: {
      glb: "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb",
      clip: CLIP,
      sha256,
      frames,
      clipSpanS: durationS,
    },
    expressions: {
      seconds: "clip-local seconds (mixer origin); plantS = interpolated 0.06 m band entry, liftS = band exit",
      cycleS: "mixer loop period = raw last timestamp (three.js LoopRepeat duration); all fractions use it",
      gateCircleS: "gate duty normalizer ((clipSpan + step) / windows, post-seam-drop); differs by one frame when the seam duplicate drops",
      plantPhase: "((plantS % cycleS) + cycleS) % cycleS / cycleS",
      liftPhase: "((liftS % cycleS) + cycleS) % cycleS / cycleS",
      stepLengthM: "gate stride proxy: stance-phase foot travel relative to the root, metres at actor scale",
      stanceDurationS: "(liftS - plantS) mod cycleS, native clip rate",
      contactFraction: "stanceDurationS / cycleS",
      stepFractionLeftToRight: "(rightPlantS - leftPlantS) mod cycleS / cycleS",
      stepFractionRightToLeft: "(leftPlantS - rightPlantS) mod cycleS / cycleS",
    },
    cycleS: phases.cycleS,
    gateCircleS: phases.gateCircleS,
    seamDroppedEndFrame: phases.seamDroppedEndFrame,
    left: phases.left,
    right: phases.right,
    stepFractionLeftToRight: phases.stepFractionLeftToRight,
    stepFractionRightToLeft: phases.stepFractionRightToLeft,
    contactWindows: phases.contactWindows,
    footBase: {
      schema: "openclinxr.walk-foot-base-rows.v1",
      expressions: {
        rows: "41 rows per foot at phase k/40 past this foot's plant; the toe in the contemporary clip-root frame projected onto the liftoff-to-next-plant segment (the plant-to-plant segment is degenerate: the shipped clip is in-place and cyclic, so consecutive plants coincide)",
        along01: "fraction along the segment: 0 at liftoff, 1 at touchdown; stance rows read 1 -> 0 (unused for stance XZ, the stance foot pins to its foothold)",
        lateralM: "signed metres off the segment, left-normal side positive",
        heightM: "toe Y minus this stance's plant toe Y",
        yawRad: "toe yaw minus segment yaw, wrapped to [-pi, pi]; recorded, not actuated",
      },
      left: footBaseRowsFor(sample, MPFB_WALK_JOINTS, {
        plantS: phases.left.plantS,
        liftS: phases.left.liftS,
        cycleS: phases.cycleS,
        foot: "left",
      }),
      right: footBaseRowsFor(sample, MPFB_WALK_JOINTS, {
        plantS: phases.right.plantS,
        liftS: phases.right.liftS,
        cycleS: phases.cycleS,
        foot: "right",
      }),
    },
  };
  const out = join(here, "physician-walk-contact-phases.json");
  writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
  process.stdout.write(
    `emitted ${out}: cycleS=${phases.cycleS.toFixed(6)} ` +
      `L plant=${phases.left.plantPhase.toFixed(4)} lift=${phases.left.liftPhase.toFixed(4)} step=${phases.left.stepLengthM.toFixed(4)}m stance=${phases.left.stanceDurationS.toFixed(4)}s ` +
      `R plant=${phases.right.plantPhase.toFixed(4)} lift=${phases.right.liftPhase.toFixed(4)} step=${phases.right.stepLengthM.toFixed(4)}m stance=${phases.right.stanceDurationS.toFixed(4)}s\n`,
  );
}

await main();
