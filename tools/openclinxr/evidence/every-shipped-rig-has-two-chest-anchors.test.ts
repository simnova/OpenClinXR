import { NodeIO } from "@gltf-transform/core";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: the chest-anchor collapse fixed on one actor at 1f5519d2 is fleet-wide. Nineteen of
 * the twenty shipped MPFB rigs still put `breast.L` and `breast.R` at the same midline point, so a
 * `rightChestSurface` goal aims at the sternum on every one of them.
 *
 * MEASURED 2026-09-03 at 1f5519d2 across every *.glb under apps packages tools (179 files) with
 * @gltf-transform/core. 42 declare both breast joints; 19 have a chest span of exactly 0:
 *
 *   chest_cm  clav_cm  file
 *      0.000    3.425  mpfb-peds-patient-child.glb
 *      0.000    4.650  mpfb-street-adult-male.glb
 *      0.000    4.555  mpfb-viseme-inspect.glb
 *      0.000    4.555  mpfb-ob-patient-aisha-rigged-candidate.glb
 *      0.000    4.687  mpfb-peds-parent-aisha.motion-bind.glb     <- CAST, reaches a learner
 *      0.000    4.555  mpfb-gown-inspect.glb
 *      0.000    4.690  mpfb-gown-adult-patient.glb
 *     14.083      --   charmorph-antonia-ob-patient-candidate.glb
 *     15.797      --   reom-* and charmorph-reom-* candidates
 *     17.000    4.869  mpfb-clinical-nurse-adult.glb              <- fixed at 1f5519d2
 *
 * TWO INDEPENDENT KNOWN-GOODS, so no threshold here is invented. The CharMorph-derived rigs
 * separate their chest anchors at 14.08 and 15.80 cm from a DIFFERENT pipeline that never had the
 * defect — they carry no clavicle.L/R at all, so they are not MPFB topology. And
 * mpfb-clinical-nurse-adult sits at 17.00 cm after 1f5519d2. Every collapsed file is `mpfb-*`.
 *
 * CAUSE, traced on tsk_56d49aad722488bf: MPFB's addon rig data authors both breast bone HEADS as
 * `strategy: "CUBE", cube_name: "joint-spine-1"` — the AABB centre of the spine joint vertex group,
 * i.e. the midline — while giving the same bones VERTEX tails at |x| ~= 0.102. MPFB intends a
 * lateral reach and only the head collapsed, on every rig built from it.
 *
 * THE TOOL ALREADY EXISTS AND WORKS ON THE OTHERS. Measured on mpfb-gown-inspect.glb:
 * `separate_chest_anchor_joints.mjs` reported chestSpanM before 0, after 0.17, and adjusted both
 * ClinicalIdleConversation translation channels (2 keyframes each). This is a wiring slice.
 *
 * CLAUSE (2) CLOSES A GAP THE EARLIER RED LEFT. the-chest-anchor-joints-are-not-one-point.test.ts
 * reads REST NODES ONLY. These GLBs also carry animation TRANSLATION channels for the same joints
 * that pin them to the collapsed position on every keyframe, so a rig whose rest nodes were
 * separated and whose clip channels were not would pass that instrument and still aim at the
 * sternum. Measured, not hypothetical: the nurse's channels went from +/-0.00000 to +/-0.08500 as
 * part of 1f5519d2, and the earlier RED never checked them.
 *
 * IMMUTABLE diagnosis. Flip `it.fails` -> `it` and append a `## FIXED (#N)` block. Do not rewrite
 * the measured table.
 *
 * claimScope: whether every shipped GLB that declares both chest anchor joints separates them
 *   laterally, keeps them outside its clavicle roots where it has them, and carries no animation
 *   translation channel that returns them to the midline.
 * notEvidenceFor: what any still SHOWS — no pixel is graded here. Whether 8.5 cm is the right
 *   half-span for every body (it is the nurse's value; MPFB's own tail vertex argues for ~10.2 cm).
 *   The anchors' HEIGHT. Whether `rightChestSurface` suits any given gesture. Quest frame budget.
 *
 * ## FIXED (#0)
 * Fleet run 2026-09-03: the existing stage (separate_chest_anchor_joints.mjs, landed at 1f5519d2)
 * was run over every shipped GLB that declares both breast joints. Twelve tracked rigs collapsed
 * (chest span 0.000 cm): mpfb-clinical-physician-adult, mpfb-family-partner-adult,
 * mpfb-gown-adult-patient, mpfb-gown-inspect, mpfb-ob-patient-aisha, mpfb-peds-nurse-kevin,
 * mpfb-peds-parent-aisha, mpfb-peds-patient-child, mpfb-street-adult-male, mpfb-viseme-inspect,
 * mpfb-ob-patient-aisha-rigged-candidate and mpfb-peds-parent-aisha.motion-bind (the last two in
 * xr-assets/humanoids/candidates). Each was mirrored to x = +/- 0.085 m (17 cm total, above every
 * clavicle span in the fleet, under the 25 cm ceiling); the same delta was applied to the breast
 * translation keyframes of every clip that pinned them to the midline (ClinicalIdleConversation on
 * all twelve; openclinxr_retarget_seated_talking_cc0 on the motion-bind candidate as well). Rest
 * nodes, keyframes, y/z untouched on all. Per-actor reports:
 * tools/openclinxr/evidence/chest-anchor-joints/<actor>.json; provenance sourceNotes appended to
 * the seven full-schema provenance files; report-only for the gown/viseme inspection fixtures and
 * the two candidates, which carry no full-schema provenance sidecar. Post-pass diagnostic across
 * the whole tree: 0 collapsed, 0 at-or-below the clavicle span, 0 pinned by an animation channel.
 * Half-span recorded as 0.085 m fleet-wide (uniform with mpfb-clinical-nurse-adult, the 1f5519d2
 * known-good); MPFB's ~0.102 tail vertex is the bracketed alternative the contract does not choose.
 */

const ROOT = join(import.meta.dirname, "../../..");

/** Anatomical ceiling: adult nipple-to-nipple tops out near 22 cm. Refuses a fling-apart. */
const MAX_CHEST_SEPARATION_M = 0.25;

type Rig = { file: string; chest: number; clavicle: number | null; animOnMidline: boolean };

async function rigs(): Promise<Rig[]> {
  const listing = execFileSync(
    "bash",
    ["-lc", "find apps packages tools -name '*.glb' -not -path '*/node_modules/*' 2>/dev/null | sort"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  const io = new NodeIO();
  const out: Rig[] = [];
  for (const rel of listing.trim().split("\n").filter(Boolean)) {
    let doc: Awaited<ReturnType<NodeIO["read"]>>;
    try {
      doc = await io.read(join(ROOT, rel));
    } catch {
      continue;
    }
    const node = (n: string) => doc.getRoot().listNodes().find((x) => x.getName() === n);
    const bl = node("breast.L");
    const br = node("breast.R");
    if (!bl || !br) continue;
    const cl = node("clavicle.L");
    const cr = node("clavicle.R");
    let animOnMidline = false;
    for (const a of doc.getRoot().listAnimations()) {
      for (const ch of a.listChannels()) {
        const nm = ch.getTargetNode()?.getName();
        if (!nm || !/^breast\.[LR]$/.test(nm) || ch.getTargetPath() !== "translation") continue;
        const arr = ch.getSampler()?.getOutput()?.getArray();
        if (!arr) continue;
        for (let i = 0; i < arr.length; i += 3) {
          if (Math.abs(arr[i] as number) <= 1e-6) animOnMidline = true;
        }
      }
    }
    out.push({
      file: rel,
      chest: Math.abs((bl.getTranslation()[0] as number) - (br.getTranslation()[0] as number)),
      clavicle:
        cl && cr ? Math.abs((cl.getTranslation()[0] as number) - (cr.getTranslation()[0] as number)) : null,
      animOnMidline,
    });
  }
  return out;
}

describe("every shipped rig has two chest anchors", () => {
  it("(0) VACUITY GUARD: enough rigs declare both chest joints for the assertions to mean something", async () => {
    const all = await rigs();
    // 42 carried both joints when measured. A floor of 20 refuses a pass over an emptied or
    // truncated set without pinning a count that grows as rigs are added.
    expect(all.length, `only ${all.length} GLBs declare both breast joints`).toBeGreaterThanOrEqual(20);
  });

  it("(1) FIXED: no shipped rig collapses its two chest anchors onto the midline", async () => {
    const all = await rigs();
    const collapsed = all.filter((r) => r.chest < 1e-9).map((r) => r.file);
    expect(collapsed, `${collapsed.length} of ${all.length} rigs put both chest anchors at one midline point`)
      .toEqual([]);

    // COUNTERWEIGHT 1 — lateral is not enough. The anchors must sit outside the clavicle roots,
    // which are medial to them. Applied only where the rig HAS clavicles; CharMorph rigs do not.
    for (const r of all.filter((x) => x.clavicle !== null)) {
      expect(
        r.chest,
        `${r.file}: chest span ${(r.chest * 100).toFixed(3)} cm is not outside its clavicle span ${((r.clavicle as number) * 100).toFixed(3)} cm`,
      ).toBeGreaterThan(r.clavicle as number);
    }

    // COUNTERWEIGHT 2 — refuse flinging them apart to clear the floor.
    for (const r of all) {
      expect(r.chest, `${r.file}: chest span ${(r.chest * 100).toFixed(1)} cm is wider than any human chest`)
        .toBeLessThanOrEqual(MAX_CHEST_SEPARATION_M);
    }
  });

  it("(2) FIXED: no animation channel returns a chest anchor to the midline", async () => {
    const all = await rigs();
    const pinned = all.filter((r) => r.animOnMidline).map((r) => r.file);
    expect(pinned, `${pinned.length} rigs carry breast translation keyframes on the midline`).toEqual([]);
  });
});
