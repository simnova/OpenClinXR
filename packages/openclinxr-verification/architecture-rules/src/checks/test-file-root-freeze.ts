import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Test file root freeze (ArchUnit-style; "tools/openclinxr/evidence/ root never gains a .test.ts").
 *
 * WHY: tools/openclinxr/evidence/ holds 37 .test.ts files in ONE flat directory, and the
 * repo's own delegation protocol tells every worker to plant a RED there. Seven of the
 * seventeen conflict-resolving merges in 1,500 commits were test files. Shared test files
 * are the largest serialization class in this repo at 33.1% of excess-writer events, ahead
 * of source modules at 23.9%.
 *
 * WHAT IS COUNTED:
 *   Root-level .test.ts files directly under tools/openclinxr/evidence/ (no subdirectories).
 *
 * RATCHET SEMANTICS (same as checks/file-size-budgets.ts and checks/stand-in-freeze.ts):
 *   The count is frozen at the current measurement (37) and may only FALL. A new root-level
 *   test file raises the count and fails the gate. The fix is to plant the RED in a
 *   subdirectory named for its subject, never at the root. Do NOT raise the frozen number.
 *
 * ESCAPE ROUTE: A test file in a SUBDIRECTORY is never counted, so the escape route is
 * always open. Workers MUST plant REDs into a subdirectory (e.g. tools/openclinxr/evidence/<subject>/).
 *
 * DO NOT MOVE the existing 37 files. Moving them would be one enormous diff and would break
 * every path that references them; the ratchet exists so the count comes down as REDs are
 * retired and new ones land in subdirectories.
 * (2026-10-30 station-trellis sidecar, operator-approved 2026-10-30, is the narrow
 * exception: 4 trellis evidence-root tests moved to @openclinxr/trellis-evidence,
 * lowering the freeze 560 -> 556. The ratchet otherwise stands.)
 * (2026-10-31 root batch root-trellis, operator-approved 2026-10-31: 10 root tests moved
 * to @openclinxr/trellis-evidence, lowering the freeze 556 -> 546.)
 * (2026-10-31 root batch room-generate, operator-approved 2026-10-31: 17 root tests
 * moved to @openclinxr/room-generate-evidence, lowering the freeze 546 -> 529.)
 * (2026-10-31 root batch lip-sync, operator-approved 2026-10-31: 14 root lip-sync
 * evidence tests moved to @openclinxr/lip-sync-evidence, lowering the freeze
 * 529 -> 515.)
 * (2026-10-31 root batch runtime-scene, operator-approved 2026-10-31: 21 root tests moved
 * to @openclinxr/runtime-scene-evidence, lowering the freeze 515 -> 494.)
 * (2026-10-31 root batch motion-bakeoff, operator-approved 2026-10-31: 9 root tests
 * moved to @openclinxr/rig-fit-evidence, lowering the freeze 494 -> 485.)
 * (2026-10-31 root batch anny-phenotype, operator-approved 2026-10-31: 14 root tests
 * moved to @openclinxr/anny-phenotype-evidence, lowering the freeze 485 -> 471.)
 * (2026-10-31 root batch model-vetting, operator-approved 2026-10-31: 19 root tests moved,
 * 14 to @openclinxr/model-vetting-evidence and 5 to the model-vetting-snapshots/ and
 * model-vetting-tools/ subdirectories, lowering the freeze 471 -> 452.)
 * (2026-10-31 root batch garment-cache, operator-approved 2026-10-31: 2 root tests
 * moved to @openclinxr/makeclothes-evidence and 7 to
 * tools/openclinxr/evidence/garment-cache/, lowering the freeze 452 -> 443.)
 * (2026-10-31 root batch local-runtime, operator-approved 2026-10-31: 38 root tests
 * moved out, lowering the freeze 443 -> 405: 36 to @openclinxr/local-runtime-evidence
 * and 2 (host-dependent realtime-voice-transport-spike, humanoid-toolchain-bakeoff,
 * review fix 2026-10-31) to tools/openclinxr/evidence/local-runtime/.)
 * (2026-10-31 root batch iwsdk, operator-approved 2026-10-31: 24 root tests left the
 * root — 20 to @openclinxr/iwsdk-evidence, 3 known-red/manual to
 * tools/openclinxr/evidence/iwsdk/, 1 (browser-boot-inventory) returned to the root
 * after independent review (sidecar must stay fully green); freeze 405 -> 382.)
 * (2026-10-31 root batch rig-fit, operator-approved 2026-10-31: 33 root tests moved,
 * 28 to @openclinxr/rig-fit-evidence and 5 to
 * tools/openclinxr/evidence/rig-fit/, lowering the freeze 382 -> 349.)
 * (2026-10-31 root batch openclaw-evidence, operator-approved 2026-10-31: 39 root tests
 * moved, 37 to tools/openclinxr/openclaw/contracts/ and 2 red-gated (drain-loop,
 * fixture-git) to tools/openclinxr/evidence/drain-loop/ and
 * tools/openclinxr/evidence/fixture-git/, lowering the freeze 349 -> 310.)
 * (2026-10-31 root batch cast-readiness, operator-approved 2026-10-31: 33 root tests
 * moved, 30 to @openclinxr/cast-readiness-evidence and 3 red-on-main to
 * tools/openclinxr/evidence/cast-readiness-stale/, lowering the freeze 310 -> 277.)
 * (2026-10-31 root batch humanoid-bake, operator-approved 2026-10-31: 37 root tests
 * moved to @openclinxr/humanoid-bake-evidence and 3 to
 * tools/openclinxr/evidence/humanoid-bake/, lowering the freeze 277 -> 237.)
 * (2026-10-31 root batch body-param, operator-approved 2026-10-31: 21 root tests moved,
 * 15 to @openclinxr/body-param-evidence and 6 to root subdirectories (dark-factory/,
 * cue-props/, body-param/, wardrobe/, environment-artifacts/): known-red, pre-existing-red
 * and gitignored-cache files stay out of the sidecar per T12/T6/T7, lowering the
 * freeze 237 -> 216.)
 * (2026-10-31 root batch humanoid-probe, operator-approved 2026-10-31: 21 root tests
 * moved out — 18 to @openclinxr/humanoid-probe-evidence and 3 known-red/gitignored-gated
 * (material-region, upright-guard, cagematch-bind) to
 * tools/openclinxr/evidence/humanoid-probe/, lowering the freeze 216 -> 195.)
 * (2026-10-31 root batch exam-pipeline, operator-approved 2026-10-31: 26 root tests
 * moved, 16 to @openclinxr/exam-pipeline-evidence and 10 known-red/manual/host-dependent to
 * tools/openclinxr/evidence/exam-pipeline/, lowering the freeze 195 -> 169.)
 * (2026-10-31 root batch gown-phenotype, operator-approved 2026-10-31: 19 root tests
 * moved, 18 to @openclinxr/gown-phenotype-evidence and 1 known-red
 * (garment-hem-boundary) to tools/openclinxr/evidence/gown-phenotype/,
 * lowering the freeze 169 -> 150.)
 * (2026-10-31 root batch garment-surface, operator-approved 2026-10-31: 37 root tests
 * moved, 27 to @openclinxr/garment-surface-evidence, 9 red-on-main to
 * tools/openclinxr/evidence/garment-surface-stale/ and the room-frame consumer to
 * tools/openclinxr/evidence/room-frames/, lowering the freeze 150 -> 113.)
 * (2026-10-31 root batch staging, operator-approved 2026-10-31: 35 root tests moved,
 * 11 to @openclinxr/staging-evidence and 24 known-red to the staging/ subdirectory
 * (known-red cannot enter the sidecar per pre-push whole-sidecar runs; the-supine-head
 * moved sidecar -> staging/ 2026-11-01 after a deterministic-red isolated rerun),
 * lowering the freeze 113 -> 78.)
 * (2026-10-31 root batch cast-fleet, operator-approved 2026-10-31: 14 root tests moved,
 * 12 to @openclinxr/cast-fleet-evidence, 1 red-on-main (chest-anchors) to
 * tools/openclinxr/evidence/chest-anchors/ and 1 gitignored-cache-gated
 * (trellis-metal-mesh-bake) to tools/openclinxr/evidence/trellis-metal/,
 * lowering the freeze 78 -> 64.)
 * (2026-11-01 root batch blender-bake, operator-approved 2026-10-31: 15 root tests
 * moved, 7 to @openclinxr/blender-bake-evidence and 8 that spawn Blender or Infinigen bpy
 * or read $HOME tools to tools/openclinxr/evidence/blender-bake/, lowering the freeze 64 -> 49.)
 * (2026-10-31 root batch isolated-subject, operator-approved 2026-10-31: 12 root tests
 * moved, 9 to @openclinxr/station-capture-evidence and 3 (known-red isolated-subject-harness;
 * trellis-metal-subject-isolation and trellis-equipment-cagematch, which read gitignored
 * output or probe a live ComfyUI) to tools/openclinxr/evidence/isolated-subject/,
 * lowering the freeze 49 -> 37.)
 */

const EVIDENCE_ROOT = "tools/openclinxr/evidence";

function findWorkspaceRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    try {
      readFileSync(join(dir, "pnpm-workspace.yaml"));
      return dir;
    } catch {
      dir = dirname(dir);
    }
  }
  throw new Error("workspace root (pnpm-workspace.yaml) not found");
}

/** Count root-level .test.ts files in tools/openclinxr/evidence/ (non-recursive). */
export function countRootTestFiles(): number {
  const root = findWorkspaceRoot();
  const evidenceDir = join(root, EVIDENCE_ROOT);
  if (!existsSync(evidenceDir)) return 0;
  let count = 0;
  for (const entry of readdirSync(evidenceDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx") || entry.name.endsWith(".test.mts")) {
      count += 1;
    }
  }
  return count;
}

/**
 * Frozen root-level test file count. Generated by running countRootTestFiles() against a
 * clean tree. This number may only be LOWERED; never raise it to excuse a new root-level test.
 */
export const ROOT_TEST_FILE_FREEZE = 37;

export type RootTestFreezeViolation = { detail: string };

/**
 * Fails if the current root-level count EXCEEDS the frozen count.
 */
export function checkRootTestFileFreeze(
  freeze: number = ROOT_TEST_FILE_FREEZE,
  measured: number = countRootTestFiles(),
): RootTestFreezeViolation[] {
  const violations: RootTestFreezeViolation[] = [];
  if (measured > freeze) {
    violations.push({
      detail:
        `tools/openclinxr/evidence/ root has ${measured} .test.ts file(s) > frozen ${freeze}. ` +
        "A new root-level test file is a serialization hotspot: 33.1% of excess-writer events, " +
        "seven of seventeen conflict merges were test files. FIX: plant the RED in a subdirectory " +
        "named for its subject (e.g. tools/openclinxr/evidence/<subject>/). Counts only shrink — " +
        "do NOT raise this number.",
    });
  }
  return violations;
}

/**
 * Fails if the freeze sits ABOVE the current measurement — the ratchet must tighten.
 */
export function checkRootTestFileFreezeIsHonest(
  freeze: number = ROOT_TEST_FILE_FREEZE,
  measured: number = countRootTestFiles(),
): RootTestFreezeViolation[] {
  const violations: RootTestFreezeViolation[] = [];
  if (measured < freeze) {
    violations.push({
      detail:
        `tools/openclinxr/evidence/ root frozen at ${freeze} but now measures ${measured}. ` +
        "Lower the freeze entry to the measurement so the ceiling keeps tracking the tree.",
    });
  }
  return violations;
}