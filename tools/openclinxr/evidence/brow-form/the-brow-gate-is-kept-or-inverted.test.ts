import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * tsk_463f772581db4da3 — the brow gate is KEPT or INVERTED, never silently dropped.
 *
 * h1 settled the choice on the orchestrator's pixel grade: decision (ii)
 * texture-only. The inversion itself is owned by a FOLLOW-UP card, so on THIS
 * card both gate files must be byte-identical to origin/main (this card
 * performs no inversion, it only records decision (ii) + evidence).
 *
 * claimScope: recorded decision value + gate-file intactness + T1 asset pin +
 *   evidence presence.
 * notEvidenceFor: pixel grading (orchestrator); the follow-up's inverted guards.
 */
/** Pinned T1 texture asset sha (measured 2026-10-15, S/brow/alb-t1brow.png). */
const T1_SHA256 = "b3b92248c9167d5652ee855a2a9f2656fe399c539f36e1379dd92dbd9d2f25e6";
const DIR = "tools/openclinxr/evidence/brow-form";
const GATE_A = "packages/openclinxr/stations/humanoid-bake-evidence/src/humanoid-bake/every-actor-has-brows-lashes-and-teeth.test.ts";
const GATE_B = "packages/openclinxr/stations/humanoid-bake-evidence/src/humanoid-bake/the-reduced-eyebrow-still-spans-and-darkens-the-brow-band.test.ts";

describe("the brow gate is kept or inverted (never silently dropped)", () => {
  it("(1) decision.json records decision (ii) with a reason, and no gate edit on this card", () => {
    const d = JSON.parse(readFileSync(`${DIR}/decision.json`, "utf8")) as {
      decision?: unknown;
      reason?: unknown;
      orchestrator_grade_quote?: unknown;
      follow_up_required?: { edits_gates?: unknown };
    };
    expect(d.decision, "h1 settled the choice: decision must be (ii)").toBe("(ii)");
    expect(typeof d.reason === "string" && d.reason.length > 0, "decision needs a reason").toBe(true);
    expect(
      typeof d.orchestrator_grade_quote === "string" && d.orchestrator_grade_quote.length > 0,
      "decision (ii) must quote the orchestrator grade",
    ).toBe(true);
    expect(d.follow_up_required?.edits_gates, "this card must not edit gates").toBe(false);
  });

  it("(2) INVERTED-elsewhere: both gate files are byte-identical to origin/main", () => {
    // CW: any edit/deletion of either gate test is a fail. Marker presence
    // (below) proves the fitted-mesh clauses still stand; byte-identity proves
    // this card added no inversion of its own — the follow-up owns it.
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
    const numstat = execSync(`git diff --numstat origin/main -- ${GATE_A} ${GATE_B}`, {
      cwd: repoRoot, encoding: "utf8", timeout: 60_000,
    }).trim();
    expect(numstat, "a gate test differs from origin/main — this card must not touch gates").toBe("");
    const a = readFileSync(GATE_A, "utf8");
    const b = readFileSync(GATE_B, "utf8");
    expect(a, "gate A lost its /eyebrow/i presence clause").toMatch(/\/eyebrow\/i/);
    expect(b, "gate B lost its /fitted_eyebrow/i geometry clause").toMatch(/fitted_eyebrow/i);
    expect(b, "gate B lost its 25%/10% floors").toMatch(/MIN_COVERAGE_FRACTION_OF_REF|MIN_INK_FRACTION_OF_REF/);
  });

  it("(3) T1 texture asset recorded with its full sha256 in decision.json", () => {
    const d = JSON.parse(readFileSync(`${DIR}/decision.json`, "utf8")) as {
      t1_texture_asset?: { sha256?: unknown };
    };
    expect(d.t1_texture_asset?.sha256, "T1 asset full sha missing").toBe(T1_SHA256);
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
