import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#185). Three REDs. All flip.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT — MEASURED, not inferred. Trust these; do not re-derive.
 *
 * `roomProp()` at `main.ts:6130-6167` builds, for EVERY prop id without exception:
 *
 *     const body = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ color, ... }));
 *     body.scale.set(scale.x, scale.y, scale.z);
 *
 * A unit cube, scaled. It then tags `group.userData.openClinXrEquipmentSource = "fallback"` at
 * `:6165`, which is honest — it IS the fallback — and `openClinXrEquipmentId = propId` at `:6160`.
 *
 * Meanwhile this repo already contains a parametric equipment factory:
 *
 *     station-equipment-builders.ts          485 lines, 21 `case "<id>_equipment"` builder arms
 *     station-equipment-families.ts          561
 *     station-equipment-support-surfaces.ts  224
 *     station-equipment.ts                   312
 *                                          -----
 *                                           1582 lines
 *
 * `buildDeclaredEquipmentGeometry(equipmentId)` (`station-equipment-builders.ts:377`) is wired into
 * the EQUIPMENT channel at `main.ts:3494`. It is never consulted by the ROOM PROP channel.
 *
 * IDS THAT HAVE A REAL BUILDER AND STILL RENDER AS A SCALED BOX (measured by intersecting the
 * builder `case` arms against declared roomProp ids in the bank):
 *
 *     bedside_monitor_equipment      stretcher_equipment           pediatric_stretcher_equipment
 *     parent_chair_equipment         pulse_oximeter_equipment      nebulizer_mask_equipment
 *     inhaler_spacer_equipment       oxygen_wall_port_equipment
 *
 * This is why rooms grade as slabs. It is not a missing generator — the generator is in the tree
 * and one channel does not call it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DIRECTIVE D9 — this is the dark-factory read, and it inverts my first proposal
 *
 * I proposed building a Blender `equipment_generate` stage, on the premise that no equipment station
 * existed. A peer round refuted that against the tree and I verified the refutation myself: the
 * station exists, in TypeScript, and a Blender tree would be a second source of truth for the same
 * artifacts. WITHDRAWN. Consuming the factory you have is the D9 move; cloning it is not.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE LANDMINE — this slice is a REGRESSION without the exclusive-mount rule
 *
 * Many ids are ALREADY DUAL-PATH: the equipment plan mounts them parametrically at `main.ts:3486-3520`
 * AND the manifest declares them as roomProps, which `roomProp()` renders as a box. Two objects, one
 * id, and today you only see one of them as furniture because the other is a flat box that reads as
 * part of the room.
 *
 * Route roomProp through the builder with no other change and you get TWO REAL MONITORS in the same
 * room. Contract (2) is the XOR that forbids it. This is the single most likely way this slice ships
 * looking correct in a mesh count and wrong in the pixels.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE SCALE DECISION, MADE — do not re-litigate it mid-slice
 *
 * `roomProp` applies the manifest `scale` to a unit box, so the manifest numbers are BOX-PROXY
 * DIMENSIONS (a monitor declared 0.55 x 0.32 x 0.04), not a target AABB. The builders already emit
 * metric geometry at real size.
 *
 *   POSITION  keep from the manifest.
 *   SCALE     IGNORE for builder-backed props. Do not fit builder output into the manifest AABB —
 *             that squashes a real monitor into a stamp and produces false clearance numbers.
 *   MARKER + NAMEPLATE  currently positioned from `scale.y` at `:6150-6156`. For builder-backed
 *             props they must come from the BUILDER'S measured AABB, or labels float in the air.
 *   SOURCE TAG  `openClinXrEquipmentSource` must become `"parametric"` for builder-backed props.
 *             Leaving it `"fallback"` makes #209's declared-equipment inspector
 *             (`declared-equipment-mounted.ts:36`, `:413-416`) report a lie.
 *
 * If you believe ignoring manifest scale is wrong, say so in your report and implement it anyway.
 * Naming the disagreement is not refusing the work.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT WILL MOVE, so you recognise it rather than diagnose it
 *
 * Real geometry is not unit-box-times-scale, so anything measuring prop SIZE or CLEARANCE will shift:
 * actor-prop-intersection, equipment-assembly-integrity, room-prop-colour-fidelity, and any furniture
 * AABB assertion. A shifted baseline is expected. A shifted baseline that now reports OVERLAP with an
 * actor is a real finding — report it, do not tune it away.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SCOPE
 *
 *   DO:     make the room-prop channel consult the existing builder, exclusively, with correct tags.
 *   DO NOT: write a new builder, a Blender equipment stage, or any new prop geometry. If an id has
 *           no builder arm it KEEPS the box — that is the honest fallback and contract (3) counts it.
 *   DO NOT: adopt TRELLIS. #164 measured it `reject_measured` with `notEvidenceFor: adoption`.
 *   DO NOT: touch the asset pipeline, humanoid GLBs, or clinical-idle-posture.ts — a second worker
 *           holds those this cycle.
 *   DO NOT: delete roomProps to satisfy the XOR. Contract (3) forbids the room getting emptier.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * NOT KNOWN TO ME BEYOND THE ABOVE. My last several diagnoses in this repo were withdrawn, so take no
 * hypothesis of mine as fact beyond the measured file:line facts above. Unranked and possibly all
 * wrong: the equipment plan may already suppress some of these ids; #186's fixture-ownership filter at
 * `:6092` may already remove others; the builder may return an empty Group for some arms. MEASURE THE
 * LIVE SCENE FIRST and write the pre-fix artifact before any product edit — the artifact is what tells
 * you which of the eight ids are genuinely dual-mounted today.
 *
 * If a proof in the brief cannot pass as written, or passes trivially against the measured range, SAY
 * SO IN YOUR REPORT AT THE MOMENT YOU FIND IT, before running a corrected version. That is my defect,
 * not yours, and I need to see it.
 */

type PropRender = {
  scenarioId: string;
  propId: string;
  /** True when station-equipment-builders has a `case` arm for this id. */
  hasBuilder: boolean;
  /** Distinct scene roots in the LIVE scene carrying openClinXrEquipmentId === propId. */
  mountedRootCount: number;
  /** Meshes under the prop root. A lone scaled cube is 1 body mesh plus decoration. */
  bodyMeshCount: number;
  triangleCount: number;
  /** userData.openClinXrEquipmentSource on the prop root. */
  sourceTag: string;
  /** True when the prop's body geometry is a single box whose vertex count is 8. */
  isUnitBoxBody: boolean;
};

type Inspect = () => Promise<{
  props: PropRender[];
  builderArmIds: string[];
  preFixRenderedPropIds: string[];
}>;

const load = () =>
  import("./room-prop-uses-real-builder.js") as Promise<Record<string, unknown>>;

describe("a room prop with a real builder renders real geometry (#185)", () => {
  it("builder-backed props are not scaled boxes", async () => {
    const mod = await load();
    const inspect = mod["inspectRoomPropUsesRealBuilder"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(
      report.builderArmIds.length,
      "no builder arms discovered — read them from station-equipment-builders, do not hardcode a list",
    ).toBeGreaterThan(10);

    const backed = report.props.filter((p) => p.hasBuilder);
    expect(
      backed.length,
      "no declared roomProp has a builder — the intersection this slice exists to close is empty",
    ).toBeGreaterThan(0);

    const boxes: string[] = [];
    for (const p of backed) {
      if (p.isUnitBoxBody) {
        boxes.push(
          `${p.scenarioId}/${p.propId}: still a unit box, while `
          + `buildDeclaredEquipmentGeometry("${p.propId}") exists and is never called`,
        );
      }
      if (p.sourceTag === "fallback") {
        boxes.push(
          `${p.scenarioId}/${p.propId}: openClinXrEquipmentSource="fallback" on a builder-backed prop `
          + `— #209's inspector reads this tag and would be reporting a lie`,
        );
      }
    }
    expect(boxes, `builder-backed props still rendering as boxes:\n${boxes.join("\n")}`).toEqual([]);
  }, 1_800_000);

  it("no equipment id is mounted twice (COUNTERWEIGHT — the XOR)", async () => {
    // The landmine. Ids are already dual-path: the equipment plan mounts them parametrically at
    // main.ts:3486-3520 AND the manifest declares them as roomProps. Today one of the two is a flat
    // box that reads as room, so the duplication is invisible. Give the box channel a real builder
    // with no exclusive-mount rule and the room gets two of everything.
    const mod = await load();
    const inspect = mod["inspectRoomPropUsesRealBuilder"] as Inspect;
    const report = await inspect();

    const doubled: string[] = [];
    for (const p of report.props) {
      if (p.mountedRootCount > 1) {
        doubled.push(
          `${p.scenarioId}/${p.propId}: ${p.mountedRootCount} scene roots carry this equipment id — `
          + `the room-prop channel and the equipment plan both mounted it`,
        );
      }
    }
    expect(doubled, `equipment mounted more than once:\n${doubled.join("\n")}`).toEqual([]);
  }, 1_800_000);

  it("the room did not get emptier, and un-backed ids keep the honest box (COUNTERWEIGHT)", async () => {
    // Deleting roomProps satisfies the XOR trivially and empties the room. The pre-fix artifact is
    // the guard: every prop id that rendered before must still render. Ids with no builder arm keep
    // the 1x1x1 box — that is the correct fallback, not a defect, and it must be COUNTED so the
    // residual is visible rather than implied.
    const mod = await load();
    const inspect = mod["inspectRoomPropUsesRealBuilder"] as Inspect;
    const report = await inspect();

    const rendered = new Set(report.props.map((p) => p.propId));
    const lost = report.preFixRenderedPropIds.filter((id) => !rendered.has(id));
    expect(
      report.preFixRenderedPropIds.length,
      "no pre-fix prop list — the measurement must be taken before the product edit",
    ).toBeGreaterThan(0);

    const broken: string[] = [];
    if (lost.length > 0) {
      broken.push(`props that stopped rendering: ${lost.join(", ")} — the room got emptier`);
    }
    for (const p of report.props.filter((x) => !x.hasBuilder)) {
      if (p.bodyMeshCount < 1) {
        broken.push(`${p.propId}: no builder arm AND no fallback box — it renders nothing at all`);
      }
    }
    expect(broken, `the counterweight broke:\n${broken.join("\n")}`).toEqual([]);
  }, 1_800_000);
});
