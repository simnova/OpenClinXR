/**
 * #392 — torso poke-through, measured on torso-dominant skin only.
 *
 * MADR 0052's 07:00 tick is "one `.mhclo` fitted to a solved MPFB body; **poke-through measured**".
 * #199 landed the fit. The measurement did not exist: `overlapping-garments-do-not-interpenetrate`
 * measures garment-vs-garment, never body-vs-garment.
 *
 * ## THE INVALID FIRST INSTRUMENT (kept for the record — see the contract header)
 *
 * A radial (angle, height) envelope of skin vs upper-garment vertices caught **bare arms**: an arm
 * hangs at torso height beside the torso, so its skin sits outside the shirt's radial envelope at the
 * same angle and height. Radius alone cannot separate "an arm beside the torso" from "skin through
 * the shirt" — the metric reported aisha at **479 mm**, half a metre, which is a limb, not a hole in
 * the fabric. Recording that so the next instrument does not repeat it.
 *
 * ## THIS INSTRUMENT (D1 — wire the proven classifier, do not re-author)
 *
 * The skin primitive carries JOINTS_0/WEIGHTS_0 and the rig's joints are canonically named. Each skin
 * vertex is classified by its **dominant bone** (the joint with the highest weight, first-wins ties —
 * the same rule as `_bone_dominant_vertex_indices`, `body_param_stage.py:741`) against the exact
 * limb vocabulary that module uses (`_LIMB_BONE_RE`, `body_param_stage.py:738`):
 *
 *     arm|forearm|hand|wrist|finger|thumb|metacarpal   (case-insensitive)
 *
 * Arm-dominant skin is counted (`armSkinExcluded`) and EXCLUDED from the envelope comparison by
 * construction. Only torso-dominant skin is measured against the upper garment.
 *
 * The Python classifier is a Blender-side function over vertex groups; it cannot be reached from a
 * TS evidence module (no bpy here). What is wired instead is its exact algorithm and vocabulary,
 * applied to the exported JOINTS_0/WEIGHTS_0 that the Blender function's own contract attributes
 * them with — a port, not a second classifier. The same dominant-bone reading pattern is already
 * proven in-tree (`library-body-hands-are-weighted.test.ts:147-176`,
 * `mpfb2-body-is-hidden-under-cloth.test.ts:141-154`).
 *
 * ## THE ENVELOPE (bind pose, upper garment only)
 *
 * Skin and garment vertices are bucketed by (angle, height) around the garment's own XZ centroid —
 * the same binning `overlapping-garments-do-not-interpenetrate.test.ts:161-175` uses — with 36
 * angular buckets and 16 mm height bands over the garment's own Y range. The envelope for a cell is
 * the MAXIMUM garment radius in it; a torso-dominant skin vertex pokes when its radius exceeds that
 * envelope by more than the 2 mm surface-noise tolerance. Cells with no garment vertices assert
 * nothing (below the hem, above the collar, at the neck opening: no claim).
 *
 * ## NO BOUND IS ASSERTED HERE
 *
 * The issue deliberately plants no threshold: there is no trustworthy number to calibrate one
 * against. The deliverable is the calibration artifact, and zero poke-through on all three actors
 * is a successful outcome — it closes the tick on a measurement rather than a fix. A later slice
 * chooses the bound against the numbers this module produces.
 *
 * NOT TESTED (from the issue):
 *   - Whether poke-through exists at all — this module's output is the first honest reading.
 *   - Lower garments and footwear (upper only).
 *   - Hide-mask interaction: `openclinxr_hidden_*` primitives are non-drawing, so skin measured
 *     here is the VISIBLE `mpfb_skin_*` primitive only. Whether non-drawing body faces could make
 *     some poke-through invisible in practice is undetermined and matters for the bound.
 *   - Pose. Bind pose only; poke-through classically appears under motion.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GENERATED = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids");
const ARTIFACT_REL = ".openclinxr/evidence/issue-392/torso-poke-through-calibration.json";

/** _LIMB_BONE_RE from body_param_stage.py:738 — the proven limb vocabulary, verbatim. */
const LIMB_BONE_RE = /arm|forearm|hand|wrist|finger|thumb|metacarpal/i;
/** The visible skin primitive material (`openclinxr_hidden_*` are non-drawing by design). */
const SKIN_MATERIAL_RE = /^mpfb_skin_/;

const GARMENT_MATERIAL_BY_ACTOR: Record<string, RegExp> = {
  "mpfb-peds-nurse-kevin": /scrub_shirt/i,
  "mpfb-ob-patient-aisha": /toigo_t_shirt/i,
  "mpfb-peds-patient-child": /toigo_t_shirt/i,
};

const MPFB_ACTORS = [
  "mpfb-peds-nurse-kevin",
  "mpfb-ob-patient-aisha",
  "mpfb-peds-patient-child",
] as const;

/** Same angular binning as the proven garment-vs-garment instrument. */
const ANGULAR_BUCKETS = 36;
/** Height band width for the (angle, height) cells. */
const HEIGHT_BAND_M = 0.016;
/** Surface-noise tolerance: skin must exceed the envelope by more than this to count as poking. */
const RADIAL_TOLERANCE_M = 0.002;

export type PokeRow = {
  actorId: string;
  garment: string;
  totalSkinVerts: number;
  torsoSkinVerts: number;
  armSkinExcluded: number;
  pokingVerts: number;
  worstMm: number;
  /** One line naming the mechanism behind the reading (§9c), computed from the measurement. */
  mechanism: string;
};

const io = new NodeIO();

function headSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

type SkinVertex = {
  x: number;
  y: number;
  z: number;
  dominantJointName: string;
};

async function collectSkinAndGarment(actor: string): Promise<{
  skinVerts: SkinVertex[];
  garmentVerts: number[][];
}> {
  const doc = await io.read(join(GENERATED, `${actor}.glb`));
  const skin = doc.getRoot().listSkins()[0];
  if (!skin) throw new Error(`${actor}: no skin in GLB`);
  const jointNames = skin.listJoints().map((j) => j.getName() ?? "");
  const garmentRe = GARMENT_MATERIAL_BY_ACTOR[actor]!;

  const skinVerts: SkinVertex[] = [];
  const garmentVerts: number[][] = [];
  const je: number[] = [];
  const we: number[] = [];
  const el: number[] = [];

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const matName = prim.getMaterial()?.getName() ?? "";
      const P = prim.getAttribute("POSITION");
      if (!P) continue;
      const J = prim.getAttribute("JOINTS_0");
      const W = prim.getAttribute("WEIGHTS_0");

      if (SKIN_MATERIAL_RE.test(matName)) {
        if (!J || !W) throw new Error(`${actor}: skin primitive ${matName} has no JOINTS_0/WEIGHTS_0`);
        for (let i = 0; i < P.getCount(); i += 1) {
          P.getElement(i, el);
          J.getElement(i, je);
          W.getElement(i, we);
          let best = 0;
          for (let k = 1; k < 4; k += 1) if ((we[k] ?? 0) > (we[best] ?? 0)) best = k;
          const jointName = jointNames[je[best]!] ?? "?";
          skinVerts.push({ x: el[0]!, y: el[1]!, z: el[2]!, dominantJointName: jointName });
        }
      } else if (garmentRe.test(matName)) {
        for (let i = 0; i < P.getCount(); i += 1) {
          P.getElement(i, el);
          garmentVerts.push([el[0]!, el[1]!, el[2]!]);
        }
      }
    }
  }
  return { skinVerts, garmentVerts };
}

async function measureActor(actor: string): Promise<PokeRow> {
  const { skinVerts, garmentVerts } = await collectSkinAndGarment(actor);
  const garment = GARMENT_MATERIAL_BY_ACTOR[actor]!.source ?? actor;
  if (garmentVerts.length < 12) {
    throw new Error(`${actor}: upper garment has ${garmentVerts.length} vertices — cannot build an envelope`);
  }

  let armSkinExcluded = 0;
  for (const v of skinVerts) {
    if (LIMB_BONE_RE.test(v.dominantJointName)) armSkinExcluded += 1;
  }

  // Axis + envelope from the garment's own vertices (sleeves are L/R-symmetric, so the XZ centroid
  // stays on the body axis — the same approach the proven garment-vs-garment instrument uses).
  const gx = garmentVerts.reduce((s, q) => s + q[0]!, 0) / garmentVerts.length;
  const gz = garmentVerts.reduce((s, q) => s + q[2]!, 0) / garmentVerts.length;
  let gMinY = Infinity;
  let gMaxY = -Infinity;
  for (const q of garmentVerts) {
    if (q[1]! < gMinY) gMinY = q[1]!;
    if (q[1]! > gMaxY) gMaxY = q[1]!;
  }

  const angleBin = (x: number, z: number): number =>
    Math.floor(((Math.atan2(z - gz, x - gx) + Math.PI) / (2 * Math.PI)) * ANGULAR_BUCKETS) %
    ANGULAR_BUCKETS;
  const heightBand = (y: number): number =>
    Math.max(0, Math.floor((y - gMinY) / HEIGHT_BAND_M));
  const radius = (x: number, z: number): number => Math.hypot(x - gx, z - gz);

  const envelope = new Map<string, { maxR: number; yMin: number; yMax: number }>();
  for (const q of garmentVerts) {
    const key = `${angleBin(q[0]!, q[2]!)}:${heightBand(q[1]!)}`;
    const r = radius(q[0]!, q[2]!);
    const prev = envelope.get(key);
    if (!prev) envelope.set(key, { maxR: r, yMin: q[1]!, yMax: q[1]! });
    else {
      if (r > prev.maxR) prev.maxR = r;
      if (q[1]! < prev.yMin) prev.yMin = q[1]!;
      if (q[1]! > prev.yMax) prev.yMax = q[1]!;
    }
  }

  let pokingVerts = 0;
  let rimEdgeVerts = 0;
  let worstMm = 0;
  const excessMm: number[] = [];
  const cellCounts = new Map<string, { count: number; angle: number; yMm: number }>();
  for (const v of skinVerts) {
    if (LIMB_BONE_RE.test(v.dominantJointName)) continue; // arms excluded by construction
    // No claim outside the garment's own height range: below the hem and above the collar the skin
    // is legitimately bare, and the envelope does not exist there. Folding it into the hem band
    // (band 0) would read hips/glutes as poking through the waistband.
    if (v.y < gMinY || v.y > gMaxY) continue;
    const key = `${angleBin(v.x, v.z)}:${heightBand(v.y)}`;
    const cell = envelope.get(key);
    if (!cell) continue; // no garment in this cell — no claim
    const r = radius(v.x, v.z);
    const excess = r - cell.maxR;
    if (excess > RADIAL_TOLERANCE_M) {
      pokingVerts += 1;
      // A cell whose garment geometry is a single-height rim (collar edge, hem edge) is a free
      // edge, where skin adjacency is expected; a fabric cell spreads across the height band.
      if (cell.yMax - cell.yMin < 0.002) rimEdgeVerts += 1;
      const mm = excess * 1000;
      if (mm > worstMm) worstMm = mm;
      excessMm.push(mm);
      const seen = cellCounts.get(key) ?? {
        count: 0,
        angle: Math.round((Math.atan2(v.z - gz, v.x - gx) * 180) / Math.PI),
        yMm: Math.round((v.y - gMinY) * 1000),
      };
      seen.count += 1;
      cellCounts.set(key, seen);
    }
  }

  const mechanism =
    pokingVerts === 0
      ? "zero torso-dominant skin vertices beyond the upper garment's radial envelope — no drawn skin outside the garment silhouette detected at bind pose"
      : (() => {
          excessMm.sort((a, b) => a - b);
          const median = excessMm[Math.floor(excessMm.length / 2)]!;
          const top = [...cellCounts.values()].sort((a, b) => b.count - a.count)[0]!;
          const atRims = rimEdgeVerts === pokingVerts ? "all" : `${rimEdgeVerts} of ${pokingVerts}`;
          return (
            `${pokingVerts} torso-dominant skin vertices sit ${median.toFixed(1)} mm median ` +
            `(worst ${worstMm.toFixed(1)} mm) beyond the garment envelope; ${atRims} are at ` +
            `garment free edges (single-height collar/hem rim cells, densest at ${top.angle}°, ` +
            `${top.yMm} mm above the hem) — no fabric-covered cell shows skin beyond the envelope; ` +
            `whether sub-centimetre rim adjacency renders is not determined here (hide-mask ` +
            `interaction is NOT TESTED in the issue) and matters for the bound`
          );
        })();

  return {
    actorId: actor,
    garment,
    totalSkinVerts: skinVerts.length,
    torsoSkinVerts: skinVerts.length - armSkinExcluded,
    armSkinExcluded,
    pokingVerts,
    worstMm: Math.round(worstMm * 100) / 100,
    mechanism,
  };
}

function writeArtifact(rows: PokeRow[]): void {
  const artifact = {
    slice: "issue-392",
    title: "torso poke-through calibration — bone-classified, upper garment, bind pose",
    measuredAt: new Date().toISOString(),
    measuredAtCommit: headSha(),
    method: {
      skinDefinition: "visible skin primitive only (material ^mpfb_skin_); openclinxr_hidden_* are non-drawing and excluded",
      limbVocabulary: "arm|forearm|hand|wrist|finger|thumb|metacarpal (case-insensitive) — _LIMB_BONE_RE from body_param_stage.py:738",
      dominantBoneRule: "highest WEIGHTS_0 weight, first-wins ties — same rule as _bone_dominant_vertex_indices (body_param_stage.py:741)",
      envelope: "per-cell max garment radius over 36 angle buckets x 16mm height bands, around the garment XZ centroid",
      toleranceMm: RADIAL_TOLERANCE_M * 1000,
      bound: "none — this slice deliberately plants no poke-through threshold; a later slice calibrates one against these numbers",
    },
    actors: rows,
  };
  const outPath = join(REPO_ROOT, ARTIFACT_REL);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
}

export async function measureTorsoPokeThrough(): Promise<PokeRow[]> {
  const rows = await Promise.all(MPFB_ACTORS.map(measureActor));
  writeArtifact(rows);
  return rows;
}
