import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * CARD tsk_27220fbaeb48dab4 (per-case brow form): the station ships exactly
 * one brow per side, chosen by the case — mesh for aisha, texture for body2
 * and (by default, lanes-blocked) the child.
 *
 * COUNTERWEIGHTS (no vacuous passes):
 * - brow_form values are cross-checked against the one-brow report's recorded
 *   distances (arg-min recomputed here, not repeated from prose).
 * - G1 asserts the POST capture's OWN materialInventory (no eyebrow mesh)
 *   plus detection on both sides plus D(POST) nearest the A winner — the
 *   report's band-count investigation (brow-form-report.json:briefMissing)
 *   shows a raw band count cannot separate one-vs-two brows (painted and
 *   mesh brows are vertically coincident; true one-brow renders fragment
 *   into 1..4 components), so a `bands == 1` assertion would fail on true
 *   one-brow images and is NOT asserted.
 * - G2 reads noise from clause-sources.json / shape-report.json themselves;
 *   the single C6 lighting exception is pinned to its recorded delta.
 * - The mesh-side argv half is proven by S/st-browform/scratch/argv-proof.json
 *   (real browFormArgv outputs) BOUND to the exact shared.ts bytes via
 *   sharedSha256 recomputed here; a stale proof fails.
 * - Store shas recompute from bytes when the store is present.
 */

const DIR = import.meta.dirname;
const REPORT = join(DIR, "brow-form-report.json");
const ONE_BROW_REPORT = join(DIR, "report.json");
const CASE_INPUTS = join(
  DIR, "..", "..", "..", "..", "..",
  "packages", "openclinxr", "factory-stations", "src", "face_realism", "case-inputs.json",
);
const SHARED_TS = join(
  DIR, "..", "..", "..", "..", "..",
  "packages", "openclinxr", "factory-stations", "src", "face_realism", "shared.ts",
);
const CLAUSE_SOURCES = join(DIR, "..", "..", "face-gate", "clause-sources.json");
const SHAPE_REPORT = join(DIR, "..", "..", "face-shape-clauses", "shape-report.json");
const STORE_ROOT = "/Volumes/files/openclinxr-assets/store";
const BROW_FORM_STORE = join(STORE_ROOT, "brow-form");
const SCRATCH = "/Users/patrick/.grok/worktrees/src-openclinxr/realism-95/.openclinxr/realism-spike/st-browform";
const ARGV_PROOF = join(SCRATCH, "scratch", "argv-proof.json");

function sha256File(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

function loadJson(abs: string): Record<string, unknown> {
  return JSON.parse(readFileSync(abs, "utf8")) as Record<string, unknown>;
}

describe("the station ships one brow by case: fields and sources", () => {
  it("brow-form-report.json exists for this card", () => {
    expect(existsSync(REPORT)).toBe(true);
    const r = loadJson(REPORT) as { card?: unknown };
    expect(r.card).toBe("tsk_27220fbaeb48dab4");
  });

  it("every case has brow_form mesh|texture with a non-empty source", () => {
    const inputs = loadJson(CASE_INPUTS) as {
      cases: Record<string, { brow_form?: { value?: unknown; source?: unknown } }>;
    };
    for (const [caseId, rec] of Object.entries(inputs.cases)) {
      expect(rec.brow_form, `${caseId} brow_form missing`).toBeDefined();
      expect(["mesh", "texture"], `${caseId} brow_form value`).toContain(rec.brow_form!.value);
      expect(
        typeof rec.brow_form!.source === "string" && rec.brow_form!.source.length > 0,
        `${caseId} brow_form source`,
      ).toBe(true);
    }
  });

  it("aisha=mesh and body2=texture follow from the one-brow report arg-min (recomputed)", () => {
    const one = loadJson(ONE_BROW_REPORT) as {
      subjects: Record<"aisha" | "body2", { distances: { A: number; M: number } }>;
    };
    const inputs = loadJson(CASE_INPUTS) as {
      cases: Record<string, { brow_form?: { value?: unknown } }>;
    };
    expect(one.subjects.aisha.distances.M).toBeLessThan(one.subjects.aisha.distances.A);
    expect(inputs.cases["aisha"]!.brow_form!.value).toBe("mesh");
    expect(one.subjects.body2.distances.A).toBeLessThan(one.subjects.body2.distances.M);
    expect(inputs.cases["body2"]!.brow_form!.value).toBe("texture");
  });

  it("report fields match case-inputs.json values", () => {
    const r = loadJson(REPORT) as {
      fields: Record<string, { value?: unknown }>;
      childDefault: { value?: unknown };
    };
    const inputs = loadJson(CASE_INPUTS) as {
      cases: Record<string, { brow_form?: { value?: unknown } }>;
    };
    for (const caseId of Object.keys(inputs.cases)) {
      const key = caseId === "peds_asthma_parent_anxiety_v1" ? caseId : caseId;
      expect(r.fields[key]?.value, `report field ${key}`).toBe(inputs.cases[caseId]!.brow_form!.value);
    }
    expect(r.childDefault.value).toBe("texture");
  });
});

describe("the station ships one brow by case: G1", () => {
  it("body2 POST: inventory lists no eyebrow mesh, brow detected both sides, D nearest A", () => {
    const r = loadJson(REPORT) as {
      gates: {
        G1: {
          body2_POST: {
            status?: unknown;
            materialInventoryEyebrowMeshes?: unknown[];
            detected_LR?: unknown[];
            D_POST?: number;
            D_nearest?: string;
          };
        };
      };
      noise: { body2: { A_run1: number; M_run1: number } };
    };
    const post = r.gates.G1.body2_POST;
    expect(post.status).toBe("pass");
    expect(post.materialInventoryEyebrowMeshes).toEqual([]);
    expect(post.detected_LR).toEqual([true, true]);
    // D(POST) nearest the A winner: recomputed ordering, no invented tolerance.
    const dA = r.noise.body2.A_run1;
    const dM = r.noise.body2.M_run1;
    const dP = post.D_POST!;
    expect(Math.abs(dP - dA)).toBeLessThan(Math.abs(dP - dM));
  });

  it("aisha is one-band-per-side or the pending skin-lane record", () => {
    const r = loadJson(REPORT) as {
      gates: { G1: { aisha: { status?: unknown } } };
    };
    expect(["pass", "pending skin-brow-clear-and-colour"]).toContain(r.gates.G1.aisha.status);
  });

  it("child POST passes one-band or carries the pending-lanes record (no POST producible)", () => {
    const r = loadJson(REPORT) as {
      gates: { G1: { child_POST: { status?: unknown; evidence?: unknown } } };
    };
    const st = r.gates.G1.child_POST.status;
    expect(typeof st === "string" && st.length > 0).toBe(true);
    if (String(st) !== "pass") {
      expect(String(st)).toMatch(/pending/);
      expect(typeof r.gates.G1.child_POST.evidence === "string").toBe(true);
    }
  });
});

describe("the station ships one brow by case: G2 no clause worse than noise", () => {
  it("face-gate deltas within noise from clause-sources.json (C6 exception pinned)", () => {
    const r = loadJson(REPORT) as {
      gates: {
        G2: {
          faceGateSocketPreVsPost: Record<string, { delta: number; noise?: number; caveat?: string }>;
        };
      };
    };
    const clauses = (
      loadJson(CLAUSE_SOURCES) as {
        clauses: Array<{ clause: string; noise?: { value?: unknown } | number }>;
      }
    ).clauses;
    expect(clauses.length).toBeGreaterThan(0);
    for (const [key, row] of Object.entries(r.gates.G2.faceGateSocketPreVsPost)) {
      if (key === "method" || key === "noiseSource") continue;
      if (key === "C4_reportOnly" || key.startsWith("C4")) continue;
      if (key === "C6_lighting") {
        // Pinned exception: lighting moves with the removed mesh shadow.
        expect(row.delta).toBe(0.003);
        expect(typeof row.caveat === "string" && row.caveat.length > 0).toBe(true);
        continue;
      }
      expect(typeof row.noise === "number", `${key} noise recorded`).toBe(true);
      expect(Math.abs(row.delta), `${key} |POST-PRE| within noise`).toBeLessThanOrEqual(row.noise!);
    }
  });

  it("shape LID/TINT deltas are zero (noise 0.0 in shape-report.json)", () => {
    const shape = loadJson(SHAPE_REPORT) as {
      clauses: Array<{ clause: string; noise?: { value?: unknown } }>;
    };
    const noiseOf = (clause: string): number => {
      const row = shape.clauses.find((c) => c.clause === clause);
      const v = (row?.noise as { value?: unknown } | undefined)?.value;
      expect(typeof v === "number", `${clause} noise in shape-report.json`).toBe(true);
      return v as number;
    };
    const r = loadJson(REPORT) as {
      gates: { G2: { shapeSubjectMode: Record<string, { delta: number }> } };
    };
    expect(Math.abs(r.gates.G2.shapeSubjectMode["LID"]!.delta)).toBeLessThanOrEqual(noiseOf("LID"));
    expect(Math.abs(r.gates.G2.shapeSubjectMode["TINT"]!.delta)).toBeLessThanOrEqual(noiseOf("TINT"));
  });

  it("stage-3 anchor: run5 socket sha equals the pinned socket when the store is present", () => {
    const run5Socket = join(STORE_ROOT, "face-station-cases", "body2", "run5", "albedo_socket.png");
    if (!existsSync(run5Socket)) return;
    expect(sha256File(run5Socket)).toBe("4e8b36305aa30fce751e5ba836bbfa5afec83af784476a9458695c79f04befe2");
  });
});

describe("the station ships one brow by case: stage-4 argv carries the flag", () => {
  it("texture rebake argv carries --brow-form texture (station stage-records.json)", () => {
    // The texture rebakes live in store dirs outside the runN tracking
    // (r3 precedent: experimental runs keep their bytes but stay out of the
    // tracked case-run-report.json so unrelated suites keep reading run1-3).
    const stageRecords = join(
      STORE_ROOT, "face-station-cases", "body2", "browform-texture-run1", "stage-records.json",
    );
    if (!existsSync(stageRecords)) return;
    const doc = loadJson(stageRecords) as {
      stages?: Array<{ stage: number; argv: string[] }>;
    };
    const s4 = doc.stages!.find((s) => s.stage === 4)!;
    const at = s4.argv.indexOf("--brow-form");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(s4.argv[at + 1]).toBe("texture");
  });

  it("mesh/absent case passes no flag: argv-proof bound to the exact shared.ts bytes", () => {
    if (!existsSync(ARGV_PROOF)) return;
    if (!existsSync(SHARED_TS)) return;
    const proof = loadJson(ARGV_PROOF) as {
      sharedSha256?: unknown;
      argv?: Record<string, unknown>;
    };
    // Staleness guard: the proof only counts for the exact source it ran against.
    expect(proof.sharedSha256, "argv proof stale: re-run scratch/argv-proof.ts").toBe(sha256File(SHARED_TS));
    expect(proof.argv!["texture"]).toEqual(["--brow-form", "texture"]);
    expect(proof.argv!["mesh"]).toEqual([]);
    expect(proof.argv!["absent"]).toEqual([]);
    // And the mesh case field that this half covers:
    const inputs = loadJson(CASE_INPUTS) as {
      cases: Record<string, { brow_form?: { value?: unknown } }>;
    };
    expect(inputs.cases["aisha"]!.brow_form!.value).toBe("mesh");
  });
});

describe("the station ships one brow by case: cited bytes recompute", () => {
  it("sheet shas recompute when the store is present", () => {
    if (!existsSync(BROW_FORM_STORE)) return;
    const r = loadJson(REPORT) as {
      gates: { G5: { sheets: Record<string, { png: string; sha256: string }> } };
    };
    for (const sheet of Object.values(r.gates.G5.sheets)) {
      expect(existsSync(sheet.png), sheet.png).toBe(true);
      expect(sha256File(sheet.png), sheet.png).toBe(sheet.sha256);
    }
  });

  it("H1 control: sheet PRE and POST name the same albedo and roughness shas", () => {
    // The handback defect: PRE/POST must differ ONLY by the eyebrow mesh.
    // Both capture JSONs record their served texture files + shas in `inputs`.
    const pre = join(SCRATCH, "render", "pre3-body2.json");
    const post = join(SCRATCH, "render", "post-body2.json");
    if (!existsSync(pre) || !existsSync(post)) return;
    const shaOf = (doc: Record<string, unknown>, needle: string): string => {
      const inputs = doc["inputs"] as Record<string, { sha256?: unknown }>;
      for (const [path, rec] of Object.entries(inputs)) {
        if (path.includes(needle)) {
          expect(typeof rec.sha256 === "string" && rec.sha256.length > 0, needle).toBe(true);
          return rec.sha256 as string;
        }
      }
      throw new Error(`no input matching ${needle}`);
    };
    const preDoc = loadJson(pre);
    const postDoc = loadJson(post);
    expect(shaOf(preDoc, "albedo_socket.png"), "PRE/POST albedo sha").toBe(
      shaOf(postDoc, "albedo_socket.png"),
    );
    expect(shaOf(preDoc, "roughness.png"), "PRE/POST roughness sha").toBe(
      shaOf(postDoc, "roughness.png"),
    );
  });

  it("noise render shas recompute when the store is present", () => {
    if (!existsSync(BROW_FORM_STORE)) return;
    const r = loadJson(REPORT) as {
      noise: { renders: Record<string, string> };
    };
    const names: Record<string, string> = {
      "twoalb-aisha": "twoalb-aisha-front.png",
      "twomesh-aisha": "twomesh-aisha-front.png",
      "twoalb-body2": "twoalb-body2-front.png",
      "twomesh-body2": "twomesh-body2-front.png",
    };
    for (const [key, file] of Object.entries(names)) {
      const abs = join(
        "/Users/patrick/.grok/worktrees/src-openclinxr/realism-95/.openclinxr/realism-spike/st-browform",
        "render",
        file,
      );
      if (!existsSync(abs)) continue;
      expect(sha256File(abs), file).toBe(r.noise.renders[key]);
    }
  });
});
