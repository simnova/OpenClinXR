/**
 * materialize-proof-preflight.test.ts — cap36 preflight for materialize-proof.sh.
 * (a) an empty cache root exits 6 naming the hair path and never starts
 * Blender; (b) a cache root holding every run-fix-bake.sh:47-52 path lets the
 * stub Blender run with the recorded materialize argv, and because the stub
 * writes no GLB the script then exits nonzero.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { materializeInvocation, materializerFlagSet, validateManifest } from "./run-chain";

const KEVIN_MANIFEST =
  "tools/openclinxr/asset-pipeline/humanoid-chain/manifests/mpfb-peds-nurse-kevin.json";
const PROOF_SH = "tools/openclinxr/asset-pipeline/humanoid-chain/materialize-proof.sh";

// run-fix-bake.sh:47-52 stage order: hair/facial/visemes/skins dirs, the eyes
// system assets, the scrub-pants tree, the scrub-shirt .mhmat + base-colour
// texture, and the four shoes01 files.
const PREFLIGHT_DIRS = [
  "hair",
  "facial",
  "visemes",
  "skins",
  "eyes/makehuman-system-assets",
  "garments/sources/makehuman-community-scrub-pants",
];
const PREFLIGHT_FILES = [
  "garments/sources/makehuman-community-scrub-shirt/Scrub_Shirt.mhmat",
  "garments/sources/makehuman-community-scrub-shirt/Scrubs_Main_BaseColor_Utility - sRGB - Texture.png",
  "garments/sources/makehuman-shoes01/culturalibre_male_boots/male_boots.mhmat",
  "garments/sources/makehuman-shoes01/culturalibre_male_boots/boot.png",
  "garments/sources/makehuman-shoes01/toigo_mj_cloth_shoes/mj_shoes.mhmat",
  "garments/sources/makehuman-shoes01/toigo_mj_cloth_shoes/MJ-shoes3.png",
];

function writeStub(dir: string, marker: string): string {
  const stub = join(dir, "stub-blender.sh");
  writeFileSync(stub, `#!/bin/sh\nprintf '%s\\n' "$@" >> "${marker}"\nexit 0\n`);
  chmodSync(stub, 0o755);
  return stub;
}

function runProof(args: { cache: string; stub: string; dir: string }) {
  const root = process.cwd();
  const out = join(args.dir, "out.glb");
  return {
    out,
    r: spawnSync("sh", [join(root, PROOF_SH), join(root, KEVIN_MANIFEST), out, "deadbeef"], {
      cwd: root,
      encoding: "utf8",
      timeout: 20_000,
      env: {
        ...process.env,
        MATERIALIZE_PROOF_CACHE_ROOT: args.cache,
        MATERIALIZE_PROOF_BLENDER: args.stub,
      },
    }),
  };
}

describe("materialize-proof.sh preflight", () => {
  // CI 44195741094 measured 5.7 s max; x3 ≈ 20 s
  it("empty cache root exits 6 naming hair without starting Blender", { timeout: 20_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "mat-proof-a-"));
    const cache = join(dir, "cache");
    mkdirSync(cache, { recursive: true });
    const marker = join(dir, "blender-marker.txt");
    const { out, r } = runProof({ cache, stub: writeStub(dir, marker), dir });
    expect(r.status).toBe(6);
    expect(String(r.stdout)).toContain("PREFLIGHT_MISSING hair");
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(out)).toBe(false);
  });

  // CI 44195741094 measured 5.7 s max; x3 ≈ 20 s
  it("full cache root runs the stub Blender with the recorded argv, then exits nonzero with no GLB", { timeout: 20_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "mat-proof-b-"));
    const cache = join(dir, "cache");
    for (const d of PREFLIGHT_DIRS) mkdirSync(join(cache, d), { recursive: true });
    for (const f of PREFLIGHT_FILES) {
      mkdirSync(dirname(join(cache, f)), { recursive: true });
      writeFileSync(join(cache, f), "");
    }
    const marker = join(dir, "blender-marker.txt");
    const { out, r } = runProof({ cache, stub: writeStub(dir, marker), dir });
    expect(r.status).toBe(4);
    expect(String(r.stderr)).toMatch(/no output GLB/);
    expect(existsSync(marker)).toBe(true);
    const root = process.cwd();
    const manifest = validateManifest(JSON.parse(readFileSync(join(root, KEVIN_MANIFEST), "utf8")));
    const inv = materializeInvocation(manifest, out, { knownFlags: materializerFlagSet() });
    const got = readFileSync(marker, "utf8").trim().split("\n");
    expect(got).toEqual(["--background", "--python", inv.tool, "--", ...inv.argv]);
    expect(got.slice(4)).toEqual(inv.argv);
    expect(existsSync(out)).toBe(false);
  });
});
