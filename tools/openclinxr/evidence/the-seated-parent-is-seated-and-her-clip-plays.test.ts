import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { resolveActorPosture } from "../../../packages/openclinxr/asset-registry/src/actor-posture.js";

/**
 * OBSERVABLE: the peds parent sits in the chair her case authors, and her seated clip plays.
 *
 * MEASURED 2026-08-22, do not re-derive.
 *
 *   resolveActorPosture({slotKind:"family_or_observer", scenarioId:"peds_asthma_parent_anxiety_v1"})
 *     -> "standing"
 *   main.ts:628   binds her roleAnimationClipNames = ["openclinxr_retarget_seated_talking_cc0", ...]
 *   main.ts:7441  const mixer = playbackEnabled && clips.length && !isSeated && !isSupine ? ... : undefined
 *
 * So a STANDING actor performs a SEATED talking animation. An isolated capture shows a mid-air splayed
 * crouch, hands on hips, feet ~80px above the floor grid; subject-band frame delta YMAX=156 against
 * grid YMAX=30, so the rig genuinely animates — it animates the wrong thing for its placement.
 *
 * STAGING, RULED (consulted opinion per §8u, NOT clinician sign-off): in a pediatric urgent-care asthma
 * encounter, family-centred-care guidance places the accompanying parent SEATED at the bedside, often
 * with the child on her lap during a 10-minute nebulised treatment. The fixture already agrees —
 * `pediatric-asthma.ts` authors `parent_chair_equipment` ("Parent-facing chair for family
 * communication") and the environment description says "parent seating". The chair is authored; the
 * posture table just never says she sits.
 *
 * THE `!isSeated` GUARD IS NOT A TRAP — do not remove it. `main.ts:7431` states its reason:
 *   "#83: seated figures keep a mixer only for non-leg facial/upper clips when role clips exist.
 *    Falling back to ALL glTF clips played standing armature tracks that overwrote the sit every frame"
 * It is a correct invariant. The work is to EXTEND the #83 carve-out so a seated-rig clip plays on a
 * seated actor without overwriting the sit — not to delete the guard so a full-body clip runs.
 *
 * THREE COLUMNS, because single-column green is how #58 and #64 shipped broken figures: posture is
 * seated AND the clip plays AND the seated pose survives. Any one alone is satisfiable by a fix that
 * makes the render worse.
 *
 * claimScope: the peds family slot's resolved posture, and whether her authored seated clip is
 * reachable for playback under that posture.
 * notEvidenceFor: how the seat is placed, whether she looks right, lip-sync, or any other actor.
 */

const ROOT = join(import.meta.dirname, "../../..");
const PARENT_GLB = join(ROOT, "apps/ui-xr/public/xr-assets/humanoids/candidates/mpfb-peds-parent-aisha.motion-bind.glb");
const SEATED_CLIP = "openclinxr_retarget_seated_talking_cc0";
const PEDS = "peds_asthma_parent_anxiety_v1";

const posture = (slotKind: string, scenarioId = PEDS): string =>
  resolveActorPosture({ slotKind, scenarioId, environmentId: "pediatric_urgent_care_bay_v1" });

describe("the seated parent is seated and her clip plays", () => {
  it("(0) VACUITY GUARD: the asset ships and carries the seated clip", async () => {
    // Without this, (2) could go green by the clip vanishing rather than by playback being fixed.
    expect(existsSync(PARENT_GLB), "the peds parent GLB must ship").toBe(true);
    const doc = await new NodeIO().read(PARENT_GLB);
    const names = doc.getRoot().listAnimations().map((a) => a.getName());
    expect(names, "her authored seated clip must be in the file").toContain(SEATED_CLIP);
  });

  it.fails("(1) RED column A: the peds family slot resolves to seated", () => {
    expect(
      posture("family_or_observer"),
      "the case authors parent_chair_equipment and 'parent seating'; the posture table must agree",
    ).toBe("seated");
  });

  it.fails("(2) RED column B: a seated actor can still reach a seated-rig role clip", async () => {
    // The #83 carve-out currently admits only non-leg facial/upper clips. A seated-rig clip is exactly
    // what a seated actor SHOULD play; today the guard cannot distinguish it from a standing-rig clip.
    const mod = await import("../../../apps/ui-xr/src/seated-role-clip-policy.js") as Record<string, unknown>;
    const fn = mod["seatedRoleClipIsPlayable"];
    expect(
      typeof fn,
      "apps/ui-xr does not export seatedRoleClipIsPlayable(clipName) — the #83 carve-out has no seam a "
        + "seated-rig clip can pass through, so playability cannot be measured without one",
    ).toBe("function");
    expect(
      (fn as (n: string) => boolean)(SEATED_CLIP),
      "a seated-rig clip must be playable on a seated actor",
    ).toBe(true);
  });

  it("(3) COUNTERWEIGHT: the primary patient and nurse slots are UNCHANGED", () => {
    // Refuses a global "everyone sits" fix. Only the family slot in peds urgent care changes.
    expect(posture("primary_patient"), "the peds patient still stands").toBe("standing");
    expect(posture("clinical_staff"), "clinical staff still stand").toBe("standing");
  });

  it("(4) COUNTERWEIGHT: #83's invariant survives — supine still gets no mixer path", () => {
    // Refuses "delete the guard". ED chest pain's patient is supine and must stay that way.
    expect(
      posture("primary_patient", "ed_chest_pain_priority_v2"),
      "#150's supine plant must not be disturbed by a seated carve-out",
    ).toBe("supine");
  });
});
