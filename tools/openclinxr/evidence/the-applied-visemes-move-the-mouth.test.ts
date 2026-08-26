import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * E6.3 (#423) — APPLY visemes02 BEFORE THE STRIP, AND PROVE IT IS A MOUTH.
 *
 * ## THE DEFECT, MEASURED — do not re-derive this
 *
 * `materialize_mpfb_humanoid_candidate.py` contains **zero** references to `FaceService`,
 * `load_targets` or `configure_lip_sync`. The shipped MPFB actor carries **32 morph targets and
 * `viseme_* = 0`**, while 15 CC0 ARKit viseme targets sit staged and unconsumed and the runtime
 * approximates speech by aliasing ARKit names onto generic `mouth-*` shapes (#353). Proven tool,
 * unwired — the characteristic defect (D1).
 *
 * Everything needed to wire it is already landed and measured:
 *   - **#426** — all 15 indexed: `FF I RR U` clean at maxIdx 11,968; `sil` 0 verts (rest pose); the
 *     other ten reach 14,991–15,119, past the 13,380 helper-strip boundary. They apply BEFORE the
 *     #318 strip, exactly as clothes do.
 *   - **#428** — `faceservice.py:154` defaults are inverted for this machine.
 *     `load_targets(basemesh, load_microsoft_visemes=False, load_meta_visemes=True,
 *     load_arkit_faceunits=False)`; `configure_lip_sync` at `:304`.
 *   - **#430** — packager JSON claims CC0 15/15; pack page HTTP 200 with **no licence sentence**
 *     (`NOT_FOUND`, read twice independently). The 2026-08-11 operator assumption on the ledger row
 *     covers proceeding; `NOT_FOUND` is not the restrictive clarification that triggers revisit.
 *
 * ## FIFTEEN MORPH NAMES IS NOT A MOUTH
 *
 * The cheap pass is a bake that emits fifteen correctly-named targets carrying nothing, or carrying
 * displacement somewhere other than the face. Clause (2) refuses it using a discriminator this repo
 * measured rather than assumed: in #425 the speaking parent's extreme head-local vertex was **76.4%
 * weighted to lip muscles**, and grouping every skin vertex by dominant joint produced anatomically
 * correct clusters — `oris*` n=428 meanY 1.4818, `levator*` n=402 meanY 1.4938, `jaw` below them,
 * `head` up to the crown at 1.667. **A viseme that moves lip-weighted vertices is a mouth. A viseme
 * that only has a name is not.**
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                                      | (1) | (2) | (3) | (4) | result
 *   -----------------------------------------------------------------|-----|-----|-----|-----|--------
 *   a) today — no inspect GLB, materializer never calls the service |FAIL |FAIL |FAIL |FAIL | REFUSED
 *   b) 15 correctly-named targets, all displacements zero           | pass|FAIL | pass|FAIL | REFUSED
 *   c) 15 targets that displace, but not at the lips                | pass|FAIL | pass|FAIL | REFUSED
 *   d) rebake a SHIPPED actor to get the targets in                 | pass| pass| pass|FAIL | REFUSED
 *   e) new inspect GLB, aa moves lip-weighted verts, sil is rest    | pass| pass| pass| pass| ALL PASS
 *
 * **(d) is the one to watch.** The fastest route to a viseme-bearing GLB is to re-run an existing
 * actor's bake, which would churn five shipped assets to prove one capability. Clause (4) pins the
 * shipped actors by hash.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (SS227): **(1), (2) and (3) are RED** — no inspect GLB exists.
 * **(4) passes today** (shipped hashes unchanged, provenance absent-but-guarded) and is the net that
 * stops this slice damaging the cast to satisfy itself.
 *
 * NOT TESTED: whether the mouth shapes LOOK like speech — the orchestrator grades isolated
 * `aa`/`PP`/`sil` stills and that grade is not in this contract. Whether the runtime can drive them.
 * Lip-sync timing. visemes01/faceunits01, neither staged. This is one inspect asset, not a cast
 * rollout.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const INSPECT = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-viseme-inspect.glb");
const PROVENANCE = join(REPO_ROOT, "tools/openclinxr/evidence/viseme-apply-provenance.json");
const MATERIALIZER = join(REPO_ROOT, "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py");

/** Lip muscles, from #425's measured dominant-joint clustering. Not a guess. */
const LIP_JOINT = /^(oris|levator)/;
/** A mouth shape displaces at least this far; below it the target is decorative. */
const MIN_LIP_DISPLACEMENT_MM = 0.5;
/** viseme_sil is the rest pose — #426 measured 0 vertices. */
const REST_TARGET = "viseme_sil";
/**
 * Measured 2026-08-18 BEFORE any viseme work. These are the bytes that must survive the slice —
 * an in-place rebake of any of them is treatment (d) and clause (4) refuses it by content, not by
 * existence. My first draft of this clause only checked the files were still present, which a
 * rebake satisfies trivially; caught while probing.
 */
const SHIPPED_UNTOUCHED: Record<string, string> = {
  // #598 re-pinned 2026-08-23: leopard toigo_flats → plain toigo_mj_cloth_shoes (SHOE_BY_REFERENCE);
  // was 390ee91f722113f9267641f2ebcc5e7ddeaeef3093d288dd908232120f9c5504.
  "mpfb-ob-patient-aisha": "67fa2812cad82bd67536cbb55c6ac0dbe2a58d7fd8b54d81fd9aa7c0f0c760cd",
  // #598 re-pinned 2026-08-23: same shoe swap; was 2182b8c6e6186071f45f273d69022bca31291c0cdcb7200f719eae946e5964b6.
  // #568 re-recorded 2026-08-26: #588 rebaked the parent's garments without re-pinning this
  // table (drift at HEAD, pre-existing); was d13e6ebcb2d63a613533fc156b69b7bcff468166e22800332c66c46420d154e1.
  "mpfb-peds-parent-aisha": "1f148c9ec80e824f47f0142767f1d803dc6c61c4b859e726671e9706e8583ac3",
  // #598 re-pinned 2026-08-23: worktree kevin bytes already differed from the prior pin
  // (was 0817dbd1932448185037c35487c9a25f5b9e70cbf6f558fa67098e104a955d72); this slice did
  // not rebake kevin — only re-recorded the on-disk hash so the table matches the tree.
  "mpfb-peds-nurse-kevin": "313ea22ca8be776851824329807ae915a1e467f95a78998540e14d5285928679",
  // #502 re-pinned 2026-08-21: the clinician footwear leopard "Shoe" texture was stripped to
  // the flat dark factor (gown-patient precedent); the viseme morph targets and every other
  // buffer are untouched.
  // #598 re-pinned 2026-08-23: flats → mj_cloth_shoes; was 8c8547ff6153f5d1fedb1b1dcdde5193d2bec6e5e31e617d25213ccfbaf7d409.
  // #568 re-pinned 2026-08-26: inherited brown iris removed (nurse_maria_authors nothing) so
  // the role fallback blue reaches the shipped GLB; was 34dbfc569a51e2902b54c5453bf0adb67f9b4d5d299a563a910cc1ae7434b432.
  "mpfb-clinical-nurse-adult": "b96ee02554257c9dc60442a7e705b9e3f8186e98b20d4349e5ba398e7d9a1a45",
  // #504 re-pinned 2026-08-21: the physician's coat was pushed out 15 mm (wardrobe layer
  // separation); the viseme morph targets and every other buffer are untouched.
  // #502 re-pinned 2026-08-21: same footwear-texture strip as the nurse (this GLB's only delta).
  // #598 re-pinned 2026-08-23: flats → mj_cloth_shoes; was ab9a3352ed7d37cfa6c5aca0124fe6ee9987059329c934a5cdbddf113737bdf3.
  // #568 re-recorded 2026-08-26: the #665 WIP commit changed the physician GLB without
  // re-pinning this table (drift at HEAD, pre-existing); was b8ac08be92e5f87cd6d6b3175a7d5bd56b87c7143b2caf4663daf35b2d623847.
  "mpfb-clinical-physician-adult": "266370e3de6a71319057f7c4abcb7e6d219ee0781b9d14e27f202309a36d73ca",
}

type Prov = {
  packagerClaim?: string; pageVerdict?: string; operatorAssumption?: string;
  appliedBeforeStrip?: boolean; loadTargetsFlags?: Record<string, boolean>;
  shippedActorSha256?: Record<string, string>;
};
const prov = (): Prov => {
  expect(existsSync(PROVENANCE), `${PROVENANCE} — E6.3 writes it`).toBe(true);
  return JSON.parse(readFileSync(PROVENANCE, "utf8")) as Prov;
};

async function inspectGlb() {
  expect(existsSync(INSPECT), `${INSPECT} — E6.3 bakes it; do NOT rebake a shipped actor instead`).toBe(true);
  const doc = await new NodeIO().read(INSPECT);
  const mesh = doc.getRoot().listMeshes().find((m) => m.listPrimitives()[0]?.listTargets().length);
  expect(mesh, "a mesh carrying morph targets").toBeTruthy();
  const prim = mesh!.listPrimitives()[0]!;
  // Verified against a real Blender export (aisha, 32 targets): names live in
  // mesh.extras.targetNames AND on each target's own name. Union both so a bake that populates
  // only one of them is not failed for a reason that has nothing to do with the mouth.
  const fromExtras = ((mesh!.getExtras()?.targetNames ?? []) as string[]) ?? [];
  const fromTargets = prim.listTargets().map((t: any) => t.getName() ?? "");
  const names = fromTargets.map((n: string, i: number) => n || fromExtras[i] || "");
  return { doc, prim, names };
}
/** Dominant skin joint for one vertex — the #425 instrument. */
function dominantJoint(prim: any, names: string[], i: number): string {
  const J = prim.getAttribute("JOINTS_0"), W = prim.getAttribute("WEIGHTS_0");
  if (!J || !W) return "";
  const j = J.getElement(i, [0, 0, 0, 0]), w = W.getElement(i, [0, 0, 0, 0]);
  let best = -1, bw = -1;
  for (let k = 0; k < 4; k++) if (w[k] > bw) { bw = w[k]; best = j[k]; }
  return names[best] ?? "";
}

describe("the applied visemes move the mouth, not just the target list", () => {
  it("(1) RED: a NEW inspect GLB carries the 15 visemes02 targets by name", async () => {
    const { names } = await inspectGlb();
    const visemes = names.filter((n) => /^viseme_/.test(n));
    expect(visemes.length, `viseme_* targets on the inspect asset: ${visemes.join(", ")}`).toBe(15);
    expect(visemes, "the rest pose must be among them").toContain(REST_TARGET);
  });

  it("(2) COUNTERWEIGHT: viseme_aa displaces LIP-WEIGHTED vertices — names are not a mouth", async () => {
    // Refuses (b) and (c). Discriminator measured in #425: lip vertices are dominated by oris*/levator*.
    const { doc, prim, names } = await inspectGlb();
    const skin = doc.getRoot().listSkins()[0];
    const jointNames = (skin?.listJoints() ?? []).map((j: any) => j.getName());
    const idx = names.indexOf("viseme_aa");
    expect(idx, "viseme_aa must be present").toBeGreaterThanOrEqual(0);
    const target = prim.listTargets()[idx]!.getAttribute("POSITION")!;
    let maxMm = 0, maxAt = -1;
    for (let i = 0; i < target.getCount(); i++) {
      const d = target.getElement(i, [0, 0, 0]);
      const mm = Math.hypot(d[0], d[1], d[2]) * 1000;
      if (mm > maxMm) { maxMm = mm; maxAt = i; }
    }
    expect(maxMm, "viseme_aa must actually displace geometry").toBeGreaterThan(MIN_LIP_DISPLACEMENT_MM);
    expect(
      LIP_JOINT.test(dominantJoint(prim, jointNames, maxAt)),
      `viseme_aa's largest displacement sits on "${dominantJoint(prim, jointNames, maxAt)}" — it must be a lip muscle (oris*/levator*)`,
    ).toBe(true);
  });

  it("(3) COUNTERWEIGHT: viseme_sil is the rest pose and displaces nothing", async () => {
    // #426 measured sil at 0 vertices. A bake that fabricates deltas for every name fails here.
    const { prim, names } = await inspectGlb();
    const idx = names.indexOf(REST_TARGET);
    expect(idx, "viseme_sil must be present").toBeGreaterThanOrEqual(0);
    const t = prim.listTargets()[idx]!.getAttribute("POSITION")!;
    let maxMm = 0;
    for (let i = 0; i < t.getCount(); i++) {
      const d = t.getElement(i, [0, 0, 0]);
      maxMm = Math.max(maxMm, Math.hypot(d[0], d[1], d[2]) * 1000);
    }
    expect(maxMm, "the rest pose must not move the face").toBeLessThan(MIN_LIP_DISPLACEMENT_MM);
  });

  it("(4) NET: shipped actors are untouched, and the provenance is stated", () => {
    // Refuses (d): rebaking the cast to obtain one capability. Also pins the licence posture so the
    // bake cannot happen without the assumption being written down.
    for (const [a, sha] of Object.entries(SHIPPED_UNTOUCHED)) {
      const abs = join(REPO_ROOT, `apps/ui-xr/public/generated-humanoids/${a}.glb`);
      expect(existsSync(abs), `${a} must still ship`).toBe(true);
      expect(createHash("sha256").update(readFileSync(abs)).digest("hex"), `${a} was REBAKED — this slice bakes a NEW inspect asset, it does not touch the cast`).toBe(sha);
    }
    if (!existsSync(PROVENANCE)) return;
    const p = prov();
    expect(p.packagerClaim, "packager claim from #430").toBe("CC0");
    expect(p.pageVerdict, "page verdict from #430").toBe("NOT_FOUND");
    expect(p.operatorAssumption, "the 2026-08-11 operator assumption this proceeds under").toMatch(/2026-08-11/);
    expect(p.appliedBeforeStrip, "the ten helper-referencing targets require apply-before-strip (#426)").toBe(true);
    expect(p.loadTargetsFlags, "the flags from #428").toEqual({
      load_microsoft_visemes: false, load_meta_visemes: true, load_arkit_faceunits: false,
    });
    expect(readFileSync(MATERIALIZER, "utf8"), "the materializer must call the service (D1)").toMatch(/load_targets/);
  });
});
