/**
 * ship-superset.test.ts — loss-class REDs plus identical/declared-decimate
 * GREENs for the ship-superset gate. Fixtures are synthetic GLB buffers
 * built in-test (no store files). Fixture values are illustrative: tiny
 * synthetic counts stand in for real Kevin magnitudes; the gate logic is
 * what is under test, not the numbers. Every accessor is placed into a
 * BIN-backed bufferView (F8: the BIN chunk is referenced, never bare), so
 * payload-byte and layout-redirect mutations are exercised, not vacuous.
 * New REDs cover the F1-F5+F7 hardening plus the r2 F3/F4 set: R1
 * duplicate/empty animation names (exit-2 throw), R2 retargeted channels,
 * R3 flipped BIN bytes, R4 dropped morph targets, R5 redirected layouts.
 * The r3 F3/F4 set adds: repointed channel at a string-identical-layout
 * sampler with diverged keyframe bytes, changed keyframe output bytes,
 * sparse values without a base bufferView, and a removed candidate BIN
 * (refused, never skipped).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  findLosses,
  type GltfAccessor,
  type GltfAnimation,
  type GltfBufferView,
  type GltfRoot,
} from "./ship-superset";

const TOOL = "tools/openclinxr/asset-pipeline/humanoid-chain/ship-superset.ts";
const TEETH = "openclinxr_fitted_teeth_mpfb_peds_nurse_kevin_mesh";

function glbBytes(gltf: GltfRoot, bin: Buffer): Buffer {
  const encoded = Buffer.from(JSON.stringify(gltf), "utf8");
  const pad = (4 - (encoded.length % 4)) % 4;
  const json = Buffer.concat([encoded, Buffer.alloc(pad, 0x20)]);
  const binPad = (4 - (bin.length % 4)) % 4;
  const binPadded = Buffer.concat([bin, Buffer.alloc(binPad, 0)]);
  const header = Buffer.alloc(20);
  header.write("glTF", 0, "binary");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + json.length + 8 + binPadded.length, 8);
  header.writeUInt32LE(json.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binPadded.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, json, binHeader, binPadded]);
}

const CT_SIZE: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_N: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

function elemSize(acc: GltfAccessor): number {
  const cs = typeof acc.componentType === "number" ? (CT_SIZE[acc.componentType] ?? 0) : 0;
  const tn = typeof acc.type === "string" ? (TYPE_N[acc.type] ?? 0) : 0;
  return cs * tn;
}

/** Append shared sampler time/value accessors and point every animation
 * sampler at them, so mesh-count mutations never alias sampler I/O (as in
 * real glTF, where sampler inputs/outputs are dedicated time/value tracks). */
function pinSamplers(gltf: GltfRoot): void {
  const accs = gltf.accessors ?? [];
  const timeIdx = accs.length;
  accs.push({ count: 9, componentType: 5123, type: "SCALAR" });
  accs.push({ count: 9, componentType: 5126, type: "VEC3" });
  gltf.accessors = accs;
  for (const clip of gltf.animations ?? []) {
    for (const s of clip.samplers ?? []) {
      s.input = timeIdx;
      s.output = timeIdx + 1;
    }
  }
}

/** Place every accessor into its own sequential BIN-backed bufferView. */
function autoViews(gltf: GltfRoot): void {
  const accs = gltf.accessors ?? [];
  const views: GltfBufferView[] = [];
  let off = 0;
  for (const acc of accs) {
    acc.bufferView = views.length;
    acc.byteOffset = 0;
    const len = (typeof acc.count === "number" ? acc.count : 0) * Math.max(1, elemSize(acc));
    views.push({ byteOffset: off, byteLength: len });
    off += len;
  }
  gltf.bufferViews = views;
}

/** Append an accessor with its own trailing bufferView; returns its index. */
function addAccessor(gltf: GltfRoot, acc: GltfAccessor): number {
  const accs = gltf.accessors ?? [];
  const views = gltf.bufferViews ?? [];
  let off = 0;
  for (const v of views) off = Math.max(off, (v.byteOffset ?? 0) + (v.byteLength ?? 0));
  const len = (typeof acc.count === "number" ? acc.count : 0) * Math.max(1, elemSize(acc));
  const idx = accs.length;
  accs.push({ ...acc, bufferView: views.length, byteOffset: 0 });
  views.push({ byteOffset: off, byteLength: len });
  gltf.accessors = accs;
  gltf.bufferViews = views;
  return idx;
}

/** Fill BIN covering every bufferView end. */
function sizedBin(gltf: GltfRoot, fill: number): Buffer {
  let end = 0;
  for (const v of gltf.bufferViews ?? []) end = Math.max(end, (v.byteOffset ?? 0) + (v.byteLength ?? 0));
  return Buffer.alloc(Math.max(end, 1), fill);
}

/** Standard indexed mesh: TRIANGLES by default, POSITION + indices accessors. */
function mesh(
  name: string,
  tris: number,
  accessorBase: number,
  mode = 4,
): { mesh: { name: string; primitives: Array<{ indices: number; mode: number; attributes: Record<string, number> }> }; accessors: GltfAccessor[] } {
  const idxCount = mode === 4 ? tris * 3 : tris + 2;
  return {
    mesh: { name, primitives: [{ indices: accessorBase, mode, attributes: { POSITION: accessorBase + 1 } }] },
    accessors: [
      { count: idxCount, componentType: 5123, type: "SCALAR" },
      { count: Math.max(tris, 1), componentType: 5126, type: "VEC3" },
    ],
  };
}

/** Non-indexed mesh: tri count comes from the POSITION accessor. */
function nonIndexedMesh(
  name: string,
  tris: number,
): { mesh: { name: string; primitives: Array<{ attributes: Record<string, number> }> }; accessors: GltfAccessor[] } {
  return {
    mesh: { name, primitives: [{ attributes: { POSITION: 0 } }] },
    accessors: [{ count: tris * 3, componentType: 5126, type: "VEC3" }],
  };
}

function anims(names: string[]): GltfAnimation[] {
  return names.map((name) => ({
    name,
    channels: [{ sampler: 0, target: { node: 0, path: "rotation" } }],
    samplers: [{ input: 0, output: 1 }],
  }));
}

const ANIM_NAMES = ["ClinicalIdleConversation", "ClinicalExpressionMicroTransition", "openclinxr_retarget_walk_source"];

function pair(over: { main?: Partial<GltfRoot>; cand?: Partial<GltfRoot> }): { main: GltfRoot; cand: GltfRoot } {
  const teeth = mesh(TEETH, 4627, 0);
  const base: GltfRoot = {
    asset: { copyright: "Contains WojackOWL, Medical Scrubs Kit, CC-BY", extras: { kevinChain: 1 } },
    accessors: teeth.accessors,
    meshes: [teeth.mesh],
    animations: anims(ANIM_NAMES),
  };
  const main: GltfRoot = JSON.parse(JSON.stringify({ ...base, ...over.main })) as GltfRoot;
  const cand: GltfRoot = JSON.parse(JSON.stringify({ ...base, ...over.cand })) as GltfRoot;
  pinSamplers(main);
  pinSamplers(cand);
  autoViews(main);
  autoViews(cand);
  return { main, cand };
}

function runCli(
  main: GltfRoot,
  cand: GltfRoot,
  extraArgs: string[] = [],
  bins?: { main: Buffer; cand: Buffer },
): { code: number; out: string; err: string } {
  const dir = mkdtempSync(join(tmpdir(), "superset-test-"));
  const mainPath = join(dir, "main.glb");
  const candPath = join(dir, "cand.glb");
  writeFileSync(mainPath, glbBytes(main, bins?.main ?? sizedBin(main, 0)));
  writeFileSync(candPath, glbBytes(cand, bins?.cand ?? sizedBin(cand, 0)));
  try {
    const out = execFileSync("pnpm", ["exec", "tsx", TOOL, "--main", mainPath, "--candidate", candPath, ...extraArgs], {
      encoding: "utf8",
    });
    return { code: 0, out, err: "" };
  } catch (e) {
    const err = e as { status?: number; stdout?: unknown; stderr?: unknown };
    return { code: err.status ?? 99, out: String(err.stdout ?? ""), err: String(err.stderr ?? "") };
  }
}

describe("ship-superset loss classes", () => {
  it("RED dropped animation names the clip", () => {
    const { main, cand } = pair({ cand: { animations: [{ name: "ClinicalIdleConversation" }] } });
    const losses = findLosses(main, cand, new Set());
    expect(losses.filter((l) => l.includes("ClinicalExpressionMicroTransition"))).toHaveLength(1);
    expect(losses.filter((l) => l.includes("openclinxr_retarget_walk_source"))).toHaveLength(1);
    const cli = runCli(main, cand);
    expect(cli.code).toBe(1);
    expect(cli.out).toContain("ClinicalExpressionMicroTransition");
  });

  it("RED tri change on an undeclared mesh names the mesh", () => {
    const big = mesh(TEETH, 7120, 0);
    const { main, cand } = pair({ cand: { accessors: big.accessors, meshes: [big.mesh] } });
    const losses = findLosses(main, cand, new Set());
    expect(losses.filter((l) => l.includes("mesh tri mismatch") && l.includes(TEETH))).toHaveLength(1);
    expect(losses[0]).toContain("4627");
    expect(losses[0]).toContain("7120");
    expect(runCli(main, cand).code).toBe(1);
  });

  it("RED missing copyright names copyright", () => {
    const { main, cand } = pair({ cand: { asset: { extras: { kevinChain: 1 } } } });
    const losses = findLosses(main, cand, new Set());
    expect(losses.some((l) => l.includes("asset.copyright"))).toBe(true);
    const cli = runCli(main, cand);
    expect(cli.code).toBe(1);
    expect(cli.out).toContain("asset.copyright");
  });

  it("RED missing extras key names the key", () => {
    const { main, cand } = pair({ cand: { asset: { copyright: "Contains WojackOWL, Medical Scrubs Kit, CC-BY", extras: {} } } });
    const losses = findLosses(main, cand, new Set());
    expect(losses).toHaveLength(1);
    expect(losses[0]).toContain("kevinChain");
    expect(runCli(main, cand).code).toBe(1);
  });

  it("GREEN identical pair", () => {
    const { main, cand } = pair({});
    expect(findLosses(main, cand, new Set())).toEqual([]);
    const cli = runCli(main, cand);
    expect(cli.code).toBe(0);
    expect(cli.out).toContain("OK");
  });

  it("GREEN declared-decimate tri drop", () => {
    const big = mesh(TEETH, 7120, 0);
    const { main, cand } = pair({
      main: { accessors: big.accessors, meshes: [big.mesh] },
    });
    const decimated = new Set([TEETH]);
    expect(findLosses(main, cand, decimated)).toEqual([]);
    const cli = runCli(main, cand, ["--decimated-mesh", TEETH]);
    expect(cli.code).toBe(0);
  });

  it("RED declared-decimate tri rise", () => {
    const small = mesh(TEETH, 3000, 0);
    const big = mesh(TEETH, 4627, 0);
    const base2 = pair({
      main: { accessors: small.accessors, meshes: [small.mesh] },
      cand: { accessors: big.accessors, meshes: [big.mesh] },
    });
    const decimated = new Set([TEETH]);
    const losses = findLosses(base2.main, base2.cand, decimated);
    expect(losses).toHaveLength(1);
    expect(losses[0]).toContain("rises");
    const cli = runCli(base2.main, base2.cand, ["--decimated-mesh", TEETH]);
    expect(cli.code).toBe(1);
    expect(cli.out).toContain("rises");
  });

  it("RED non-indexed tri drop counts POSITION vertices", () => {
    const dropped = nonIndexedMesh(TEETH, 2);
    const { main, cand } = pair({
      main: { accessors: nonIndexedMesh(TEETH, 3).accessors, meshes: [nonIndexedMesh(TEETH, 3).mesh] },
      cand: { accessors: dropped.accessors, meshes: [dropped.mesh] },
    });
    const losses = findLosses(main, cand, new Set());
    const tri = losses.filter((l) => l.includes("mesh tri mismatch") && l.includes(TEETH));
    expect(tri).toHaveLength(1);
    expect(tri[0]).toContain("mainTris=3");
    expect(tri[0]).toContain("candidateTris=2");
    expect(runCli(main, cand).code).toBe(1);
  });

  it("RED strip primitive counts n-2 not n/3", () => {
    const strip = mesh(TEETH, 4, 0, 5);
    const flatAccessors: GltfAccessor[] = [
      { count: 6, componentType: 5123, type: "SCALAR" },
      { count: 4, componentType: 5126, type: "VEC3" },
    ];
    const { main, cand } = pair({
      main: { accessors: strip.accessors, meshes: [strip.mesh] },
      cand: {
        accessors: flatAccessors,
        meshes: [{ name: TEETH, primitives: [{ indices: 0, mode: 4, attributes: { POSITION: 1 } }] }],
      },
    });
    const losses = findLosses(main, cand, new Set());
    const tri = losses.filter((l) => l.includes("mesh tri mismatch") && l.includes(TEETH));
    expect(tri).toHaveLength(1);
    expect(tri[0]).toContain("mainTris=4");
    expect(tri[0]).toContain("candidateTris=2");
    expect(runCli(main, cand).code).toBe(1);
  });

  it("EXIT2 duplicate mesh name exits 2 naming the name", () => {
    const teeth = mesh(TEETH, 4627, 0);
    const dup = mesh(TEETH, 100, 2);
    const { main } = pair({});
    const cand: GltfRoot = {
      ...JSON.parse(JSON.stringify(pair({}).cand)) as GltfRoot,
      accessors: [...teeth.accessors, ...dup.accessors],
      meshes: [teeth.mesh, dup.mesh],
    };
    const cli = runCli(main, cand);
    expect(cli.code).toBe(2);
    expect(cli.err).toContain(TEETH);
  });

  it("RED missing mesh names the mesh", () => {
    const extra = mesh("openclinxr_extra_kevin_mesh", 100, 2);
    const { main, cand } = pair({});
    const mainPlus: GltfRoot = {
      ...main,
      accessors: [...(main.accessors ?? []), ...extra.accessors],
      meshes: [...(main.meshes ?? []), extra.mesh],
    };
    const losses = findLosses(mainPlus, cand, new Set());
    expect(losses).toContain("mesh missing in candidate: openclinxr_extra_kevin_mesh");
    const cli = runCli(mainPlus, cand);
    expect(cli.code).toBe(1);
    expect(cli.out).toContain("mesh missing in candidate: openclinxr_extra_kevin_mesh");
  });

  it("RED zero-channel animation names the clip", () => {
    const { main, cand } = pair({
      cand: {
        animations: [
          ...anims(["ClinicalIdleConversation"]).map((a) => ({ ...a, channels: [], samplers: [] })),
          ...anims(["ClinicalExpressionMicroTransition", "openclinxr_retarget_walk_source"]),
        ],
      },
    });
    const losses = findLosses(main, cand, new Set());
    expect(losses).toContain("animation has no channels in candidate: ClinicalIdleConversation");
    const cli = runCli(main, cand);
    expect(cli.code).toBe(1);
    expect(cli.out).toContain("animation has no channels in candidate: ClinicalIdleConversation");
  });

  it("RED structure change names the mesh", () => {
    const changed = mesh(TEETH, 4627, 0);
    changed.accessors.push({ count: 5, componentType: 5126, type: "VEC3" });
    (changed.mesh.primitives[0] as { attributes: Record<string, number> }).attributes = {
      POSITION: 1,
      NORMAL: 2,
    };
    const { main, cand } = pair({
      cand: { accessors: changed.accessors, meshes: [changed.mesh] },
    });
    const losses = findLosses(main, cand, new Set());
    const struct = losses.filter((l) => l.includes("mesh structure mismatch") && l.includes(TEETH));
    expect(struct.length).toBeGreaterThan(0);
    expect(struct.some((l) => l.includes("NORMAL"))).toBe(true);
    expect(losses.some((l) => l.includes("mesh tri mismatch"))).toBe(false);
    expect(runCli(main, cand).code).toBe(1);
  });

  it("RED empty candidate copyright with empty main names copyright", () => {
    const { main, cand } = pair({
      main: { asset: { copyright: "", extras: { kevinChain: 1 } } },
      cand: { asset: { copyright: "", extras: { kevinChain: 1 } } },
    });
    const losses = findLosses(main, cand, new Set());
    expect(losses.some((l) => l.includes("asset.copyright missing in candidate"))).toBe(true);
    const cli = runCli(main, cand);
    expect(cli.code).toBe(1);
    expect(cli.out).toContain("asset.copyright");
  });

  it("RED inherited extras key names the key", () => {
    const { main, cand } = pair({
      main: { asset: { copyright: "Contains WojackOWL, Medical Scrubs Kit, CC-BY", extras: { kevinChain: 1, toString: 1 } } },
    });
    const losses = findLosses(main, cand, new Set());
    expect(losses).toContain("asset.extras key missing in candidate: toString");
    const cli = runCli(main, cand);
    expect(cli.code).toBe(1);
    expect(cli.out).toContain("asset.extras key missing in candidate: toString");
  });

  it("RED R1 duplicate animation name is rejected in either file", () => {
    const { main, cand } = pair({});
    cand.animations = [...(cand.animations ?? []), ...anims(["ClinicalIdleConversation"])];
    expect(() => findLosses(main, cand, new Set())).toThrow(/duplicate animation name/);
    const flipped = pair({});
    flipped.main.animations = [...(flipped.main.animations ?? []), ...anims(["ClinicalIdleConversation"])];
    expect(() => findLosses(flipped.main, flipped.cand, new Set())).toThrow(/duplicate animation name/);
  });

  it("RED R1 empty animation name is rejected", () => {
    const { main, cand } = pair({});
    cand.animations = [
      ...(cand.animations ?? []),
      { name: "", channels: [{ sampler: 0, target: { node: 0, path: "rotation" } }], samplers: [{ input: 0, output: 1 }] },
    ];
    expect(() => findLosses(main, cand, new Set())).toThrow(/empty animation name/);
  });

  it("RED R2 retargeted animation channel is refused", () => {
    const moved = pair({});
    const ch0 = moved.cand.animations?.[0]?.channels?.[0];
    if (ch0 === undefined || ch0.target === undefined) throw new Error("fixture broken: missing channel target");
    ch0.target = { node: 99, path: "rotation" };
    const movedLosses = findLosses(moved.main, moved.cand, new Set());
    expect(
      movedLosses.some(
        (l) => l.includes("ClinicalIdleConversation") && l.includes("channel 0") && l.includes("target"),
      ),
    ).toBe(true);
    const pathed = pair({});
    const ch1 = pathed.cand.animations?.[0]?.channels?.[0];
    if (ch1 === undefined || ch1.target === undefined) throw new Error("fixture broken: missing channel target");
    ch1.target = { node: 0, path: "translation" };
    const pathedLosses = findLosses(pathed.main, pathed.cand, new Set());
    expect(
      pathedLosses.some(
        (l) => l.includes("ClinicalIdleConversation") && l.includes("channel 0") && l.includes("target"),
      ),
    ).toBe(true);
  });

  it("RED R3 changed BIN bytes under an identical accessor are refused", () => {
    const { main, cand } = pair({});
    const mainBin = sizedBin(main, 0xa5);
    const candBin = Buffer.from(mainBin);
    const pos = (cand.accessors ?? [])[1];
    if (pos === undefined) throw new Error("fixture broken: missing POSITION accessor");
    const view = (cand.bufferViews ?? [])[pos.bufferView ?? -1];
    const start = (view?.byteOffset ?? 0) + (pos.byteOffset ?? 0);
    const len = (typeof pos.count === "number" ? pos.count : 0) * 12;
    candBin[start + 5] ^= 0xff;
    const losses = findLosses(main, cand, new Set(), { main: mainBin, candidate: candBin });
    const expected = createHash("sha256").update(candBin.subarray(start, start + len)).digest("hex");
    expect(losses.some((l) => l.includes("bytes mismatch") && l.includes(TEETH) && l.includes(expected))).toBe(true);
  });

  it("RED R4 dropped morph target is refused", () => {
    const { main, cand } = pair({});
    const t0 = addAccessor(main, { count: 4627, componentType: 5126, type: "VEC3" });
    const t1 = addAccessor(main, { count: 4627, componentType: 5126, type: "VEC3" });
    const prim = main.meshes?.[0]?.primitives?.[0];
    if (prim === undefined) throw new Error("fixture broken: missing primitive");
    prim.targets = [{ POSITION: t0 }, { POSITION: t1 }];
    const losses = findLosses(main, cand, new Set(), {
      main: sizedBin(main, 0xa5),
      cand: sizedBin(cand, 0xa5),
    });
    expect(losses.some((l) => l.includes("morph") && l.includes(TEETH))).toBe(true);
  });

  it("RED R5 redirected accessor layout is refused", () => {
    const moved = pair({});
    const maccs = moved.cand.accessors ?? [];
    const first = maccs[0];
    if (first === undefined) throw new Error("fixture broken: missing indices accessor");
    const decoy = addAccessor(moved.cand, { count: 13881, componentType: 5123, type: "SCALAR" });
    const decoyView = (moved.cand.accessors ?? [])[decoy]?.bufferView;
    if (decoyView === undefined) throw new Error("fixture broken: missing decoy view");
    maccs[0] = { ...first, bufferView: decoyView };
    const movedLosses = findLosses(moved.main, moved.cand, new Set(), {
      main: sizedBin(moved.main, 0xa5),
      cand: sizedBin(moved.cand, 0xa5),
    });
    expect(movedLosses.some((l) => l.includes("structure mismatch") && l.includes(TEETH))).toBe(true);
    const shifted = pair({});
    const saccs = shifted.cand.accessors ?? [];
    const sfirst = saccs[0];
    if (sfirst === undefined) throw new Error("fixture broken: missing indices accessor");
    saccs[0] = { ...sfirst, byteOffset: 4 };
    const shiftedLosses = findLosses(shifted.main, shifted.cand, new Set(), {
      main: sizedBin(shifted.main, 0xa5),
      cand: sizedBin(shifted.cand, 0xa5),
    });
    expect(shiftedLosses.some((l) => l.includes("structure mismatch") && l.includes(TEETH))).toBe(true);
  });

  it("RED F3 keyframe byte change on a shared view behind a same-layout sampler is refused (sampler-index repoint alone: KCG-SUPERSET-RESIDUALS)", () => {
    const { main, cand } = pair({});
    // Decoy sampler I/O: fresh accessor indices sharing the original
    // bufferViews/offsets, so every layout string is identical and only the
    // resolved payload differs.
    const mainTime = (main.accessors ?? [])[(main.animations?.[0]?.samplers?.[0]?.input ?? -1)];
    const mainVal = (main.accessors ?? [])[(main.animations?.[0]?.samplers?.[0]?.output ?? -1)];
    if (mainTime === undefined || mainVal === undefined) throw new Error("fixture broken: missing sampler I/O");
    const accs = cand.accessors ?? [];
    const timeIdx = accs.length;
    accs.push({ ...JSON.parse(JSON.stringify(mainTime)) as GltfAccessor });
    accs.push({ ...JSON.parse(JSON.stringify(mainVal)) as GltfAccessor });
    cand.accessors = accs;
    const samplers = cand.animations?.[0]?.samplers ?? [];
    samplers.push({ input: timeIdx, output: timeIdx + 1 });
    const ch = cand.animations?.[0]?.channels?.[0];
    if (ch === undefined) throw new Error("fixture broken: missing channel");
    ch.sampler = samplers.length - 1;
    const mainBin = sizedBin(main, 0xa5);
    const candBin = sizedBin(cand, 0xa5);
    // Diverge only the decoy output bytes; every mesh byte stays identical.
    const decoyOut = accs[timeIdx + 1] as GltfAccessor;
    const decoyView = (cand.bufferViews ?? [])[decoyOut.bufferView ?? -1];
    candBin[(decoyView?.byteOffset ?? 0) + (decoyOut.byteOffset ?? 0) + 3] ^= 0xff;
    const losses = findLosses(main, cand, new Set(), { main: mainBin, candidate: candBin });
    expect(
      losses.some(
        (l) =>
          l.includes("sampler bytes mismatch") &&
          l.includes("ClinicalIdleConversation") &&
          l.includes("channel 0") &&
          l.includes("output"),
      ),
    ).toBe(true);
  });

  it("RED F3 changed keyframe output bytes are refused", () => {
    const { main, cand } = pair({});
    const mainBin = sizedBin(main, 0xa5);
    const candBin = Buffer.from(mainBin);
    const outIdx = main.animations?.[0]?.samplers?.[0]?.output;
    const out = (cand.accessors ?? [])[outIdx ?? -1];
    if (out === undefined) throw new Error("fixture broken: missing sampler output");
    const view = (cand.bufferViews ?? [])[out.bufferView ?? -1];
    candBin[(view?.byteOffset ?? 0) + (out.byteOffset ?? 0) + 5] ^= 0xff;
    const losses = findLosses(main, cand, new Set(), { main: mainBin, candidate: candBin });
    expect(
      losses.some(
        (l) =>
          l.includes("sampler bytes mismatch") &&
          l.includes("ClinicalIdleConversation") &&
          l.includes("channel 0") &&
          l.includes("output"),
      ),
    ).toBe(true);
  });

  it("RED F4 sparse values without a base bufferView are refused", () => {
    const addSparseTarget = (gltf: GltfRoot): void => {
      const views = gltf.bufferViews ?? [];
      let off = 0;
      for (const v of views) off = Math.max(off, (v.byteOffset ?? 0) + (v.byteLength ?? 0));
      const idxView = views.length;
      views.push({ byteOffset: off, byteLength: 4 });
      const valView = views.length;
      views.push({ byteOffset: off + 4, byteLength: 24 });
      gltf.bufferViews = views;
      const accs = gltf.accessors ?? [];
      const sparseIdx = accs.length;
      accs.push({
        count: 4,
        componentType: 5126,
        type: "VEC3",
        sparse: {
          count: 2,
          indices: { bufferView: idxView, byteOffset: 0, componentType: 5123 },
          values: { bufferView: valView, byteOffset: 0 },
        },
      });
      gltf.accessors = accs;
      const prim = gltf.meshes?.[0]?.primitives?.[0];
      if (prim === undefined) throw new Error("fixture broken: missing primitive");
      prim.targets = [{ POSITION: sparseIdx }];
    };
    const { main, cand } = pair({});
    addSparseTarget(main);
    addSparseTarget(cand);
    const mainBin = sizedBin(main, 0xa5);
    const candBin = Buffer.from(mainBin);
    // Diverge only the sparse values bytes (base is zeros on both sides).
    const valView = (cand.bufferViews ?? [])[(cand.bufferViews ?? []).length - 1];
    candBin[(valView?.byteOffset ?? 0) + 7] ^= 0xff;
    const losses = findLosses(main, cand, new Set(), { main: mainBin, candidate: candBin });
    expect(losses.some((l) => l.includes("bytes mismatch") && l.includes(TEETH) && l.includes("target 0"))).toBe(true);
  });

  it("RED F4 removed candidate BIN is refused, not skipped", () => {
    const { main, cand } = pair({});
    const losses = findLosses(main, cand, new Set(), { main: sizedBin(main, 0xa5) });
    expect(losses.some((l) => l.includes("BIN missing") && l.includes(TEETH))).toBe(true);
  });

  it("GREEN material-only change passes", () => {
    const { main, cand } = pair({});
    main.materials = [{ name: "skin", pbrMetallicRoughness: { baseColorFactor: [1, 0.82, 0.71, 1] } }];
    cand.materials = [{ name: "skin", pbrMetallicRoughness: { baseColorFactor: [0.93, 0.55, 0.42, 1] } }];
    expect(
      findLosses(main, cand, new Set(), { main: sizedBin(main, 7), candidate: sizedBin(cand, 7) }),
    ).toEqual([]);
  });
});
