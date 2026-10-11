/**
 * Pinned-turn step 0b: arrival probe (physician first).
 *
 * Reuses production runApproach + decodeArrivalTurnRig (D1, no new instruments).
 * Prints the first settling frame's slot XZ + heading (the arrival point/heading
 * the turn take must start from), the intent target/heading, and the toe tracks
 * at the first settling frame (must equal the decoded rest frame: the runtime
 * snaps markers to rest on settling entry when no stop take is wired).
 *
 * Usage: mise exec -- tsx tools/openclinxr/evidence/foot-plant/pinned-turn/arrival-probe.ts [--rig physician]
 */

import { decodeArrivalTurnRig } from "../arrival-turn-cagematch.js";
import {
  intentFor,
  runApproach,
  stageWard,
} from "../../scene-closure/proofs/sc-05/runtime-approach-measurement.js";

const RIG_GLBS: Record<string, string> = {
  physician: "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb",
  nurse: "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb",
  child: "apps/ui-xr/public/generated-humanoids/mpfb-peds-patient-child.glb",
};

function wrapPi(a: number): number {
  return ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flagValue = (flag: string, fallback: string): string => {
    const index = args.indexOf(flag);
    return index >= 0 ? (args[index + 1] ?? fallback) : fallback;
  };
  const rig = flagValue("--rig", "physician");
  const glb = RIG_GLBS[rig];
  if (!glb) throw new Error(`unknown rig ${rig}`);
  const decoded = await decodeArrivalTurnRig(glb);
  const ward = stageWard();
  const intent = intentFor(ward);
  if (intent.refused) throw new Error(`approach refused: ${intent.reason}`);
  const run = runApproach({ ward, intent, seconds: 12, decoded });
  const firstSettling = run.frames.findIndex((f) => f.phase === "settling");
  const frame = run.frames[firstSettling];
  if (!frame) throw new Error("no settling frame");
  const trackL = run.trackL[firstSettling];
  const trackR = run.trackR[firstSettling];
  const arrivalDelta = wrapPi(intent.target.headingRadians - run.travelHeadingRadians);
  process.stdout.write(
    JSON.stringify(
      {
        rig,
        firstSettlingIndex: firstSettling,
        arrivalPointXZ: frame.positionXz,
        arrivalHeadingRadians: frame.headingRadians,
        arrivalHeadingDeg: (frame.headingRadians * 180) / Math.PI,
        travelHeadingDeg: (run.travelHeadingRadians * 180) / Math.PI,
        targetHeadingDeg: (intent.target.headingRadians * 180) / Math.PI,
        targetPositionXZ: intent.target.position,
        startXZ: intent.start,
        arrivalDeltaDeg: (arrivalDelta * 180) / Math.PI,
        arrivalDeltaRadians: arrivalDelta,
        toeLAtSettling: trackL?.position ?? null,
        toeRAtSettling: trackR?.position ?? null,
        decodedRestLeft: decoded.restLeft,
        decodedRestRight: decoded.restRight,
        walkFrames: run.walkFrameCount,
        settleFrames: run.settleFrameCount,
      },
      null,
      2,
    ),
  );
  process.stdout.write("\n");
}

await main();
