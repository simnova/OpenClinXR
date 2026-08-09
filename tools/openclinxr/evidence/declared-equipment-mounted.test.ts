import { describe, expect, it } from "vitest";
import { NodeIO } from "@gltf-transform/core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REAL_EQUIPMENT_GLTF_BY_ID } from "../../../apps/ui-xr/src/station-equipment.js";

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
};

type StationEquipment = {
  scenarioId: string;
  /** Equipment ids in the SHIPPED scene manifest for this station. */
  declaredEquipmentIds: string[];
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
});
