/**
 * Eyes compat census (tsk_e4befac3ff1b06da): gaze + blink readiness on the
 * realism head vs shipped control.
 *
 * Reads both GLBs with NodeIO (machine-read populations, never typed) and
 * writes census.json beside this script. The compat-report.json cites it.
 *
 * Shell is OFF for this proof (shell-rebind graded not shippable, kept off):
 * the bake below carries no --eye-occlusion-shell flag, so the census records
 * shell/tearline/corner absence honestly instead of inventing meshes.
 *
 * Usage:
 *   pnpm exec tsx tools/openclinxr/evidence/realism-head/eyes/eye-census.ts
 *
 * claimScope: eye mesh / morph / joint / texture populations measured off two
 *   GLB files.
 * notEvidenceFor: clinical_validity, production_asset_readiness, pixel grade.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "../../../../..");
const CONTROL = join(REPO, "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb");
const REALISM =
  "/Users/patrick/.grok/worktrees/src-openclinxr/realism-95/.openclinxr/realism-spike/compateyes/aisha-realism.glb";

const EYE_FACS = [
  "eye-left-closure",
  "eye-left-slit",
  "eye-left-opened-up",
  "eye-right-closure",
  "eye-right-slit",
  "eye-right-opened-up",
];

function sha256File(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

async function censusOne(label: string, glb: string) {
  const doc = await new NodeIO().read(glb);
  const root = doc.getRoot();
  const meshes = root.listMeshes();
  const meshNames = meshes.map((m) => m.getName());

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
  const eyeFacs = Object.fromEntries(EYE_FACS.map((t) => [t, allTargets.has(t)]));

  const eyeMeshes = meshNames.filter((n) => /eye/i.test(n));
  const globeMeshes = meshNames.filter((n) => /globe/i.test(n));
  const corneaMeshes = meshNames.filter((n) => /cornea/i.test(n));
  const lashMeshes = meshNames.filter((n) => /eyelash/i.test(n));
  const shellMeshes = meshNames.filter((n) => /occlusion_shell/i.test(n));
  const tearlineMeshes = meshNames.filter((n) => /tearline/i.test(n));
  const cornerMeshes = meshNames.filter((n) => /conjunctiva|caruncle|corner/i.test(n));
  const lashMorphs: Record<string, string[]> = {};
  for (const n of lashMeshes) lashMorphs[n] = morphByMesh[n] ?? [];

  const joints = root.listSkins()[0]?.listJoints() ?? [];
  const jointNames = joints.map((j) => j.getName() ?? "");
  const eyeJoints = jointNames.filter((n) => /^eye(\.L|\.R|L|R)?$/i.test(n) || /eye/i.test(n));

  // Iris texture: eye-mesh material carries a baseColorTexture (KG eyes-have-an-iris).
  let irisTextureBytes = 0;
  for (const m of meshes) {
    if (!/eye|globe|cornea/i.test(m.getName())) continue;
    for (const prim of m.listPrimitives()) {
      const img = prim.getMaterial()?.getBaseColorTexture()?.getImage();
      if (img && img.byteLength > irisTextureBytes) irisTextureBytes = img.byteLength;
    }
  }

  let trisEye = 0;
  for (const m of meshes) {
    if (!/eye|globe|cornea|lash/i.test(m.getName())) continue;
    for (const prim of m.listPrimitives()) {
      const idx = prim.getIndices();
      const count = prim.getAttribute("POSITION")?.getCount() ?? 0;
      trisEye += Math.round(idx ? idx.getCount() / 3 : count / 3);
    }
  }

  return {
    label,
    sha256: sha256File(glb),
    eyeMeshes,
    globeMeshes,
    corneaMeshes,
    lashMeshes,
    lashMorphs,
    shellMeshes,
    tearlineMeshes,
    cornerMeshes,
    eyeJoints,
    eyeFacs,
    eyeFacsPresent: EYE_FACS.filter((t) => allTargets.has(t)),
    irisTextureBytes,
    trisEye,
    morphMeshCount: Object.keys(morphByMesh).length,
  };
}

async function main(): Promise<void> {
  const rows = [await censusOne("realism", REALISM), await censusOne("control", CONTROL)];
  const out = {
    schema: "openclinxr.eyes-census.v1",
    control: CONTROL.replace(`${REPO}/`, ""),
    realismNote: "scratch bake (high-poly+cornea, iris-centred-d) + lash T2+A3; not git-tracked; sha recorded here",
    shellNote: "shell OFF for this proof (shell-rebind graded not shippable); absence recorded, not hidden",
    cornerNote: "corner-assets terminal not_found (eye-corner manifest 8bba4edd); absence recorded, not hidden",
    rows,
  };
  writeFileSync(join(HERE, "census.json"), `${JSON.stringify(out, null, 2)}\n`);
  for (const r of rows) {
    console.log(
      `${r.label}: sha=${r.sha256.slice(0, 8)} eyeMeshes=${r.eyeMeshes.length} globe=${r.globeMeshes.length} cornea=${r.corneaMeshes.length} lash=${JSON.stringify(r.lashMeshes)} lashMorphs=${JSON.stringify(Object.values(r.lashMorphs).map((v) => (v as string[]).length))} shell=${r.shellMeshes.length} tear=${r.tearlineMeshes.length} corner=${r.cornerMeshes.length} eyeJoints=${JSON.stringify(r.eyeJoints)} facs=${r.eyeFacsPresent.length}/6 irisTex=${r.irisTextureBytes} trisEye=${r.trisEye}`,
    );
  }
}

await main();
