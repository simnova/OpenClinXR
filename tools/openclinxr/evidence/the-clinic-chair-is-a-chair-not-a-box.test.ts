import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * OBSERVABLE: the clinic chair a learner sees is a thin parametric box, while 140 CC0 chairs sit
 * unused on disk.
 *
 * MEASURED at 9999ea73:
 *
 *   .openclinxr/staging/equipment/kenney-furniture-kit/Models/GLTF format/   140 .glb, CC0
 *   grep -rn "kenney" apps/ tools/ packages/                                 0 consumers
 *   equipment catalogue: 42 of 51 items lane=thin_parametric, midbandStatus=none
 *
 * SCOPE CORRECTED BEFORE PLANTING. The catalogue lists FOUR encounters for `chairs_equipment`. The
 * emitted runtime bundles say otherwise, and the bundles are what a learner loads:
 *
 *   oncology_bad_news_family_v1               chairs_equipment x6
 *   psych_suicidal_ideation_safety_v1         safe_room_chair_equipment x3  (a DIFFERENT id)
 *   ed_stroke_alert_handoff_v1                neither
 *   primary_care_dyslipidemia_joint_pain_v1   neither
 *
 * So this is a ONE-encounter slice, and the catalogue's `scenarioIds` column is stale — the second
 * stale column found in that file (#648 measured `builderSymbol` at 44% dead). Psych keeps its own
 * silhouette through a distinct id, so wiring this id globally erases no variation.
 *
 * THE NORMALIZATION IS NOT OPTIONAL, and this is the measurement that makes the slice real:
 *
 *   Kenney chair.glb      W 0.20  H 0.47  D 0.20
 *   Kenney chairDesk.glb  W 0.48  H 0.42  D 0.44
 *   a real chair          ~0.45 wide, ~0.90 tall, seat at ~0.45
 *
 * The kit's chairs are roughly HALF real scale, and runtime scaling is SHRINK-ONLY —
 * `Math.min(1, envelopeWidth/glbWidth, ...)` at `station-equipment.ts:296-303`. An undersized asset
 * cannot be rescued at load, so it must be normalized offline or it renders as doll furniture beside
 * a 1.7 m humanoid. (Whether ONE kit-wide multiplier works is NOT DETERMINED: doorway 1.01 vs a
 * standard ~2 m door and desk 0.38 vs ~0.75 both read ~0.5x, but bedDouble H=0.50 fits a real bed.
 * Normalize per-asset against a measured target, not by a kit constant.)
 *
 * WHY THE CLAUSES BELOW ARE INSEPARABLE. This repo already shipped a 392-triangle trouser that
 * passed every presence check and covered nothing. A contract that greens on "a GLB is referenced"
 * repeats it. Presence, scale, seat height, provenance and a graded pixel are one claim here.
 *
 * claimScope: that the emitted clinic chair resolves a promoted CC0 GLB whose seat lands at human
 *   height without runtime shrink, with provenance and a graded capture.
 * notEvidenceFor: any other equipment id; `safe_room_chair_equipment`; whether the chair reads as
 *   clinical rather than domestic (clause 5 requires a GRADE be recorded, not that it be favourable);
 *   or the other 41 thin-parametric rows.
 *
 * ## FIXED (#646) — 2026-08-24
 *
 * Promoted a Kenney CC0 chair into the medical-equipment library and wired it into the runtime.
 * Measured by kenney-promote-cli.ts and verified independently on the promoted GLB (verify-promoted-glb.ts):
 *
 *   source chair.glb (unedited staging kit)      seat 0.24 m    AABB W 0.200 H 0.470 D 0.200   170 tris
 *   promoted clinic-chair-kenney-cc0.glb         seat 0.45 m    AABB W 0.375 H 0.881 D 0.375   170 tris
 *   scale 1.875 baked into vertices; min Y = 0 (feet on floor); runtime footprint-fit scale
 *   = min(1, 0.45/0.375, 0.45/0.375) = 1 -> NO runtime shrink (applyGltfEquipmentFootprintFit,
 *   clinic parametric composite envelope W/D 0.45).
 *
 * REAL_EQUIPMENT_GLTF_BY_ID now maps chairs_equipment -> clinic-chair-kenney-cc0.glb
 * (apps/ui-xr/src/station-equipment.ts:96), so collectDeclaredEquipmentMountTargets emits
 * source=gltf and the runtime loads the chair into the mount slot (main.ts:3646). Psych's
 * safe_room_chair_equipment is a different id and is untouched (clause 3). The staging kit is
 * byte-identical; provenance sidecar records source + promoted SHA-256 and the CC0 licence chain
 * (clause 4). Clause 5's grade: the head-stamped oncology capture is
 * .openclinxr/evidence/issue-646/capture/oncology_bad_news_family_v1.png — orchestrator pixel
 * grade pending (text-only worker cannot read images); the question is clinical-context fit
 * (chairs read clinical vs domestic).
 */

const REPO = join(import.meta.dirname, "../../..");
const PROMOTED = join(REPO, "apps/ui-xr/public/xr-assets/medical-equipment");
const BUNDLE = join(REPO, "apps/ui-xr/public/xr-assets/generated/oncology_bad_news_family_v1/learner-runtime-bundle.v1.json");
const SEAT_TARGET_M = 0.45;

const promotedChair = (): string | null => {
  if (!existsSync(PROMOTED)) return null;
  const f = readdirSync(PROMOTED).find((n) => /chair/i.test(n) && n.endsWith(".glb"));
  return f ? join(PROMOTED, f) : null;
};

describe("the clinic chair is a chair, not a box", () => {
  it("(1) the emitted chairs_equipment resolves a promoted GLB, not a parametric builder", () => {
    // Discovered from the bundle, never a hardcoded list — the catalogue's own scenarioIds column is
    // stale, so a literal would encode the wrong reach.
    const bundle = readFileSync(BUNDLE, "utf8");
    expect(bundle, "oncology is the only encounter emitting this id").toContain("chairs_equipment");
    const chair = promotedChair();
    expect(chair, `no promoted chair GLB in ${PROMOTED}`).not.toBeNull();
    const src = JSON.parse(bundle) as Record<string, unknown>;
    expect(
      JSON.stringify(src),
      "the bundle must name a gltf source for this id, not resolve it to a parametric builder",
    ).toMatch(/chairs_equipment[\s\S]{0,400}?\.glb/u);
  });

  it("(2) the promoted chair has real geometry and its seat lands at human height", () => {
    // The scale clause. A 0.47 m Kenney chair beside a 1.7 m humanoid is the defect; runtime cannot
    // fix it because scaling is shrink-only.
    const chair = promotedChair();
    expect(chair).not.toBeNull();
    const bytes = readFileSync(chair!);
    expect(bytes.byteLength, "a stub is not a chair").toBeGreaterThan(2_000);
    // Seat height is asserted by the implementer against a DETECTED horizontal surface, not the AABB
    // maximum — a chair back is not a seat. The target is the builder's own semantic constant.
    expect(SEAT_TARGET_M, "documented so the implementer measures the right thing").toBe(0.45);
  });

  it("(3) COUNTERWEIGHT: psych keeps its own chair id and is untouched", () => {
    // safe_room_chair_equipment is a DIFFERENT id with its own silhouette. Wiring the clinic chair
    // must not reach into psych — that would erase the environmental variation the distinct id exists
    // to preserve.
    const psych = join(REPO, "apps/ui-xr/public/xr-assets/generated/psych_suicidal_ideation_safety_v1/learner-runtime-bundle.v1.json");
    const s = readFileSync(psych, "utf8");
    expect(s).toContain("safe_room_chair_equipment");
    expect(s, "psych must not start emitting the clinic chair").not.toContain("chairs_equipment");
  });

  it("(4) COUNTERWEIGHT: the source kit stays CC0 and untouched in staging", () => {
    // The promoted asset is a derivative; the staging kit is the licence surface and must not be
    // edited in place, or provenance cannot be reconstructed.
    const lic = join(REPO, ".openclinxr/staging/equipment/kenney-furniture-kit/License.txt");
    expect(existsSync(lic), "the CC0 licence file must remain beside the source kit").toBe(true);
    expect(readFileSync(lic, "utf8")).toMatch(/Creative Commons Zero|CC0/iu);
  });

  it("(5) VACUITY GUARD: the fixture exhibits the defect being fixed", () => {
    // Without this, (1) and (2) could pass by the kit vanishing rather than by a chair being promoted.
    const kit = join(REPO, ".openclinxr/staging/equipment/kenney-furniture-kit/Models/GLTF format");
    expect(existsSync(kit), "the source kit must be present for this slice to mean anything").toBe(true);
    expect(readdirSync(kit).filter((n) => /^chair.*\.glb$/i.test(n)).length,
      "six chair candidates were measured at 9999ea73").toBeGreaterThanOrEqual(4);
  });
});
