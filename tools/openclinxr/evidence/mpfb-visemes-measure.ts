/**
 * #353 pre-fix measurement — every MPFB actor a learner will speak to is mute.
 *
 * Runs BEFORE any product edit (issue #353: "FIRST MEASUREMENT"). Calls the real runtime
 * resolver (`resolveMorphTarget`, #308) against each shipped MPFB actor's actual morph
 * dictionary, and measures the mouth/lip/jaw targets with the #224 method (magnitude spread
 * + direction count) — coherence alone cannot separate a stub from a jaw-drop, and a target
 * that moves a handful of vertices by a millimetre is not a viseme shape whatever its name
 * suggests. This column decides the 1:1 viseme mapping.
 *
 * RUN:  pnpm exec tsx tools/openclinxr/evidence/mpfb-visemes-measure.ts
 * Writes: .openclinxr/evidence/mpfb-visemes/pre-fix.json (force-added)
 */
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
// Relative source import: `tools/` is outside the workspace package graph and cannot resolve
// `@openclinxr/asset-registry` by name. This is the SAME function the runtime calls (#308).
import { resolveMorphTarget } from "../../../packages/openclinxr/asset-registry/src/morph-target-resolver.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GENERATED = "apps/ui-xr/public/generated-humanoids";

/** The ARKit-style set the runtime asks for (`viseme-runtime-wire.ts` DIALOGUE_PHONEME_TO_ARKIT). */
const ARKIT_VISEMES = ["sil", "AA", "E", "IH", "OH", "OU", "FV", "TH", "L"] as const;

/** The three canonical runtime expression names (#308 + the deliberate cheek-tension null). */
const CANONICAL_EXPRESSIONS = [
  "openclinxr_mouth_open",
  "openclinxr_brow_concern",
  "openclinxr_cheek_tension",
] as const;

const isMouthTarget = (n: string): boolean => /mouth|lip|jaw/i.test(n);

const io = new NodeIO();

async function morphTargetNames(rel: string): Promise<Set<string>> {
  const doc = await io.read(join(REPO_ROOT, rel));
  const names = new Set<string>();
  for (const mesh of doc.getRoot().listMeshes()) {
    const extras = (mesh.getExtras() ?? {}) as { targetNames?: string[] };
    for (const t of extras.targetNames ?? []) names.add(t);
  }
  return names;
}

/**
 * Displacement statistics for one named morph, summed across every mesh and primitive
 * (the #224 method, same as `mouth-morph-resolves-on-mpfb-bodies.test.ts`).
 */
async function morphStats(
  rel: string,
  targetName: string,
): Promise<{ verticesMoved: number; magnitudeSd: number; distinctDirections: number; centroidY: number | null }> {
  const doc = await io.read(join(REPO_ROOT, rel));
  const magnitudes: number[] = [];
  const directions = new Set<string>();
  const delta: number[] = [];
  const position: number[] = [];

  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION")!;
      for (let i = 0; i < pos.getCount(); i += 1) {
        pos.getElement(i, position);
        if (position[1]! < minY) minY = position[1]!;
        if (position[1]! > maxY) maxY = position[1]!;
      }
    }
  }
  const stature = maxY - minY;
  let centroidSum = 0;

  for (const mesh of doc.getRoot().listMeshes()) {
    const extras = (mesh.getExtras() ?? {}) as { targetNames?: string[] };
    const index = (extras.targetNames ?? []).indexOf(targetName);
    if (index < 0) continue;
    for (const prim of mesh.listPrimitives()) {
      const target = prim.listTargets()[index];
      const positions = target?.getAttribute("POSITION");
      const base = prim.getAttribute("POSITION");
      if (!positions || !base) continue;
      for (let i = 0; i < positions.getCount(); i += 1) {
        positions.getElement(i, delta);
        const magnitude = Math.hypot(delta[0]!, delta[1]!, delta[2]!);
        if (magnitude <= 1e-5) continue;
        base.getElement(i, position);
        centroidSum += (position[1]! - minY) / stature;
        magnitudes.push(magnitude);
        directions.add(
          [delta[0]! / magnitude, delta[1]! / magnitude, delta[2]! / magnitude]
            .map((v) => v.toFixed(2))
            .join(","),
        );
      }
    }
  }

  if (magnitudes.length === 0) {
    return { verticesMoved: 0, magnitudeSd: 0, distinctDirections: 0, centroidY: null };
  }
  const mean = magnitudes.reduce((a, b) => a + b, 0) / magnitudes.length;
  const sd = Math.sqrt(magnitudes.reduce((a, b) => a + (b - mean) ** 2, 0) / magnitudes.length);
  return {
    verticesMoved: magnitudes.length,
    magnitudeSd: sd,
    distinctDirections: directions.size,
    centroidY: centroidSum / magnitudes.length,
  };
}

type MouthTargetStats = {
  verticesMoved: number;
  magnitudeSd: number;
  distinctDirections: number;
  centroidY: number | null;
};

async function main(): Promise<void> {
  const files = readdirSync(join(REPO_ROOT, GENERATED))
    .filter((n: string) => n.startsWith("mpfb-") && n.endsWith(".glb") && !/candidate/i.test(n))
    .map((n: string) => `${GENERATED}/${n}`)
    .sort();

  const actors = [];
  for (const rel of files) {
    const names = await morphTargetNames(rel);
    const allNames = [...names].sort();
    const mouthTargets = allNames.filter(isMouthTarget);
    const mouthStats: Record<string, MouthTargetStats> = {};
    for (const t of mouthTargets) {
      mouthStats[t] = await morphStats(rel, t);
    }
    actors.push({
      file: rel.split("/").pop(),
      morphCount: names.size,
      allTargetNames: allNames,
      mouthFacsTargets: mouthTargets.map((t) => ({
        name: t,
        ...mouthStats[t],
      })),
      resolvedVisemes: ARKIT_VISEMES.map((v) => ({
        name: `viseme_${v}`,
        target: resolveMorphTarget(`viseme_${v}`, names),
      })),
      resolvedCanonical: CANONICAL_EXPRESSIONS.map((c) => ({
        name: c,
        target: resolveMorphTarget(c, names),
      })),
    });
  }

  const artifact = {
    schemaVersion: "openclinxr.mpfb-visemes.pre-fix.v1",
    measuredAt: new Date().toISOString(),
    note:
      "Pre-fix measurement for #353, taken before any product edit. Resolution via the real runtime " +
      "resolver (resolveMorphTarget, #308). Mouth-target stats use the #224 method: verticesMoved = " +
      "vertices displaced >1e-5 m summed across all meshes/primitives; magnitudeSd = sd of per-vertex " +
      "displacement magnitudes; distinctDirections = distinct unit directions rounded to 2dp; " +
      "centroidY = displaced-vertex centroid as a fraction of stature.",
    actors,
  };

  const outPath = `${REPO_ROOT}/.openclinxr/evidence/mpfb-visemes/pre-fix.json`;
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(`PRE-FIX ${outPath}`);

  for (const a of actors) {
    console.log(`\n${a.file} (${a.morphCount} morphs, ${a.mouthFacsTargets.length} mouth/lip/jaw):`);
    for (const v of a.resolvedVisemes) {
      console.log(`  ${v.name.padEnd(10)} -> ${String(v.target).padEnd(28)}`);
    }
    for (const c of a.resolvedCanonical) {
      console.log(`  ${c.name.padEnd(10)} -> ${String(c.target).padEnd(28)}`);
    }
    for (const m of a.mouthFacsTargets) {
      const s = m;
      console.log(
        `  MOUTH ${m.name.padEnd(34)} verts=${String(s.verticesMoved).padStart(6)} sd=${s.magnitudeSd.toFixed(5)} dirs=${String(s.distinctDirections).padStart(4)} cy=${s.centroidY === null ? "-" : s.centroidY.toFixed(4)}`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
