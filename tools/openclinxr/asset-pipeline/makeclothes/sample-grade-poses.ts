/** sample-grade-poses: regenerate the posed-gate inputs from shipped sources only.
 *
 * Named regenerating command for the rehide posed gate (e9-r1c D2): every
 * byte it writes derives from (1) the INPUT GLB's own animation clips + rig
 * and (2) the committed grade instrument
 * (tools/openclinxr/evidence/humanoid-vetting/see-through-pixels.ts
 * `loadScene`). No store dump, no E-dir file is read.
 *
 * Contract (F9): the input GLB must carry exactly the nurse's 3 shipped clips
 * (ClinicalIdleConversation, ClinicalExpressionMicroTransition,
 * openclinxr_retarget_walk_source) x 8 frames each = 24 frames; anything
 * else refuses loudly before writing.
 *
 * Replicates the e9-r0 pose sampling exactly: each animation clip x 8 frames
 * at mixer time (k * duration) / 8, skinned WORLD positions (three
 * getVertexPosition + localToWorld) as float32, meshes sorted by name; the
 * e9-r1 t2_rays sidecar (gradeNorm from the grade model node, capture-box
 * ray dirs + origins); and the e9-r1b full-frame stride-2 ray-dir bins.
 *
 * Usage:
 *   tsx tools/openclinxr/asset-pipeline/makeclothes/sample-grade-poses.ts \
 *     --in <nurse.glb> --out-dir <dir>
 * Outputs in <dir>: meta.json, <clip>_f<k>.bin (24), t2_rays.json,
 *   rays_full_front_s2.bin, rays_full_tq_s2.bin (28 files exactly).
 * The outputs stage in a sibling temp dir and promote via one atomic
 * directory rename into the absent <dir>; an existing <dir> is refused. A
 * mid-run failure cleans the stage and leaves <dir>
 * absent/unchanged. The derivation command must not pre-create <dir>.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { AnimationClip, Group } from "three";
import { AnimationMixer, Raycaster, type SkinnedMesh, Vector2, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { loadScene } from "../../evidence/humanoid-vetting/see-through-pixels.js";

const W = 4096;
const STRIDE = 2;
const BOXES: Record<string, { view: "front" | "three_quarter"; box: [number, number, number, number] }> = {
  cap_front: { view: "front", box: [2230, 1480, 2270, 1540] },
  cap_tq: { view: "three_quarter", box: [2160, 1460, 2220, 1530] },
  chest_front: { view: "front", box: [2160, 1460, 2270, 1540] },
};

function arg(name: string): string {
  const i = process.argv.indexOf(name);
  if (i < 0 || i + 1 >= process.argv.length) throw new Error(`missing ${name} <value>`);
  const value = process.argv[i + 1];
  if (value === undefined) throw new Error(`missing ${name} <value>`);
  return value;
}

/** Drop images/textures/samplers + all *Texture refs so GLTFLoader never hits
 * the browser image path (`self is not defined` in node). Geometry, skins,
 * animations and node bounds are untouched, so poses and cameras are exact. */
function stripTextures(glb: Buffer): ArrayBuffer {
  const jsonLen = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLen).toString("utf8")) as Record<string, unknown>;
  const nImg = Array.isArray(json["images"]) ? (json["images"] as unknown[]).length : 0;
  const nTex = Array.isArray(json["textures"]) ? (json["textures"] as unknown[]).length : 0;
  delete json["images"]; delete json["textures"]; delete json["samplers"];
  let scrubbed = 0;
  const scrub = (o: unknown): void => {
    if (Array.isArray(o)) { for (const v of o) scrub(v); return; }
    if (o !== null && typeof o === "object") {
      for (const k of Object.keys(o as Record<string, unknown>)) {
        if (k.endsWith("Texture")) { delete (o as Record<string, unknown>)[k]; scrubbed++; }
        else scrub((o as Record<string, unknown>)[k]);
      }
    }
  };
  scrub(json);
  console.log(`stripTextures: images=${nImg} textures=${nTex} texrefs=${scrubbed}`);
  const jsonBuf = Buffer.from(JSON.stringify(json));
  const pad = (4 - (jsonBuf.length % 4)) % 4;
  // Rebuild: header + JSON chunk + verbatim BIN chunk (if present).
  const paddedJsonLen = (jsonLen + 3) & ~3;
  const jsonStart = 20 + paddedJsonLen;
  const hasBin = jsonStart + 8 <= glb.length;
  const binChunk = hasBin ? glb.subarray(jsonStart) : null;
  const total = 12 + 8 + jsonBuf.length + pad + (binChunk ? binChunk.length : 0);
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonBuf.length + pad, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  jsonBuf.copy(out, 20);
  out.fill(0x20, 20 + jsonBuf.length, 20 + jsonBuf.length + pad);
  if (binChunk) binChunk.copy(out, 20 + jsonBuf.length + pad);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

/**
 * M5 atomic promote: validate the exact 28-file manifest in the staged
 * directory, then rename the whole directory into place with one atomic
 * rename. The destination must be absent (fresh derivation scratch): an
 * existing destination is refused with a clear error and the stage is
 * cleaned, so promotion is exactly one namespace operation. A manifest
 * mismatch cleans the stage and throws before the destination is touched.
 */
export function promoteStagedDir(stagedDir: string, outDir: string, expectedNames: readonly string[]): void {
  const got = readdirSync(stagedDir).sort();
  const want = [...expectedNames].sort();
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    rmSync(stagedDir, { recursive: true, force: true });
    throw new Error(
      `REFUSED: staged pose outputs [${got.join(", ")}] != manifest [${want.join(", ")}]; stage cleaned, destination untouched`,
    );
  }
  if (existsSync(outDir)) {
    rmSync(stagedDir, { recursive: true, force: true });
    throw new Error(
      `REFUSED: pose destination ${outDir} already exists; refusing to replace it — stage cleaned, destination unchanged`,
    );
  }
  renameSync(stagedDir, outDir);
}

async function main() {
  const glbPath = arg("--in");
  const outDir = resolve(arg("--out-dir"));

  const buf = readFileSync(glbPath);
  const ab = stripTextures(buf);
  const gltf = await new GLTFLoader().parseAsync(ab, "");
  // F9 refuse-before-writing: the posed gate's contract is the nurse's 3 shipped
  // clips x 8 frames each = 24 frames. Validate immediately after GLTF load,
  // before any mkdir/write, so a wrong-clip input leaves no partial frame bins
  // in the requested output directory.
  const CONTRACT_CLIPS = [
    "ClinicalIdleConversation",
    "ClinicalExpressionMicroTransition",
    "openclinxr_retarget_walk_source",
  ];
  const gotClips = gltf.animations.map((c) => c.name).sort();
  if (JSON.stringify(gotClips) !== JSON.stringify([...CONTRACT_CLIPS].sort())) {
    throw new Error(
      `REFUSED: input GLB clips [${gltf.animations.map((c) => c.name).join(", ")}] != contract [${CONTRACT_CLIPS.join(", ")}]; ` +
        "the posed gate needs exactly the 3 shipped clips x 8 frames = 24",
    );
  }
  const contractFrames = gltf.animations.length * 8;
  if (contractFrames !== 24) {
    throw new Error(`REFUSED: posed frame set is ${contractFrames}, not the contract 24 (3 clips x 8)`);
  }
  // M5: stage in a sibling temp dir (same parent: rename-into-place stays on
  // one filesystem and is atomic). The requested outDir is NOT pre-created —
  // the derivation command must not mkdir it either — it appears only via the
  // atomic promote after the exact 28-file manifest validates.
  mkdirSync(dirname(outDir), { recursive: true });
  const stagedDir = mkdtempSync(join(dirname(outDir), ".sample-grade-poses-"));
  const frameName = (clip: string, k: number): string => `${clip.replace(/[^\w.-]+/g, "_")}_f${k}.bin`;
  const manifest = [
    ...CONTRACT_CLIPS.flatMap((clip) => Array.from({ length: 8 }, (_unused, k) => frameName(clip, k))),
    "meta.json",
    "t2_rays.json",
    "rays_full_front_s2.bin",
    "rays_full_tq_s2.bin",
  ];
  let promoted = false;
  try {
    await runSampler(gltf, glbPath, stagedDir);
    promoteStagedDir(stagedDir, outDir, manifest);
    promoted = true;
  } finally {
    if (!promoted) rmSync(stagedDir, { recursive: true, force: true });
  }
  console.log(`done -> ${outDir}`);
}

async function runSampler(
  gltf: { scene: Group; animations: AnimationClip[] },
  glbPath: string,
  ownedTmp: string,
): Promise<void> {
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);

  const skinned: SkinnedMesh[] = [];
  scene.traverse((o: unknown) => {
    const m = o as SkinnedMesh;
    if ((m as { isSkinnedMesh?: boolean }).isSkinnedMesh) skinned.push(m);
  });
  // Total order: name first, traversal index second (F11: names are not
  // guaranteed unique across engines/runtimes, so equal names fall back to
  // the deterministic traversal position; 0 only for the same element).
  const order = new Map<SkinnedMesh, number>(skinned.map((m, i) => [m, i]));
  skinned.sort((a, b) => {
    if (a.name < b.name) return -1;
    if (a.name > b.name) return 1;
    const ia = order.get(a) ?? 0;
    const ib = order.get(b) ?? 0;
    if (ia < ib) return -1;
    if (ia > ib) return 1;
    return 0;
  });
  const totalVerts = skinned.reduce((n, m) => n + m.geometry.getAttribute("position").count, 0);
  console.log(`meshes=${skinned.length} totalVerts=${totalVerts}`);

  const meta: Record<string, unknown> = {
    meshes: skinned.map((m) => ({
      name: m.name,
      mat: (m.material as { name?: string }).name ?? "",
      verts: m.geometry.getAttribute("position").count,
      index: Array.from((m.geometry.getIndex() as { array: ArrayLike<number> }).array),
    })),
  };

  // 1. Pose loop: each clip x 8 frames at (k * duration) / 8 (e9-r0 rule).
  const v = new Vector3();
  const frames: Record<string, string[]> = {};
  for (const clip of gltf.animations) {
    const mixer = new AnimationMixer(scene);
    const action = mixer.clipAction(clip);
    action.play();
    const files: string[] = [];
    for (let k = 0; k < 8; k++) {
      mixer.setTime((k * clip.duration) / 8);
      scene.updateMatrixWorld(true);
      for (const m of skinned) m.skeleton.update();
      const out = new Float32Array(totalVerts * 3);
      let o = 0;
      for (const m of skinned) {
        const n = m.geometry.getAttribute("position").count;
        for (let i = 0; i < n; i++) {
          (m as SkinnedMesh & { getVertexPosition(i: number, t: Vector3): Vector3 }).getVertexPosition(i, v);
          m.localToWorld(v);
          out[o++] = v.x;
          out[o++] = v.y;
          out[o++] = v.z;
        }
      }
      const fn = `${clip.name.replace(/[^\w.-]+/g, "_")}_f${k}.bin`;
      writeFileSync(join(ownedTmp, fn), Buffer.from(out.buffer));
      files.push(fn);
    }
    mixer.stopAllAction();
    frames[clip.name] = files;
    console.log(`clip=${clip.name} dur=${clip.duration.toFixed(3)} frames=8`);
  }
  // Defensive cardinality after the loop (pre-promote): the early contract
  // above already refused before any write; this guards the promote step.
  const totalFrames = Object.values(frames).reduce((n, f) => n + f.length, 0);
  if (totalFrames !== 24) {
    throw new Error(`REFUSED: posed frame set is ${totalFrames}, not the contract 24 (3 clips x 8)`);
  }
  (meta as Record<string, unknown>)["frames"] = frames;
  (meta as Record<string, unknown>)["clips"] = gltf.animations.map((c) => ({ name: c.name, duration: c.duration }));
  writeFileSync(join(ownedTmp, "meta.json"), JSON.stringify(meta, null, 1));

  // 2. t2_rays sidecar: gradeNorm + per-box ray dirs/origins (e9-r1 rule).
  const sidecar: Record<string, unknown> = {};
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  {
    const { model } = await loadScene(glbPath, "front");
    sidecar["gradeNorm"] = { scale: model.scale.toArray(), position: model.position.toArray() };
    console.log(`gradeNorm scale=[${model.scale.toArray()}] position=[${model.position.toArray()}]`);
  }
  for (const [key, { view, box }] of Object.entries(BOXES)) {
    const { camera } = await loadScene(glbPath, view);
    const [x0, y0, x1, y1] = box;
    const n = (x1 - x0) * (y1 - y0);
    const dirs = new Float32Array(n * 3);
    let origin: number[] = [];
    let k = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        ndc.set(((x + 0.5) / W) * 2 - 1, -((y + 0.5) / W) * 2 + 1);
        raycaster.setFromCamera(ndc, camera);
        if (k === 0) origin = raycaster.ray.origin.toArray();
        const d = raycaster.ray.direction;
        dirs[k * 3] = d.x; dirs[k * 3 + 1] = d.y; dirs[k * 3 + 2] = d.z;
        k++;
      }
    }
    sidecar[key] = { view, box, origin, count: n };
    console.log(`${key}: view=${view} rays=${n}`);
  }
  writeFileSync(join(ownedTmp, "t2_rays.json"), JSON.stringify(sidecar, null, 1));

  // 3. Full-frame stride-2 ray-dir bins (e9-r1b rule).
  for (const view of ["front", "three_quarter"] as const) {
    const { camera } = await loadScene(glbPath, view);
    const n = (W / STRIDE) * (W / STRIDE);
    const dirs = new Float32Array(n * 3);
    let k = 0;
    for (let y = 0; y < W; y += STRIDE) {
      for (let x = 0; x < W; x += STRIDE) {
        ndc.set(((x + 0.5) / W) * 2 - 1, -((y + 0.5) / W) * 2 + 1);
        raycaster.setFromCamera(ndc, camera);
        const d = raycaster.ray.direction;
        dirs[k * 3] = d.x; dirs[k * 3 + 1] = d.y; dirs[k * 3 + 2] = d.z;
        k++;
      }
    }
    const fn = `rays_full_${view === "front" ? "front" : "tq"}_s2.bin`;
    writeFileSync(join(ownedTmp, fn), Buffer.from(dirs.buffer));
    console.log(`${view}: n=${n} -> ${fn}`);
  }
}

if (process.argv[1]?.endsWith("sample-grade-poses.ts")) main().catch((e) => { console.error(e); process.exit(1); });
