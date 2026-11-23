import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import {
  NURSE_CHEST_STAGE_INDICES_SHA256,
  NURSE_CHEST_STAGE_KEPT_INDICES_SHA256,
} from "@openclinxr/asset-registry/nurse-chest-stage";
import { glbGeometryDigest } from "@openclinxr/factory-station-core/runner";
import { describe, expect, it } from "vitest";
import {
  counterweights,
  matched,
} from "./shipped-lash-follow-geometry.js";
import {
  accessorBytes,
  indicesSha256,
  primAttrSig,
  sortedIndexArray,
  targetHash,
} from "./shipped-lash-follow-nurse-chest-split.js";
import {
  BASELINE_REF,
  CLOSURE,
  GLB_DIR,
  ROOT,
} from "./shipped-lash-follow-types.js";

const NURSE = "mpfb-clinical-nurse-adult.glb";
const EMITTED = "6c908f97c3048adad699edde7f67c7465e33402895cfa2e53cbe92d08af0f20b";
const SHIPPED_SPLIT_GEOMETRY_SHA256 = "1b1d0279aba867c8817a15188ae021634e6e0630adc8f2c11165e6bbcb33ae76";

/**
 * Split-nurse live identity is geometry, not bytes (C3a): the guards read indices,
 * morphs and hide-material bindings, never whole bytes, so a material-only
 * post-export stage keeps this digest while the file hash churns.
 */
function splitGeometryPinMatches(bytes: Uint8Array): boolean {
  return glbGeometryDigest(bytes) === SHIPPED_SPLIT_GEOMETRY_SHA256;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function loadInputBytes(): Uint8Array {
  return new Uint8Array(
    execFileSync("git", ["show", `${BASELINE_REF}:apps/ui-xr/public/generated-humanoids/${NURSE}`], {
      cwd: ROOT,
      maxBuffer: 64 * 1024 * 1024,
    }),
  );
}

function sidecarEmitted(): string {
  const sidecar = JSON.parse(
    readFileSync(join(GLB_DIR, NURSE.replace(/\.glb$/, ".provenance.json")), "utf8"),
  ) as { lashFollowR8?: { inputSha256?: unknown } };
  const emitted = sidecar.lashFollowR8?.inputSha256;
  if (typeof emitted !== "string") throw new Error("sidecar lashFollowR8.inputSha256 missing");
  return emitted;
}

describe("nurse chest-split guards (R3a allowance)", () => {
  it("refuses a +1mm body morph plant on the shipped split nurse (CW1+CW2 false, pins intact)", async () => {
    const t0 = Date.now();
    // Baseline is still the emitted lash input; the plant goes on the shipped
    // +1-split nurse so the chestSplitBodyEqual allowance path runs (F7). The
    // old plant on the unsplit lash input took the equal-prim-count strict path
    // and never exercised the split pairing.
    const inputBytes = loadInputBytes();
    const baseSha = sha256(inputBytes);
    const emitted = sidecarEmitted();
    console.log("G1 plant-morph", { emitted, baseSha });
    expect(emitted, "sidecar emission pins the lash input").toBe(EMITTED);
    expect(baseSha, "plant baseline is the emitted lash-input bytes").toBe(emitted);
    const shippedBytes = new Uint8Array(readFileSync(join(GLB_DIR, NURSE)));
    const shippedSha = sha256(shippedBytes);
    expect(splitGeometryPinMatches(shippedBytes), "plant starts from the shipped split nurse").toBe(true);

    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const base = await io.readBinary(new Uint8Array(inputBytes));
    const shipped = await io.readBinary(new Uint8Array(shippedBytes));
    const pristineCw = counterweights(shipped, base, NURSE);
    console.log("G1 plant-morph pristine counterweights", pristineCw);
    expect(pristineCw.bodyMorphsByteEqual, "pristine shipped split passes CW1").toBe(true);
    expect(pristineCw.nonLashMeshesHashEqual, "pristine shipped split passes CW2").toBe(true);

    const cur = await io.readBinary(new Uint8Array(shippedBytes));
    const { body } = matched(cur, NURSE);
    const bodyMesh = body.getMesh()!;
    const names = (bodyMesh.getExtras() as { targetNames?: string[] }).targetNames ?? [];
    const targetIndex = names.indexOf(CLOSURE.left);
    expect(targetIndex, "eye-left-closure target present on shipped split body").toBeGreaterThanOrEqual(0);
    const prim = bodyMesh.listPrimitives()[0]!;
    const accessor = prim.listTargets()[targetIndex]?.getAttribute("POSITION");
    if (!accessor) throw new Error("eye-left-closure POSITION accessor missing on shipped split body prim0");
    const before: [number, number, number] = [0, 0, 0];
    accessor.getElement(0, before);
    accessor.setElement(0, [before[0], before[1] + 0.001, before[2]]);
    const plantedBytes = await io.writeBinary(cur);
    const plantedSha = sha256(plantedBytes);
    console.log("G1 plant-morph shas", { shippedSha, plantedSha });
    expect(plantedSha, "plant changed the bytes (+1mm on one shipped body morph vertex)").not.toBe(shippedSha);

    const plantedDoc = await io.readBinary(new Uint8Array(plantedBytes));
    const plantedBody = matched(plantedDoc, NURSE).body.getMesh()!;
    const plantedPrims = plantedBody.listPrimitives();
    const keptSha = indicesSha256(plantedPrims[0]!);
    const hiddenSha = indicesSha256(plantedPrims[plantedPrims.length - 2]!);
    expect(keptSha, "kept pin intact: morph plant moved no indices").toBe(NURSE_CHEST_STAGE_KEPT_INDICES_SHA256);
    expect(NURSE_CHEST_STAGE_INDICES_SHA256, "hidden pin intact: morph plant moved no indices").toContain(hiddenSha);
    const cw = counterweights(plantedDoc, base, NURSE);
    console.log("G1 plant-morph counterweights", cw);
    expect(cw.bodyMorphsByteEqual, "planted split morph must fail CW1").toBe(false);
    expect(cw.nonLashMeshesHashEqual, "planted split morph must fail CW2").toBe(false);
    console.log("G1 plant-morph wallMs", Date.now() - t0);
  }, 30_000);

  it("refuses a baseline-only off-by-one union plant with live buffers pinned (allowance false)", async () => {
    const t0 = Date.now();
    // F8: live kept/hidden buffers stay pinned; only the BASELINE union moves by
    // one index, so the sorted-index-union requirement is the ONLY thing that
    // can refuse. The old plant rewrote the live hidden buffer sha, which the
    // pin check already rejects. Baseline chosen as the live-kept key mate, so
    // the pairing still resolves to the split triple.
    const inputBytes = loadInputBytes();
    expect(sha256(inputBytes), "union plant baseline is the emitted lash input").toBe(EMITTED);
    const shippedBytes = new Uint8Array(readFileSync(join(GLB_DIR, NURSE)));
    expect(splitGeometryPinMatches(shippedBytes), "union plant live side is the shipped split nurse").toBe(true);
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const base = await io.readBinary(new Uint8Array(inputBytes));
    const shipped = await io.readBinary(new Uint8Array(shippedBytes));
    const pristineCw = counterweights(shipped, base, NURSE);
    expect(pristineCw.bodyMorphsByteEqual, "pristine shipped split passes CW1").toBe(true);
    expect(pristineCw.nonLashMeshesHashEqual, "pristine shipped split passes CW2").toBe(true);

    const shippedBody = matched(shipped, NURSE).body.getMesh()!;
    const keptLive = shippedBody.listPrimitives()[0]!;
    const cnLive = ((shippedBody.getExtras() as { targetNames?: string[] }).targetNames ?? []) as string[];
    const liveKey = `${primAttrSig(keptLive)}|${targetHash(keptLive, cnLive)}`;
    const baseBody = matched(base, NURSE).body.getMesh()!;
    const bnBase = ((baseBody.getExtras() as { targetNames?: string[] }).targetNames ?? []) as string[];
    const basePrim = baseBody.listPrimitives().find((p) => `${primAttrSig(p)}|${targetHash(p, bnBase)}` === liveKey);
    expect(basePrim, "setup: baseline prim pairs with the live kept prim").toBeDefined();
    const pristineUnion = sortedIndexArray(basePrim!);
    const indices = basePrim!.getIndices()!;
    const snapshot = Array.from(indices.getArray()! as ArrayLike<number>).map(Number);
    const before0 = snapshot[0]!;
    const posCount = basePrim!.getAttribute("POSITION")!.getCount();
    const after0 = (before0 + 1) % posCount;
    expect(after0, "union swap target differs").not.toBe(before0);
    (indices.getArray()! as unknown as number[])[0] = after0;
    const plantedBytes = await io.writeBinary(base);
    const plantedBase = await io.readBinary(new Uint8Array(plantedBytes));
    const plantedBaseBody = matched(plantedBase, NURSE).body.getMesh()!;
    const plantedNames = ((plantedBaseBody.getExtras() as { targetNames?: string[] }).targetNames ?? []) as string[];
    const plantedBasePrim = plantedBaseBody.listPrimitives().find((p) => `${primAttrSig(p)}|${targetHash(p, plantedNames)}` === liveKey);
    expect(plantedBasePrim, "setup: mutated baseline prim still pairs by key").toBeDefined();
    const plantedUnion = sortedIndexArray(plantedBasePrim!);
    expect(plantedUnion, "baseline-only plant moved the union").not.toEqual(pristineUnion);

    const liveBody = matched(shipped, NURSE).body.getMesh()!;
    const livePrims = liveBody.listPrimitives();
    expect(indicesSha256(livePrims[0]!), "live kept pin intact").toBe(NURSE_CHEST_STAGE_KEPT_INDICES_SHA256);
    expect(NURSE_CHEST_STAGE_INDICES_SHA256, "live hidden pin intact").toContain(
      indicesSha256(livePrims[livePrims.length - 2]!),
    );
    const cw = counterweights(shipped, plantedBase, NURSE);
    console.log("G1 plant-split counterweights", cw);
    expect(cw.bodyMorphsByteEqual, "baseline-only union plant must fail CW1").toBe(false);
    expect(cw.nonLashMeshesHashEqual, "baseline-only union plant must fail CW2").toBe(false);
    console.log("G1 plant-split wallMs", Date.now() - t0);
  }, 30_000);

  it("M2 lash path: prim8 morph target repointed at a byte-identical duplicate accessor refuses (index identity)", async () => {
    const t0 = Date.now();
    // The lash caller builds accessor-INDEX maps from the live document, so a
    // prim8 whose morph target points at a different accessor index holding
    // identical bytes must refuse through counterweights (CW1+CW2 false) even
    // though every byte signature — and therefore the pairing key — is intact.
    const inputBytes = loadInputBytes();
    expect(sha256(inputBytes), "repoint plant baseline is the emitted lash input").toBe(EMITTED);
    const shippedBytes = new Uint8Array(readFileSync(join(GLB_DIR, NURSE)));
    expect(splitGeometryPinMatches(shippedBytes), "repoint plant live side is the shipped split nurse").toBe(true);
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const base = await io.readBinary(new Uint8Array(inputBytes));
    const shipped = await io.readBinary(new Uint8Array(shippedBytes));
    const pristineCw = counterweights(shipped, base, NURSE);
    expect(pristineCw.bodyMorphsByteEqual, "pristine shipped split passes CW1").toBe(true);
    expect(pristineCw.nonLashMeshesHashEqual, "pristine shipped split passes CW2").toBe(true);

    const cur = await io.readBinary(new Uint8Array(shippedBytes));
    const bodyMesh = matched(cur, NURSE).body.getMesh()!;
    const prims = bodyMesh.listPrimitives();
    // P2e-C appended the skin prim9 last: the E9 hidden prim8 is second-to-last.
    const hidden = prims[prims.length - 2]!;
    const targets = hidden.listTargets();
    // Find two morph targets whose POSITION accessors are distinct objects
    // with byte-identical payloads (body prim0 targets 16/17 are the known
    // twin: POSITION 2055 == 2057, NORMAL 2056 == 2058).
    let twin: { from: number; to: number } | undefined;
    const posBytes = targets.map((target) => accessorBytes(target.getAttribute("POSITION")).toString("hex"));
    for (let i = 0; i < targets.length && !twin; i++) {
      for (let j = i + 1; j < targets.length; j++) {
        if (posBytes[i] === posBytes[j] && targets[i]!.getAttribute("POSITION") !== targets[j]!.getAttribute("POSITION")) {
          twin = { from: i, to: j };
          break;
        }
      }
    }
    expect(twin, "setup: prim8 carries a byte-identical duplicate POSITION accessor pair").toBeDefined();
    const donor = targets[twin!.from]!.getAttribute("POSITION")!;
    const before = targets[twin!.to]!.getAttribute("POSITION")!;
    expect(donor, "setup: donor POSITION accessor present").not.toBe(before);
    targets[twin!.to]!.setAttribute("POSITION", donor);
    // No write/read round-trip: gltf-transform's writer reorders the accessor
    // table (pristine POSITION 2018 reads back as 2032), which would break the
    // caller's index-identity witness for the wrong reason. Run the counterweights
    // directly on the mutated in-memory document: numbering is untouched, only
    // the intended binding differs.
    const plantedPrims = matched(cur, NURSE).body.getMesh()!.listPrimitives();
    expect(indicesSha256(plantedPrims[0]!), "live kept pin intact").toBe(NURSE_CHEST_STAGE_KEPT_INDICES_SHA256);
    expect(NURSE_CHEST_STAGE_INDICES_SHA256, "live hidden pin intact").toContain(
      indicesSha256(plantedPrims[plantedPrims.length - 2]!),
    );
    const cw = counterweights(cur, base, NURSE);
    console.log("G1 plant-repoint counterweights", cw);
    expect(cw.bodyMorphsByteEqual, "repointed duplicate-accessor split must fail CW1").toBe(false);
    expect(cw.nonLashMeshesHashEqual, "repointed duplicate-accessor split must fail CW2").toBe(false);
    console.log("G1 plant-repoint wallMs", Date.now() - t0);
  }, 30_000);

  it("M2 lash path: prim8 material swapped to another openclinxr_hidden_* refuses (exact hide material)", async () => {
    const t0 = Date.now();
    // The pairing key carries no material, so swapping prim8 onto another
    // existing openclinxr_hidden_* material still resolves the split triple —
    // only the predicate's exact hide-material binding can refuse.
    const inputBytes = loadInputBytes();
    expect(sha256(inputBytes), "material plant baseline is the emitted lash input").toBe(EMITTED);
    const shippedBytes = new Uint8Array(readFileSync(join(GLB_DIR, NURSE)));
    expect(splitGeometryPinMatches(shippedBytes), "material plant live side is the shipped split nurse").toBe(true);
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const base = await io.readBinary(new Uint8Array(inputBytes));
    const shipped = await io.readBinary(new Uint8Array(shippedBytes));
    const pristineCw = counterweights(shipped, base, NURSE);
    expect(pristineCw.bodyMorphsByteEqual, "pristine shipped split passes CW1").toBe(true);
    expect(pristineCw.nonLashMeshesHashEqual, "pristine shipped split passes CW2").toBe(true);

    const cur = await io.readBinary(new Uint8Array(shippedBytes));
    const root = cur.getRoot();
    const bodyMesh = matched(cur, NURSE).body.getMesh()!;
    const prims = bodyMesh.listPrimitives();
    // P2e-C appended the skin prim9 last: the E9 hidden prim8 is second-to-last.
    const hidden = prims[prims.length - 2]!;
    const liveHide = hidden.getMaterial()?.getName() ?? "";
    expect(liveHide, "setup: E9 hide material is the upper hidden material").toContain("openclinxr_hidden_upper_");
    const other = root.listMaterials().find(
      (material) => (material.getName() ?? "").startsWith("openclinxr_hidden_") && material.getName() !== liveHide,
    );
    expect(other, "setup: another openclinxr_hidden_* material exists on the nurse").toBeDefined();
    hidden.setMaterial(other!);
    // No write/read round-trip (see the repoint plant above): run the
    // counterweights directly on the mutated in-memory document.
    const plantedPrims = matched(cur, NURSE).body.getMesh()!.listPrimitives();
    expect(indicesSha256(plantedPrims[0]!), "live kept pin intact").toBe(NURSE_CHEST_STAGE_KEPT_INDICES_SHA256);
    expect(NURSE_CHEST_STAGE_INDICES_SHA256, "live hidden pin intact").toContain(
      indicesSha256(plantedPrims[plantedPrims.length - 2]!),
    );
    const cw = counterweights(cur, base, NURSE);
    console.log("G1 plant-material counterweights", cw);
    expect(cw.bodyMorphsByteEqual, "swapped-hide-material split must fail CW1").toBe(false);
    expect(cw.nonLashMeshesHashEqual, "swapped-hide-material split must fail CW2").toBe(false);
    console.log("G1 plant-material wallMs", Date.now() - t0);
  }, 30_000);

  it("M1 lash path: hidden-only triangle-rotated buffer refuses (hidden pin, union live)", async () => {
    const t0 = Date.now();
    // Rotate each hidden-prim triangle (a,b,c)->(b,c,a): the raw INDICES sha
    // changes while the sorted multiset, accessor bindings, and material stay
    // live. Only the predicate's hidden-role pin can refuse; with that check
    // removed the rotated pair is admitted and the counterweights pass.
    const inputBytes = loadInputBytes();
    expect(sha256(inputBytes), "rotation plant baseline is the emitted lash input").toBe(EMITTED);
    const shippedBytes = new Uint8Array(readFileSync(join(GLB_DIR, NURSE)));
    expect(splitGeometryPinMatches(shippedBytes), "rotation plant live side is the shipped split nurse").toBe(true);
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const base = await io.readBinary(new Uint8Array(inputBytes));
    const shipped = await io.readBinary(new Uint8Array(shippedBytes));
    const pristineCw = counterweights(shipped, base, NURSE);
    expect(pristineCw.bodyMorphsByteEqual, "pristine shipped split passes CW1").toBe(true);
    expect(pristineCw.nonLashMeshesHashEqual, "pristine shipped split passes CW2").toBe(true);

    const cur = await io.readBinary(new Uint8Array(shippedBytes));
    const bodyMesh = matched(cur, NURSE).body.getMesh()!;
    const prims = bodyMesh.listPrimitives();
    // P2e-C appended the skin prim9 last: rotate the E9 hidden prim8.
    const hidden = prims[prims.length - 2]!;
    const indices = hidden.getIndices()!;
    const arr = indices.getArray() as unknown as ArrayLike<number> & { length: number };
    expect(arr.length % 3, "setup: hidden indices form whole triangles").toBe(0);
    const beforeSorted = sortedIndexArray(hidden);
    const hiddenShaBefore = indicesSha256(hidden);
    const buf = Array.from({ length: arr.length }, (_, k) => arr[k]!);
    for (let i = 0; i < buf.length; i += 3) {
      const a = buf[i]!;
      buf[i] = buf[i + 1]!;
      buf[i + 1] = buf[i + 2]!;
      buf[i + 2] = a;
    }
    for (let k = 0; k < buf.length; k += 1) {
      (arr as unknown as number[])[k] = buf[k]!;
    }
    expect(sortedIndexArray(hidden), "rotation preserves the sorted multiset").toEqual(beforeSorted);
    expect(indicesSha256(hidden), "rotation changes the hidden raw sha").not.toBe(hiddenShaBefore);
    const plantedPrims = matched(cur, NURSE).body.getMesh()!.listPrimitives();
    expect(indicesSha256(plantedPrims[0]!), "kept pin intact: rotation touched only the hidden prim").toBe(
      NURSE_CHEST_STAGE_KEPT_INDICES_SHA256,
    );
    const cw = counterweights(cur, base, NURSE);
    console.log("G1 plant-rotation counterweights", cw);
    expect(cw.bodyMorphsByteEqual, "triangle-rotated hidden split must fail CW1").toBe(false);
    expect(cw.nonLashMeshesHashEqual, "triangle-rotated hidden split must fail CW2").toBe(false);
    console.log("G1 plant-rotation wallMs", Date.now() - t0);
  }, 30_000);

  it("control: the lash input vs itself passes (true/true, shas equal)", async () => {
    const t0 = Date.now();
    const inputBytes = loadInputBytes();
    const baseSha = sha256(inputBytes);
    expect(baseSha, "control starts from the emitted lash-input bytes").toBe(EMITTED);
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const a = await io.readBinary(new Uint8Array(inputBytes));
    const b = await io.readBinary(new Uint8Array(inputBytes));
    const inputBytesAgain = loadInputBytes();
    const againSha = sha256(inputBytesAgain);
    console.log("G1 control shas", { baseSha, againSha });
    expect(againSha, "control reloads identical bytes").toBe(baseSha);
    const cw = counterweights(a, b, NURSE);
    console.log("G1 control counterweights", cw);
    expect(cw.bodyMorphsByteEqual, "control passes CW1").toBe(true);
    expect(cw.nonLashMeshesHashEqual, "control passes CW2").toBe(true);
    console.log("G1 control wallMs", Date.now() - t0);
  }, 30_000);
});

describe("A6 split-nurse geometry pin (C3a: a material-only stage re-pins no geometry file)", () => {
  const SPLIT_GLB = join(GLB_DIR, NURSE);

  /** Material-only variant: one parsed baseColorFactor component +0.05 (clamped); JSON chunk lengths repaired. */
  function withMaterialOnlyTweak(shipped: Uint8Array): {
    bytes: Uint8Array;
    material: string;
    component: number;
    before: number[];
    after: number[];
  } {
    const buf = Buffer.from(shipped);
    const jsonLen = buf.readUInt32LE(12);
    const jsonText = buf.subarray(20, 20 + jsonLen).toString("utf8");
    const doc = JSON.parse(jsonText) as {
      materials?: { name?: string; pbrMetallicRoughness?: { baseColorFactor?: number[] } }[];
    };
    const idx = (doc.materials ?? []).findIndex((mm) => Array.isArray(mm.pbrMetallicRoughness?.baseColorFactor));
    if (idx < 0) throw new Error("A6 P1 setup: no baseColorFactor material");
    const mat = doc.materials![idx]!;
    const before = [...mat.pbrMetallicRoughness!.baseColorFactor!];
    const component = 0;
    const bumped = Math.min(1, (before[component] ?? 0) + 0.05);
    const after = [...before];
    after[component] = bumped;
    const arrM = /"baseColorFactor":\[([^\]]*)\]/.exec(jsonText);
    if (!arrM) throw new Error("A6 P1 setup: baseColorFactor array missing from JSON text");
    const numM = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(arrM[1]!);
    if (!numM) throw new Error("A6 P1 setup: no numeric token in baseColorFactor");
    const tok = numM[0];
    const absIdx = arrM.index + arrM[0].indexOf(arrM[1]!) + numM.index;
    let next = jsonText.slice(0, absIdx) + String(bumped) + jsonText.slice(absIdx + tok.length);
    next += " ".repeat((4 - (Buffer.byteLength(next, "utf8") % 4)) % 4);
    const nextBytes = Buffer.from(next, "utf8");
    const binStart = 20 + jsonLen;
    const out = Buffer.alloc(20 + nextBytes.length + (buf.length - binStart));
    buf.subarray(0, 8).copy(out, 0);
    out.writeUInt32LE(nextBytes.length, 12);
    buf.subarray(16, 20).copy(out, 16);
    nextBytes.copy(out, 20);
    buf.subarray(binStart).copy(out, 20 + nextBytes.length);
    out.writeUInt32LE(out.length, 8);
    return { bytes: new Uint8Array(out.buffer, out.byteOffset, out.byteLength), material: String(mat.name), component, before, after };
  }

  /** 1-ULP edit of the first float of the first float-POSITION accessor (in-memory copy). */
  function withOneUlpPositionEdit(shipped: Uint8Array): { bytes: Uint8Array; beforeHex: string; afterHex: string } {
    const buf = Buffer.from(shipped);
    const jsonLen = buf.readUInt32LE(12);
    const doc = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8")) as {
      meshes?: { primitives?: { attributes?: Record<string, number> }[] }[];
      accessors?: { bufferView?: number; byteOffset?: number; componentType?: number }[];
      bufferViews?: { byteOffset?: number }[];
    };
    let at = -1;
    for (const mesh of doc.meshes ?? []) {
      for (const prim of mesh.primitives ?? []) {
        const ai = prim.attributes?.["POSITION"];
        const acc = ai === undefined ? undefined : doc.accessors?.[ai];
        const bv = acc?.bufferView === undefined ? undefined : doc.bufferViews?.[acc.bufferView];
        if (acc !== undefined && bv !== undefined && acc.componentType === 5126) {
          at = 20 + jsonLen + 8 + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
          break;
        }
      }
      if (at >= 0) break;
    }
    if (at < 0) throw new Error("A6 P2 setup: no float POSITION accessor");
    const beforeHex = buf.subarray(at, at + 4).toString("hex");
    buf.writeUInt32LE(buf.readUInt32LE(at) + 1, at);
    const afterHex = buf.subarray(at, at + 4).toString("hex");
    if (afterHex === beforeHex) throw new Error("A6 P2 setup: ULP edit did not change bytes");
    return { bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), beforeHex, afterHex };
  }

  it("A6 P1 material-blind: a material-only copy keeps the split geometry pin", () => {
    const shipped = new Uint8Array(readFileSync(SPLIT_GLB));
    const liveSha = createHash("sha256").update(shipped).digest("hex");
    const liveDigest = glbGeometryDigest(shipped);
    const tweak = withMaterialOnlyTweak(shipped);
    const copySha = createHash("sha256").update(tweak.bytes).digest("hex");
    console.log("A6 P1", { material: tweak.material, component: tweak.component, before: tweak.before[tweak.component], after: tweak.after[tweak.component], liveSha, copySha });
    // One parsed color component really changed (no float64-rounding no-op):
    expect(tweak.after[tweak.component], "material tweak must change the parsed component").not.toBe(tweak.before[tweak.component]);
    // Today's whole-sha reader refuses this copy (the RED premise), against the LIVE input:
    expect(copySha, "material-only copy must differ in whole bytes from the live GLB").not.toBe(liveSha);
    // The converted reader accepts it: geometry untouched.
    expect(glbGeometryDigest(tweak.bytes), "material-only copy must keep the live geometry digest").toBe(liveDigest);
    expect(splitGeometryPinMatches(tweak.bytes)).toBe(true);
  }, 30_000);

  it("A6 P2 counterweight: a 1-ULP POSITION edit refuses as stale", () => {
    const shipped = new Uint8Array(readFileSync(SPLIT_GLB));
    const edit = withOneUlpPositionEdit(shipped);
    console.log("A6 P2", { beforeHex: edit.beforeHex, afterHex: edit.afterHex });
    expect(edit.afterHex, "ULP edit must change accessor bytes").not.toBe(edit.beforeHex);
    expect(splitGeometryPinMatches(edit.bytes), "1-ULP POSITION edit must refuse").toBe(false);
  }, 30_000);

  it("A6 P3 known-good: the shipped split nurse passes the new pin", () => {
    const shipped = new Uint8Array(readFileSync(SPLIT_GLB));
    expect(splitGeometryPinMatches(shipped)).toBe(true);
  }, 30_000);
});
