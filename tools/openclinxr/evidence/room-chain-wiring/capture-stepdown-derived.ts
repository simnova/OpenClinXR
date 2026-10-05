/** Controlled stepdown comparison: identical derived poses/runtime/rig; only room GLB bytes differ. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const evidence = "docs/openclinxr/room-realism/stepdown-room-v1-finish";
const capture = "tools/openclinxr/evidence/room-ward-finish-chain/ward-finish-chain-capture.ts";
const poses = `${evidence}/derived-poses.json`;
const current = "apps/ui-xr/public/xr-assets/environment/infinigen-stepdown.glb";
// The before arm is always the checked-in shipped asset; the after arm is
// the working-tree promote. This keeps each defect-fix comparison local to
// the bytes it actually replaces instead of a historical room-chain debut.
const priorRevision = "HEAD";
const sha = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const scratch = mkdtempSync(path.join(tmpdir(), `stepdown-derived-${process.pid}-`));

try {
  const priorBytes = execFileSync("git", ["show", `${priorRevision}:${current}`], { maxBuffer: 32 * 1024 * 1024 });
  const prior = path.join(scratch, "prior-stepdown.glb");
  writeFileSync(prior, priorBytes);
  for (const arm of ["before", "after"] as const) {
    execFileSync("pnpm", ["exec", "tsx", capture], {
      stdio: "inherit",
      timeout: 600_000,
      env: {
        ...process.env,
        STAGE2_CAPTURE_OUT_DIR: `${evidence}/${arm}`,
        STAGE2_POSES_FILE: poses,
        STAGE2_ENVIRONMENT_ID: "stepdown_room_v1",
        STAGE2_CAPTURE_GLB: arm === "before" ? prior : "",
        STAGE2_VIEWPORT_WIDTH: "1280",
        STAGE2_VIEWPORT_HEIGHT: "720",
      },
    });
    if (arm === "before") {
      const manifestPath = `${evidence}/${arm}/stage2-multiview.json`;
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
      manifest["glb"] = `git:${priorRevision}:${current}`;
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    }
  }
  process.stdout.write(`${JSON.stringify({
    priorRevision,
    beforeSha256: sha(priorBytes),
    afterSha256: sha(readFileSync(current)),
    poses,
  }, null, 2)}\n`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
