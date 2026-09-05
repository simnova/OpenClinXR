/**
 * #746 — splice the re-baked gown mesh into the shipped mpfb-gown-adult-patient.glb.
 *
 * The Blender re-export (bake_mpfb_gown_inspect.py) re-encodes every mesh (vertex ordering,
 * position quantization, even the body skin), so shipping the whole re-export would churn
 * contracts that read the other 9 meshes. This replaces ONLY the gown mesh primitive
 * (positions/normals/weights + material) in the shipped asset, keeping every other mesh
 * byte-identical, and remaps JOINTS_0 from the re-bake's skin joint ORDER to the shipped
 * skin's by joint NAME (the re-bake's skin has 139 joints, the shipped 138, and the orders
 * differ).
 */
import { NodeIO, type Accessor } from "@gltf-transform/core";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const SHIPPED = "apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb";
const REBAKE = process.argv[2] ?? "";
const OUT = process.argv[3] ?? SHIPPED;
const GOWN_PREFIX = "openclinxr_real_garment_peds_upper_v1_mesh";
const GOWN_MAT_NAME = "openclinxr_real_garment_hospital_gown_phenotype_L0";
const GOWN_NODE = "openclinxr_real_garment_from_phenotype_hospital_gown";

const io = new NodeIO();
const a = await io.read(SHIPPED);
const b = await io.read(REBAKE);
const ra = a.getRoot();
const rb = b.getRoot();

const gownB = rb.listMeshes().find((m) => m.getName().startsWith(GOWN_PREFIX));
if (!gownB) throw new Error("gown mesh not found in rebake");
const primB = gownB.listPrimitives()[0];
if (!primB) throw new Error("gown prim not found in rebake");

// Joint-name remap: rebake skin order -> shipped skin order.
const skinA = ra.listSkins()[0];
const skinB = rb.listSkins()[0];
if (!skinA || !skinB) throw new Error("skins missing");
const nameToIdxA = new Map(skinA.listJoints().map((j, i) => [j.getName(), i]));
const nameB = skinB.listJoints().map((j) => j.getName());
const jointsB = primB.getAttribute("JOINTS_0")?.getArray() as Uint8Array | Uint16Array | undefined;
if (!jointsB) throw new Error("gown JOINTS_0 missing in rebake");
const missing = new Set<string>();
const remappedCtor = jointsB.constructor as new (n: number) => Uint8Array | Uint16Array;
const remapped: Uint8Array | Uint16Array = new remappedCtor(jointsB.length);
for (let i = 0; i < jointsB.length; i++) {
  const name = nameB[jointsB[i] as number];
  const idx = name === undefined ? undefined : nameToIdxA.get(name);
  if (idx === undefined) {
    missing.add(String(name));
    remapped[i] = 0;
  } else {
    remapped[i] = idx;
  }
}
if (missing.size) {
  console.log(`WARN: joints referenced by gown but missing in shipped skin: ${[...missing].join(", ")}`);
}
console.log(
  `JOINTS_0 remapped: ${jointsB.length} entries, max=${Math.max(...Array.from(remapped))} ` +
    `(shipped skin has ${skinA.listJoints().length} joints)`,
);

// Material: copy the rebake gown material's properties onto a new material in the shipped
// doc named exactly like the old one (runtime lookups by name stay intact).
const matB = primB.getMaterial();
if (!matB) throw new Error("gown material missing in rebake");
const oldMat = ra.listMaterials().find((m) => m.getName() === GOWN_MAT_NAME);
if (oldMat) oldMat.dispose();
const matA = a.createMaterial();
matA.setName(GOWN_MAT_NAME);
matA.setBaseColorFactor(matB.getBaseColorFactor());
matA.setDoubleSided(matB.getDoubleSided());
matA.setAlphaMode(matB.getAlphaMode());
matA.setMetallicFactor(matB.getMetallicFactor());
matA.setRoughnessFactor(matB.getRoughnessFactor());
matA.setEmissiveFactor(matB.getEmissiveFactor());
matA.setAlphaCutoff(matB.getAlphaCutoff());

// Remove the old gown mesh + node in the shipped doc.
const oldGownMesh = ra.listMeshes().find((m) => m.getName().startsWith(GOWN_PREFIX));
if (oldGownMesh) oldGownMesh.dispose();
const gownNode = ra.listNodes().find((n) => n.getName() === GOWN_NODE);
if (!gownNode) throw new Error("gown node not found in shipped doc");

// New gown mesh: copy the rebake gown's accessor data into fresh accessors in the shipped
// doc (clones stay bound to the source graph and cannot cross documents), then swap
// JOINTS_0 for the remapped copy. Semantics come from listAttributeSemantics() — accessors
// themselves are unnamed in glTF.
const newMesh = a.createMesh().setName(gownB.getName());
const newPrim = a.createPrimitive();
const attrsB = primB.listAttributes();
const namesB = primB.listSemantics();
let gownPositions: Float32Array | null = null;
let gownIndices: Uint32Array | Uint16Array | null = null;
for (let i = 0; i < attrsB.length; i++) {
  const atB = attrsB[i]!;
  const name = namesB[i]!;
  const arrB = atB.getArray();
  if (!arrB) throw new Error(`attribute ${name} has no array in rebake gown`);
  if (name === "POSITION") gownPositions = arrB as Float32Array;
  const atA = a.createAccessor();
  if (name === "JOINTS_0") {
    atA.setArray(remapped as never);
  } else {
    atA.setArray(arrB);
  }
  atA.setType(atB.getType());
  atA.setNormalized(atB.getNormalized());
  newPrim.setAttribute(name, atA);
}
const idxB = primB.getIndices();
if (idxB) {
  gownIndices = idxB.getArray() as Uint32Array | Uint16Array | null;
  const idxA = a.createAccessor();
  const arrB = idxB.getArray();
  if (!arrB) throw new Error("gown indices have no array in rebake");
  idxA.setArray(arrB);
  idxA.setType(idxB.getType());
  idxA.setNormalized(idxB.getNormalized());
  newPrim.setIndices(idxA);
}

// #746 regeneration path (optional --decimate): meshopt-simplify the re-baked gown back to
// the shipped gown's triangle density (the original asset ran the #695 rung; the re-bake is
// full-res per #747's constraint 5). Tight error budget (1 mm) keeps the #746 clearance
// push-out intact. simplify() returns indices over the SAME vertex buffer, so per-vertex
// attributes stay valid; unused vertices are compacted below.
if (process.env.OPENCLINXR_GOWN_DECIMATE === "1") {
  if (!gownPositions || !gownIndices) throw new Error("gown positions/indices missing for decimation");
  const originalTris = Number(process.env.OPENCLINXR_GOWN_TARGET_TRIS ?? 29185);
  const targetIndices = Math.floor(originalTris / 3) * 3;
  const { MeshoptSimplifier } = await import("meshoptimizer");
  await MeshoptSimplifier.ready;
  const [simplified] = MeshoptSimplifier.simplify(
    new Uint32Array(gownIndices),
    gownPositions,
    3,
    targetIndices,
    0.001,
  ) as [Uint32Array, number];
  console.log(`decimated: ${gownIndices.length} -> ${simplified.length} indices`);

  // Compact: remap referenced vertices, rebuild every attribute array.
  const remap = new Map<number, number>();
  const newIndices = new Uint16Array(simplified.length);
  for (let i = 0; i < simplified.length; i++) {
    const old = simplified[i]!;
    if (!remap.has(old)) remap.set(old, remap.size);
    newIndices[i] = remap.get(old)!;
  }
  const newCount = remap.size;
  console.log(`compacted: ${gownPositions.length / 3} -> ${newCount} vertices`);
  for (const name of namesB) {
    const atA = newPrim.getAttribute(name);
    if (!atA) continue;
    const src = atA.getArray()!;
    const comps = src.length / (gownPositions.length / 3);
    const out = new (src.constructor as new (n: number) => typeof src)(newCount * comps);
    for (const [old, ni] of remap) {
      for (let c = 0; c < comps; c++) out[ni * comps + c] = src[old * comps + c]!;
    }
    atA.setArray(out as never);
  }
  const idxA = newPrim.getIndices()!;
  idxA.setArray(newIndices);
}
newPrim.setMaterial(matA);
newMesh.addPrimitive(newPrim);

gownNode.setMesh(newMesh);
gownNode.setSkin(skinA);

const buf = await io.writeBinary(a);
writeFileSync(OUT, buf);
const hash = createHash("sha256").update(buf).digest("hex");
console.log(`wrote ${OUT} ${buf.length} bytes sha256=${hash}`);
