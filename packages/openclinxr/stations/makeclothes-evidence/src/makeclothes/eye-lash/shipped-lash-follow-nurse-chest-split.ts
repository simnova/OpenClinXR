/**
 * R1c nurse chest-stage split allowance (e9-r2b). Split out of
 * shipped-lash-follow-geometry.ts to keep that file within its 500-line
 * zone budget; behaviour is unchanged (verbatim move + one thin wrapper).
 *
 * Owning gate: packages/openclinxr/stations/humanoid-vetting-evidence/src/humanoid-vetting/the-adult-nurse-chest-shows-no-skin-through-the-scrub.test.ts.
 * E9 moved 92 skin tris out of body prim0 into one new hidden prim sharing
 * prim0's attribute/morph accessors. The pairing below matches current body
 * prims to lash-input body prims by shared attribute + morph bytes; an
 * unmatched triple is allowed only as the one shared E9 split
 * (isNurseChestStageSplit: role-bound E9 pin pair, sorted index union equals
 * the input prim, same accessor-index identity, exact hide material, no
 * triangle lost or added). Lash geometry carries no
 * sidecar chain, so the rehide-newer-than-swap clause is unchecked here
 * (derivationArgvs: undefined). Role order is resolved by trying both
 * assignments through the predicate — no caller-side role check.
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
// attribute/morph accessors. Pairs current body prims to lash-input body prims by
// shared attribute + morph bytes; an unmatched triple is allowed only as the one
// shared E9 split (isNurseChestStageSplit: role-bound E9 pin pair, sorted index
// union equals the input prim, same accessor-index identity, kept keeps the
// baseline material and hidden carries the exact hide material, no triangle lost
// or added). Lash geometry carries no sidecar chain, so the rehide-newer-than-swap
// clause is unchecked here (derivationArgvs: undefined). Role order is resolved
// by trying both assignments through the predicate — no caller-side role check.
export function chestSplitBodyEqual(
  cp: Primitive[],
  bp: Primitive[],
  cn: string[],
  actor: string,
  currentDoc: Document,
  baselineDoc: Document,
): boolean {
  if (actor !== `${NURSE_CHEST_STAGE_ACTOR}.glb` || cp.length !== bp.length + 1) return false;
  const used = new Set<string>();
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
      if (!isNurseChestStageSplit(witnessFor(m1, m2)) && !isNurseChestStageSplit(witnessFor(m2, m1))) {
        return false;
      }
      used.add(indicesSha256(m1));
      used.add(indicesSha256(m2));
    } else {
      return false;
    }
    byKey.delete(k);
  }
  return byKey.size === 0 && used.size === 2;
}
/**
 * Mesh-level entry for the non-lash hash path in counterweights: null when the
 * allowance does not apply (wrong actor or no +1 split present, so the caller
 * falls back to the strict hash comparison), otherwise the split verdict.
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
  if (currentBody.listPrimitives().length !== baselineBody.listPrimitives().length + 1) return null;
  return chestSplitBodyEqual(
    currentBody.listPrimitives(),
    baselineBody.listPrimitives(),
    cn,
    actor,
    currentDoc,
    baselineDoc,
  );
}
