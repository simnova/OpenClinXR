/**
 * Kenney CC0 furniture GLB -> promoted medical-equipment asset (issue #646 and future deck-bank
 * slices). Reads a raw kit GLB from staging, DETECTS the target horizontal surface (seat top for
 * chairs), scales UNIFORMLY so that surface lands at a target height, bakes world transforms into
 * vertex positions, and writes the promoted GLB + provenance sidecar. Never edits the staging kit.
 *
 * Usage:
 *   pnpm exec tsx tools/openclinxr/asset-pipeline/equipment/kenney-promote-cli.ts \
 *     --source chair.glb \
 *     --target clinic-chair-kenney-cc0.glb \
 *     --asset-id chairs_equipment \
 *     --target-height-m 0.45 \
 *     --surface largest_horizontal
 *
 * claimScope: uniform seat-height normalization of a raw CC0 GLB into the tracked medical-equipment
 * library with provenance. notEvidenceFor: visual realism, clinical validity, Quest readiness.
 */
import { NodeIO } from "@gltf-transform/core";
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const REPO = process.cwd();
const KIT = join(REPO, ".openclinxr/staging/equipment/kenney-furniture-kit/Models/GLTF format");
const PROMOTED_DIR = join(REPO, "apps/ui-xr/public/xr-assets/medical-equipment");
const KIT_LICENSE_PATH = join(REPO, ".openclinxr/staging/equipment/kenney-furniture-kit/License.txt");
const KIT_PROVENANCE_PATH = join(REPO, ".openclinxr/staging/equipment/kenney-furniture-kit/provenance.json");

type Mat4 = number[];

function mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    let v = 0;
    for (let k = 0; k < 4; k++) v += a[r * 4 + k] * b[k * 4 + c];
    o[r * 4 + c] = v;
  }
  return o;
}

function trs(t: number[], q: number[], s: number[]): Mat4 {
  const [x, y, z, w] = q;
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;
  const rot: Mat4 = [
    1 - 2 * (yy + zz), 2 * (xy + wz), 2 * (xz - wy), 0,
    2 * (xy - wz), 1 - 2 * (xx + zz), 2 * (yz + wx), 0,
    2 * (xz + wy), 2 * (yz - wx), 1 - 2 * (xx + yy), 0,
    0, 0, 0, 1,
  ];
  const rs = rot.map((v, i) => (i % 4 === 3 || i >= 12 ? v : v * s[Math.floor(i / 4)]));
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    o[r * 4 + c] = rs[r * 4 + c] + (c === 3 ? t[r] : 0);
  }
  return o;
}

function apply(m: Mat4, p: number[]): number[] {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

function applyNormal(m: Mat4, n: number[]): number[] {
  // upper 3x3 (uniform scale is handled by re-normalization after).
  const out = [
    m[0] * n[0] + m[4] * n[1] + m[8] * n[2],
    m[1] * n[0] + m[5] * n[1] + m[9] * n[2],
    m[2] * n[0] + m[6] * n[1] + m[10] * n[2],
  ];
  const len = Math.hypot(out[0], out[1], out[2]);
  return len === 0 ? out : out.map((v) => v / len);
}

/** World AABB + horizontal-surface area bins (|ny|>0.85), from the RAW source geometry. */
function measure(doc: any, scale: number): { aabbMin: number[]; aabbMax: number[]; tris: number; horizontalBins: Map<number, number> } {
  const root = doc.getRoot();
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  let tris = 0;
  const bins = new Map<number, number>();
  const processNode = (node: any, m: Mat4): void => {
    const mesh = node.getMesh();
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute("POSITION");
        if (!pos) continue;
        const arr = pos.getArray();
        if (!arr) continue;
        const size = pos.getElementSize();
        const idx = prim.getIndices();
        const idxArr = idx?.getArray() ?? null;
        const n = idxArr ? idxArr.length : arr.length / size;
        const at = (i: number): number[] => {
          const base = idxArr ? idxArr[i] * size : i * size;
          return [arr[base], arr[base + 1], arr[base + 2]];
        };
        for (let i = 0; i + 2 < n; i += 3) {
          const a = apply(m, at(i));
          const b = apply(m, at(i + 1));
          const c = apply(m, at(i + 2));
          for (const p of [a, b, c]) {
            const scaled = p.map((v) => v * scale);
            min = [Math.min(min[0], scaled[0]), Math.min(min[1], scaled[1]), Math.min(min[2], scaled[2])];
            max = [Math.max(max[0], scaled[0]), Math.max(max[1], scaled[1]), Math.max(max[2], scaled[2])];
          }
          tris++;
          const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
          const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
          const nrm = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
          const len = Math.hypot(nrm[0], nrm[1], nrm[2]);
          if (len === 0) continue;
          if (Math.abs(nrm[1]) / len > 0.85) {
            const area = 0.5 * len;
            const yCm = Math.round(((a[1] + b[1] + c[1]) / 3) * 100);
            bins.set(yCm, (bins.get(yCm) ?? 0) + area);
          }
        }
      }
    }
    for (const child of node.listChildren()) {
      const t = child.getTranslation() ?? [0, 0, 0];
      const q = child.getRotation() ?? [0, 0, 0, 1];
      const s = child.getScale() ?? [1, 1, 1];
      processNode(child, mul(m, trs(t, q, s)));
    }
  };
  for (const scene of root.listScenes()) {
    for (const child of scene.listChildren()) {
      const t = child.getTranslation() ?? [0, 0, 0];
      const q = child.getRotation() ?? [0, 0, 0, 1];
      const s = child.getScale() ?? [1, 1, 1];
      processNode(child, trs(t, q, s));
    }
  }
  return { aabbMin: min, aabbMax: max, tris, horizontalBins: bins };
}

/** Bake world transforms + uniform scale into POSITION/NORMAL, reset node TRS to identity. */
function bakeTransformsAndScale(doc: any, scale: number): void {
  const root = doc.getRoot();
  const processNode = (node: any, m: Mat4): void => {
    const mesh = node.getMesh();
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute("POSITION");
        if (!pos) continue;
        const arr = pos.getArray();
        if (!arr) continue;
        const size = pos.getElementSize();
        const count = pos.getCount();
        for (let i = 0; i < count; i++) {
          const p = apply(m, [arr[i * size], arr[i * size + 1], arr[i * size + 2]]);
          arr[i * size] = p[0] * scale;
          arr[i * size + 1] = p[1] * scale;
          arr[i * size + 2] = p[2] * scale;
        }
        const norm = prim.getAttribute("NORMAL");
        if (norm) {
          const nrm = norm.getArray();
          const nsize = norm.getElementSize();
          if (nrm) {
            for (let i = 0; i < norm.getCount(); i++) {
              const n = applyNormal(m, [nrm[i * nsize], nrm[i * nsize + 1], nrm[i * nsize + 2]]);
              nrm[i * nsize] = n[0];
              nrm[i * nsize + 1] = n[1];
              nrm[i * nsize + 2] = n[2];
            }
          }
        }
      }
      node.setTranslation([0, 0, 0]);
      node.setRotation([0, 0, 0, 1]);
      node.setScale([1, 1, 1]);
    }
    for (const child of node.listChildren()) {
      const t = child.getTranslation() ?? [0, 0, 0];
      const q = child.getRotation() ?? [0, 0, 0, 1];
      const s = child.getScale() ?? [1, 1, 1];
      processNode(child, mul(m, trs(t, q, s)));
    }
  };
  for (const scene of root.listScenes()) {
    for (const child of scene.listChildren()) {
      const t = child.getTranslation() ?? [0, 0, 0];
      const q = child.getRotation() ?? [0, 0, 0, 1];
      const s = child.getScale() ?? [1, 1, 1];
      processNode(child, trs(t, q, s));
    }
  }
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function parseArgs(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]!;
    if (!key.startsWith("--")) throw new Error(`expected --flag, got ${key}`);
    out[key.slice(2)] = args[i + 1] ?? "";
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const source = args.source;
  const target = args.target;
  const assetId = args["asset-id"];
  const targetHeightM = Number(args["target-height-m"]);
  if (!source || !target || !assetId || !Number.isFinite(targetHeightM)) {
    throw new Error("--source, --target, --asset-id, --target-height-m are required");
  }

  const sourcePath = join(KIT, source);
  const targetPath = join(PROMOTED_DIR, target);
  const sourceBytes = await readFile(sourcePath);
  const io = new NodeIO();
  const doc = await io.read(sourcePath);

  // 1. Detect the target horizontal surface on the RAW geometry (scale 1).
  const raw = measure(doc, 1);
  const sorted = [...raw.horizontalBins.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) throw new Error("no horizontal (|ny|>0.85) surface detected; cannot anchor seat height");
  const [seatY, seatArea] = sorted[0]!;
  const scale = targetHeightM / (seatY / 100);
  if (scale <= 0 || !Number.isFinite(scale)) throw new Error(`invalid scale ${scale} from seatY ${seatY}`);

  // 2. Bake + scale.
  bakeTransformsAndScale(doc, scale);

  // 3. Rename the root scene object(s) to the target stem for runtime affordance naming.
  const stem = target.replace(/\.glb$/u, "");
  for (const scene of doc.getRoot().listScenes()) {
    for (const child of scene.listChildren()) child.setName(stem);
  }

  // 4. Write promoted GLB.
  await io.write(targetPath, doc);

  // 5. Promoted measurements (verify the seat actually landed at target).
  const doc2 = await io.read(targetPath);
  const promoted = measure(doc2, 1);
  const promotedSeat = [...promoted.horizontalBins.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  const promotedBytes = await readFile(targetPath);
  const sourceStat = await stat(sourcePath);
  const license = await readFile(KIT_LICENSE_PATH, "utf8");

  const provenance = {
    schemaVersion: "openclinxr.medical-equipment-provenance.v1",
    derivationMode: "kenney_cc0_seat_height_normalize_promote",
    scenarioId: null,
    assetId,
    assetPath: `apps/ui-xr/public/xr-assets/medical-equipment/${target}`,
    sourceRecordPath: ".openclinxr/staging/equipment/kenney-furniture-kit/provenance.json",
    generatorMode: "kenney_promote_cli_tsx_bake_world_transform_and_uniform_scale",
    sourceKind: "third_party_kenney_cc0",
    usesRealTrellisForwardPass: false,
    backgroundRemovalUsed: false,
    textureMode: "author_embedded_materials",
    animationMode: "none_static_equipment",
    optimizationMode: "seat_height_uniform_normalize_no_decimation",
    realismGrade: null,
    promotionStatus: "runtime_candidate_not_readiness_gate_pass",
    sha256: sha256(promotedBytes),
    bytes: promotedBytes.length,
    measuredNormalize: {
      sourceFile: source,
      sourceBytes: sourceStat.size,
      sourceSha256: sha256(sourceBytes),
      sourceAabbM: {
        w: round3(raw.aabbMax[0] - raw.aabbMin[0]),
        h: round3(raw.aabbMax[1] - raw.aabbMin[1]),
        d: round3(raw.aabbMax[2] - raw.aabbMin[2]),
      },
      detectedSurfaceY: seatY / 100,
      detectedSurfaceArea: round3(seatArea),
      detectionMethod: "largest horizontal (|ny|>0.85) face cluster by area in world space; NOT the AABB maximum (a chair back is not a seat)",
      scaleFactor: round3(scale),
      targetHeightM,
      promotedAabbM: {
        w: round3(promoted.aabbMax[0] - promoted.aabbMin[0]),
        h: round3(promoted.aabbMax[1] - promoted.aabbMin[1]),
        d: round3(promoted.aabbMax[2] - promoted.aabbMin[2]),
      },
      promotedSurfaceY: promotedSeat ? promotedSeat[0] / 100 : null,
      promotedSurfaceArea: promotedSeat ? round3(promotedSeat[1]) : null,
      promotedTriangleCount: promoted.tris,
      runtimeFit: "applyGltfEquipmentFootprintFit scale=min(1, env/glb); promoted footprint must be <= parametric composite envelope so the runtime does not shrink it",
    },
    sourceOriginChain: {
      sourceTopologyMode: "kenney_asset_pack_download",
      downloadUrl: "https://kenney.nl/media/pages/assets/furniture-kit/440e0608a4-1677580847/kenney_furniture-kit.zip",
      rawZipPath: ".openclinxr/staging/equipment/kenney_furniture-kit.zip",
      rawZipBytes: 5130729,
      rawDownloadedAt: "2026-08-12T08:40:00.000Z",
      kitLicense: "CC0",
      derivationNote: "Promoted from the unedited CC0 staging kit (Models/GLTF format/chair.glb). Uniform scale baked into vertices so runtime shrink-only footprint fit leaves it untouched. Staging kit byte-identical (never edited).",
    },
    licenseChain: {
      status: "verified_at_download_cc0_no_attribution",
      licence: "CC0 (Public Domain)",
      attributionRequired: false,
      attribution: "Kenney Furniture Kit (https://kenney.nl/assets/furniture-kit) — CC0, no attribution required",
      licenseSource: "kenney.nl page text + .openclinxr/staging/equipment/kenney-furniture-kit/License.txt",
      sourceRecordClaimsSupported: [
        "Kenney Furniture Kit is CC0 Public Domain (source page text, read 2026-08-12).",
        "No attribution obligation for CC0 (Kenney CC0 policy).",
        "License.txt beside the kit states: Creative Commons Zero (CC0).",
      ],
      notRun: ["reverification_after_promote", "author_page_html_reparse"],
      explicitUnknown: ["whether embedded textures include third-party content beyond the CC0 grant"],
      notes: `CC0 carries no attribution obligation at all — no licences page required (contrast CC-BY route, issue #645). License.txt first line: ${license.split("\n")[0] ?? ""}`,
    },
    derivativeLineage: {
      status: "kenney_cc0_normalize_promote_derivative",
      assetId,
      method: "bake_world_transform_and_uniform_scale_into_vertices_then_copy_to_tracked_library",
      promotedFrom: `.openclinxr/staging/equipment/kenney-furniture-kit/Models/GLTF format/${source}`,
      lineageSteps: [
        "Raw CC0 kit GLB read from unedited staging path.",
        "Seat surface detected as largest horizontal face cluster (world space).",
        "Uniform scale = targetHeightM / detectedSurfaceY applied to all axes.",
        "World transforms + scale baked into POSITION (NORMAL re-oriented), node TRS reset to identity.",
        "Promoted byte-copy into apps/ui-xr/public/xr-assets/medical-equipment/.",
        "Wire REAL_EQUIPMENT_GLTF_BY_ID + PROVENANCE.md entry.",
      ],
    },
    toolVersion: "openclinxr-equipment-bank-promote-v1",
    promotedAt: new Date().toISOString(),
    notEvidenceFor: [
      "b_plus_visual_realism_gate",
      "quest_readiness",
      "production_asset_readiness",
      "learner_readiness",
      "clinical_validity",
      "scoring_validity",
      "scene_placement_readiness",
    ],
  };

  const sidecarPath = targetPath.replace(/\.glb$/u, ".provenance.json");
  await writeFile(sidecarPath, JSON.stringify(provenance, null, 2) + "\n");
  console.log(JSON.stringify({
    source,
    target,
    assetId,
    scaleFactor: round3(scale),
    detectedSurfaceY: seatY / 100,
    promotedSurfaceY: promotedSeat ? promotedSeat[0] / 100 : null,
    promotedAabbM: {
      w: round3(promoted.aabbMax[0] - promoted.aabbMin[0]),
      h: round3(promoted.aabbMax[1] - promoted.aabbMin[1]),
      d: round3(promoted.aabbMax[2] - promoted.aabbMin[2]),
    },
    promotedBytes: promotedBytes.length,
    sha256: provenance.sha256,
    sidecar: sidecarPath,
  }, null, 2));
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

await main();
