/**
 * ci-w9 P3 — re-measure decimation report rows against the live GLBs.
 *
 * Uses the reports' own measuring code (NodeIO + FACE_RE over mesh names,
 * first-skin joint count, declared-length bytes) and prints per body:
 * report after-values vs live values, plus the last commit touching the GLB
 * (the candidate superseding commit). Read-only: never rewrites reports or GLBs.
 *
 * Usage: mise exec -- pnpm exec tsx tools/openclinxr/asset-pipeline/trellis/measure-decimation-rows.ts
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

const ROOT = process.cwd();
const HUMANOIDS = path.join(ROOT, "apps/ui-xr/public/generated-humanoids");
const FACE_RE = /eye|brow|lash|teeth|tongue/i;

type Row = {
  body: string;
  triangleCountBefore: number;
  triangleCountAfter: number;
  bytesBefore: number;
  bytesAfter: number;
  faceBefore: number;
  faceAfter: number;
  faceRetentionRatio: number;
  jointCountBefore: number;
  jointCountAfter: number;
  jointCountExpected: number;
  promoted?: boolean;
};

async function liveStats(file: string) {
  const full = path.join(HUMANOIDS, file);
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(full);
  let tris = 0;
  let face = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    let mt = 0;
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      if (idx) mt += idx.getCount() / 3;
    }
    tris += mt;
    if (FACE_RE.test(mesh.getName())) face += mt;
  }
  const joints = doc.getRoot().listSkins()[0]!.listJoints().length;
  const bytes = statSync(full).size;
  const declared = readFileSync(full).readUInt32LE(8);
  return { tris: Math.round(tris), face: Math.round(face), joints, bytes, declared };
}

function lastChange(file: string): string {
  try {
    return execFileSync("git", ["log", "--format=%H %ad %s", "--date=short", "-1", "--", `apps/ui-xr/public/generated-humanoids/${file}`], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    return "UNKNOWN";
  }
}

async function main() {
  const target = process.argv[2];
  if (target) {
    // History mode: measure face/tris/joints/bytes at every commit touching the GLB.
    const log = execFileSync("git", ["log", "--format=%H %ad %s", "--date=short", "--", `apps/ui-xr/public/generated-humanoids/${target}`], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim().split("\n");
    console.log("commit | date | face | tris | joints | bytes | subject");
    for (const line of log) {
      const [sha, date, ...rest] = line.split(" ");
      const bytes = execFileSync("git", ["show", `${sha}:apps/ui-xr/public/generated-humanoids/${target}`], {
        cwd: ROOT,
        maxBuffer: 256 * 1024 * 1024,
      }) as unknown as Uint8Array;
      const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(new Uint8Array(bytes));
      let tris = 0;
      let face = 0;
      for (const mesh of doc.getRoot().listMeshes()) {
        let mt = 0;
        for (const prim of mesh.listPrimitives()) {
          const idx = prim.getIndices();
          if (idx) mt += idx.getCount() / 3;
        }
        tris += mt;
        if (FACE_RE.test(mesh.getName())) face += mt;
      }
      const joints = doc.getRoot().listSkins()[0]!.listJoints().length;
      console.log(`${sha.slice(0, 9)} | ${date} | ${Math.round(face)} | ${Math.round(tris)} | ${joints} | ${bytes.byteLength} | ${rest.join(" ")}`);
    }
    return;
  }
  const hb03 = JSON.parse(readFileSync(path.join(ROOT, "docs/openclinxr/humanoid-postopt-ladder-2026-09-10.json"), "utf8")) as {
    bodies: Row[];
  };
  const hb05 = JSON.parse(
    readFileSync(path.join(ROOT, "docs/openclinxr/humanoid-postopt-ladder-face-preserving-2026-09-11.json"), "utf8"),
  ) as { bodies: Row[] };
  const promoted = new Map(hb05.bodies.filter((r) => r.promoted).map((r) => [r.body, r]));
  const rows: { report: string; row: Row }[] = [
    ...hb03.bodies.map((row) => ({ report: (promoted.get(row.body)?.body === row.body ? "HB05" : "HB03") as string, row: (promoted.get(row.body) ?? row) as Row })),
  ];
  console.log("body | report | bytesAfter->live | trisAfter->live | faceAfter->live | jointsAfter->live | floorOk | lastChange");
  for (const { report, row } of rows) {
    const live = await liveStats(row.body);
    const floor = Math.floor(row.faceBefore * row.faceRetentionRatio);
    const floorOk = live.face >= floor ? "FLOOR-OK" : "FLOOR-BREACH";
    console.log(
      `${row.body} | ${report} | ${row.bytesAfter}->${live.bytes}${row.bytesAfter === live.bytes ? "" : " MISMATCH"} | ` +
        `${row.triangleCountAfter}->${live.tris}${row.triangleCountAfter === live.tris ? "" : " MISMATCH"} | ` +
        `${row.faceAfter}->${live.face}${row.faceAfter === live.face ? "" : " MISMATCH"} | ` +
        `${row.jointCountAfter}->${live.joints}${row.jointCountAfter === live.joints ? "" : " MISMATCH"} | ` +
        `${floorOk} (floor ${floor}) | ${lastChange(row.body)}`,
    );
  }
}

void main();
