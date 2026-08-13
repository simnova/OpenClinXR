/**
 * #357 — pre-fix measurement for mpfb2-lower-garment-and-mask-footprint clause (2).
 *
 * The contract's clause (2) compares EVERY hide mask against the union of the
 * upper + lower garment boxes only — footwear is excluded (#333) but the foot
 * hide-mask (`openclinxr_hidden_foot_*`, created by #341) is still collected,
 * so its ankle-to-sole reach below the trouser hem is arithmetically guaranteed
 * to over-reach. The clause can never pass; it is a scope mismatch, not a
 * product defect.
 *
 * This writes .openclinxr/evidence/mask-footprint/pre-fix.json BEFORE any edit:
 * for BOTH rails the contract measures (mpfb2_aisha + library_lean_female),
 * each mask slot's box, each garment channel's box, and the over-reach per
 * MATCHING slot (upper mask vs upper garment, lower vs lower, foot vs
 * footwear, orphan vs n/a), plus the current contract's union comparison to
 * document the false positive precisely.
 *
 * Instrument notes:
 *  - slot is read from the material name (openclinxr_hidden_{upper,lower,foot,orphan}_*),
 *    mirroring issue-341-mask-boundary-probe.py.
 *  - garment channels use the same regexes as the contract: UPPER
 *    /shirt|top|tshirt|toigo/i, LOWER /pants|trouser|cargo/i, FOOTWEAR
 *    /footwear|shoe|boot|flat/i. FOOTWEAR is classified BEFORE UPPER here:
 *    aisha's flats material is `mat_makeclothes_library_footwear_toigo_flats`,
 *    which matches UPPER via "toigo" — the contract only survives that today
 *    because iteration order lets the t-shirt overwrite it. The per-slot
 *    comparison must not inherit that trap.
 *  - over-reach per axis: max(0, mask.min - garment.min) on the min side and
 *    max(0, garment.max - mask.max) on the max side, in mm.
 *  - the tree stamp (§7s) records what was measured so the artifact cannot go
 *    stale silently.
 *
 * claimScope: where the shipped hide masks sit relative to the garment channel
 * that hides them, on the two rails clause (2) measures, pre-fix.
 * notEvidenceFor: whether 2 mm is the right allowance; clinical wardrobe;
 * whether the masks are correct beyond footprint.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { computeMeasurementTreeStamp } from "./lib/measurement-tree-stamp.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const PUBLIC = `${REPO_ROOT}/apps/ui-xr/public`;

const AISHA = "generated-humanoids/mpfb-ob-patient-aisha.glb";
const LIBRARY = "xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb";

const UPPER = /shirt|top|tshirt|toigo/i;
const LOWER = /pants|trouser|cargo/i;
const FOOTWEAR = /footwear|shoe|boot|flat/i;
/** Hair is not a garment the mask hides under — excluding it from UPPER keeps the t-shirt/scrub channel honest. */
const HAIR = /hair|scalp/i;
const HIDDEN = /hidden/i;
const SLOT_RE = /hidden_(upper|lower|foot|orphan)/i;
const MAX_OVERREACH_M = 0.002;

type Box = { min: [number, number, number]; max: [number, number, number]; verts: number };
type Slot = "upper" | "lower" | "foot" | "orphan";

const io = new NodeIO();
const EMPTY = (): Box => ({ min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9], verts: 0 });

function grow(b: Box, e: readonly number[]): void {
  for (let a = 0; a < 3; a += 1) {
    if (e[a]! < b.min[a]!) b.min[a] = e[a]!;
    if (e[a]! > b.max[a]!) b.max[a] = e[a]!;
  }
}

function boxKey(b: Box): { min: number[]; max: number[]; verts: number } {
  return {
    min: b.min.map((v) => +(v * 1000).toFixed(2)),
    max: b.max.map((v) => +(v * 1000).toFixed(2)),
    verts: b.verts,
  };
}

function mergeInto(target: Box, src: Box): void {
  for (let a = 0; a < 3; a += 1) {
    if (src.min[a]! < target.min[a]!) target.min[a] = src.min[a]!;
    if (src.max[a]! > target.max[a]!) target.max[a] = src.max[a]!;
  }
  target.verts += src.verts;
}

function perAxisOverreachMm(mask: Box, garment: Box | null): { min: number[]; max: number[] } {
  const min = [0, 0, 0];
  const max = [0, 0, 0];
  if (!garment) return { min, max };
  for (let a = 0; a < 3; a += 1) {
    min[a] = Math.max(0, garment.min[a]! - mask.min[a]!) * 1000;
    max[a] = Math.max(0, mask.max[a]! - garment.max[a]!) * 1000;
  }
  return { min, max };
}

async function railMeasure(id: string, rel: string) {
  const doc = await io.read(`${PUBLIC}/${rel}`);
  const masks: Partial<Record<Slot, Box[]>> = {};
  // Channels use union (merge) across every primitive in the channel: the mask
  // hides under ANY part of the channel, and multi-primitive garments exist
  // (flats L/R, t-shirt + scrub layers).
  const channels: Partial<Record<"upper" | "lower" | "footwear", Box>> = {};
  let bodyVerts = 0;
  const primitives: Array<{ name: string; box: ReturnType<typeof boxKey> }> = [];

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const matName = prim.getMaterial()?.getName() ?? "";
      const name = `${mesh.getName()}/${matName}`;
      const box = EMPTY();
      const el: [number, number, number] = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i += 1) grow(box, pos.getElement(i, el));
      box.verts = pos.getCount();
      primitives.push({ name, box });

      if (HIDDEN.test(matName)) {
        const m = matName.match(SLOT_RE);
        const slot = m?.[1]?.toLowerCase() as Slot | undefined;
        const target: Slot = slot === "upper" || slot === "lower" || slot === "foot" || slot === "orphan" ? slot : "orphan";
        (masks[target] ??= []).push(box);
      } else if (FOOTWEAR.test(matName)) {
        const g = (channels.footwear ??= EMPTY());
        mergeInto(g, box);
      } else if (LOWER.test(matName)) {
        const g = (channels.lower ??= EMPTY());
        mergeInto(g, box);
      } else if (HAIR.test(matName)) {
        // Not a garment channel — do not pollute upper with hair (fitted hair names carry "toigo").
      } else if (UPPER.test(matName)) {
        const g = (channels.upper ??= EMPTY());
        mergeInto(g, box);
      } else {
        bodyVerts += pos.getCount();
      }
    }
  }

  // Per matching slot: upper mask vs upper, lower vs lower, foot vs footwear.
  // Orphan: no single matching garment (spans boundaries by design, #350) —
  // recorded with garmentChannel "none" and its overreach against the union of
  // ALL garment channels for reference, but it is n/a for the per-slot check.
  const unionAll: Box | null = (() => {
    const parts = [channels.upper, channels.lower, channels.footwear].filter((b): b is Box => !!b);
    if (!parts.length) return null;
    const u = EMPTY();
    for (const p of parts) mergeInto(u, p);
    return u;
  })();

  const perMatchingSlot: Array<{
    slot: string;
    maskBox: ReturnType<typeof boxKey>;
    garmentChannel: string;
    garmentBox: ReturnType<typeof boxKey> | null;
    overreach: { min: number[]; max: number[] };
    worstOverreachMm: number;
  }> = [];
  for (const slot of ["upper", "lower", "foot", "orphan"] as const) {
    for (const m of masks[slot] ?? []) {
      const channel: string = slot === "upper" ? "upper" : slot === "lower" ? "lower" : slot === "foot" ? "footwear" : "none";
      const g = (slot === "upper" ? channels.upper : slot === "lower" ? channels.lower : slot === "foot" ? channels.footwear : null) ?? null;
      const over = perAxisOverreachMm(m, g);
      const worst = Math.max(...over.min, ...over.max);
      perMatchingSlot.push({
        slot,
        maskBox: boxKey(m),
        garmentChannel: channel,
        garmentBox: g ? boxKey(g) : null,
        overreach: over,
        worstOverreachMm: +worst.toFixed(2),
      });
    }
  }

  // Reproduce the CURRENT clause (2): every mask vs union(upper, lower) —
  // footwear excluded, foot mask still collected. This is the false positive.
  const unionUL: Box | null = (() => {
    const parts = [channels.upper, channels.lower].filter((b): b is Box => !!b);
    if (!parts.length) return null;
    const u = EMPTY();
    for (const p of parts) mergeInto(u, p);
    return u;
  })();
  const contractUnionUpperLower: Array<{ slot: string; worstOverreachMm: number; detail: string[] }> = [];
  for (const slot of ["upper", "lower", "foot", "orphan"] as const) {
    for (const m of masks[slot] ?? []) {
      const over = perAxisOverreachMm(m, unionUL);
      const detail: string[] = [];
      for (let a = 0; a < 3; a += 1) {
        if (over.min[a]! > MAX_OVERREACH_M * 1000) detail.push(`axis${a} min: ${over.min[a]!.toFixed(1)}mm`);
        if (over.max[a]! > MAX_OVERREACH_M * 1000) detail.push(`axis${a} max: ${over.max[a]!.toFixed(1)}mm`);
      }
      contractUnionUpperLower.push({ slot, worstOverreachMm: +Math.max(...over.min, ...over.max).toFixed(2), detail });
    }
  }

  return {
    id,
    file: rel,
    bodyVerts,
    garmentChannels: {
      upper: channels.upper ? boxKey(channels.upper) : null,
      lower: channels.lower ? boxKey(channels.lower) : null,
      footwear: channels.footwear ? boxKey(channels.footwear) : null,
    },
    primitives: primitives.map((p) => ({ name: p.name, box: boxKey(p.box) })),
    perMatchingSlot,
    contractUnionUpperLower,
  };
}

const aisha = await railMeasure("mpfb2_aisha", AISHA);
const library = await railMeasure("library_lean_female", LIBRARY);

const report = {
  issue: "#357",
  measuredAt: new Date().toISOString(),
  maxOverreachM: MAX_OVERREACH_M,
  note:
    "Per-slot comparison: upper mask vs upper garment, lower vs lower, foot vs footwear, orphan vs none (spans boundaries by design). contractUnionUpperLower reproduces the current clause (2) comparison: every mask vs union(upper, lower) — the foot mask's guaranteed false positive.",
  rails: [aisha, library],
  treeStamp: computeMeasurementTreeStamp(REPO_ROOT),
};

const outDir = `${REPO_ROOT}/.openclinxr/evidence/mask-footprint`;
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const out = `${outDir}/pre-fix.json`;
writeFileSync(out, JSON.stringify(report, null, 2), "utf8");
console.log(`wrote ${out}`);
for (const r of report.rails) {
  console.log(`\n== ${r.id}`);
  console.log("per-slot:", JSON.stringify(r.perMatchingSlot.map((s) => ({ slot: s.slot, vs: s.garmentChannel, worst: s.worstOverreachMm }))));
  console.log("contract union:", JSON.stringify(r.contractUnionUpperLower.filter((s) => s.detail.length > 0).map((s) => ({ slot: s.slot, detail: s.detail }))));
}
