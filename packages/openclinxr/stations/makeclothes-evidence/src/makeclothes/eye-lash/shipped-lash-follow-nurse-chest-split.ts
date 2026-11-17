/**
 * R1c nurse chest-stage split allowance (e9-r2b) generalized for P2e-C
 * (p2e-c-prod 2026-11-16): split out of
 * shipped-lash-follow-geometry.ts to keep that file within its 500-line
 * zone budget; behaviour is unchanged (verbatim move + one thin wrapper).
 *
 * Owning gate: packages/openclinxr/stations/humanoid-vetting-evidence/src/humanoid-vetting/the-adult-nurse-chest-shows-no-skin-through-the-scrub.test.ts.
 * E9 moved 92 skin tris out of body prim0 into one new hidden prim sharing
 * prim0's attribute/morph accessors. P2e-C additionally un-hid exactly 6
 * tris (prim7 {2,3,4,5,6,53}) from hidden prim7 into one new skin prim9
 * sharing prim7's attribute/morph accessors (position-keyed 6-tri set,
 * moved==6). The pairing below matches current body prims to lash-input
 * body prims by shared attribute + morph bytes; unmatched triples are
 * allowed only as the pinned set EQUALITY below: exactly the one shared
 * E9 split (isNurseChestStageSplit: role-bound E9 pin pair, sorted index
 * union equals the input prim, same accessor-index identity, exact hide
 * material, no triangle lost or added) plus exactly the one pinned P2e-C
 * split (role-bound kept/new pin pair, sorted index union equals the input
 * prim, same accessor-index identity, kept keeps the baseline hide
 * material NAME, new carries the exact pinned skin material NAME). A
 * missing pinned split refuses; an extra unpinned split refuses. Lash
 * geometry carries no sidecar chain, so the rehide-newer-than-swap clause
 * is unchecked here (derivationArgvs: undefined). Role order is resolved
 * by trying both assignments through the E9 predicate — no caller-side
 * role check; the P2e-C kept/new roles resolve by baseline-material
 * identity (ambiguous roles refuse).
 *
 * The small glTF byte helpers (accessorBytes/indicesSha256/primAttrSig/
 * sortedIndexArray/targetHash) moved with the split so this module imports
 * nothing from shipped-lash-follow-geometry.ts (no import cycle); geometry.ts
 * imports the helpers back for the neck allowance and counterweights.
 */
import { createHash } from "node:crypto";
import type { Accessor, Document, Mesh, Primitive } from "@gltf-transform/core";
import {
  isNurseChestStageSplit,
  NURSE_CHEST_STAGE_ACTOR,
} from "@openclinxr/asset-registry/nurse-chest-stage";

export function accessorBytes(a: Accessor | null): Buffer {
  if (!a?.getArray()) return Buffer.alloc(0);
  const array = a.getArray()!;
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
}
export function targetHash(p: Primitive, names: string[]): string {
  const h = createHash("sha256");
  for (const [index, targetEntry] of p.listTargets().entries()) {
    h.update(JSON.stringify([index, names[index] ?? null]));
    for (const semantic of targetEntry.listSemantics().sort()) {
      const accessor = targetEntry.getAttribute(semantic);
      h.update(JSON.stringify([
        semantic,
        accessor?.getType() ?? null,
        accessor?.getComponentType() ?? null,
        accessor?.getCount() ?? 0,
      ]));
      h.update(accessorBytes(accessor));
    }
  }
  return h.digest("hex");
}
export function indicesSha256(p: Primitive): string {
  return createHash("sha256").update(accessorBytes(p.getIndices())).digest("hex");
}
export function primAttrSig(p: Primitive): string {
  const h = createHash("sha256");
  for (const semantic of p.listSemantics().sort()) {
    const a = p.getAttribute(semantic)!;
    h.update(JSON.stringify([semantic, a.getType(), a.getComponentType(), a.getCount()]));
    h.update(accessorBytes(a));
  }
  return h.digest("hex");
}
export function sortedIndexArray(p: Primitive): number[] {
  return Array.from(p.getIndices()!.getArray() as ArrayLike<number>).map(Number).sort((a, b) => a - b);
}
// R1c: nurse chest-stage split allowance (owning gate: the-adult-nurse-chest-shows-no-skin-through-the-scrub test).
// E9 moved 92 skin tris out of body prim0 into one new hidden prim sharing prim0's
// attribute/morph accessors. P2e-C additionally moved exactly 6 tris out of
// hidden body prim7 into one new skin prim9 sharing prim7's attribute/morph
// accessors. Pairs current body prims to lash-input body prims by
// shared attribute + morph bytes; an unmatched triple is allowed only as the
// pinned set EQUALITY below (exactly one E9 split via isNurseChestStageSplit
// plus exactly one P2e-C split via the pinned kept/new pair: role-bound
// pins, sorted index union equals the input prim, same accessor-index
// identity, kept keeps the baseline hide material NAME and new carries the
// exact skin material NAME, no triangle lost or added). Lash geometry carries
// no sidecar chain, so the rehide-newer-than-swap clause is unchecked here
// (derivationArgvs: undefined). E9 role order is resolved by trying both
// assignments through the predicate — no caller-side role check; P2e-C
// kept/new roles resolve by baseline-material identity (ambiguous refuse).
// P2e-C split pins. Every literal below is measured from the live P2e-C GLB
// (sha ce10321833f92ccc5930fafbadfc8544c9b5ec715a33e71c96ebf5b4e5d6056e,
// 12477104 B) against the lash-input baseline (a1944f7c2, sha 6c908f97...):
// baseline prim7 (282 idx, hide orphan mat) splits into kept prim7' (264 idx,
// same hide orphan mat) + new prim9 (18 idx, body skin mat); sorted union
// equals the baseline exactly (282 == 264 + 18); both halves share the
// baseline prim's attribute/morph accessor indices.
/** Skin material NAME the P2e-C new half carries (the body skin material). */
const NURSE_P2EC_SKIN_MATERIAL = "mpfb_skin_ed_chest_pain_nurse_adult";
type NurseP2eCSplitPin = {
  /** sha256 of the BASELINE prim7's own raw INDICES bytes. */
  baselineIndicesSha256: string;
  /** sha256 of the kept (hide) half's raw INDICES bytes. Role-bound. */
  keptIndicesSha256: string;
  /** sha256 of the new (skin) half's raw INDICES bytes. Role-bound. */
  newIndicesSha256: string;
  /** Baseline prim7's hide material NAME (kept half must carry exactly this NAME). */
  baselineMaterial: string;
};
const NURSE_P2EC_SPLIT_PIN: NurseP2eCSplitPin = {
  baselineIndicesSha256:
    "efd41aa0ec88f5abbee1b3bb80045559df5d40ad50ece5c605c4dd69399e1483", // baseline prim7 282 idx
  keptIndicesSha256:
    "d9ade0b7fca729096d90e8851879d10689a4dee7f57c344abf5dc9a779d8dad3", // kept prim7' 264 idx
  newIndicesSha256:
    "20d8873ef4911e801f15d1100b95e633cca44a18283bab1ebb6eca2be7142363", // new prim9 18 idx
  baselineMaterial:
    "openclinxr_hidden_orphan_mpfb_ed_chest_pain_nurse_adult_body_mesh",
};
/**
 * P2e-C split verdict (owning gate: the nurse-chest-split guards file).
 * True iff (m1, m2) in some order is exactly the pinned kept/new pair:
 * the baseline prim carries the baseline pin; one half carries the kept
 * pin AND the baseline hide material NAME; the other carries the new pin
 * AND the exact skin material NAME (role-bound: each half must carry its
 * own pin — a swapped pair is refused even though both shas are in the
 * pin set); both halves share the baseline prim's attribute/morph
 * accessor indices (index identity, not byte signatures); the sorted
 * index union equals the baseline prim exactly (no triangle lost/added:
 * 282 == 264 + 18). Ambiguous roles (both assignments admit) refuse.
 */
export function isNurseP2eCSplit(
  baselinePrim: Primitive,
  a: Primitive,
  b: Primitive,
  currentDoc: Document,
  baselineDoc: Document,
  matIndex: (doc: Document, p: Primitive) => number,
  attrMap: (doc: Document, p: Primitive) => Record<string, number>,
  targetMaps: (doc: Document, p: Primitive) => Array<Record<string, number>>,
): boolean {
  void matIndex;
  if (indicesSha256(baselinePrim) !== NURSE_P2EC_SPLIT_PIN.baselineIndicesSha256) return false;
  const baseAttrs = JSON.stringify(attrMap(baselineDoc, baselinePrim));
  const baseTargets = JSON.stringify(targetMaps(baselineDoc, baselinePrim));
  const baseSorted = JSON.stringify(sortedIndexArray(baselinePrim));
  let admitted = 0;
  for (const [kept, added] of [[a, b], [b, a]] as const) {
    if (indicesSha256(kept) !== NURSE_P2EC_SPLIT_PIN.keptIndicesSha256) continue;
    if (indicesSha256(added) !== NURSE_P2EC_SPLIT_PIN.newIndicesSha256) continue;
    if ((kept.getMaterial()?.getName() ?? "") !== NURSE_P2EC_SPLIT_PIN.baselineMaterial) continue;
    if ((added.getMaterial()?.getName() ?? "") !== NURSE_P2EC_SKIN_MATERIAL) continue;
    if (JSON.stringify(attrMap(currentDoc, kept)) !== baseAttrs) continue;
    if (JSON.stringify(attrMap(currentDoc, added)) !== baseAttrs) continue;
    if (JSON.stringify(targetMaps(currentDoc, kept)) !== baseTargets) continue;
    if (JSON.stringify(targetMaps(currentDoc, added)) !== baseTargets) continue;
    const union = [...sortedIndexArray(kept), ...sortedIndexArray(added)].sort((x, y) => x - y);
    if (JSON.stringify(union) !== baseSorted) continue;
    admitted += 1;
  }
  return admitted === 1;
}
export function chestSplitBodyEqual(
  cp: Primitive[],
  bp: Primitive[],
  cn: string[],
  actor: string,
  currentDoc: Document,
  baselineDoc: Document,
): boolean {
  if (actor !== `${NURSE_CHEST_STAGE_ACTOR}.glb` || cp.length !== bp.length + 2) return false;
  let e9Splits = 0;
  let p2eSplits = 0;
  const key = (p: Primitive) => `${primAttrSig(p)}|${targetHash(p, cn)}`;
  const byKey = new Map<string, Primitive[]>();
  for (const p of cp) {
    const k = key(p);
    byKey.set(k, [...(byKey.get(k) ?? []), p]);
  }
  const accIndex = (doc: Document, a: Accessor | null): number =>
    a === null ? -1 : doc.getRoot().listAccessors().indexOf(a);
  const matIndex = (doc: Document, p: Primitive): number => {
    const m = p.getMaterial();
    return m === null ? -1 : doc.getRoot().listMaterials().indexOf(m);
  };
  const attrMap = (doc: Document, p: Primitive): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const s of p.listSemantics().sort()) out[s] = accIndex(doc, p.getAttribute(s));
    return out;
  };
  const targetMaps = (doc: Document, p: Primitive): Array<Record<string, number>> =>
    p.listTargets().map((t) => {
      const out: Record<string, number> = {};
      for (const s of t.listSemantics().sort()) out[s] = accIndex(doc, t.getAttribute(s));
      return out;
    });
  for (const b of bp) {
    const k = key(b);
    const mates = byKey.get(k) ?? [];
    if (mates.length === 1) {
      if (indicesSha256(mates[0]!) !== indicesSha256(b)) return false;
    } else if (mates.length === 2) {
      const [m1, m2] = mates as [Primitive, Primitive];
      const baselineMaterial = b.getMaterial()?.getName() ?? "";
      const witnessFor = (keptPrim: Primitive, hiddenPrim: Primitive) => ({
        keptIndicesSha256: indicesSha256(keptPrim),
        hiddenIndicesSha256: indicesSha256(hiddenPrim),
        keptSortedIndices: sortedIndexArray(keptPrim),
        hiddenSortedIndices: sortedIndexArray(hiddenPrim),
        baselineSortedIndices: sortedIndexArray(b),
        keptAttrAccessors: attrMap(currentDoc, keptPrim),
        hiddenAttrAccessors: attrMap(currentDoc, hiddenPrim),
        baselineAttrAccessors: attrMap(baselineDoc, b),
        keptTargetAccessors: targetMaps(currentDoc, keptPrim),
        hiddenTargetAccessors: targetMaps(currentDoc, hiddenPrim),
        baselineTargetAccessors: targetMaps(baselineDoc, b),
        keptMaterialIndex: matIndex(currentDoc, keptPrim),
        hiddenMaterialIndex: matIndex(currentDoc, hiddenPrim),
        baselineMaterialIndex: matIndex(baselineDoc, b),
        keptMaterial: keptPrim.getMaterial()?.getName() ?? "",
        hiddenMaterial: hiddenPrim.getMaterial()?.getName() ?? "",
        baselineMaterial,
        derivationArgvs: undefined,
      });
      // M1: no caller-side role or pin check — try both assignments. The
      // role-bound predicate admits at most one (the pins differ), so either
      // order resolves to exactly the kept+hidden split or the pair refuses.
      if (isNurseChestStageSplit(witnessFor(m1, m2)) || isNurseChestStageSplit(witnessFor(m2, m1))) {
        e9Splits += 1;
      } else if (isNurseP2eCSplit(b, m1, m2, currentDoc, baselineDoc, matIndex, attrMap, targetMaps)) {
        p2eSplits += 1;
      } else {
        return false;
      }
    } else {
      return false;
    }
    byKey.delete(k);
  }
  // Pinned-set EQUALITY: exactly one E9 split plus exactly one P2e-C split.
  // A missing pinned split refuses; an extra unpinned split refuses in the
  // pair branch above (neither predicate admits it).
  return byKey.size === 0 && e9Splits === 1 && p2eSplits === 1;
}
/**
 * Mesh-level entry for the non-lash hash path in counterweights: null when the
 * allowance does not apply (wrong actor or no +2 split present, so the caller
 * falls back to the strict hash comparison), otherwise the split verdict.
 * The lash-input baseline is the pre-E9 8-prim body; live carries both splits
 * (E9 hidden prim8 + P2e-C skin prim9), hence +2.
 */
export function nurseChestBodyOk(
  currentBody: Mesh,
  baselineBody: Mesh,
  cn: string[],
  actor: string,
  currentDoc: Document,
  baselineDoc: Document,
): boolean | null {
  if (actor !== `${NURSE_CHEST_STAGE_ACTOR}.glb`) return null;
  if (currentBody.listPrimitives().length !== baselineBody.listPrimitives().length + 2) return null;
  return chestSplitBodyEqual(
    currentBody.listPrimitives(),
    baselineBody.listPrimitives(),
    cn,
    actor,
    currentDoc,
    baselineDoc,
  );
}
