/**
 * Fleet room bake CLI (issue-526): runs the repaired occlusion bake — and the albedo
 * bake where a room still lacks one — over every shipped Infinigen environment, then
 * verifies that geometry, UV0, base colour, normals and triangle counts are UNCHANGED
 * and writes a stamped report.
 *
 * The room list is enumerated DYNAMICALLY from `INFINIGEN_ENVIRONMENT_ASSETS`
 * (`apps/ui-xr/src/infinigen-environment-assets.ts`) — a hardcoded list is the thing
 * that goes stale. The hand-built `ed-exam-bay-shell.glb` is not in that map and is
 * never touched.
 *
 * Bake chain per room:
 *   1. albedo (room-albedo-ao-bake.py)   — ONLY when the room's materials carry no baked
 *      baseColorTexture. The shipped rooms already have one (baked by an older light rig,
 *      #345); re-baking them changes base-colour bytes, which this card forbids. Fresh
 *      rooms (no base colour) get the full chain, so the next generated room cannot
 *      bypass the fix.
 *   2. occlusion (room-occlusion-bake.py) — the issue-526 bounded raycast mechanism
 *      (`bounded_raycast_v2`). Always runs.
 *
 * After the bake the CLI re-measures the OUTPUT with the same instrument as the contract
 * test (NodeIO over the GLBs) and refuses the room if anything but AO artifacts moved.
 *
 * Usage:
 *   pnpm factory:rooms:bake                     # bake all 14 (in place)
 *   pnpm exec tsx tools/openclinxr/asset-pipeline/environment/rooms-bake-cli.ts --inspect
 *                                                # measure only, no bake
 */
import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync, copyFileSync, renameSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { NodeIO } from "@gltf-transform/core";
import { decodePng } from "../../evidence/decode-png.js";
import { planRoomGenerate } from "@openclinxr/factory-stations";

const execFileAsync = promisify(execFile);

export const ROOMS_BAKE_SCHEMA_VERSION = "openclinxr.rooms-bake.v1";
export const ROOMS_BAKE_REPORT_DIR = ".openclinxr/evidence/issue-526";
export const ROOMS_BAKE_REPORT = `${ROOMS_BAKE_REPORT_DIR}/rooms-bake-report.json`;
export const ENV_DIR = "apps/ui-xr/public";
export const ENV_ASSETS_MODULE = "apps/ui-xr/src/infinigen-environment-assets.ts";
export const ALBEDO_SCRIPT = "tools/openclinxr/asset-pipeline/environment/room-albedo-ao-bake.py";
export const OCCLUSION_SCRIPT = "tools/openclinxr/asset-pipeline/environment/room-occlusion-bake.py";
export const BLENDER_TIMEOUT_MS = 600_000;

const io = new NodeIO();

type RoomRow = { envId: string; glb: string };
type GlbFingerprint = {
  tris: number;
  posSha: string;
  normalSha: string;
  uv0Sha: string;
  indexSha: string;
  baseColourShas: Array<{ material: string; sha: string }>;
};
type AoStat = { mean: number; sd: number; black: number; strength: number; greyscale: boolean };
type RoomResult = {
  envId: string;
  glb: string;
  albedo: "baked" | "skipped-already-textured";
  occlusion: { mechanism: string; reachMeters: number; mapsWired: number };
  invariant: { ok: boolean; diffs: string[] };
  aoStats: Array<{ material: string; stat: AoStat }>;
  wallClockMs: number;
};
export type RoomsBakeReport = {
  schemaVersion: typeof ROOMS_BAKE_SCHEMA_VERSION;
  issue: 526;
  generatedAt: string;
  measuredAgainstCommit: string;
  command: string;
  rooms: RoomResult[];
  verdict: { passed: boolean; blockers: string[] };
};

/** Parse the `as const` map out of the ui-xr module source — the fleet enumerates what ships. */
export function enumerateEnvironments(): RoomRow[] {
  const src = readFileSync(ENV_ASSETS_MODULE, "utf8");
  const block = /INFINIGEN_ENVIRONMENT_ASSETS[^{]*\{([\s\S]*?)\n\} as const/u.exec(src)?.[1] ?? "";
  const rows: RoomRow[] = [];
  for (const m of block.matchAll(/^\s*([a-z0-9_]+)\s*:\s*"([^"]+)"/gmu)) {
    const url = m[2]!;
    if (!url.endsWith(".glb")) continue;
    // The map holds app-public URLs ("/xr-assets/environment/..."), which resolve to
    // the ui-xr public dir on disk.
    rows.push({ envId: m[1]!, glb: url.replace(/^\//u, "") });
  }
  rows.sort((a, b) => a.glb.localeCompare(b.glb));
  return rows;
}

function sha256(bytes: ArrayBuffer | ArrayBufferView): string {
  const view = ArrayBuffer.isView(bytes)
    ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : Buffer.from(bytes);
  return createHash("sha256").update(view).digest("hex").slice(0, 16);
}

async function fingerprintFull(relPath: string): Promise<GlbFingerprint> {
  const doc = await io.read(relPath);
  let tris = 0;
  let pos = "", normal = "", uv0 = "", index = "";
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      tris += (prim.getIndices()?.getCount() ?? 0) / 3;
      pos += sha256(prim.getAttribute("POSITION")?.getArray() ?? new Uint8Array(0));
      normal += sha256(prim.getAttribute("NORMAL")?.getArray() ?? new Uint8Array(0));
      uv0 += sha256(prim.getAttribute("TEXCOORD_0")?.getArray() ?? new Uint8Array(0));
      index += sha256(prim.getIndices()?.getArray() ?? new Uint8Array(0));
    }
  }
  const baseColourShas: GlbFingerprint["baseColourShas"] = [];
  for (const material of doc.getRoot().listMaterials()) {
    const image = material.getBaseColorTexture()?.getImage();
    baseColourShas.push({ material: material.getName(), sha: image ? sha256(image) : "absent" });
  }
  return { tris, posSha: sha256(Buffer.from(pos)), normalSha: sha256(Buffer.from(normal)), uv0Sha: sha256(Buffer.from(uv0)), indexSha: sha256(Buffer.from(index)), baseColourShas };
}

function fingerprintDiff(pre: GlbFingerprint, post: GlbFingerprint): string[] {
  const diffs: string[] = [];
  if (pre.tris !== post.tris) diffs.push(`tris ${pre.tris} -> ${post.tris}`);
  if (pre.posSha !== post.posSha) diffs.push("POSITION changed");
  if (pre.normalSha !== post.normalSha) diffs.push("NORMAL changed");
  if (pre.uv0Sha !== post.uv0Sha) diffs.push("TEXCOORD_0 changed");
  if (pre.indexSha !== post.indexSha) diffs.push("indices changed");
  const preBc = new Map(pre.baseColourShas.map((r) => [r.material, r.sha]));
  for (const r of post.baseColourShas) {
    if (preBc.get(r.material) !== r.sha) diffs.push(`baseColor ${r.material} changed`);
  }
  return diffs;
}

async function measureAoStats(relPath: string): Promise<Array<{ material: string; stat: AoStat }>> {
  const doc = await io.read(relPath);
  const rows: Array<{ material: string; stat: AoStat }> = [];
  for (const material of doc.getRoot().listMaterials()) {
    const tex = material.getOcclusionTexture();
    if (!tex) continue;
    const image = tex.getImage();
    if (!image) continue;
    const png = decodePng(image);
    const n = png.w * png.h;
    let sum = 0, below64 = 0;
    for (let i = 0; i < n; i += 1) {
      const v = png.lum[i]!;
      sum += v;
      if (v < 64) below64 += 1;
    }
    const mean = sum / n;
    let sq = 0;
    for (let i = 0; i < n; i += 1) {
      const d = png.lum[i]! - mean;
      sq += d * d;
    }
    rows.push({
      material: material.getName(),
      stat: {
        mean: Math.round(mean * 10) / 10,
        sd: Math.round(Math.sqrt(sq / n) * 10) / 10,
        black: Math.round((below64 / n) * 10000) / 10000,
        strength: material.getOcclusionStrength(),
        greyscale: png.greyscale,
      },
    });
  }
  return rows;
}

function gitHead(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"]).toString().trim();
  } catch {
    return "unknown";
  }
}

async function bakeRoom(room: RoomRow, blenderPath: string): Promise<RoomResult> {
  const shipped = path.join(ENV_DIR, room.glb);
  const work = path.join(ROOMS_BAKE_REPORT_DIR, `${room.glb}.work.glb`);
  await mkdir(path.dirname(work), { recursive: true });
  copyFileSync(shipped, work);

  const started = Date.now();
  const pre = await fingerprintFull(work);

  // Albedo only for rooms whose materials carry no baked base colour (see header).
  const doc = await io.read(work);
  const anyTextured = doc.getRoot().listMaterials().some((m) => m.getBaseColorTexture() !== null);
  let albedo: RoomResult["albedo"] = "skipped-already-textured";
  if (!anyTextured) {
    await execFileAsync(blenderPath, ["--background", "--python", ALBEDO_SCRIPT, "--", "--input", work, "--output", work, "--resolution", "1024"], {
      timeout: BLENDER_TIMEOUT_MS,
      maxBuffer: 20 * 1024 * 1024,
    });
    albedo = "baked";
  }

  await execFileAsync(blenderPath, ["--background", "--python", OCCLUSION_SCRIPT, "--", "--input", work, "--output", work, "--resolution", "512"], {
    timeout: BLENDER_TIMEOUT_MS,
    maxBuffer: 20 * 1024 * 1024,
  });

  const post = await fingerprintFull(work);
  const diffs = fingerprintDiff(pre, post);
  const aoStats = await measureAoStats(work);

  if (diffs.length === 0) {
    renameSync(work, shipped);
  }

  return {
    envId: room.envId,
    glb: room.glb,
    albedo,
    occlusion: {
      mechanism: "bounded_raycast_v2",
      reachMeters: 2.0,
      mapsWired: aoStats.length,
    },
    invariant: { ok: diffs.length === 0, diffs },
    aoStats,
    wallClockMs: Date.now() - started,
  };
}

export async function runRoomsBakeCli(args = process.argv.slice(2)): Promise<void> {
  if (args.includes("--dry-run")) {
    const planned = planRoomGenerate({
      environmentId: "ed_bay_v1",
      infinigenPrompt: "exam bay",
      seed: 1,
      layoutVariant: "default",
    });
    process.stdout.write(`${JSON.stringify(planned, null, 2)}\n`);
    if ("issues" in planned) process.exit(2);
    return;
  }
  const inspect = args.includes("--inspect");
  const blenderPath = process.env["BLENDER"] ?? "blender";
  const rooms = enumerateEnvironments();
  if (rooms.length === 0) throw new Error(`no environments enumerated from ${ENV_ASSETS_MODULE}`);

  const report: RoomsBakeReport = {
    schemaVersion: ROOMS_BAKE_SCHEMA_VERSION,
    issue: 526,
    generatedAt: new Date().toISOString(),
    measuredAgainstCommit: gitHead(),
    command: inspect ? "inspect" : "bake",
    rooms: [],
    verdict: { passed: true, blockers: [] },
  };

  for (const room of rooms) {
    const abs = path.join(ENV_DIR, room.glb);
    if (!existsSync(abs)) {
      report.verdict.blockers.push(`${room.glb} missing`);
      continue;
    }
    if (inspect) {
      const pre = await fingerprintFull(abs);
      report.rooms.push({
        envId: room.envId,
        glb: room.glb,
        albedo: "skipped-already-textured",
        occlusion: { mechanism: "pending", reachMeters: 0, mapsWired: 0 },
        invariant: { ok: true, diffs: [] },
        aoStats: await measureAoStats(abs),
        wallClockMs: 0,
      });
      process.stdout.write(`[rooms-bake] inspect ${room.glb}: tris=${pre.tris}\n`);
      continue;
    }
    const result = await bakeRoom(room, blenderPath);
    report.rooms.push(result);
    process.stdout.write(
      `[rooms-bake] ${result.glb}: albedo=${result.albedo} wired=${result.occlusion.mapsWired} ` +
      `invariant=${result.invariant.ok ? "ok" : "FAIL:" + result.invariant.diffs.join(",")} ` +
      `(${result.wallClockMs}ms)\n`,
    );
    for (const row of result.aoStats) {
      process.stdout.write(
        `  ao ${row.material}: mean=${row.stat.mean} sd=${row.stat.sd} black=${row.stat.black} strength=${row.stat.strength}\n`,
      );
    }
  }

  report.verdict.blockers.push(
    ...report.rooms.filter((r) => !r.invariant.ok).map((r) => `${r.glb}: ${r.invariant.diffs.join("; ")}`),
  );
  if (report.verdict.blockers.length > 0) report.verdict.passed = false;

  await mkdir(ROOMS_BAKE_REPORT_DIR, { recursive: true });
  await writeFile(ROOMS_BAKE_REPORT, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`[rooms-bake] report: ${ROOMS_BAKE_REPORT}\n`);
  process.stdout.write(`[rooms-bake] verdict: ${report.verdict.passed ? "PASSED" : "FAILED"} — ${report.verdict.blockers.length} blocker(s)\n`);
  if (!report.verdict.passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runRoomsBakeCli();
}
