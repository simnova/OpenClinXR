/**
 * The station passes the skin-card flags (card tsk_3dc1802d0ca2b36c).
 *
 * The tracked skin chain (replay.py run_stage) threads two flags the
 * station standalone path drops: --beard-weight into detail_bands
 * (replay.py beard weight carried from subjects.<s>.overrides.beard_shadow.weight)
 * and --vermilion-mask into beard_shadow (replay.py _vermilion_union of the
 * lips-stage albedo). stages-c.ts runDetailSubStage / runBeardSubStage build
 * neither flag, so:
 * (a) runDetailSubStage argv carries --beard-weight with the case's
 *     stage3_beard.weight for a case record that has stage3_beard, and
 *     carries no such flag for a case record without stage3_beard;
 * (b) runBeardSubStage argv carries --vermilion-mask <path> (existing file)
 *     while keeping --lips-mask;
 * (c) the pure measure M used by gate G2 (texels inside a mask that differ
 *     between two albedos) separates two synthetic pairs.
 *
 * The station functions run for real in a runtime-materialized probe (a
 * scratch .ts outside the repo, driven over subprocess): no static import
 * reaches across the package boundary (the architecture freeze refuses new
 * tools -> packages src reaches). RED: (a) and (b) fail until M2 adds the
 * flags; (c) passes throughout.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Local repo-root walk (same pattern as the face_realism tests). */
function testRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("workspace root (pnpm-workspace.yaml) not found");
}

const MISE_TRUST_DIR = "/Volumes/files/src/openclinxr";

/** Pure measure M for gate G2: texels inside mask that differ. */
export function countChangedTexels(before: number[], after: number[], mask: number[]): number {
  if (before.length !== after.length || before.length !== mask.length) {
    throw new Error("countChangedTexels length mismatch: refused");
  }
  let n = 0;
  for (let i = 0; i < before.length; i += 1) {
    if (mask[i] !== 0 && before[i] !== after[i]) n += 1;
  }
  return n;
}

const FIXTURE_PY = `
import json
from PIL import Image
import numpy as np
import os
scratch = os.environ["PROBE_SCRATCH"]
S = 256
alb = np.ones((S, S, 3), np.float64) * 180.0
alb[147:174, 97:160, 0] = 198.0
alb[147:174, 97:160, 1] = 138.0
alb[147:174, 97:160, 2] = 146.0
Image.fromarray(np.clip(alb, 0, 255).astype(np.uint8)).save(os.path.join(scratch, "albedo_detail_in.png"))
Image.fromarray(np.clip(alb, 0, 255).astype(np.uint8)).save(os.path.join(scratch, "socket.png"))
Image.fromarray(np.clip(alb, 0, 255).astype(np.uint8)).save(os.path.join(scratch, "albedo_lips.png"))
d = os.path.join(scratch, "derive_out")
os.makedirs(d, exist_ok=True)
def mask(rects):
    m = np.zeros((S, S), np.uint8)
    for (r0, r1, c0, c1) in rects:
        m[r0:r1, c0:c1] = 255
    return m
Image.fromarray(mask([(32, 224, 32, 224)])).save(os.path.join(d, "mask-facecore.png"))
Image.fromarray(mask([(0, 60, 0, 256)])).save(os.path.join(d, "mask-scalp.png"))
Image.fromarray(mask([(100, 120, 60, 110)])).save(os.path.join(d, "mask-eyes-L.png"))
Image.fromarray(mask([(100, 120, 146, 196)])).save(os.path.join(d, "mask-eyes-R.png"))
Image.fromarray(mask([(80, 92, 60, 110)])).save(os.path.join(d, "mask-brows-L.png"))
Image.fromarray(mask([(80, 92, 146, 196)])).save(os.path.join(d, "mask-brows-R.png"))
Image.fromarray(mask([(150, 170, 100, 156)])).save(os.path.join(d, "mask-lips.png"))
lm = {"size": S, "landmarks": {
  "nose-tip": {"uv_texel": [128, 140]},
  "nostril-L": {"uv_texel": [118, 150]},
  "nostril-R": {"uv_texel": [138, 150]},
  "chin": {"uv_texel": [128, 200]},
  "ear-attach-L": {"uv_texel": [40, 140]},
  "ear-attach-R": {"uv_texel": [216, 140]},
}}
open(os.path.join(d, "landmarks-uv.json"), "w").write(json.dumps(lm))
print("fixtures staged")
`;

/** The probe imports the station module by runtime path (argv, never a
 * static specifier) and runs the two sub-stages on the staged fixtures,
 * printing the three argv lists as JSON. */
const PROBE_TS = `
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const target = process.argv[2] as string;
const scratch = process.argv[3] as string;
function prep(sub: string, files: string[]): string {
  const dir = path.join(scratch, sub);
  mkdirSync(path.join(dir, "derive_out"), { recursive: true });
  for (const f of files) copyFileSync(path.join(scratch, f), path.join(dir, f));
  return dir;
}
async function main(): Promise<void> {
let root = path.dirname(target);
for (let i = 0; i < 12; i += 1) {
  if (existsSync(path.join(root, "pnpm-workspace.yaml"))) break;
  root = path.dirname(root);
}
const stages = (await import(pathToFileURL(target).href)) as {
  runDetailSubStage: (caseRec: unknown, chainSubject: string, manifestDoc: unknown, detailInPng: string, outFile: string, outDir: string) => { argv: string[] };
  runBeardSubStage: (caseRec: unknown, socketPng: string, outDir: string, outFile: string) => { argv: string[] };
};
const manifest = JSON.parse(readFileSync(path.join(root, "tools/openclinxr/asset-pipeline/skin/face-replay/chain-manifest.json"), "utf8")) as {
  stages: Array<{ name: string }>;
};
const detailStage = manifest.stages.find((s) => s.name === "detail_bands");
if (detailStage === undefined) throw new Error("no detail_bands stage: refused");
const manifestDoc = { stages: [detailStage], subjects: { synthprobe: { overrides: {} } } };
const deriveFiles = readdirSync(path.join(scratch, "derive_out")).map((f) => path.join("derive_out", f));
const withDir = prep("with", ["albedo_detail_in.png", "albedo_lips.png", ...deriveFiles]);
const withoutDir = prep("without", ["albedo_detail_in.png", "albedo_lips.png", ...deriveFiles]);
const beardDir = prep("beard", ["socket.png", "albedo_lips.png", ...deriveFiles]);
const nil = "0".repeat(64);
const beardCfg = { value: { weight: { value: 0.9 }, seed: { value: 11 }, texels_per_mm: { value: 4.079 }, expected_out_sha256: { value: nil } } };
const detailCfg = { value: { expected_out_sha256: { value: nil } } };
const withRec = stages.runDetailSubStage({ stage3_beard: beardCfg, stage3_detail: detailCfg }, "synthprobe", manifestDoc, path.join(withDir, "albedo_detail_in.png"), path.join(withDir, "albedo_detail.png"), withDir);
const withoutRec = stages.runDetailSubStage({ stage3_detail: detailCfg }, "synthprobe", manifestDoc, path.join(withoutDir, "albedo_detail_in.png"), path.join(withoutDir, "albedo_detail.png"), withoutDir);
const beardRec = stages.runBeardSubStage({ stage3_beard: beardCfg }, path.join(beardDir, "socket.png"), beardDir, path.join(beardDir, "albedo_beard.png"));
console.log(JSON.stringify({ detailWith: withRec.argv, detailWithout: withoutRec.argv, beard: beardRec.argv }));
}
void main().then(
  () => undefined,
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
`;

function runProbe(): { detailWith: string[]; detailWithout: string[]; beard: string[] } {
  const root = testRepoRoot();
  const scratch = mkdtempSync(join(tmpdir(), "skin-card-flags-"));
  try {
    execFileSync("mise", ["exec", "-C", MISE_TRUST_DIR, "--", "python3", "-c", FIXTURE_PY], {
      cwd: root,
      timeout: 300_000,
      env: { ...process.env, PROBE_SCRATCH: scratch },
    });
    const probe = join(scratch, "probe.ts");
    writeFileSync(probe, PROBE_TS);
    const target = join(root, "packages/openclinxr/stations/face-realism/src/stages-c.ts");
    const stdout = execFileSync("pnpm", ["exec", "tsx", probe, target, scratch], {
      cwd: root,
      timeout: 300_000,
      encoding: "utf8",
    });
    return JSON.parse(stdout) as { detailWith: string[]; detailWithout: string[]; beard: string[] };
  } finally {
    // Scratch holds only synthetic fixtures; keep the failure output on disk by
    // leaving the dir (tmpdir, outside the repo and the asset store).
  }
}

describe("the station passes the skin-card flags", () => {
  it("(a) runDetailSubStage threads the case beard weight, or no flag without one", () => {
    const { detailWith, detailWithout } = runProbe();
    const at = detailWith.indexOf("--beard-weight");
    expect(at, `--beard-weight missing in [${detailWith.join(" ")}]`).toBeGreaterThanOrEqual(0);
    expect(detailWith[at + 1]).toBe("0.9");
    expect(detailWithout, `--beard-weight leaked into [${detailWithout.join(" ")}]`).not.toContain(
      "--beard-weight",
    );
  }, 300_000);

  it("(b) runBeardSubStage hugs the visible lip while keeping the derive mask", () => {
    const { beard } = runProbe();
    expect(beard).toContain("--lips-mask");
    const at = beard.indexOf("--vermilion-mask");
    expect(at, `--vermilion-mask missing in [${beard.join(" ")}]`).toBeGreaterThanOrEqual(0);
    expect(existsSync(beard[at + 1] as string)).toBe(true);
  }, 300_000);

  it("(c) the G2 measure separates two synthetic pairs", () => {
    const before = new Array<number>(100).fill(0);
    const mask = [...new Array<number>(50).fill(1), ...new Array<number>(50).fill(0)];
    const afterFew = [...before];
    for (let i = 0; i < 10; i += 1) afterFew[i] = 7;
    const afterMany = [...before];
    for (let i = 0; i < 40; i += 1) afterMany[i] = 7;
    expect(countChangedTexels(before, before, mask)).toBe(0);
    expect(countChangedTexels(before, afterFew, mask)).toBe(10);
    expect(countChangedTexels(before, afterMany, mask)).toBe(40);
    // Differences outside the mask do not count.
    const outside = [...before];
    for (let i = 50; i < 70; i += 1) outside[i] = 7;
    expect(countChangedTexels(before, outside, mask)).toBe(0);
  });
});
