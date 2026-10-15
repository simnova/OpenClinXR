/**
 * Mouth compat census (tsk_667587349a455eec): visemes, jaw, teeth/tongue,
 * emotion morphs, and brow ownership on the realism head vs shipped control.
 *
 * Reads both GLBs with NodeIO (machine-read populations, never typed) and
 * writes census.json beside this script. The compat-report.json cites it.
 *
 * Usage:
 *   pnpm exec tsx tools/openclinxr/evidence/realism-head/mouth/mouth-census.ts
 *
 * claimScope: morph/joint populations measured off two GLB files.
 * notEvidenceFor: clinical_validity, production_asset_readiness, pixel grade.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO, type Node } from "@gltf-transform/core";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "../../../../..");
const CONTROL = join(REPO, "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb");
const REALISM =
  "/Users/patrick/.grok/worktrees/src-openclinxr/realism-95/.openclinxr/realism-spike/compatmouth/aisha-realism.glb";

const EXPECTED_VISEMES = [
  "viseme_aa",
  "viseme_CH",
  "viseme_DD",
  "viseme_E",
  "viseme_FF",
  "viseme_I",
  "viseme_kk",
  "viseme_nn",
  "viseme_O",
  "viseme_PP",
  "viseme_RR",
  "viseme_sil",
  "viseme_SS",
  "viseme_TH",
  "viseme_U",
];

const FACS_GROUP_TARGETS = [
  "eyebrows-left-inner-up",
  "eyebrows-right-inner-up",
  "eyebrows-left-down",
  "eyebrows-right-down",
  "eye-left-slit",
  "eye-right-slit",
  "nose-compression-uncompress",
  "mouth-open",
  "mouth-corner-puller",
];

function sha256File(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

function worldTranslation(node: Node): [number, number, number] {
  const acc: [number, number, number] = [0, 0, 0];
  let p: Node | null = node;
  while (p) {
    const t = p.getTranslation();
    acc[0] += t[0];
    acc[1] += t[1];
    acc[2] += t[2];
    p = p.getParentNode() as Node | null;
  }
  return acc;
}

async function censusOne(label: string, glb: string) {
  const doc = await new NodeIO().read(glb);
  const root = doc.getRoot();
  const meshes = root.listMeshes();

  const morphByMesh: Record<string, string[]> = {};
  for (const m of meshes) {
    const names = new Set<string>();
    for (const prim of m.listPrimitives()) {
      for (const t of prim.listTargets()) {
        const n = t.getName();
        if (n) names.add(n);
      }
    }
    const extras = (m.getExtras()?.targetNames ?? []) as string[];
    for (const n of extras) names.add(n);
    if (names.size > 0) morphByMesh[m.getName()] = [...names].sort();
  }
  const allTargets = new Set<string>(Object.values(morphByMesh).flat());
  const visemes = [...allTargets].filter((n) => n.startsWith("viseme_")).sort();
  const facs = Object.fromEntries(FACS_GROUP_TARGETS.map((t) => [t, allTargets.has(t)]));
  const browCarrierMeshes = Object.entries(morphByMesh)
    .filter(([, names]) => names.some((n) => n.startsWith("eyebrows-")))
    .map(([mesh]) => mesh);
  const fittedBrowMeshes = meshes
    .map((m) => m.getName())
    .filter((n) => /eyebrow/i.test(n));
  const fittedBrowMorphs = Object.fromEntries(
    fittedBrowMeshes.map((n) => [n, morphByMesh[n] ?? []]),
  );

  const joints = root.listSkins()[0]?.listJoints() ?? [];
  const byName = new Map(joints.map((j) => [j.getName() ?? "", j]));
  const jawJoints = joints.map((j) => j.getName() ?? "").filter((n) => n === "jaw" || n.toLowerCase() === "jaw");
  let leverM: number | null = null;
  let jawDescLip = 0;
  let lipTotal = 0;
  const jaw = byName.get("jaw");
  if (jaw) {
    const descendants = new Set<string>();
    const walk = (n: Node): void => {
      for (const c of n.listChildren()) {
        descendants.add(c.getName() ?? "");
        walk(c);
      }
    };
    walk(jaw);
    const lipBones = [...byName.keys()].filter((n) => /^(oris|levator)/.test(n));
    lipTotal = lipBones.length;
    jawDescLip = lipBones.filter((n) => descendants.has(n)).length;
    const oris01 = byName.get("oris01");
    if (oris01) {
      const jw = worldTranslation(jaw);
      const lw = worldTranslation(oris01);
      leverM = Math.hypot(lw[0] - jw[0], lw[1] - jw[1], lw[2] - jw[2]);
    }
  }

  const meshInfo = meshes.map((m) => {
    let tris = 0;
    let skinned = false;
    for (const prim of m.listPrimitives()) {
      const idx = prim.getIndices();
      const count = prim.getAttribute("POSITION")?.getCount() ?? 0;
      tris += idx ? idx.getCount() / 3 : count / 3;
      if (prim.getAttribute("JOINTS_0") && prim.getAttribute("WEIGHTS_0")) skinned = true;
    }
    let maxZ = -Infinity;
    const v = [0, 0, 0];
    for (const prim of m.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        if (v[2]! > maxZ) maxZ = v[2]!;
      }
    }
    return { mesh: m.getName(), tris: Math.round(tris), skinned, maxZ };
  });
  const teeth = meshInfo.filter((m) => /teeth/i.test(m.mesh));
  const tongue = meshInfo.filter((m) => /tongue/i.test(m.mesh));

  return {
    label,
    sha256: sha256File(glb),
    visemes,
    visemesExpected: EXPECTED_VISEMES,
    visemesMatch: EXPECTED_VISEMES.every((v) => visemes.includes(v)) && visemes.length === 15,
    facs,
    browCarrierMeshes,
    fittedBrowMeshes,
    fittedBrowMorphs,
    jawJoints,
    lipBonesTotal: lipTotal,
    lipBonesUnderJaw: jawDescLip,
    jawToOris01LeverM: leverM,
    teeth,
    tongue,
    morphMeshCount: Object.keys(morphByMesh).length,
  };
}

async function main(): Promise<void> {
  const rows = [await censusOne("realism", REALISM), await censusOne("control", CONTROL)];
  const out = {
    schema: "openclinxr.mouth-census.v1",
    control: CONTROL.replace(REPO + "/", ""),
    realismNote: "scratch bake, not git-tracked; sha recorded here",
    rows,
  };
  writeFileSync(join(HERE, "census.json"), `${JSON.stringify(out, null, 2)}\n`);
  for (const r of rows) {
    console.log(
      `${r.label}: visemes=${r.visemes.length} match15=${r.visemesMatch} jaw=${JSON.stringify(r.jawJoints)} lip=${r.lipBonesUnderJaw}/${r.lipBonesTotal} lever=${r.jawToOris01LeverM} browCarriers=${r.browCarrierMeshes.length} fittedBrow=${JSON.stringify(r.fittedBrowMeshes)}`,
    );
  }
}

await main();
