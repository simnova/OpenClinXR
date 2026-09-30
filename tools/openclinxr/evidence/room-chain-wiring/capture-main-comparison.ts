/** Same learner runtime, rig, poses and viewport; vary only the ward GLB. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const output = "tools/openclinxr/evidence/room-chain-wiring/visual-comparison";
const asset = "apps/ui-xr/public/xr-assets/environment/infinigen-inpatient-ward.glb";
const rig = "apps/ui-xr/public/xr-assets/lighting/inpatient_ward_room_v1.rig.json";
const poses = "tools/openclinxr/evidence/room-ward-finish-chain/hand-placed-poses.json";
const sha = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const scratch = mkdtempSync(path.join(tmpdir(), "room-main-capture-"));
mkdirSync(output, { recursive: true });
try {
  const main = execFileSync("git", ["show", `origin/main:${asset}`], { maxBuffer: 32 * 1024 * 1024 });
  const mainPath = path.join(scratch, "main.glb");
  writeFileSync(mainPath, main);
  const candidate = readFileSync(asset);
  for (const variant of ["main", "candidate"] as const) {
    const env = { ...process.env,
      STAGE2_CAPTURE_OUT_DIR: `${output}/${variant}`,
      STAGE2_POSES_FILE: poses,
      STAGE2_VIEWPORT_WIDTH: "1280", STAGE2_VIEWPORT_HEIGHT: "720",
      STAGE2_CAPTURE_GLB: variant === "main" ? mainPath : "",
    };
    // The capture producer owns server teardown; its browser uses the compute facade.
    execFileSync("pnpm", ["exec", "tsx", "tools/openclinxr/evidence/room-ward-finish-chain/ward-finish-chain-capture.ts"], {
      env, stdio: "inherit", timeout: 600_000,
    });
  }
  const pixels = JSON.parse(execFileSync("python3", [
    "tools/openclinxr/evidence/room-chain-wiring/compare-room-pixels.py", output,
  ], { encoding: "utf8" })) as Record<string, unknown>;
  const proof = {
    schemaVersion: "openclinxr.room-chain-visual-comparison.v1",
    mainRevision: execFileSync("git", ["rev-parse", "origin/main"], { encoding: "utf8" }).trim(),
    mainGlbSha256: sha(main), candidateGlbSha256: sha(candidate),
    sharedRigSha256: sha(readFileSync(rig)), posesSha256: sha(readFileSync(poses)),
    control: "Identical learner runtime and candidate lighting rig in both arms; only the GLB changes. Main bytes served at the learner asset URL by a route override; candidate uses the shipped learner URL. Standard producer hides UI/non-room meshes in both arms.",
    notEvidenceFor: ["old-versus-new lighting rig equivalence", "Quest readiness", "clinical validity"],
    ...pixels,
  };
  writeFileSync(`${output}/diff.json`, `${JSON.stringify(proof, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
  if (pixels["passed"] !== true) process.exitCode = 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
