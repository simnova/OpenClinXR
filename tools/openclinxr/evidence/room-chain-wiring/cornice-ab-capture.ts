/** Capture all cornice A/B arms through the learner runtime at fixed room-specific poses. */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildCaptureChildArgs } from "./cornice-capture-input.ts";

const capture = "tools/openclinxr/evidence/room-ward-finish-chain/ward-finish-chain-capture.ts";

export interface CorniceBuildManifest {
  results: Record<string, { finalGlb: string; glbSha256?: string }>;
}

export function loadBuildManifest(manifestPath = ".openclinxr/evidence/cornice-ab/build-manifest.json"): CorniceBuildManifest {
  return JSON.parse(readFileSync(manifestPath, "utf8")) as CorniceBuildManifest;
}
const rooms = {
  ward: {
    environmentId: "inpatient_ward_room_v1",
    poses: "runtime-01-toward-door,runtime-02-toward-bed-wall,runtime-03-ceiling-corner,runtime-05-troffer-junction",
    posesFile: "tools/openclinxr/evidence/room-ward-finish-chain/hand-placed-poses.json",
  },
  stepdown: {
    environmentId: "stepdown_room_v1",
    poses: "runtime-01-toward-door,runtime-02-toward-bed-wall,runtime-04-door-inside,runtime-05-troffer-junction",
    posesFile: "docs/openclinxr/room-realism/stepdown-room-v1-finish/derived-poses.json",
  },
} as const;

export async function runCorniceAbCapture(spawn: (args: {
  outDir: string;
  glbPath: string;
  environmentId: string;
  posesFile: string;
  multiviewOnly: string;
}) => void = defaultSpawn, options?: { manifest?: CorniceBuildManifest; storeRoot?: string }): Promise<void> {
const buildManifest = options?.manifest ?? loadBuildManifest();
const pending: { outDir: string; glbPath: string; environmentId: string; posesFile: string; multiviewOnly: string }[] = [];
for (const [room, config] of Object.entries(rooms)) {
  for (const variant of ["v1", "v2", "v3", "v4"] as const) {
    const key = `${config.environmentId}/${variant}`;
    const entry = buildManifest.results[key] as { finalGlb: string; glbSha256?: string } | undefined;
    const glb = entry?.finalGlb;
    if (!glb) throw new Error(`missing GLB in build manifest: ${key}`);
    const digest = entry?.glbSha256;
    if (!digest || !/^[0-9a-f]{64}$/u.test(digest)) {
      throw new Error(`missing or malformed glbSha256 in build manifest: ${key}`);
    }
    const child = await buildCaptureChildArgs({
      glbRef: glb,
      outDir: path.join("docs/openclinxr/room-realism/cornice-ab", room, variant),
      environmentId: config.environmentId,
      posesFile: config.posesFile,
      multiviewOnly: config.poses,
      expectedSha256: digest,
      storeRoot: options?.storeRoot,
    });
    pending.push(child);
  }
}
for (const child of pending) spawn(child);
}

function defaultSpawn(child: {
  outDir: string;
  glbPath: string;
  environmentId: string;
  posesFile: string;
  multiviewOnly: string;
}): void {
    execFileSync("pnpm", ["exec", "tsx", capture], {
      stdio: "inherit",
      timeout: 600_000,
      env: {
        ...process.env,
        STAGE2_CAPTURE_OUT_DIR: child.outDir,
        STAGE2_CAPTURE_GLB: child.glbPath,
        STAGE2_ENVIRONMENT_ID: child.environmentId,
        STAGE2_POSES_FILE: child.posesFile,
        STAGE2_MULTIVIEW_ONLY: child.multiviewOnly,
        STAGE2_VIEWPORT_WIDTH: "1280",
        STAGE2_VIEWPORT_HEIGHT: "720",
      },
    });
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await runCorniceAbCapture();
}
