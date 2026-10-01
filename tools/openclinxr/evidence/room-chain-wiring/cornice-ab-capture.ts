/** Capture all cornice A/B arms through the learner runtime at fixed room-specific poses. */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const capture = "tools/openclinxr/evidence/room-ward-finish-chain/ward-finish-chain-capture.ts";
const buildManifest = JSON.parse(readFileSync(".openclinxr/evidence/cornice-ab/build-manifest.json", "utf8")) as {
  results: Record<string, { finalGlb: string }>;
};
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

for (const [room, config] of Object.entries(rooms)) {
  for (const outputVariant of ["v4-flush", "v4-flush-repeat"] as const) {
    const key = `${config.environmentId}/v4-flush`;
    const glb = buildManifest.results[key]?.finalGlb;
    if (!glb) throw new Error(`missing GLB in build manifest: ${key}`);
    execFileSync("pnpm", ["exec", "tsx", capture], {
      stdio: "inherit",
      timeout: 600_000,
      env: {
        ...process.env,
        STAGE2_CAPTURE_OUT_DIR: path.join("docs/openclinxr/room-realism/cornice-ab", room, outputVariant),
        STAGE2_CAPTURE_GLB: glb,
        STAGE2_ENVIRONMENT_ID: config.environmentId,
        STAGE2_POSES_FILE: config.posesFile,
        STAGE2_MULTIVIEW_ONLY: config.poses,
        STAGE2_VIEWPORT_WIDTH: "1280",
        STAGE2_VIEWPORT_HEIGHT: "720",
      },
    });
  }
}
