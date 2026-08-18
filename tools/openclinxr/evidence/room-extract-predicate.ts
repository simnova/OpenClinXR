/**
 * room-extract-predicate.ts — dry-run reporter for the extract-time room predicate.
 *
 * Reads a shipped Infinigen room GLB with the sanctioned instrument (NodeIO + node
 * world matrices, the exact frame `issue-341-dump-tris.ts` / `model-vetting-glb-grade-capture.ts`
 * use), dumps the room parts' WORLD-space triangles to the payload format the predicate
 * expects, and runs the pure-Python predicate (`room-extract-predicate.py`) via python3
 * — the same module `infinigen-single-room-extract.py` calls in-process at extract time.
 *
 * The GLB is the extract's own output frame: centred at origin, floor top at y=0,
 * transforms applied to the exported primitives' positions.
 *
 * claimScope: dry-run of the predicate on shipped room bytes.
 * notEvidenceFor: the remaining 12 station rooms, interior framing, Quest readiness.
 */
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO, type Node as GltfNode } from "@gltf-transform/core";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
export const PREDICATE_PY = join(
  REPO_ROOT,
  "tools/openclinxr/asset-pipeline/environment/room_extract_predicate.py",
);

export type PredicateResult = {
  room: string;
  predicateVersion: number;
  measures: {
    floorAspect: number;
    floorAreaM2: number;
    ceilingHeightM: number;
    hullFrontFacingToDoorwayEyeCount: number;
    doorwayCandidateSurviveCount: number;
  };
  thresholds: Record<string, { min?: number; max?: number; basis: string }>;
  pass: boolean;
  refuseReasons: string[];
  derivedFrom: { method: string; rooms: unknown[] };
};

function transformPoint(x: number, y: number, z: number, m: number[]): [number, number, number] {
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}

const R = (v: number) => Math.round(v * 10000) / 10000;

/** Dump a GLB's room parts as world-space triangles in the predicate's payload shape. */
export async function dumpRoomGeometryPayload(
  glbPath: string,
  roomName?: string,
): Promise<{ room: string; parts: Record<string, [number, number, number][][]> }> {
  const doc = await new NodeIO().read(glbPath);
  const parts: Record<string, [number, number, number][][]> = {};
  const visit = (node: GltfNode): void => {
    const mesh = node.getMesh();
    if (mesh) {
      const world = node.getWorldMatrix();
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute("POSITION");
        const idx = prim.getIndices();
        if (!pos) continue;
        const arr = pos.getArray();
        if (!arr) continue;
        const count = pos.getCount();
        const pts: [number, number, number][] = [];
        for (let i = 0; i < count; i += 1) {
          const [x, y, z] = transformPoint(Number(arr[i * 3]), Number(arr[i * 3 + 1]), Number(arr[i * 3 + 2]), world);
          pts.push([R(x), R(y), R(z)]);
        }
        const tris = parts[node.getName()] ?? (parts[node.getName()] = []);
        if (idx) {
          const ia = idx.getArray();
          if (!ia) continue;
          for (let i = 0; i + 2 < ia.length; i += 3) {
            tris.push([pts[ia[i]]!, pts[ia[i + 1]]!, pts[ia[i + 2]]!]);
          }
        } else {
          for (let i = 0; i + 2 < count; i += 3) {
            tris.push([pts[i]!, pts[i + 1]!, pts[i + 2]!]);
          }
        }
      }
    }
    for (const child of node.listChildren()) visit(child);
  };
  for (const scene of doc.getRoot().listScenes()) {
    for (const root of scene.listChildren()) visit(root);
  }
  return { room: roomName ?? "unknown", parts };
}

/** Run the pure-Python predicate on a room geometry payload; returns parsed JSON. */
export function runPredicate(payload: { room: string; parts: Record<string, [number, number, number][][]> }): PredicateResult {
  const tmpPayload = join(tmpdir(), `ocxr-room-predicate-${randomUUID()}.json`);
  writeFileSync(tmpPayload, JSON.stringify(payload), "utf8");
  try {
    const res = spawnSync("python3", [PREDICATE_PY, "--geometry", tmpPayload], {
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    if (res.status === null) throw new Error(`predicate timed out: ${String(res.error)}`);
    // Exit 2 is a legitimate REFUSE verdict (the JSON is still printed); anything else
    // non-zero is a real failure.
    if (res.status !== 0 && res.status !== 2) {
      throw new Error(`predicate failed (exit ${res.status}): ${String(res.stderr).slice(-500)}`);
    }
    const out = res.stdout ?? "";
    const lines = out.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim().startsWith("{")) {
        return JSON.parse(lines[i].trim()) as PredicateResult;
      }
    }
    throw new Error(`predicate produced no JSON: ${out.slice(-500)}`);
  } finally {
    try {
      unlinkSync(tmpPayload);
    } catch {
      // best-effort cleanup
    }
  }
}

/** Report the predicate result for a shipped GLB (or write it with --output). */
export async function reportForGlb(glbPath: string, roomName?: string): Promise<PredicateResult> {
  const payload = await dumpRoomGeometryPayload(glbPath, roomName);
  return runPredicate(payload);
}

// CLI
const isMain =
  process.argv[1] &&
  pathResolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const glbs = process.argv.slice(2).filter((a) => a.endsWith(".glb"));
  (async () => {
    for (const glb of glbs) {
      const result = await reportForGlb(glb);
      console.log(JSON.stringify(result, null, 2));
    }
    process.exit(0);
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
