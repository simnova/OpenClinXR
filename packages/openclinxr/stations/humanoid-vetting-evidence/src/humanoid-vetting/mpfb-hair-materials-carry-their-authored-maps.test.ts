import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { repoRoot } from "@openclinxr/factory-station-core/runner";
import { decodePng } from "@openclinxr/png-measure/evidence-png";
import { expect, it } from "vitest";

const REPO_ROOT = repoRoot();
const SHIPPED_DIR = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids");
const GLB_DIR = process.env["HMM_GLB_DIR"] ?? SHIPPED_DIR;
const PHENOTYPES = join(REPO_ROOT, "packages/openclinxr/scenario-fixtures/generated/actor-phenotype.v1.json");

const ALL_12 = [
  "mpfb-clinical-nurse-adult.glb",
  "mpfb-clinical-physician-adult.glb",
  "mpfb-family-partner-adult.glb",
  "mpfb-gown-adult-patient.glb",
  "mpfb-gown-ed-robert-hayes.glb",
  "mpfb-gown-inspect.glb",
  "mpfb-ob-patient-aisha.glb",
  "mpfb-peds-nurse-kevin.glb",
  "mpfb-peds-parent-aisha.glb",
  "mpfb-peds-patient-child.glb",
  "mpfb-street-adult-male.glb",
  "mpfb-viseme-inspect.glb",
];
const SHIPPABLE_3 = [
  "mpfb-family-partner-adult.glb",
  "mpfb-gown-ed-robert-hayes.glb",
  "mpfb-peds-patient-child.glb",
];
const KNOWN_GOOD = "mpfb-peds-parent-aisha.glb";
// FU1 F2 HOLD SET: no case hair_color token exists for these 5 (case files outside
// this card's writeRoots), so the stage must not map them. Inverted guard below
// fails if a held GLB ever carries maps.
const HELD_5 = new Set([
  "mpfb-clinical-nurse-adult.glb",
  "mpfb-gown-adult-patient.glb",
  "mpfb-gown-inspect.glb",
  "mpfb-ob-patient-aisha.glb",
  "mpfb-viseme-inspect.glb",
]);
const HELD_NOTE = "held by MAPS-TOIGO F2: no case hair_color token; map it only after the case token card lands; do not delete this guard";
// G1 FU6 SHIP (grade 2026-11-18, JOB/RULING-cap41-maps-toigo-fu6.txt): family-partner
// ACCEPTED on the FU5 bytes; the FU3 grade HOLD is LIFTED, so the former HELD_GRADE
// set is deleted here (not renamed): the GLB is shippable, not held.
// Explicit skip set: the mhair02 style is owned by a later mhair02 card, not this toigo round.
// Inverted guard below fails if an mhair02 GLB already carries maps, so the skip cannot hide a fix.
const MHAIR02_SKIP = new Set([
  "mpfb-clinical-physician-adult.glb",
  "mpfb-peds-nurse-kevin.glb",
  "mpfb-street-adult-male.glb",
]);
const MHAIR02_NOTE = "mhair02 hair is owned by the later mhair02 card (mhair02, not this toigo round)";

function hairColorRgba(token: string | null): [number, number, number, number] {
  const value = String(token ?? "brown").toLowerCase();
  let key = "brown";
  if (value.includes("black")) key = "black";
  else if (value.includes("blond") || value.includes("blonde")) key = "blond";
  else if (value.includes("light")) key = "light";
  const table: Record<string, [number, number, number]> = {
    black: [0.035, 0.028, 0.022],
    blond: [0.42, 0.32, 0.16],
    light: [0.24, 0.15, 0.075],
    brown: [0.12, 0.07, 0.035],
  };
  const rgb = table[key]!;
  return [rgb[0], rgb[1], rgb[2], 1.0];
}

/**
 * Sole authorized token inheritance (cap41 ruling 2026-11-18 (MAPS-TOIGO r1),
 * I1 TOKENS line 4: "Inspect GLBs (gown-inspect, viseme-inspect) are copies of
 * ob-patient-aisha (material names): inherit its token; record source GLB in
 * their provenance"). Each inspect GLB resolves the token of its recorded
 * source GLB; the mapping below is the whole allowlist — no broader pattern.
 * The source GLB's own provenance (scenarioId/actorId) is the lookup key.
 * Anything else missing a token throws; brown is never a silent fallback
 * (the stage refuses a missing token with NO-FALLBACK).
 */
const INSPECT_INHERITANCE: Readonly<Record<string, string>> = {
  "mpfb-gown-inspect.glb": "mpfb-ob-patient-aisha.glb",
  "mpfb-viseme-inspect.glb": "mpfb-ob-patient-aisha.glb",
};

type PhenotypeEntry = { phenotype?: Record<string, unknown> };

/** Injectable readers so plants exercise the real caseTokenFor entry point.
 * Live calls pass nothing (file reads). */
type TokenReader = {
  readProvenance: (glbName: string) => { scenarioId?: string; actorId?: string };
  readPhenotypes: () => { entries?: Record<string, Record<string, PhenotypeEntry>> };
};

const FILE_READER: TokenReader = {
  readProvenance: (glbName: string) =>
    JSON.parse(readFileSync(join(SHIPPED_DIR, glbName.replace(/\.glb$/, ".provenance.json")), "utf8")) as {
      scenarioId?: string;
      actorId?: string;
    },
  readPhenotypes: () =>
    JSON.parse(readFileSync(PHENOTYPES, "utf8")) as {
      entries?: Record<string, Record<string, PhenotypeEntry>>;
    },
};

function tokenFromEntry(
  glbName: string,
  sc: string,
  aid: string,
  entry: PhenotypeEntry | undefined,
  sourceTag: string,
): { token: string; source: string } {
  if (!entry) throw new Error(`${glbName}: no phenotype entry for ${sc}.${aid}`);
  const token = entry.phenotype?.["hair_color"];
  if (typeof token !== "string" || token.trim() === "") {
    throw new Error(`${glbName}: missing hair_color for ${sc}.${aid} (and ${glbName} is not covered by inspect inheritance)`);
  }
  return { token, source: sourceTag };
}

function inheritedTokenFor(glbName: string, sourceGlb: string, reader: TokenReader = FILE_READER): { token: string; source: string } {
  let srcProv: { scenarioId?: string; actorId?: string };
  try {
    srcProv = reader.readProvenance(sourceGlb);
  } catch {
    throw new Error(`${glbName}: unresolvable source-GLB provenance for inherited token (${sourceGlb})`);
  }
  const sc = String(srcProv.scenarioId ?? "");
  const aid = String(srcProv.actorId ?? "");
  let entry: PhenotypeEntry | undefined;
  try {
    entry = reader.readPhenotypes().entries?.[sc]?.[aid];
  } catch {
    throw new Error(`${glbName}: unresolvable phenotype file for inherited token (${sourceGlb} ${sc}.${aid})`);
  }
  if (!entry) throw new Error(`${glbName}: no phenotype entry for inherited source ${sourceGlb} ${sc}.${aid}`);
  const token = entry.phenotype?.["hair_color"];
  if (typeof token !== "string" || token.trim() === "") {
    throw new Error(`${glbName}: inherited token missing (source ${sourceGlb} ${sc}.${aid} has no hair_color; never brown)`);
  }
  return { token, source: `inherited:${sourceGlb} (${sc}.${aid}.phenotype.hair_color)` };
}

function caseTokenFor(glbName: string, reader: TokenReader = FILE_READER): { token: string; source: string } {
  const inherited = INSPECT_INHERITANCE[glbName];
  if (inherited !== undefined) return inheritedTokenFor(glbName, inherited, reader);
  let prov: { scenarioId?: string; actorId?: string };
  let phenotypes: { entries?: Record<string, Record<string, PhenotypeEntry>> };
  try {
    prov = reader.readProvenance(glbName);
    phenotypes = reader.readPhenotypes();
  } catch {
    throw new Error(`${glbName}: unresolvable provenance/phenotype file (no fallback)`);
  }
  const sc = String(prov.scenarioId ?? "");
  const aid = String(prov.actorId ?? "");
  return tokenFromEntry(glbName, sc, aid, phenotypes.entries?.[sc]?.[aid], `phenotype#entries.${sc}.${aid}.phenotype.hair_color`);
}

function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(v: number): number {
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
}

/**
 * Encoder quantisation floor (FU2 T2-BOUND): the bound is derived per token and
 * per channel as half of one 8-bit sRGB step at the token's value, i.e.
 *   s = linToSrgb(token_c) * 255   (unrounded code position of the token)
 *   bound_c = (srgb8ToLin(s+0.5) - srgb8ToLin(s-0.5)) / 2
 * using the same transfer functions the test measures with. A recoloured PNG
 * stores each texel rounded to the nearest 8-bit sRGB code, so the mean of the
 * stored texels can sit at most half a code step from the token that the
 * recolour targeted. Do NOT pick or adjust the bound from any measured mean.
 */
function quantFloorBound(tokenRgb: readonly [number, number, number]): [number, number, number] {
  return [0, 1, 2].map((c) => {
    const s = Math.min(1, Math.max(0, linearToSrgb(tokenRgb[c]!))) * 255;
    return (srgbToLinear((s + 0.5) / 255) - srgbToLinear((s - 0.5) / 255)) / 2;
  }) as [number, number, number];
}

async function hairReport(glbPath: string) {
  const doc = await new NodeIO().readBinary(readFileSync(glbPath));
  const mats = doc.getRoot().listMaterials().filter((m) => /openclinxr_fitted_hair_/i.test(m.getName()));
  return { doc, mats };
}

it("T1 census: 3 shippable + peds-parent carry authored maps; 5 held stay unmapped; mhair02 skip guard holds", async () => {
  const files = readdirSync(GLB_DIR).filter((f) => f.startsWith("mpfb-") && f.endsWith(".glb")).sort();
  expect(files, `HMM_GLB_DIR census (default shipped dir ${SHIPPED_DIR})`).toEqual([...ALL_12].sort());
  expect(files.length, "vacuity guard: exactly 12 mpfb GLBs").toBe(12);
  const lines: string[] = [];
  for (const file of files) {
    const { mats } = await hairReport(join(GLB_DIR, file));
    expect(mats.length, `${file}: exactly one fitted hair material`).toBe(1);
    const mat = mats[0]!;
    const hasBase = mat.getBaseColorTexture() !== null;
    const hasNormal = mat.getNormalTexture() !== null;
    const alpha = mat.getAlphaMode();
    lines.push(`${file} :: ${mat.getName()} base=${hasBase} normal=${hasNormal} alpha=${alpha}`);
    if (MHAIR02_SKIP.has(file)) continue;
    if (HELD_5.has(file)) {
      const mapped = hasBase || hasNormal;
      expect(mapped, `${file}: ${HELD_NOTE}`).toBe(false);
      continue;
    }
    expect(hasBase, `${file}: hair material ${mat.getName()} is missing its authored baseColorTexture diffuse map.`).toBe(true);
    expect(hasNormal, `${file}: hair material ${mat.getName()} is missing its authored normalTexture map.`).toBe(true);
    expect(alpha === "OPAQUE", `${file}: hair material ${mat.getName()} has alphaMode OPAQUE but the authored cards need MASK cutout.`).toBe(false);
  }
  console.log(lines.join("\n"));
  // Inverted guards: the 5 F2 held GLBs and the mhair02 skip set must stay
  // unmapped, so neither guard can silently hide a fix. When HMM_GLB_DIR points
  // at candidate outputs the 3 shippable GLBs are mapped but the 5 held and the
  // 3 mhair02 copies stay unmapped (copied unchanged).
  for (const file of MHAIR02_SKIP) {
    const { mats } = await hairReport(join(GLB_DIR, file));
    const mat = mats[0]!;
    const mapped = mat.getBaseColorTexture() !== null || mat.getNormalTexture() !== null;
    expect(mapped, `${file}: ${MHAIR02_NOTE}; failing because an mhair02 GLB already carries maps`).toBe(false);
  }
}, 120_000);

it("T2 tint: shippable hair albedo x factor equals its case token within the encoder floor", async () => {
  // FU2 T2-BOUND (supersedes FU1 F3's fitted 0.0003, WITHDRAWN): per-token,
  // per-channel bound from the encoder quantisation floor (see quantFloorBound).
  // If a shippable GLB fails it, the test REDs and RESULT reports the number;
  // the coordinator rules.
  const TOKENS: Record<string, readonly [number, number, number]> = {
    black: [0.035, 0.028, 0.022],
    brown: [0.12, 0.07, 0.035],
    light_brown: [0.24, 0.15, 0.075],
  };
  const boundLines = Object.entries(TOKENS).map(
    ([name, rgb]) => `token=${name} rgb=[${rgb.join(",")}] bound=[${quantFloorBound(rgb).map((b) => b.toFixed(6)).join(",")}]`,
  );
  console.log(boundLines.join("\n"));
  const means: string[] = [];
  for (const file of SHIPPABLE_3) {
    const glbPath = join(GLB_DIR, file);
    const { doc, mats } = await hairReport(glbPath);
    void doc;
    const mat = mats[0]!;
    const base = mat.getBaseColorTexture();
    expect(base, `${file}: T2 needs baseColorTexture (run the stage first)`).not.toBeNull();
    const bytes = base!.getImage();
    expect(bytes, `${file}: baseColorTexture has no embedded image`).not.toBeNull();
    const decoded = decodePng(bytes!);
    expect(decoded, `${file}: baseColorTexture decodes as PNG`).not.toBeNull();
    const factor = mat.getBaseColorFactor();
    const cutoff = mat.getAlphaCutoff() || 0.2;
    let wsum = 0;
    const acc = [0, 0, 0];
    const n = decoded!.w * decoded!.h;
    for (let i = 0; i < n; i++) {
      const a = decoded!.a[i]! / 255;
      if (a < cutoff) continue;
      const r = srgbToLinear(decoded!.r[i]! / 255);
      const g = srgbToLinear(decoded!.g[i]! / 255);
      const b = srgbToLinear(decoded!.b[i]! / 255);
      acc[0]! += r * a;
      acc[1]! += g * a;
      acc[2]! += b * a;
      wsum += a;
    }
    expect(wsum, `${file}: no texels above alphaCutoff ${cutoff}`).toBeGreaterThan(0);
    const mean = [acc[0]! / wsum, acc[1]! / wsum, acc[2]! / wsum].map((v, c) => v * (factor[c] ?? 1));
    const { token, source } = caseTokenFor(file);
    const kind = source.includes("phenotype#entries") ? "case" : "inherited";
    const target = hairColorRgba(token).slice(0, 3);
    const bound = quantFloorBound(target as [number, number, number]);
    const diffs = mean.map((v, c) => Math.abs(v - target[c]!));
    const margins = bound.map((b, c) => b - diffs[c]!);
    means.push(`${file} token=${token} kind=${kind} mean=[${mean.map((v) => v.toFixed(5)).join(",")}] target=[${target.map((v) => v.toFixed(5)).join(",")}] bound=[${bound.map((b) => b.toFixed(6)).join(",")}] abs=[${diffs.map((d) => d.toFixed(6)).join(",")}] margin=[${margins.map((m) => m.toFixed(6)).join(",")}] src=${source}`);
    for (let c = 0; c < 3; c++) {
      expect(diffs[c]!, `${file} channel ${"RGB"[c]}: |mean-token| ${diffs[c]!.toFixed(6)} exceeds encoder floor bound ${bound[c]!.toFixed(6)} (mean ${mean.map((v) => v.toFixed(5))} vs ${token} ${target}; ${means[means.length - 1]})`).toBeLessThanOrEqual(bound[c]!);
    }
  }
  // Known-good calibration: peds-parent at 30083bee8 measured by the same code.
  const kgPath = join(SHIPPED_DIR, KNOWN_GOOD);
  const { mats: kgMats } = await hairReport(kgPath);
  const kgBase = kgMats[0]!.getBaseColorTexture();
  if (kgBase?.getImage()) {
    const decoded = decodePng(kgBase.getImage()!);
    if (decoded) {
      const cutoff = kgMats[0]!.getAlphaCutoff() || 0.2;
      const factor = kgMats[0]!.getBaseColorFactor();
      let wsum = 0;
      const acc = [0, 0, 0];
      const n = decoded.w * decoded.h;
      for (let i = 0; i < n; i++) {
        const a = decoded.a[i]! / 255;
        if (a < cutoff) continue;
        acc[0]! += srgbToLinear(decoded.r[i]! / 255) * a;
        acc[1]! += srgbToLinear(decoded.g[i]! / 255) * a;
        acc[2]! += srgbToLinear(decoded.b[i]! / 255) * a;
        wsum += a;
      }
      const mean = [acc[0]! / wsum, acc[1]! / wsum, acc[2]! / wsum].map((v, c) => v * (factor[c] ?? 1));
      means.push(`${KNOWN_GOOD} shipped mean=[${mean.map((v) => v.toFixed(5)).join(",")}] (raw Auburn, pre-recolour; cutoff ${cutoff})`);
    }
  }
  console.log(means.join("\n"));
}, 180_000);

it("T2 PLANT: a 2x-bound synthetic offset REDs and a 0.5x-bound offset stays GREEN", () => {
  // Synthetic counterweight on the gate itself (no GLB): take each shippable
  // token, offset channel R by 2x its encoder-floor bound (must exceed the bound
  // -> RED) and by 0.5x (must stay inside -> GREEN). Both outcomes printed.
  const TOKENS: Record<string, readonly [number, number, number]> = {
    black: [0.035, 0.028, 0.022],
    brown: [0.12, 0.07, 0.035],
    light_brown: [0.24, 0.15, 0.075],
  };
  for (const [name, rgb] of Object.entries(TOKENS)) {
    const bound = quantFloorBound(rgb);
    const off2 = [rgb[0]! + 2 * bound[0]!, rgb[1], rgb[2]] as const;
    const d2 = Math.abs(off2[0] - rgb[0]!);
    const reds = d2 > bound[0]!;
    console.log(`PLANT token=${name} 2x-bound R: |delta|=${d2.toFixed(6)} bound=${bound[0]!.toFixed(6)} -> ${reds ? "RED" : "UNEXPECTED-GREEN"}`);
    expect(reds, `PLANT 2x-bound on ${name} R must RED (|delta| ${d2} vs bound ${bound[0]})`).toBe(true);
    const off05 = [rgb[0]! + 0.5 * bound[0]!, rgb[1], rgb[2]] as const;
    const d05 = Math.abs(off05[0] - rgb[0]!);
    const greens = d05 <= bound[0]!;
    console.log(`PLANT token=${name} 0.5x-bound R: |delta|=${d05.toFixed(6)} bound=${bound[0]!.toFixed(6)} -> ${greens ? "GREEN" : "UNEXPECTED-RED"}`);
    expect(greens, `PLANT 0.5x-bound on ${name} R must stay GREEN (|delta| ${d05} vs bound ${bound[0]})`).toBe(true);
  }
});

it("P1 PLANT: stripped Robert hair_color throws naming the file through caseTokenFor", () => {
  const live = FILE_READER.readPhenotypes();
  const sc = "ed_chest_pain_priority_v1";
  const aid = "patient_robert_hayes_v1";
  const stripped: PhenotypeEntry = { phenotype: { ...live.entries?.[sc]?.[aid]?.phenotype } };
  delete (stripped.phenotype as Record<string, unknown>)["hair_color"];
  const injected: TokenReader = {
    readProvenance: FILE_READER.readProvenance,
    readPhenotypes: () => ({
      entries: {
        ...live.entries,
        [sc]: { ...live.entries?.[sc], [aid]: stripped },
      },
    }),
  };
  let message = "";
  try {
    caseTokenFor("mpfb-gown-ed-robert-hayes.glb", injected);
  } catch (e) {
    message = String((e as Error)?.message ?? e);
  }
  console.log(`PLANT P1 stripped Robert: throws "${message}" -> RED (refusal, as required)`);
  expect(
    () => caseTokenFor("mpfb-gown-ed-robert-hayes.glb", injected),
    "stripped Robert must throw naming mpfb-gown-ed-robert-hayes.glb",
  ).toThrow("mpfb-gown-ed-robert-hayes.glb");
  // Counterweight: live Robert (no injection) resolves to phenotype#entries.
  const liveRes = caseTokenFor("mpfb-gown-ed-robert-hayes.glb");
  console.log(`COUNTERWEIGHT live Robert: token=${liveRes.token} src=${liveRes.source}`);
  expect(liveRes.source, "live Robert must resolve to phenotype#entries").toContain("phenotype#entries");
  expect(liveRes.token).toBe("brown");
});

it("P2 PLANT: inspect GLB with tokenless aisha entry throws naming the inspect file", () => {
  const live = FILE_READER.readPhenotypes();
  const sc = "ob_headache_preeclampsia_triage_v1";
  const aid = "patient_aisha_khan_v1";
  const stripped: PhenotypeEntry = { phenotype: { ...live.entries?.[sc]?.[aid]?.phenotype } };
  delete (stripped.phenotype as Record<string, unknown>)["hair_color"];
  const injected: TokenReader = {
    readProvenance: FILE_READER.readProvenance,
    readPhenotypes: () => ({
      entries: {
        ...live.entries,
        [sc]: { ...live.entries?.[sc], [aid]: stripped },
      },
    }),
  };
  let message = "";
  try {
    caseTokenFor("mpfb-gown-inspect.glb", injected);
  } catch (e) {
    message = String((e as Error)?.message ?? e);
  }
  console.log(`PLANT P2 tokenless aisha entry: throws "${message}" -> RED (refusal, as required)`);
  expect(
    () => caseTokenFor("mpfb-gown-inspect.glb", injected),
    "tokenless aisha entry must throw naming mpfb-gown-inspect.glb",
  ).toThrow("mpfb-gown-inspect.glb");
  // The allowlist is exactly the two inspect GLBs: nothing broader may inherit.
  expect(Object.keys(INSPECT_INHERITANCE).sort()).toEqual(["mpfb-gown-inspect.glb", "mpfb-viseme-inspect.glb"]);
});

function quantileOf(sorted: number[], q: number): number {
  if (sorted.length === 0) throw new Error("quantile of empty set");
  return sorted[Math.min(sorted.length - 1, Math.round(q * (sorted.length - 1)))]!;
}

/** Encoder half-step at an unrounded sRGB code position, divided by token_c. */
function encHalfStepAtCode(s: number, tokenC: number): number {
  const hi = srgbToLinear((s + 0.5) / 255);
  const lo = srgbToLinear((s - 0.5) / 255);
  return (hi - lo) / 2 / tokenC;
}

async function keptKArrays(glbPath: string, token: readonly [number, number, number]): Promise<{ kR: number[]; kG: number[]; kB: number[]; cutoff: number }> {
  const { mats } = await hairReport(glbPath);
  const mat = mats[0]!;
  const base = mat.getBaseColorTexture();
  if (!base) throw new Error(`${glbPath}: no baseColorTexture`);
  const bytes = base.getImage();
  if (!bytes) throw new Error(`${glbPath}: no embedded image`);
  const decoded = decodePng(bytes);
  if (!decoded) throw new Error(`${glbPath}: PNG decode failed`);
  const factor = mat.getBaseColorFactor();
  const cutoff = mat.getAlphaCutoff() || 0.2;
  const kR: number[] = [];
  const kG: number[] = [];
  const kB: number[] = [];
  const n = decoded.w * decoded.h;
  for (let i = 0; i < n; i++) {
    const a = decoded.a[i]! / 255;
    if (a < cutoff) continue;
    kR.push((srgbToLinear(decoded.r[i]! / 255) * (factor[0] ?? 1)) / token[0]!);
    kG.push((srgbToLinear(decoded.g[i]! / 255) * (factor[1] ?? 1)) / token[1]!);
    kB.push((srgbToLinear(decoded.b[i]! / 255) * (factor[2] ?? 1)) / token[2]!);
  }
  if (kR.length === 0) throw new Error(`${glbPath}: no kept texels`);
  kR.sort((x, y) => x - y);
  kG.sort((x, y) => x - y);
  kB.sort((x, y) => x - y);
  return { kR, kG, kB, cutoff };
}

it("T2c CHANNEL COUPLING: per-channel k quantiles agree up to encoder rounding", async () => {
  // Under the FU4 R1 chroma recolour, k_c = k for every channel before encoding,
  // so the per-channel quantiles of k_c differ only by 8-bit rounding. eps_pair =
  // e_c(q) + e_c'(q) with e_c(q) the quantFloorBound-style half step at the code
  // lin^-1(token_c * q(k_c)) divided by token_c (unrounded; same derivation as
  // quantFloorBound, not a measured number).
  const lines: string[] = [];
  for (const file of SHIPPABLE_3) {
    const { token } = caseTokenFor(file);
    const target = hairColorRgba(token).slice(0, 3) as [number, number, number];
    const { kR, kG, kB } = await keptKArrays(join(GLB_DIR, file), target);
    for (const q of [0.05, 0.5, 0.95]) {
      const qR = quantileOf(kR, q);
      const qG = quantileOf(kG, q);
      const qB = quantileOf(kB, q);
      const eR = encHalfStepAtCode(Math.min(1, Math.max(0, linearToSrgb(target[0]! * qR))) * 255, target[0]!);
      const eG = encHalfStepAtCode(Math.min(1, Math.max(0, linearToSrgb(target[1]! * qG))) * 255, target[1]!);
      const eB = encHalfStepAtCode(Math.min(1, Math.max(0, linearToSrgb(target[2]! * qB))) * 255, target[2]!);
      const pairs: Array<[string, number, number, number, number]> = [
        ["R-G", qR, qG, Math.abs(qR - qG), eR + eG],
        ["G-B", qG, qB, Math.abs(qG - qB), eG + eB],
        ["R-B", qR, qB, Math.abs(qR - qB), eR + eB],
      ];
      for (const [pair, qa, qb, diff, eps] of pairs) {
        lines.push(`${file} q=${q} ${pair}: |${qa.toFixed(4)}-${qb.toFixed(4)}|=${diff.toFixed(5)} eps=${eps.toFixed(5)} margin=${(eps - diff).toFixed(5)}`);
        expect(diff, `${file} q=${q} pair ${pair}: |k diff| ${diff.toFixed(5)} exceeds eps_pair ${eps.toFixed(5)}`).toBeLessThanOrEqual(eps);
      }
    }
  }
  console.log(lines.join("\n"));
}, 180_000);

it("T2d SPREAD KEPT: the chroma recolour is not a flat token fill", async () => {
  // Counterweight to a flat token fill, which passes T2 (mean on token) and T2c
  // (all k_c equal up to rounding). A flat fill has every k_G within one half
  // step of 1 at both quantiles, so its spread is <= e_G(p95) + e_G(p05); 2x is
  // the separation from that floor.
  const lines: string[] = [];
  for (const file of SHIPPABLE_3) {
    const { token } = caseTokenFor(file);
    const target = hairColorRgba(token).slice(0, 3) as [number, number, number];
    const { kG } = await keptKArrays(join(GLB_DIR, file), target);
    const p95 = quantileOf(kG, 0.95);
    const p05 = quantileOf(kG, 0.05);
    const spread = p95 - p05;
    const e95 = encHalfStepAtCode(Math.min(1, Math.max(0, linearToSrgb(target[1]! * p95))) * 255, target[1]!);
    const e05 = encHalfStepAtCode(Math.min(1, Math.max(0, linearToSrgb(target[1]! * p05))) * 255, target[1]!);
    const floor = 2 * (e95 + e05);
    lines.push(`${file} k_G p95=${p95.toFixed(4)} p05=${p05.toFixed(4)} spread=${spread.toFixed(5)} floor=2*(${e95.toFixed(5)}+${e05.toFixed(5)})=${floor.toFixed(5)} margin=${(spread - floor).toFixed(5)}`);
    expect(spread, `${file}: k_G spread ${spread.toFixed(5)} is not above the flat-fill floor ${floor.toFixed(5)}`).toBeGreaterThan(floor);
  }
  console.log(lines.join("\n"));
}, 180_000);

it("T2c PLANT: mean-scale REDs coupling, R1 passes it, flat fill REDs spread", () => {
  // Synthetic two-hue source (illustrative, fixed): three A texels and one B
  // texel, so the q50 quantile lands inside the majority cluster per channel.
  const A = [0.5, 0.1, 0.1] as const;
  const B = [0.1, 0.5, 0.1] as const;
  const TOKEN = [0.12, 0.07, 0.035] as const; // brown
  const src = [A, A, A, B];
  const encDec = (v: number): number => {
    const s = Math.round(Math.min(1, Math.max(0, linearToSrgb(v))) * 255);
    return srgbToLinear(s / 255);
  };
  const kStats = (texels: ReadonlyArray<readonly [number, number, number]>) => {
    const kR = texels.map((t) => encDec(t[0]) / TOKEN[0]!).sort((x, y) => x - y);
    const kG = texels.map((t) => encDec(t[1]) / TOKEN[1]!).sort((x, y) => x - y);
    const kB = texels.map((t) => encDec(t[2]) / TOKEN[2]!).sort((x, y) => x - y);
    const q50 = { R: quantileOf(kR, 0.5), G: quantileOf(kG, 0.5), B: quantileOf(kB, 0.5) };
    const e = {
      R: encHalfStepAtCode(Math.min(1, Math.max(0, linearToSrgb(TOKEN[0]! * q50.R))) * 255, TOKEN[0]!),
      G: encHalfStepAtCode(Math.min(1, Math.max(0, linearToSrgb(TOKEN[1]! * q50.G))) * 255, TOKEN[1]!),
      B: encHalfStepAtCode(Math.min(1, Math.max(0, linearToSrgb(TOKEN[2]! * q50.B))) * 255, TOKEN[2]!),
    };
    return { q50, e, kG };
  };
  // (a) per-channel mean-scale build (the FU1/R1 defect): scale_c = token_c/mean_c.
  const mean = [0, 1, 2].map((ch) => src.reduce((s, t) => s + t[ch]!, 0) / src.length);
  const meanScaled = src.map((t) => [t[0]! * TOKEN[0]! / mean[0]!, t[1]! * TOKEN[1]! / mean[1]!, t[2]! * TOKEN[2]! / mean[2]!] as const);
  const m = kStats(meanScaled);
  const dRG = Math.abs(m.q50.R - m.q50.G);
  const epsRG = m.e.R + m.e.G;
  console.log(`PLANT (a) mean-scale q50 R=${m.q50.R.toFixed(4)} G=${m.q50.G.toFixed(4)} |diff|=${dRG.toFixed(4)} eps=${epsRG.toFixed(4)} -> ${dRG > epsRG ? "RED" : "UNEXPECTED-GREEN"}`);
  expect(dRG > epsRG, "PLANT (a): mean-scale build must RED T2c").toBe(true);
  // (b) R1 chroma build of the same source: k = Y/Ybar shared across channels.
  const Y = src.map((t) => 0.2126 * t[0]! + 0.7152 * t[1]! + 0.0722 * t[2]!);
  const Ybar = Y.reduce((s, y) => s + y, 0) / Y.length;
  const chroma = src.map((t, i) => [TOKEN[0]! * Y[i]! / Ybar, TOKEN[1]! * Y[i]! / Ybar, TOKEN[2]! * Y[i]! / Ybar] as const);
  const c = kStats(chroma);
  const cdRG = Math.abs(c.q50.R - c.q50.G);
  const cepsRG = c.e.R + c.e.G;
  const cdGB = Math.abs(c.q50.G - c.q50.B);
  const cepsGB = c.e.G + c.e.B;
  console.log(`PLANT (b) R1 q50 R=${c.q50.R.toFixed(4)} G=${c.q50.G.toFixed(4)} B=${c.q50.B.toFixed(4)} margins=${(cepsRG - cdRG).toFixed(4)},${(cepsGB - cdGB).toFixed(4)} -> ${cdRG <= cepsRG && cdGB <= cepsGB ? "GREEN" : "UNEXPECTED-RED"}`);
  expect(cdRG <= cepsRG && cdGB <= cepsGB, "PLANT (b): R1 build must pass T2c").toBe(true);
  // (c) flat token fill: k_G spread is 0, below the T2d floor.
  const flat = [TOKEN, TOKEN, TOKEN, TOKEN];
  const f = kStats(flat);
  const spread = Math.max(...f.kG) - Math.min(...f.kG);
  console.log(`PLANT (c) flat fill k_G spread=${spread.toFixed(6)} floor>0 -> ${!(spread > 0) ? "RED (as required)" : "UNEXPECTED-GREEN"}`);
  expect(spread > 0, "PLANT (c): flat fill must RED T2d (zero spread)").toBe(false);
});

// FU5 shininess source (test embeds the value; CI has no .openclinxr-local checkout).
// toigo_curled_under_bob_with_bangs: bob_curled_under_bangs.mhmat:8 "shininess 0.01961"
// toigo_blunt_bob_with_bangs: bob_blunt_bangs.mhmat:8 "shininess 0.01961"
// (provider-cache hair/sources/makehuman-hair01/extracted/hair/toigo_*/).
const SHININESS_BY_STYLE: Record<string, { shininess: number; mhmat: string }> = {
  toigo_curled_under_bob_with_bangs: {
    shininess: 0.01961,
    mhmat: "hair/sources/makehuman-hair01/extracted/hair/toigo_curled_under_bob_with_bangs/bob_curled_under_bangs.mhmat:8",
  },
  toigo_blunt_bob_with_bangs: {
    shininess: 0.01961,
    mhmat: "hair/sources/makehuman-hair01/extracted/hair/toigo_blunt_bob_with_bangs/bob_blunt_bangs.mhmat:8",
  },
  toigo_curled_under_bob: {
    shininess: 0.01961,
    mhmat: "hair/sources/makehuman-hair01/extracted/hair/toigo_curled_under_bob/bob_curled_under.mhmat:8",
  },
};

function hairStyleOf(materialName: string): string {
  for (const style of Object.keys(SHININESS_BY_STYLE)) {
    if (materialName.includes(style)) return style;
  }
  throw new Error(`no known toigo style in ${materialName}`);
}

it("T2e NO BLUE TEXELS: p95(B8-R8) stays within one code", async () => {
  // out = token*k with token_B < token_R, so B - R < 0 in linear for every
  // texel; each 8-bit channel rounds by at most 0.5 code, so the pair
  // difference can rise by at most 1 code.
  for (const file of SHIPPABLE_3) {
    const { token, source } = caseTokenFor(file);
    const target = hairColorRgba(token).slice(0, 3) as [number, number, number];
    expect(target[2]! < target[0]!, `${file}: token ${token} has no B<R ordering (excluded by name if ever added)`).toBe(true);
  }
  const lines: string[] = [];
  for (const file of SHIPPABLE_3) {
    const { mats } = await hairReport(join(GLB_DIR, file));
    const mat = mats[0]!;
    const base = mat.getBaseColorTexture();
    if (!base?.getImage()) throw new Error(`${file}: no baseColorTexture image`);
    const decoded = decodePng(base.getImage()!);
    if (!decoded) throw new Error(`${file}: PNG decode failed`);
    const cutoff = mat.getAlphaCutoff() || 0.2;
    const diffs: number[] = [];
    const n = decoded.w * decoded.h;
    let kept = 0;
    for (let i = 0; i < n; i++) {
      if (decoded.a[i]! / 255 < cutoff) continue;
      kept++;
      diffs.push(decoded.b[i]! - decoded.r[i]!);
    }
    expect(kept, `${file}: no kept texels`).toBeGreaterThan(0);
    diffs.sort((x, y) => x - y);
    const p95 = quantileOf(diffs, 0.95);
    lines.push(`${file} kept=${kept} p95(B8-R8)=${p95} bound=1 -> ${p95 <= 1 ? "GREEN" : "RED"}`);
    expect(p95, `${file}: p95(B8-R8)=${p95} exceeds 1 code`).toBeLessThanOrEqual(1);
  }
  console.log(lines.join("\n"));
}, 180_000);

it("T3s SPEC MATERIAL: roughness follows the mhmat shininess, no invented specular", async () => {
  // FU5 SPEC DECIDE: roughnessFactor = 1 - shininess per the MPFB mhmat rule
  // (abstractmaterialwrapper.py update_principled_sockets_from_mhmat); no
  // reference maps Phong specularColor to glTF specularColorFactor, so no
  // specular extension is wired (KEY::SPEC_MAP_UNMAPPED).
  const lines: string[] = [];
  for (const file of SHIPPABLE_3) {
    const { mats } = await hairReport(join(GLB_DIR, file));
    const mat = mats[0]!;
    const style = hairStyleOf(mat.getName());
    const { shininess, mhmat } = SHININESS_BY_STYLE[style]!;
    const expected = 1 - shininess;
    const got = mat.getRoughnessFactor();
    const rel = Math.abs(got - expected) / expected;
    lines.push(`${file} style=${style} mhmat=${mhmat} shininess=${shininess} roughness=${got} expected=${expected} rel=${rel.toExponential(2)} -> ${rel <= 2 ** -24 ? "GREEN" : "RED"}`);
    expect(rel, `${file}: roughnessFactor ${got} != 1 - shininess(${mhmat}) ${expected}`).toBeLessThanOrEqual(2 ** -24);
    const spec = mat.getExtension("KHR_materials_specular");
    lines.push(`${file} KHR_materials_specular=${spec === null || spec === undefined ? "absent" : "PRESENT"} -> ${spec === null || spec === undefined ? "GREEN" : "RED"}`);
    expect(spec, `${file}: unexpected KHR_materials_specular extension (no mapping reference exists)`).toBeNull();
  }
  console.log(lines.join("\n"));
}, 120_000);

it("T2e/T3s PLANT: blue tail REDs T2e, flat 0.9 REDs T3s", () => {
  // (a) synthetic texture, 10 kept texels, one with B = R + 3.
  const diffs = [0, 0, -1, -2, 0, -1, 0, -2, -1, 3].sort((x, y) => x - y);
  const p95 = quantileOf(diffs, 0.95);
  console.log(`PLANT T2e tail: diffs sorted [${diffs.join(",")}] p95=${p95} bound=1 -> ${p95 > 1 ? "RED" : "UNEXPECTED-GREEN"}`);
  expect(p95 > 1, "PLANT T2e: 10% B=R+3 tail must RED").toBe(true);
  // (b) T3s on a material with the old flat roughnessFactor 0.9.
  const expected = 1 - 0.01961;
  const rel = Math.abs(0.9 - expected) / expected;
  console.log(`PLANT T3s flat-0.9: roughness=0.9 expected=${expected} rel=${rel.toExponential(2)} bound=2^-24 -> ${rel > 2 ** -24 ? "RED" : "UNEXPECTED-GREEN"}`);
  expect(rel > 2 ** -24, "PLANT T3s: roughnessFactor 0.9 must RED").toBe(true);
});
