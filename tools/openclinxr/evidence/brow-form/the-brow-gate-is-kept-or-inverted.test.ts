import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * tsk_463f772581db4da3 — the brow gate is KEPT or INVERTED, never silently dropped.
 *
 * This card decides among (i) texture+mesh, (ii) texture-only (supersede gates),
 * (iii) mesh-only. It must NOT edit either gate test (CW). So the only legal
 * end states are:
 *   - KEPT: decision (i)/(iii); both gate files still carry their fitted-mesh
 *     clauses (/eyebrow/i presence, /fitted_eyebrow/i geometry), unedited;
 *   - INVERTED: decision (ii); the inversion itself is owned by a FOLLOW-UP card,
 *     so here both gate files must STILL be unedited (this card performs no
 *     inversion, it only records the decision + evidence for the follow-up).
 *
 * claimScope: decision-file shape + gate-file intactness + evidence presence.
 * notEvidenceFor: which option is right (decision.json reason); pixel grading.
 */
const DIR = "tools/openclinxr/evidence/brow-form";
const GATE_A = "tools/openclinxr/evidence/every-actor-has-brows-lashes-and-teeth.test.ts";
const GATE_B = "tools/openclinxr/evidence/the-reduced-eyebrow-still-spans-and-darkens-the-brow-band.test.ts";

describe("the brow gate is kept or inverted (never silently dropped)", () => {
  it("(1) decision.json names exactly one of (i)/(ii)/(iii) with a reason", () => {
    const d = JSON.parse(readFileSync(`${DIR}/decision.json`, "utf8")) as {
      decision?: unknown;
      reason?: unknown;
    };
    expect(d.decision, "decision.json must name exactly one option").toMatch(/^\((i|ii|iii)\)$/);
    expect(typeof d.reason === "string" && d.reason.length > 0, "decision needs a reason").toBe(true);
  });

  it("(2) KEPT-or-INVERTED: neither gate test was edited by this card", () => {
    // CW: a decision file naming no option, or any edit/deletion of either
    // gate test, is a fail. Presence of the original gate markers proves the
    // files still require a fitted mesh (kept); inversion, if decided, lands
    // in a follow-up card, not here.
    const a = readFileSync(GATE_A, "utf8");
    const b = readFileSync(GATE_B, "utf8");
    expect(a, "gate A lost its /eyebrow/i presence clause").toMatch(/\/eyebrow\/i/);
    expect(b, "gate B lost its /fitted_eyebrow/i geometry clause").toMatch(/fitted_eyebrow/i);
    expect(b, "gate B lost its 25%/10% floors").toMatch(/MIN_COVERAGE_FRACTION_OF_REF|MIN_INK_FRACTION_OF_REF/);
  });

  it("(3) bake-off evidence exists: ink per option, sheet, renders", () => {
    const d = JSON.parse(readFileSync(`${DIR}/decision.json`, "utf8")) as {
      ink_rendered_L28_browzone_rows625_670_stable_face?: Record<string, unknown>;
      sheet?: { path?: unknown };
    };
    const ink = d.ink_rendered_L28_browzone_rows625_670_stable_face ?? {};
    for (const k of ["opt1_hybrid_tex_plus_kept_strands", "opt2_texonly_T1_hidden_mesh", "opt3_meshonly_regen_native_material"]) {
      expect(typeof ink[k], `ink fraction missing for ${k}`).toBe("number");
    }
    expect(typeof d.sheet?.path === "string" && existsSync(d.sheet.path), "brow sheet missing").toBe(true);
    for (const t of ["opt1-hybrid", "opt2-texonly", "opt3-meshonly"]) {
      expect(existsSync(`${DIR}/renders/browform-${t}-front.png`), `render missing for ${t}`).toBe(true);
    }
  });
});
