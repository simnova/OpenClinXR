import { describe, expect, it } from "vitest";
import { NodeIO } from "@gltf-transform/core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REAL_EQUIPMENT_GLTF_BY_ID } from "../../../apps/ui-xr/src/station-equipment.js";
import { measureParametricComposite } from "../../../apps/ui-xr/src/station-equipment-composite-measure.js";
import {
  aspectToleranceFor,
  measureGltfAssetLocalBounds,
} from "./equipment-aspect-preservation.js";

/**
 * PLANTED CONTRACTS (#140) — every station's shipped manifest declares the clinical equipment that
 * belongs in that room, and the runtime mounts two hardcoded ED items regardless.
 *
 * TWO REDs FLIP. The third is a COUNTERWEIGHT — the ED bay's ECG cart and IV pole must keep their
 * real GLBs. It is `it.fails` only because the module is absent.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THIS IS THE SIXTH INSTANCE OF THE SAME PATTERN
 *
 * `#106` conversation surface, `#107` cast identity, `#114` station identity, `#122` actor slots,
 * `#127` the chart — each removed a hardcoded ED assumption from one surface. This is the same
 * shape in the equipment mount, and it is the one a learner sees as an empty room.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT, MEASURED — verified against the shipped manifests, do not re-derive
 *
 * `apps/ui-xr/public/xr-assets/generated/<scenarioId>/scene-manifest.v1.json` — the JSON the runtime
 * actually fetches (`main.ts:1138`) — already carries per-station equipment:
 *
 *     ed_stroke_alert_handoff_v1            wall_clock_equipment, bedside_monitor_equipment
 *     ob_headache_preeclampsia_triage_v1    fetal_monitor_equipment, blood_pressure_cuff_equipment
 *     clinic_abdominal_pain_interpreter_v1  exam_table_equipment, abdominal_exam_zone_equipment
 *     ed_chest_pain_priority_v1             (none — the ED slots are hardcoded instead)
 *
 * `main.ts:3455-3490` mounts exactly two: `ecgCartRuntimeAsset` and the IV stand, from module-level
 * `let` bindings, for every station.
 *
 * So a stroke station declares a wall clock and a bedside monitor and renders neither, while an ECG
 * cart it never asked for is mounted in the room.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * ONLY TWO REAL EQUIPMENT GLBs EXIST — and that is the interesting half
 *
 *     apps/ui-xr/public/xr-assets/medical-equipment/ecg-cart-12-lead.glb   288 tris
 *     apps/ui-xr/public/xr-assets/medical-equipment/iv-pole-with-pump.glb  144 tris
 *
 * Everything else the manifests declare has no geometry. A research consult was explicit that for
 * this class of object — a wall clock, a monitor bezel, a sharps bin, an IV pole — a **parametric
 * builder beats image-to-3D on quality, determinism, budget and repeatability**, and that the
 * permissively-licensed image-to-3D options either do not run headless on Apple Silicon or carry
 * revenue/territory gates. `station-chair.ts` and `station-stretcher.ts` are the proven pattern in
 * this repo: a descriptor drives a TypeScript builder that returns a Group.
 *
 * **AI is not the tool for these shapes.** Where it does belong later is textures on parametric
 * geometry, from a fixed seed and a fixed prompt — a deterministic block, not a mesh generator.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message with what you rejected.
 *  - Which equipment kinds get a parametric builder in this slice. You do not have to do all of them;
 *    a generic fallback that is visibly better than a scaled cube is acceptable for the tail, and
 *    saying which you covered is more useful than covering all badly.
 *  - Whether the two existing GLBs are mounted by id from the manifest, or stay on their current
 *    hardcoded path with the manifest driving only the new kinds. The first is cleaner; the second
 *    is smaller. Both are defensible.
 *  - Where a builder's dimensions come from. A wall clock is not a design decision, but the numbers
 *    have to live somewhere — say where and why.
 *  - Whether an equipment id with neither a GLB nor a builder renders a fallback or nothing at all.
 *    Rendering nothing is honest; rendering a labelled placeholder is more useful to a learner. I
 *    have no strong view and this is the kind of thing that should not be decided silently.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE THREE PULL APART
 *
 * (1) demands each station mount what it declares, and is satisfiable by mounting a scaled cube for
 * every id. (2) forbids that by requiring known kinds to be more than a single box. (3) is green
 * today and forbids buying either by dropping the two real GLBs the ED bay already renders.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectDeclaredEquipmentMounting()`. What must
 * not change: stations are enumerated from the SHIPPED manifests under
 * `apps/ui-xr/public/xr-assets/generated/`, and mounted objects are read from the LIVE scene, not
 * from the mount function in isolation.
 *
 * REQUIRED, the observable half: re-capture `ed_stroke_alert_handoff_v1` and
 * `ob_headache_preeclampsia_triage_v1` and say what is in each room. Reuse
 * `tools/openclinxr/evidence/ui-xr-environment-room-capture.ts`; do not write a fourth capture
 * script. After the first successful run, re-run it twice more with FORCE_COLOR=1 and require both
 * to regenerate the artifacts.
 *
 * IN-SCOPE VISUAL, as separate slots you must fill:
 *     IN-SCOPE VISUAL: stroke room ___ ; OB room ___ ; ED bay unchanged ___ ; anything now broken ___
 * and: CONTRACT_MET_VISUAL: reads_as_a_clinical_room | improved_not_clinical | still_boxes | other:<text>
 *
 * IF ANY PROOF CANNOT PASS AS WRITTEN, OR PASSES TRIVIALLY AGAINST THE OBSERVED RANGE, OR ASSERTS
 * THE OPPOSITE DIRECTION FROM THE DEFECT, SAY SO IN YOUR REPORT.
 *
 * If satisfying a contract here will make the product visibly worse than before, say so in your
 * report and then satisfy it anyway. Naming it is not disobedience.
 *
 * SCOPE: whether a station renders the clinical equipment its own manifest declares. Says NOTHING
 * about room props (#139, the cue-placeholder labels), the environment shell, or whether any piece
 * of equipment is clinically correct for the scenario — that needs a clinician.
 */

/* ════════════════════════════════════════════════════════════════════════════════
 * ## FIXED (#258) — placement was never verified; a triangle count is blind to WHERE
 *
 * The #253 contract above proves 60,000 source triangles reach the scene. It does not
 * prove the mount lands where its descriptor says. #258 graded `ed_stroke_alert_handoff_v1`
 * on main after #253: the generated bedside monitor rendered at FLOOR LEVEL, oversized and
 * clipped by the bottom viewport edge, overlapping the family member's feet.
 *
 * Measured (issue-258/pre-fix.json, live scene + file):
 *     bedside_monitor_equipment   placement (0.95, 0, 0.98)  asset-local y∈[-0.403, +0.402]
 *         → world AABB y∈[-0.403, +0.402]: the object-centered TRELLIS GLB was dropped at
 *         y=0, half-buried below the floor. The descriptor was authored against the
 *         parametric builder's FLOOR-STANDING convention (base on floor, content above).
 *     wall_clock_equipment        placement (-2.4, 1.55, -1.15)  asset-local y∈[-0.465, +0.464]
 *         → world AABB y∈[1.085, 2.014]: correct — placement y=1.55 is the ELEVATED
 *         mount-height convention where origin-centering is right (the control).
 *
 * Fix: the mount path now normalizes a gltf-sourced mount to the placement descriptor's
 * convention — floor placements (|Y| < 0.05) ground the object by its measured local
 * min-Y; elevated placements stay origin-centered (wall clock untouched). General
 * convention adapter, not a per-asset placement fudge. The contract below ("lands within
 * the placement envelope") is the gate that would have caught this class.
 *
 * #258 FIXED 2026-08-10 — new placement-envelope contract added below.
 */

/* ════════════════════════════════════════════════════════════════════════════
 * ## FIXED (#260) — the vertical envelope, not just the floor plane
 *
 * #258 grounded the object-centered bedside-monitor GLB on its floor placement,
 * which fixed the half-buried case and left the monitor body AT FLOOR LEVEL —
 * roughly waist height to the standing actors, occluding the nurse's legs. The
 * parametric composite that GLB replaced emitted base + pole + body: the
 * descriptor's floor placement (y=0) is base-on-floor, with the WORKING HEIGHT
 * supplied by the composite's own stand geometry. Substituting a single GLB
 * mesh for the whole composite silently dropped the stand (measured,
 * issue-260/pre-fix.json):
 *
 *     bedside_monitor_equipment  parametric composite y∈[0, 1.19]  (4 meshes:
 *                                base, pole, bezel, screen) — content top 1.19 m
 *                                GLB path world y∈[0, 0.805] (1 mesh) — content
 *                                top 0.805 m, the pole+base are GONE
 *     wall_clock_equipment       parametric composite y∈[-0.18, +0.18]
 *                                (origin-centered, no stand); GLB world
 *                                y∈[1.085, 2.014] at placement y=1.55 — correct
 *                                elevated mount, the CONTROL
 *
 * Fix: the mount path keeps the parametric STAND for composite ids (MADR 0050
 * step 10 hybrid — a generated body with a parametric stand) and rests the GLB
 * body's base on the stand top, so the monitor is at chest height again instead
 * of the floor. The contract below ("lands within the vertical envelope its
 * descriptor declares") is the gate that would have caught this class: for a
 * gltf-sourced mount at a FLOOR placement whose id has a DEDICATED composite
 * parametric builder, the mount's world AABB max-Y must reach the composite's
 * content top at that placement, within WORKING_HEIGHT_SAG_M. The wall clock is
 * elevated and exempt — it must keep passing unchanged.
 *
 * WORKING_HEIGHT_SAG_M = 0.25: the composite's content band (the bezel) is
 * ~0.28 m tall; a body whose top is within 0.25 m of the composite's top still
 * occupies the working-height band. The pre-fix floor-level body sat 0.385 m
 * below the composite top — more than a full content band lower. Staging
 * heuristic, not anatomy; residual named in NOT TESTED.
 *
 * #260 FIXED 2026-08-10 — vertical-envelope contract added below.
 */

/* ════════════════════════════════════════════════════════════════════════
 * ## FIXED (#266) — the footprint envelope, the scale half of #258
 *
 * #258 grounded the object-centered monitor GLB (translate only). The same
 * GLBs are also UNIT-NORMALIZED by the bake pipeline — bedside-monitor-
 * generated.glb spans exactly ±0.5 on x/z (1.00 m wide) — and nothing
 * rescaled them to the footprint the placement descriptor was authored
 * against (the parametric composite it replaced: 0.38 × 1.19 × 0.22).
 * Measured (issue-266/pre-fix.json, live scene + file):
 *
 *     bedside_monitor_equipment  composite envelope x/z 0.38 × 0.22
 *                                GLB local bounds x/z   1.00 × 1.00
 *                                → world x∈[0.45,1.45] z∈[0.48,1.48]
 *     → renders 2.6× the width of the object it replaced and occludes two
 *       actors in ed_stroke_alert_handoff_v1 (wall clock control: elevated,
 *       correctly mounted, must stay unchanged).
 *
 * Fix: the mount path now fits a gltf-sourced FLOOR mount's footprint to its
 * declared placement envelope — the id's parametric composite total AABB —
 * by scaling the GLB per-axis (shrink-only) before the #258 grounding and
 * #260 stand passes run. General convention adapter, not a per-asset fudge:
 * no per-equipment constants beyond the composite footprint. Elevated mounts
 * (wall clock) and ids without a dedicated composite (ED bay library GLBs)
 * are untouched. The contract below ("world extent within the declared
 * envelope") is the gate that would have caught this class.
 *
 * #266 FIXED 2026-08-10 — footprint-envelope contract added below.
 */

/* ════════════════════════════════════════════════════════════════════
 * ## FIXED (#268) — uniform scale; the #266 fit squashed the aspect
 *
 * #266's per-axis fit scaled X and Z independently and left Y alone, which
 * SQUASHED a generated GLB's aspect. Measured (issue-268/pre-fix.json, live
 * scene + file):
 *
 *     bedside_monitor_equipment  source aspect 1.242 (1.00 × 0.805)
 *                                → mounted 0.472 (0.38 × 0.81, Y untouched)
 *                                → relative aspect deviation 0.62
 *     wall_clock_equipment (CONTROL)  source 1.076 → mounted 1.076, dev 0
 *     ecg_cart / iv_stand (ED bay)    dev 0 — untouched, node-transformed
 *                                aspect preserved by the mount path
 *
 * A landscape monitor screen rendered portrait. Fix: the footprint fit now
 * applies a SINGLE uniform factor on all three axes (the largest that keeps
 * the mesh inside its declared envelope) — aspect is preserved, the asset gets
 * smaller, never stretched. The contract below ("mounted aspect equals source
 * aspect within a derived tolerance") is the gate that would have caught this
 * class; its tolerance is derived from the pipeline's 1 mm rounding, validated
 * by the control row (dev 0.000), not fitted to the observation.
 *
 * #268 FIXED 2026-08-10 — aspect-preservation contract added below.
 */

const load = async () => import("./declared-equipment-mounted.js") as Promise<Record<string, unknown>>;

const EQUIPMENT_GLB_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../apps/ui-xr/public/xr-assets/medical-equipment",
);

/**
 * Read the shipped GLB files the runtime actually loads and count their source
 * triangles. The #245 band is derived from these measured files (the control
 * rows), not from an invented number — ecg-cart-12-lead.glb = 288, iv-pole-with-
 * pump.glb = 144, wall-clock-analog.glb = 34,507.
 */
async function measureSourceGltfTriangleCounts(): Promise<Record<string, number>> {
  const io = new NodeIO();
  const out: Record<string, number> = {};
  for (const [equipmentId, fileName] of Object.entries(REAL_EQUIPMENT_GLTF_BY_ID)) {
    const doc = await io.read(path.join(EQUIPMENT_GLB_DIR, fileName));
    let tris = 0;
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const idx = prim.getIndices();
        const pos = prim.getAttribute("POSITION");
        tris += idx ? Math.floor(idx.getCount() / 3) : pos ? Math.floor(pos.getCount() / 3) : 0;
      }
    }
    out[equipmentId] = tris;
  }
  return out;
}

type MountedEquipment = {
  equipmentId: string;
  /** "gltf" when a real GLB loaded, "parametric" when a builder produced geometry, "none" when absent. */
  source: "gltf" | "parametric" | "fallback" | "none";
  /** Triangles the mounted object contributes in the live scene. */
  triangleCount: number;
  /** Meshes under the mounted root. A single scaled cube is 1. */
  meshCount: number;
  /**
   * #245 — geometry after waiting for every scene asset to resolve (re-sample).
   * When set, the first sample was taken before the GLB finished loading (§10m);
   * the post-load reading is the honest one.
   */
  triangleCountAfterLoad?: number;
  meshCountAfterLoad?: number;
  /** #258 — live world-space AABB of the mounted root's visible geometry. */
  worldAabbMin?: { x: number; y: number; z: number };
  worldAabbMax?: { x: number; y: number; z: number };
  /** #268 — live world-space AABB of the mounted root's GLB body only (parametric stand excluded). */
  worldBodyAabbMin?: { x: number; y: number; z: number };
  worldBodyAabbMax?: { x: number; y: number; z: number };
};

type StationEquipment = {
  scenarioId: string;
  /** Equipment ids in the SHIPPED scene manifest for this station. */
  declaredEquipmentIds: string[];
  /** #258 — declared placement positions from the shipped manifest's equipmentPlacements. */
  declaredPlacements: Record<string, { x: number; y: number; z: number }>;
  mounted: MountedEquipment[];
  /** Ids mounted in the live scene that the manifest never declared. */
  undeclaredMountedIds: string[];
};

type Inspect = () => Promise<{ stations: StationEquipment[] }>;

/** A recognisable clinical object is more than one box. Deliberately low — this is a floor, not a target. */
const MIN_MESHES_FOR_A_KNOWN_KIND = 2;

/** Kinds a learner should recognise. Named because the manifests name them, not because I chose them. */
const KNOWN_KINDS = [
  "wall_clock_equipment",
  "bedside_monitor_equipment",
  "fetal_monitor_equipment",
  "exam_table_equipment",
];

const ED = "ed_chest_pain_priority_v1";

describe("a station renders the equipment it declares (#140)", () => {
  it("every declared equipment id is mounted in the station that declares it", async () => {
    // ed_stroke_alert_handoff_v1 declares a wall clock and a bedside monitor and renders neither,
    // because main.ts:3455-3490 mounts two module-level ED assets for every station.
    const mod = await load();
    const inspect = mod["inspectDeclaredEquipmentMounting"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.stations.length, `only ${report.stations.length} stations enumerated`).toBeGreaterThan(8);

    const missing: string[] = [];
    for (const s of report.stations) {
      const mountedIds = new Set(s.mounted.filter((m) => m.source !== "none").map((m) => m.equipmentId));
      for (const id of s.declaredEquipmentIds) {
        if (!mountedIds.has(id)) missing.push(`${s.scenarioId}: declares ${id} and renders nothing`);
      }
    }
    expect(missing, `declared equipment that never reaches the room:\n${missing.join("\n")}`).toHaveLength(0);
  }, 900_000);

  it("a recognisable kind is more than one scaled cube", async () => {
    // Kills the cheap satisfaction of the first contract: mounting a BoxGeometry per id satisfies
    // "mounted" and leaves the room reading as coloured boxes, which is what it does today.
    const mod = await load();
    const inspect = mod["inspectDeclaredEquipmentMounting"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const cubes: string[] = [];
    for (const s of report.stations) {
      for (const m of s.mounted) {
        if (!KNOWN_KINDS.includes(m.equipmentId)) continue;
        if (m.source === "none") continue;
        if (m.meshCount < MIN_MESHES_FOR_A_KNOWN_KIND) {
          cubes.push(`${s.scenarioId}/${m.equipmentId}: ${m.meshCount} mesh, source=${m.source}`);
        }
      }
    }
    expect(cubes, `known kinds still rendering as a single box:\n${cubes.join("\n")}`).toHaveLength(0);
  }, 900_000);

  it("the ED bay keeps its real equipment GLBs (COUNTERWEIGHT)", async () => {
    // The two assets that already have real geometry — ecg-cart-12-lead.glb (288 tris) and
    // iv-pole-with-pump.glb (144 tris). A rewrite of the mount path must not cost them.
    const mod = await load();
    const inspect = mod["inspectDeclaredEquipmentMounting"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const ed = report.stations.find((s) => s.scenarioId === ED);
    expect(ed, "the ED bay was not enumerated").toBeDefined();

    const fromGltf = ed!.mounted.filter((m) => m.source === "gltf");
    expect(fromGltf.length, "the ED bay stopped loading real equipment GLBs").toBeGreaterThanOrEqual(2);
    for (const m of fromGltf) {
      expect(m.triangleCount, `${m.equipmentId} mounted with no geometry`).toBeGreaterThan(50);
    }
  }, 900_000);

  it("a gltf-sourced equipment mounts within an order of magnitude of its source file's count (#245)", async () => {
    // #245 — the wall clock resolved as gltf but only the hidden placeholder reached
    // the scene (26 triangles vs 34,507 in wall-clock-analog.glb). The suppression
    // gate in main.ts allowlisted only the two original library GLBs, so the promoted
    // real GLB was treated as a scenario-mismatched placeholder and never attached.
    // Band: [source/10, source×10], derived from the measured control rows — the two
    // known-good GLBs mount 666t vs 288t and 522t vs 144t (2.3-3.6×), so an order of
    // magnitude covers both while still failing a 26-triangle placeholder.
    // Reading: m.triangleCount is the SETTLED mounted state — the probe now waits for
    // every medical-equipment asset to reach loaded/failed before its first sample
    // (#253; before that fix the 8.4 MB monitor was still pending at the sample
    // instant and read as the #245 signature 3m/26t even though the GLB attached).
    const mod = await load();
    const inspect = mod["inspectDeclaredEquipmentMounting"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const sourceTriCount = await measureSourceGltfTriangleCounts();
    const offenders: string[] = [];
    for (const s of report.stations) {
      for (const m of s.mounted) {
        if (m.source !== "gltf") continue;
        const sourceCount = sourceTriCount[m.equipmentId];
        if (sourceCount === undefined) continue;
        if (m.triangleCount < sourceCount / 10 || m.triangleCount > sourceCount * 10) {
          offenders.push(`${s.scenarioId}/${m.equipmentId}: mounted ${m.triangleCount}t vs source ${sourceCount}t`);
        }
      }
    }
    expect(offenders, `gltf equipment outside an order of magnitude of its source geometry:\n${offenders.join("\n")}`).toHaveLength(0);
  }, 900_000);

  it("bedside_monitor_equipment mounts with source gltf at ~60k triangles in EVERY declaring station (#253)", async () => {
    // #253 — the bedside monitor (60,000 source tris) follows the #244 wall-clock wiring.
    // Source alone is what let #245 through: resolution flipped to gltf while only the
    // 26-triangle placeholder reached the scene. The count is the proof that matters.
    // Band: [6000, 600000] — an order of magnitude of the 60,000-triangle promoted GLB,
    // so a suppressed 2-mesh placeholder (24 tris) fails while the loaded GLB passes.
    // The assertion covers EVERY station that declares bedside_monitor_equipment
    // (enumerated from the shipped manifests, not a hardcoded list). ed_stroke_alert_handoff_v1
    // and adult_abdominal_pain_v1 both declare it; a station whose GLB never attaches
    // reports the placeholder (3m/26t) as its settled state and FAILS this assertion.
    const mod = await load();
    const inspect = mod["inspectDeclaredEquipmentMounting"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const declaring = report.stations.filter((s) => s.declaredEquipmentIds.includes("bedside_monitor_equipment"));
    expect(declaring.length, "no station declares bedside_monitor_equipment").toBeGreaterThan(0);

    const failures: string[] = [];
    for (const s of declaring) {
      const m = s.mounted.find((row) => row.equipmentId === "bedside_monitor_equipment");
      if (!m) {
        failures.push(`${s.scenarioId}: no mounted row for bedside_monitor_equipment`);
        continue;
      }
      if (m.source !== "gltf") {
        failures.push(`${s.scenarioId}: source=${m.source}, expected gltf`);
      }
      if (m.triangleCount < 6000 || m.triangleCount > 600000) {
        failures.push(`${s.scenarioId}: mounted ${m.triangleCount}t, expected within [6000, 600000] of a 60,000t source GLB`);
      }
    }
    expect(failures, `bedside_monitor_equipment not rendering the real GLB:\n${failures.join("\n")}`).toHaveLength(0);
  }, 900_000);

  it("a gltf-sourced equipment mount lands within the placement envelope its descriptor declares (#258)", async () => {
    // #258 — #253 proved the bedside monitor's 60,000 source triangles reach the scene
    // in every declaring station but never verified WHERE they land (its own close:
    // "NOT TESTED: pixel grade in-station"; the same residual was named at #244 and
    // bit twice). The TRELLIS GLB is object-centered — asset-local bounds
    // y∈[-0.403, +0.402] — while its placement descriptor declares y=0, the parametric
    // builder's FLOOR-STANDING convention (base on the floor, content above origin).
    // The mount dropped the origin-centered GLB at y=0, so the monitor sat half-buried
    // below the floor plane, oversized in-frame and clipped by the viewport edge.
    //
    // The wall clock is the CONTROL: its placement y=1.55 is an ELEVATED mount-height
    // convention (same parametric builders that stamp
    // openClinXrEquipmentLocalYPolicy = "origin_centered_mount_height_from_placement_root"),
    // where origin-centering is correct. It must keep passing here.
    //
    // Two halves:
    //  - burial: no gltf mount's world AABB may extend below the floor plane. This is
    //    the load-bearing check (pre-fix the monitor min-Y = -0.403; also the ED bay's
    //    ecg-cart and iv-pole GLBs, which are object-centered at floor placements).
    //  - envelope: when the manifest declares a placement for the id, the declared
    //    position must lie within the mount's world AABB (the object is where its
    //    descriptor says it is, within its own bulk).
    const mod = await load();
    const inspect = mod["inspectDeclaredEquipmentMounting"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const FLOOR_TOLERANCE_M = 0.05;
    const unmeasured: string[] = [];
    const buried: string[] = [];
    const offEnvelope: string[] = [];
    for (const s of report.stations) {
      for (const m of s.mounted) {
        if (m.source !== "gltf") continue;
        if (!m.worldAabbMin || !m.worldAabbMax) {
          unmeasured.push(`${s.scenarioId}/${m.equipmentId}: no live world AABB`);
          continue;
        }
        if (m.worldAabbMin.y < -FLOOR_TOLERANCE_M) {
          buried.push(`${s.scenarioId}/${m.equipmentId}: world min-Y ${m.worldAabbMin.y.toFixed(3)}m below floor plane`);
        }
        const placement = s.declaredPlacements[m.equipmentId];
        if (placement) {
          const inX = placement.x >= m.worldAabbMin.x - FLOOR_TOLERANCE_M
            && placement.x <= m.worldAabbMax.x + FLOOR_TOLERANCE_M;
          const inZ = placement.z >= m.worldAabbMin.z - FLOOR_TOLERANCE_M
            && placement.z <= m.worldAabbMax.z + FLOOR_TOLERANCE_M;
          const inY = placement.y >= m.worldAabbMin.y - FLOOR_TOLERANCE_M
            && placement.y <= m.worldAabbMax.y + FLOOR_TOLERANCE_M;
          if (!inX || !inZ || !inY) {
            offEnvelope.push(
              `${s.scenarioId}/${m.equipmentId}: declared (${placement.x},${placement.y},${placement.z}) outside live world AABB`,
            );
          }
        }
      }
    }
    expect(unmeasured, `gltf mounts with no live world AABB:\n${unmeasured.join("\n")}`).toHaveLength(0);
    expect(buried, `gltf equipment buried below the floor plane:\n${buried.join("\n")}`).toHaveLength(0);
    expect(offEnvelope, `gltf equipment outside its declared placement envelope:\n${offEnvelope.join("\n")}`).toHaveLength(0);
  }, 900_000);

  it("a gltf-sourced equipment mount lands within the vertical envelope its descriptor declares (#260)", async () => {
    // #260 — the #258 contract above proves a gltf mount is not buried and sits
    // within its declared placement's X/Y/Z box, but it is BLIND to the vertical
    // position of the CONTENT. The bedside-monitor composite this GLB replaced
    // emitted base + pole + body (local y∈[0, 1.19]): the descriptor's floor
    // placement (y=0) is base-on-floor, with the working height supplied by the
    // composite's own stand geometry. Substituting a single GLB mesh for the
    // whole composite dropped the stand, so the monitor body (world y∈[0, 0.805])
    // landed at the standing actors' leg height instead of chest height — while
    // passing every #258 check.
    //
    // The vertical envelope a floor placement declares is the composite's
    // content top at that placement. For a gltf-sourced mount whose id has a
    // DEDICATED composite parametric builder, the mount's world AABB max-Y must
    // reach it within WORKING_HEIGHT_SAG_M. The wall clock is the CONTROL: its
    // placement (y=1.55) is ELEVATED, so it is exempt from this floor rule and
    // keeps the #258 semantics — it must keep passing here.
    const mod = await load();
    const inspect = mod["inspectDeclaredEquipmentMounting"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const FLOOR_TOLERANCE_M = 0.05;
    const WORKING_HEIGHT_SAG_M = 0.25;
    const sagging: string[] = [];
    for (const s of report.stations) {
      for (const m of s.mounted) {
        if (m.source !== "gltf") continue;
        if (!m.worldAabbMin || !m.worldAabbMax) continue;
        const placement = s.declaredPlacements[m.equipmentId];
        if (!placement) continue;
        if (Math.abs(placement.y) >= FLOOR_TOLERANCE_M) continue; // elevated → #258 semantics
        const composite = measureParametricComposite(m.equipmentId);
        if (composite.source !== "parametric") continue; // fallback-only ids have no composite to preserve
        if (composite.totalAabbMin.y < -FLOOR_TOLERANCE_M) continue; // origin-centered composite, not base-on-floor
        const contentTop = placement.y + composite.totalAabbMax.y;
        if (m.worldAabbMax.y < contentTop - WORKING_HEIGHT_SAG_M) {
          sagging.push(
            `${s.scenarioId}/${m.equipmentId}: world max-Y ${m.worldAabbMax.y.toFixed(3)}m below composite content top ${contentTop.toFixed(3)}m (sag ${(contentTop - m.worldAabbMax.y).toFixed(3)}m > ${WORKING_HEIGHT_SAG_M}m)`,
          );
        }
      }
    }
    expect(
      sagging,
      `gltf floor mounts not reaching the composite's working height (the stand was dropped):\n${sagging.join("\n")}`,
    ).toHaveLength(0);
  }, 900_000);

  it("a gltf-sourced equipment mount's world extent falls within its declared placement envelope (#266)", async () => {
    // #266 — a generated equipment GLB is unit-normalized by the bake pipeline
    // (bedside-monitor-generated.glb spans exactly ±0.5 on x/z → 1.00 m wide)
    // and nothing in the mount path rescaled it to the footprint the placement
    // descriptor was authored against. Measured pre-fix (issue-266/pre-fix.json):
    //     bedside_monitor_equipment  composite 0.38 × 1.19 × 0.22
    //                               GLB local 1.00 × 0.805 × 1.00
    //                               → world   x∈[0.45,1.45] z∈[0.48,1.48]
    //     → renders 2.6× the width of the object it replaced and occludes two
    //       actors in ed_stroke_alert_handoff_v1. #258 fixed the object-centered
    //       TRANSLATE (grounding); this contract is the SCALE half — a gltf
    //       floor mount must fit within its declared footprint envelope.
    //
    // The wall clock is the CONTROL: its placement (y=1.55) is ELEVATED — an
    // elevated wall mount has no floor footprint to fit, and its 1.00 m world
    // width is the accepted pre-existing mount (it must keep passing unchanged).
    // ED bay library GLBs (ecg cart / IV pole) have no dedicated composite
    // envelope (they resolve to the generic fallback) and are exempt.
    const mod = await load();
    const inspect = mod["inspectDeclaredEquipmentMounting"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const FLOOR_TOLERANCE_M = 0.05;
    const FIT_TOLERANCE_M = 0.05;
    const oversized: string[] = [];
    for (const s of report.stations) {
      for (const m of s.mounted) {
        if (m.source !== "gltf") continue;
        if (!m.worldAabbMin || !m.worldAabbMax) continue;
        const placement = s.declaredPlacements[m.equipmentId];
        if (!placement) continue;
        if (Math.abs(placement.y) >= FLOOR_TOLERANCE_M) continue; // elevated → control
        const composite = measureParametricComposite(m.equipmentId);
        if (composite.source !== "parametric") continue; // no composite envelope to fit
        if (composite.totalAabbMin.y < -FLOOR_TOLERANCE_M) continue; // origin-centered composite, no floor footprint
        const envelopeWidth = composite.totalAabbMax.x - composite.totalAabbMin.x;
        const envelopeDepth = composite.totalAabbMax.z - composite.totalAabbMin.z;
        const worldWidth = m.worldAabbMax.x - m.worldAabbMin.x;
        const worldDepth = m.worldAabbMax.z - m.worldAabbMin.z;
        if (worldWidth > envelopeWidth + FIT_TOLERANCE_M || worldDepth > envelopeDepth + FIT_TOLERANCE_M) {
          oversized.push(
            `${s.scenarioId}/${m.equipmentId}: world ${worldWidth.toFixed(3)}×${worldDepth.toFixed(3)}m `
              + `vs declared envelope ${envelopeWidth.toFixed(3)}×${envelopeDepth.toFixed(3)}m`,
          );
        }
      }
    }
    expect(
      oversized,
      `gltf equipment world extent outside its declared placement envelope (unit-normalized GLB not fitted):\n${oversized.join("\n")}`,
    ).toHaveLength(0);
  }, 900_000);

  it("a gltf-sourced equipment mount preserves its source aspect ratio within a derived tolerance (#268)", async () => {
    // #268 — #266 fitted the footprint per-axis (X and Z scaled independently,
    // Y untouched), which SQUASHED the aspect: the landscape bedside monitor
    // (source 1.00 × 0.81, aspect 1.23) rendered portrait (0.38 × 0.81, aspect
    // 0.47). Measured pre-fix (issue-268/pre-fix.json):
    //     bedside_monitor_equipment  source aspect 1.242 → mounted 0.472
    //                                relative deviation 0.62
    //     wall_clock_equipment (CONTROL)  source 1.076 → mounted 1.076, dev 0
    // The fix scales UNIFORMLY — one factor on all three axes — so a mounted
    // gltf's world aspect must match its source GLB's aspect.
    //
    // The tolerance is DERIVED, not fitted. Every AABB component in this path
    // is rounded to 1 mm (round3), so the aspect W/H carries a worst-case
    // relative error of 0.001/W + 0.001/H per side, both sides independent:
    //     TOL = (0.001/Ws + 0.001/Hs) + (0.001/Wm + 0.001/Hm)
    // The wall clock control validates the formula: it is mounted untouched and
    // measures 0.000 deviation (pre-fix.json), an order of magnitude below its
    // own bound (≈0.0042 at W=1.000, H=0.929). The pre-fix defect (0.62) is
    // ~50× the tightest subject bound. A single number chosen from the control's
    // size would be fitted to it and flaky for smaller subjects (rounding is
    // absolute, so small correctly-fitted subjects have larger relative floors).
    const mod = await load();
    const inspect = mod["inspectDeclaredEquipmentMounting"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const localBounds = await measureGltfAssetLocalBounds();
    const offenders: string[] = [];
    for (const s of report.stations) {
      for (const m of s.mounted) {
        if (m.source !== "gltf") continue;
        // Body-only bounds (#268): the GLB body, excluding the parametric stand.
        const bodyMin = m.worldBodyAabbMin ?? m.worldAabbMin;
        const bodyMax = m.worldBodyAabbMax ?? m.worldAabbMax;
        if (!bodyMin || !bodyMax) continue;
        const local = localBounds[m.equipmentId];
        if (!local) continue;
        const sourceWidth = local.max.x - local.min.x;
        const sourceHeight = local.max.y - local.min.y;
        const mountedWidth = bodyMax.x - bodyMin.x;
        const mountedHeight = bodyMax.y - bodyMin.y;
        if (sourceHeight <= 0 || mountedHeight <= 0) continue;
        const sourceAspect = sourceWidth / sourceHeight;
        const mountedAspect = mountedWidth / mountedHeight;
        const deviation = Math.abs(mountedAspect - sourceAspect) / sourceAspect;
        const tolerance = aspectToleranceFor({ sourceWidth, sourceHeight, mountedWidth, mountedHeight });
        if (deviation > tolerance) {
          offenders.push(
            `${s.scenarioId}/${m.equipmentId}: aspect ${mountedAspect.toFixed(3)} vs source ${sourceAspect.toFixed(3)} `
              + `(dev ${deviation.toFixed(4)} > derived tol ${tolerance.toFixed(4)})`,
          );
        }
      }
    }
    expect(
      offenders,
      `gltf equipment aspect squashed by the mount path (per-axis footprint fit):\n${offenders.join("\n")}`,
    ).toHaveLength(0);
  }, 900_000);
});
