/**
 * generate-physics-bone-transforms.ts
 *
 * Offline CLI that runs a Rapier palpation simulation with a dynamic
 * abdomen body (spring-constrained) and outputs precomputed bone
 * transform deltas for UI-XR consumption.
 *
 * Physics engine stays in the arena package; UI-XR imports only the
 * generated JSON artifact — no @dimforge/rapier in ui-xr deps.
 *
 * Usage:
 *   npx tsx src/cli/generate-physics-bone-transforms.ts \
 *     --output apps/ui-xr/public/physics-touch/ed-palpation-bone-transforms.json \
 *     --scenario palpation --engine-id rapier --seed 42 \
 *     --bones spine,chest,upper_arm.L,upper_arm.R,clavicle.L,clavicle.R
 */

import {
  initRapier as initRapierModule,
  isRapierInitialized as rapierReady,
  getRapierModule,
  type RapierModule,
} from "../adapters/rapier-real.js";
import { buildPalpationInputLog, DEFAULT_PALPATION_SITES } from "../scenarios/palpation.js";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Vec3 = { x: number; y: number; z: number };
type Quat = { x: number; y: number; z: number; w: number };

type BoneTransformDeltas = Record<string, { position: Vec3; rotation: Quat }>;

type BoneTransformFrame = {
  /** Monotonic tick index (matches physics InputLog tick). */
  tick: number;
  /** Per-bone position/rotation deltas to apply on top of bind pose. */
  boneDeltas: BoneTransformDeltas;
};

type PhysicsBoneTransformsArtifact = {
  schemaVersion: "openclinxr.physics-bone-transforms.v1";
  generatedAt: string;
  engineId: string;
  seed: number;
  fixedDt: number;
  scenarioId: string;
  /** Names of GLB bones that receive transforms (in order). */
  bones: string[];
  /** Per-tick bone transform deltas. */
  frames: BoneTransformFrame[];
  /** Anatomical reference: abdomen center in world space at bind. */
  abdomenRestPosition: Vec3;
  abdomenRestDimensions: Vec3;
  notEvidenceFor: readonly string[];
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_BONES = ["spine", "chest", "upper_arm.L", "upper_arm.R", "clavicle.L", "clavicle.R"];
const DEFAULT_OUTPUT = "apps/ui-xr/public/physics-touch/palpation-bone-transforms.json";

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs();
  const outputPath = path.resolve(args.output ?? DEFAULT_OUTPUT);

  console.log(`[physics-bone-transforms] Initializing Rapier WASM...`);
  await initRapierModule();
  if (!rapierReady()) {
    throw new Error("Rapier WASM failed to initialize");
  }

  console.log(`[physics-bone-transforms] Building palpation simulation (seed=${args.seed})...`);
  const RAPIER = getRapierModule();
  const frames = runPalpationSimulation(args, RAPIER);

  const artifact: PhysicsBoneTransformsArtifact = {
    schemaVersion: "openclinxr.physics-bone-transforms.v1",
    generatedAt: new Date().toISOString(),
    engineId: args.engineId ?? "rapier",
    seed: args.seed,
    fixedDt: 1 / 60,
    scenarioId: "palpation_four_quadrant",
    bones: args.bones,
    frames,
    abdomenRestPosition: { x: 0, y: 0.5, z: 0.3 },
    abdomenRestDimensions: { x: 0.15, y: 0.12, z: 0.08 },
    notEvidenceFor: [
      "clinical_validity",
      "exam_equivalence",
      "scoring",
      "learner_readiness",
      "production_asset_readiness",
    ],
  };

  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(artifact, null, 2));
  console.log(`[physics-bone-transforms] Wrote ${artifact.frames.length} frames → ${outputPath}`);
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function runPalpationSimulation(
  args: CliArgs,
  RAPIER: RapierModule,
): BoneTransformFrame[] {

  const gravity = { x: 0.0, y: -9.81, z: 0.0 };
  const world = new RAPIER.World(gravity);
  world.timestep = 1 / 60;

  // --- Abdomen: dynamic body, spring-constrained to a fixed anchor ---
  const abdomenAnchorDesc = RAPIER.RigidBodyDesc.fixed();
  abdomenAnchorDesc.translation = { x: 0, y: 0.5, z: 0.3 };
  const anchorRb = world.createRigidBody(abdomenAnchorDesc);

  const abdomenDesc = RAPIER.RigidBodyDesc.dynamic();
  abdomenDesc.translation = { x: 0, y: 0.5, z: 0.3 };
  abdomenDesc.setAdditionalMass(3.0);
  const abdomenRb = world.createRigidBody(abdomenDesc);

  // Box collider approximating the abdominal region
  const abdomenColliderDesc = RAPIER.ColliderDesc.cuboid(0.15, 0.12, 0.08);
  abdomenColliderDesc.translation = { x: 0, y: 0, z: 0 };
  abdomenColliderDesc.density = 1.0;
  world.createCollider(abdomenColliderDesc, abdomenRb);

  // Spring joint: abdomen anchored to the fixed anchor
  // JointData.spring(rest_length, stiffness, damping_ratio, anchor1, anchor2)
  const springJoint = RAPIER.JointData.spring(
    0.04,                    // rest_length
    800.0,                   // stiffness
    1.0,                     // damping_ratio
    { x: 0, y: 0, z: 0 },  // anchor1 (in anchorRb local space)
    { x: 0, y: 0, z: 0 },  // anchor2 (in abdomenRb local space)
  );
  world.createImpulseJoint(springJoint, anchorRb, abdomenRb, true);

  // --- Exam table (fixed) ---
  const tableDesc = RAPIER.RigidBodyDesc.fixed();
  tableDesc.translation = { x: 0, y: 0.3, z: 0 };
  const tableRb = world.createRigidBody(tableDesc);
  const tableColliderDesc = RAPIER.ColliderDesc.cuboid(1.0, 0.05, 0.8);
  world.createCollider(tableColliderDesc, tableRb);

  // --- Palpation hand (kinematic position-based) ---
  const handDesc = RAPIER.RigidBodyDesc.kinematicPositionBased();
  handDesc.translation = { x: 0, y: 0.8, z: 0.6 };
  const handRb = world.createRigidBody(handDesc);

  const handColliderDesc = RAPIER.ColliderDesc.ball(0.04); // ~4cm fingertip
  handColliderDesc.translation = { x: 0, y: 0, z: 0 };
  handColliderDesc.density = 1.0;
  world.createCollider(handColliderDesc, handRb);

  // --- Build input log ---
  const sites = DEFAULT_PALPATION_SITES.map((site) => ({
    ...site,
    // Move palpation sites slightly closer (Z=0.3 → z=0.34) so hand
    // contacts and displaces the abdomen (which is at z=0.3).
    targetPosition: {
      ...site.targetPosition,
      z: 0.34,
    },
  }));

  const log = buildPalpationInputLog({
    ticks: 360, // 6 seconds at 60 Hz
    forcePeak: 0.8,
    sites,
    dwellTicks: 60,     // 1 second per site
    transitionTicks: 15, // 0.25s transitions
  });

  // --- Run simulation, record abdomen displacement each frame ---
  const abdomenRestPos = { x: 0, y: 0.5, z: 0.3 };

  const frames: BoneTransformFrame[] = [];

  for (const input of log.entries) {
    // Update hand position from input
    for (const pose of input.jointPoses) {
      handRb.setNextKinematicTranslation({
        x: pose.position.x,
        y: pose.position.y,
        z: pose.position.z,
      });
      handRb.setNextKinematicRotation({
        x: pose.rotation.x,
        y: pose.rotation.y,
        z: pose.rotation.z,
        w: pose.rotation.w,
      });
    }

    // Step physics
    world.step();

    // Read abdomen displacement
    const abdPos = abdomenRb.translation();
    const abdRot = abdomenRb.rotation();

    const deltaZ = abdPos.z - abdomenRestPos.z; // inward push (+)
    const deltaY = abdPos.y - abdomenRestPos.y; // upward/downward
    const deltaX = abdPos.x - abdomenRestPos.x; // lateral

    // --- Map abdomen displacement → bone transform deltas ---
    // spine: Z-axis push-through (abdomen → spine compresses inward)
    // chest: slight tilt from abdo push
    // upper_arm.L/R + clavicle.L/R: slight guarding rotation
    const spineDz = clampDelta(deltaZ * 0.7, -0.06, 0.06); // up to 6cm spine push
    const spineDy = clampDelta(deltaY * 0.4, -0.03, 0.03);

    const boneDeltas: BoneTransformDeltas = {};

    if (args.bones.includes("spine")) {
      boneDeltas["spine"] = {
        position: { x: clampDelta(deltaX * 0.5, -0.02, 0.02), y: spineDy, z: spineDz },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      };
    }

    if (args.bones.includes("chest")) {
      boneDeltas["chest"] = {
        position: { x: 0, y: spineDy * 0.6, z: spineDz * 0.8 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      };
    }

    // Guarding: upper arms adduct slightly when abdomen palpated
    const guardingAngle = clampDelta(Math.abs(deltaZ) * 1.5, 0, 0.15);

    if (args.bones.includes("upper_arm.L")) {
      const cos = Math.cos(guardingAngle * 0.5);
      const sin = Math.sin(guardingAngle * 0.5);
      boneDeltas["upper_arm.L"] = {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: sin, y: 0, z: 0, w: cos }, // adduct about X
      };
    }

    if (args.bones.includes("upper_arm.R")) {
      const cos = Math.cos(guardingAngle * 0.5);
      const sin = Math.sin(guardingAngle * 0.5);
      boneDeltas["upper_arm.R"] = {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: -sin, y: 0, z: 0, w: cos }, // adduct about X (mirror)
      };
    }

    if (args.bones.includes("clavicle.L")) {
      boneDeltas["clavicle.L"] = {
        position: { x: 0, y: 0, z: spineDz * 0.3 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      };
    }

    if (args.bones.includes("clavicle.R")) {
      boneDeltas["clavicle.R"] = {
        position: { x: 0, y: 0, z: spineDz * 0.3 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      };
    }

    frames.push({
      tick: input.tick,
      boneDeltas,
    });
  }

  // Free the world
  world.free();

  return frames;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampDelta(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

type CliArgs = {
  output?: string;
  scenario?: string;
  engineId?: string;
  seed: number;
  bones: string[];
};

function parseArgs(): CliArgs {
  const raw = process.argv.slice(2);
  const args: CliArgs = { seed: 42, bones: DEFAULT_BONES };

  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i]!;
    // exactOptionalPropertyTypes: only assign when the next token is present
    // (optional props accept omit | string, not explicit undefined).
    if (arg === "--output" || arg === "-o") {
      const next = raw[++i];
      if (next !== undefined) args.output = next;
    } else if (arg === "--scenario") {
      const next = raw[++i];
      if (next !== undefined) args.scenario = next;
    } else if (arg === "--engine-id") {
      const next = raw[++i];
      if (next !== undefined) args.engineId = next;
    } else if (arg === "--seed") args.seed = Number(raw[++i]) || 42;
    else if (arg === "--bones") args.bones = (raw[++i] ?? "").split(",").map((b) => b.trim()).filter(Boolean);
    else if (arg === "--help") {
      console.log(`Usage: generate-physics-bone-transforms.ts [options]
  --output, -o    Output JSON path (default: apps/ui-xr/public/physics-touch/palpation-bone-transforms.json)
  --scenario      Scenario id (palpation)
  --engine-id     Engine identifier (default: rapier)
  --seed          PRNG seed (default: 42)
  --bones         Comma-separated bone names (default: spine,chest,upper_arm.L,upper_arm.R,clavicle.L,clavicle.R)
  --help          Show this message
`);
      process.exit(0);
    }
  }

  return args;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error("[physics-bone-transforms] ERROR:", err);
  process.exit(1);
});
