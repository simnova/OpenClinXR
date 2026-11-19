/**
 * HB-00 — every humanoid baseColorFactor is resolved before anything is baked.
 *
 * Reads the audit artifact + the live GLBs (JSON chunk: 12-byte header,
 * uint32LE at offset 12 = JSON length, JSON at offset 20). Never reads
 * provenance sidecars. Asserts: every shipped body is in the audit; every
 * non-[1,1,1] factor on a textured material carries a non-blank reason AND a
 * numeric-literal origin (file+line whose ±3 lines contain the three numbers);
 * audit body count == .glb count on disk.
 *
 * The audit is REGENERATED from the live GLBs by
 * tools/openclinxr/asset-pipeline/makeclothes/measure-humanoid-basecolorfactor.py,
 * never hand-edited (the regeneration clause below pins the producer script,
 * the method citation, and per-row bodyLastChanged). Where no numeric literal
 * exists in the tree for a row's triple, the row honestly declares the
 * canonical no-literal origin and the refusal clause decides: textured
 * non-white rows with no literal still fail; untextured or white rows are
 * refusal-exempt and the byte-match clause pins their values.
 *
 * The counterweight rows (synthetic unexplained factor; synthetic laundered
 * no-literal) prove the refusal fires: delete them and the refusal clause
 * passes on nothing.
 *
 * CLAIM: factor spread is recorded for HB-02 (bake must not burn tints in).
 * NOT TESTED: pixel appearance of any factor; bake/decimation/packing.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "@openclinxr/factory-station-core/runner";
import { describe, expect, it } from "vitest";

const REPO = repoRoot();
const GENERATED = join(REPO, "apps/ui-xr/public/generated-humanoids");
const AUDIT_PATH = join(
  REPO,
  "docs/openclinxr/humanoid-basecolorfactor-audit-2026-09-10.json",
);

interface Origin {
  file: string;
  line: number;
  literal: string;
}

interface AuditRow {
  body: string;
  material: string;
  baseColorFactor: readonly number[] | null;
  hasBaseColorTexture: boolean;
  reason?: string;
  kind?: string;
  bodyLastChanged?: string;
  origin: Origin;
}

interface Audit {
  bodies: string[];
  bodyCount: number;
  materialRowCount: number;
  rows: AuditRow[];
}

function readAudit(): Audit {
  expect(existsSync(AUDIT_PATH), `audit artifact missing: ${AUDIT_PATH}`).toBe(true);
  return JSON.parse(readFileSync(AUDIT_PATH, "utf8")) as Audit;
}

function readGlbMaterials(body: string): {
  name: string;
  factor: readonly number[] | null;
  hasTex: boolean;
}[] {
  const bytes = readFileSync(join(GENERATED, body));
  const jsonLen = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLen).toString("utf8")) as {
    materials?: {
      name?: string;
      pbrMetallicRoughness?: {
        baseColorFactor?: readonly number[];
        baseColorTexture?: unknown;
      };
    }[];
  };
  return (gltf.materials ?? []).map((m) => ({
    name: m.name ?? "(unnamed)",
    factor: m.pbrMetallicRoughness?.baseColorFactor ?? null,
    hasTex: Boolean(m.pbrMetallicRoughness?.baseColorTexture),
  }));
}

/** Compare with tolerance: exporter float32 round-trips must not fail the audit. */
function factorsEqual(
  a: readonly number[] | null,
  b: readonly number[] | null,
): boolean {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  return a.every((v, i) => Math.abs(v - b[i]!) < 5e-4);
}

function isWhite(factor: readonly number[] | null): boolean {
  if (factor === null) return true;
  return (
    Math.abs(factor[0]! - 1) < 1e-6 &&
    Math.abs(factor[1]! - 1) < 1e-6 &&
    Math.abs(factor[2]! - 1) < 1e-6
  );
}

/** Origin cites a numeric literal: the literal's own numbers sit within ±3 lines. */
function originHoldsLiteral(origin: Origin): boolean {
  const nums = origin.literal.match(/\d+\.\d+/g) ?? [];
  if (nums.length < 3) return false;
  const src = readFileSync(join(REPO, origin.file), "utf8").split("\n");
  const lo = Math.max(0, origin.line - 1 - 3);
  const hi = Math.min(src.length, origin.line - 1 + 4);
  const window = src.slice(lo, hi).join("\n");
  return nums.slice(0, 3).every((n) => window.includes(n));
}

/** Canonical honest no-literal declaration (ci-w9 P2): the row says so. */
const NO_LITERAL = "no numeric literal in tree";
const PRODUCER_SCRIPT = join(
  REPO,
  "tools/openclinxr/asset-pipeline/makeclothes/measure-humanoid-basecolorfactor.py",
);

function isHonestNoLiteral(r: AuditRow): boolean {
  return (
    r.origin.file === "" &&
    r.origin.line === 0 &&
    r.origin.literal === NO_LITERAL
  );
}

/** Synthetic unexplained textured factor: the refusal clause must fire on it. */
const SYNTHETIC_REFUSAL_ROW: AuditRow = {
  body: "__synthetic_refusal_probe__.glb",
  material: "mat_synthetic_unexplained_tex",
  baseColorFactor: [0.11, 0.22, 0.33, 1],
  hasBaseColorTexture: true,
  origin: { file: "docs/openclinxr/humanoid-glb-bake-and-vetting-2026-09-10.md", line: 1, literal: "no literal" },
};

/** Synthetic launder attempt: textured non-white row hiding behind the
 * canonical no-literal form. The refusal clause must still fire on it. */
const SYNTHETIC_LAUNDER_ROW: AuditRow = {
  body: "__synthetic_launder_probe__.glb",
  material: "mat_synthetic_laundered_tex",
  baseColorFactor: [0.44, 0.12, 0.08, 1],
  hasBaseColorTexture: true,
  reason: "claims no literal exists",
  origin: { file: "", line: 0, literal: NO_LITERAL },
};

function refusalRows(rows: AuditRow[]): AuditRow[] {
  return rows.filter((r) => {
    if (r.hasBaseColorTexture !== true) return false;
    if (isWhite(r.baseColorFactor)) return false;
    if (!r.reason || r.reason.trim().length === 0) return true;
    if (!r.origin || r.origin.line <= 0) return true;
    if (r.baseColorFactor === null) return true;
    return !originHoldsLiteral(r.origin);
  });
}

/** MAPS-TOIGO hair-material-maps stage file: stage-origin rows must cite it. */
const STAGE_FILE = "tools/openclinxr/asset-pipeline/makeclothes/apply_hair_material_maps.py";
const TEXTURED_CONVENTION_KIND = "authored texture, factor absent (defaults white)";
const TEXTURED_CONVENTION_REASON_HEAD = "Factor absent = glTF default white; the baseColorTexture carries the look.";
const MADR_0066 = "docs/madr/0066-post-export-hair-material-maps-stage.md";

/**
 * Textured factor-absent rows must carry the convention, never stale
 * flat-colour text (FU16 hardens FU13): a row with hasBaseColorTexture true
 * and factor null REDs when its reason still claims "(untextured)" without a
 * superseding "textured" measurement (a bare "(untextured)" with no later
 * textured sentence is the stale shape; a superseded history sentence, e.g.
 * the robert gown row whose later sentence re-measures textured, does not
 * count), when its reason still claims "factor IS the albedo", or — for rows
 * whose origin names the hair-material-maps stage file — when kind, reason
 * head, or MADR cite differ from the convention.
 */
function texturedFactorAbsentViolations(rows: AuditRow[]): string[] {
  const bad: string[] = [];
  for (const r of rows) {
    if (r.hasBaseColorTexture !== true || r.baseColorFactor !== null) continue;
    const reason = r.reason ?? "";
    const id = `${r.body}::${r.material}`;
    if (reason.includes("(untextured)") && !reason.replace(/untextured/g, "").includes("textured")) {
      bad.push(`${id} :: stale untextured claim on a textured row`);
      continue;
    }
    if (reason.includes("factor IS the albedo")) {
      bad.push(`${id} :: stale flat-colour claim on a textured row`);
      continue;
    }
    if (r.origin.file === STAGE_FILE) {
      if (r.kind !== TEXTURED_CONVENTION_KIND) bad.push(`${id} :: stage-origin kind is not the convention`);
      else if (!reason.startsWith(TEXTURED_CONVENTION_REASON_HEAD)) {
        bad.push(`${id} :: stage-origin reason head is not the convention`);
      } else if (!reason.includes(MADR_0066)) bad.push(`${id} :: stage-origin reason does not cite ${MADR_0066}`);
    }
  }
  return bad;
}

describe("every humanoid baseColorFactor is resolved (HB-00)", () => {
  it("audit body count == .glb count on disk", () => {
    const audit = readAudit();
    const onDisk = readdirSync(GENERATED)
      .filter((f) => f.endsWith(".glb"))
      .sort();
    expect(audit.bodies.slice().sort()).toEqual(onDisk);
    expect(audit.bodyCount).toBe(onDisk.length);
  });

  it("every shipped body is in the audit", () => {
    const audit = readAudit();
    const inAudit = new Set(audit.bodies);
    const onDisk = readdirSync(GENERATED).filter((f) => f.endsWith(".glb"));
    expect(onDisk.filter((b) => !inAudit.has(b))).toEqual([]);
  });

  it("audit rows match the live GLB bytes (name/factor/texture)", () => {
    const audit = readAudit();
    const byBody = new Map<string, AuditRow[]>();
    for (const r of audit.rows) {
      const list = byBody.get(r.body) ?? [];
      list.push(r);
      byBody.set(r.body, list);
    }
    const mismatches: string[] = [];
    for (const body of audit.bodies) {
      const live = readGlbMaterials(body);
      const rows = (byBody.get(body) ?? []).filter(
        (r) => !r.body.startsWith("__synthetic"),
      );
      if (rows.length !== live.length) {
        mismatches.push(`${body}: audit ${rows.length} != live ${live.length}`);
        continue;
      }
      for (const m of live) {
        const row = rows.find((r) => r.material === m.name);
        if (!row) {
          mismatches.push(`${body}: live material missing from audit: ${m.name}`);
          continue;
        }
        const rf = row.baseColorFactor;
        if (!factorsEqual(rf, m.factor)) {
          mismatches.push(`${body}::${m.name}: factor drift`);
        }
        if (row.hasBaseColorTexture !== m.hasTex) {
          mismatches.push(`${body}::${m.name}: texture flag drift`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("refusal: every textured non-white factor carries a reason + literal origin", () => {
    const audit = readAudit();
    const bad = refusalRows(
      audit.rows.filter((r) => !r.body.startsWith("__synthetic")),
    );
    expect(
      bad.map((r) => `${r.body}::${r.material}`),
      "textured non-white factor with no recorded reason or no numeric-literal origin",
    ).toEqual([]);
  });

  it("COUNTERWEIGHT: the synthetic unexplained-factor row fires the refusal", () => {
    const hit = refusalRows([SYNTHETIC_REFUSAL_ROW]);
    expect(
      hit.length,
      "the refusal clause must fire on a textured non-white row with no reason/literal",
    ).toBe(1);
  });

  it("COUNTERWEIGHT: a textured non-white row cannot launder itself with the no-literal form", () => {
    const hit = refusalRows([SYNTHETIC_LAUNDER_ROW]);
    expect(
      hit.length,
      "canonical no-literal must not exempt a textured non-white row from refusal",
    ).toBe(1);
  });

  it("(FU13 plant, FU16 hardened) COUNTERWEIGHT: textured factor-absent rows carry the convention", () => {
    const audit = readAudit();
    const bad = texturedFactorAbsentViolations(audit.rows.filter((r) => !r.body.startsWith("__synthetic")));
    expect(
      bad,
      "textured factor-absent rows must carry the textured convention (kind, reason head, " +
        "MADR cite), never a stale (untextured) claim without a superseding textured " +
        "measurement and never the flat-colour text the writer emitted before FU13",
    ).toEqual([]);
  });

  it("(FU16 plant) COUNTERWEIGHT: stale textured-row shapes RED under the hardened predicate", () => {
    const fu13 = (rows: AuditRow[]) =>
      rows
        .filter((r) => r.hasBaseColorTexture === true && r.baseColorFactor === null)
        .filter((r) => (r.reason ?? "").includes("factor IS the albedo"))
        .map((r) => `${r.body}::${r.material}`);
    // P-a: Robert row with HEAD's stale reason (untextured, no textured sentence).
    const robertStale: AuditRow = {
      body: "mpfb-gown-ed-robert-hayes.glb",
      material: "openclinxr_fitted_hair_toigo_blunt_bob_with_bangs_mpfb_robert_reference_mat",
      baseColorFactor: null,
      hasBaseColorTexture: true,
      reason:
        "Measured [0.12999999523162842, 0.09000000357627869, 0.07000000029802322, 1] on live bytes " +
        "(untextured); origin first recorded 2026-10-30 in embed_library_hair.py, then relocated.",
      origin: {
        file: "tools/openclinxr/asset-pipeline/makeclothes/embed_library_hair.py",
        line: 352,
        literal: "return (0.13, 0.09, 0.07, 1.0)  # near-black",
      },
    };
    const fu13a = fu13([robertStale]);
    console.log(`PLANT FU13 predicate on stale Robert: ${fu13a.length === 0 ? "passes (the F2 defect)" : "REDs"}`);
    expect(fu13a, "FU13 predicate must pass the stale untextured Robert reason (the F2 gap)").toEqual([]);
    const newA = texturedFactorAbsentViolations([robertStale]);
    console.log(`PLANT new predicate on stale Robert: ${newA.length > 0 ? `REDs: ${newA.join("; ")}` : "UNEXPECTED-GREEN"}`);
    expect(newA.length, "hardened predicate must RED the stale untextured Robert row").toBeGreaterThan(0);
    // P-b: family row with the flat-colour phrase (FU13 already REDs this one).
    const familyFlat: AuditRow = {
      body: "mpfb-family-partner-adult.glb",
      material: "openclinxr_fitted_hair_toigo_curled_under_bob_mpfb_ed_chest_pain_spouse_adult_mat",
      baseColorFactor: null,
      hasBaseColorTexture: true,
      reason: "Flat authored colour; the factor IS the albedo (no texture to multiply).",
      origin: {
        file: "tools/openclinxr/asset-pipeline/makeclothes/embed_library_hair.py",
        line: 63,
        literal: '"black": (0.035, 0.028, 0.022),',
      },
    };
    const fu13b = fu13([familyFlat]);
    console.log(`PLANT FU13 predicate on flat-colour family: ${fu13b.length > 0 ? "REDs (already covered)" : "UNEXPECTED-GREEN"}`);
    expect(fu13b.length, "FU13 predicate REDs the flat-colour phrase").toBeGreaterThan(0);
    const newB = texturedFactorAbsentViolations([familyFlat]);
    console.log(`PLANT new predicate on flat-colour family: ${newB.length > 0 ? `REDs: ${newB.join("; ")}` : "UNEXPECTED-GREEN"}`);
    expect(newB.length, "hardened predicate must RED the flat-colour family row").toBeGreaterThan(0);
    // P-c: stage-origin row with a stale kind (reason already convention-shaped).
    const stageWrongKind: AuditRow = {
      body: "mpfb-gown-ed-robert-hayes.glb",
      material: "openclinxr_fitted_hair_toigo_blunt_bob_with_bangs_mpfb_robert_reference_mat",
      baseColorFactor: null,
      hasBaseColorTexture: true,
      kind: "MPFB fitted hair, robert role (untextured)",
      reason:
        "Factor absent = glTF default white; the baseColorTexture carries the look. Maps wired " +
        "post-export by the hair-material-maps stage; decisions recorded in " +
        "docs/madr/0066-post-export-hair-material-maps-stage.md.",
      origin: {
        file: "tools/openclinxr/asset-pipeline/makeclothes/apply_hair_material_maps.py",
        line: 217,
        literal: 'pbr["baseColorTexture"] = {"index": diffuse_tex}',
      },
    };
    const fu13c = fu13([stageWrongKind]);
    console.log(`PLANT FU13 predicate on stale-kind stage row: ${fu13c.length === 0 ? "passes (the F2 defect)" : "REDs"}`);
    expect(fu13c, "FU13 predicate must pass the stale-kind stage row (the F2 gap)").toEqual([]);
    const newC = texturedFactorAbsentViolations([stageWrongKind]);
    console.log(`PLANT new predicate on stale-kind stage row: ${newC.length > 0 ? `REDs: ${newC.join("; ")}` : "UNEXPECTED-GREEN"}`);
    expect(newC.length, "hardened predicate must RED the stale-kind stage row").toBeGreaterThan(0);
    // Counterweight: one of the 30 base convention rows passes all three rules.
    const audit = readAudit();
    const nurse = audit.rows.find(
      (r) => r.body === "mpfb-clinical-nurse-adult.glb" && r.material === "mat_makeclothes_library_footwear_toigo_mj_cloth_shoes",
    )!;
    const cw = texturedFactorAbsentViolations([nurse]);
    console.log(`COUNTERWEIGHT convention row ${nurse.body}::${nurse.material}: ${cw.length === 0 ? "passes unchanged" : `UNEXPECTED-RED: ${cw.join("; ")}`}`);
    expect(cw, "base convention row must pass the hardened predicate unchanged").toEqual([]);
  });

  it("COUNTERWEIGHT: every row origin cites a numeric literal in the tree, or honestly declares no literal on a refusal-exempt row", () => {
    const audit = readAudit();
    const bad: string[] = [];
    for (const r of audit.rows.filter((ro) => !ro.body.startsWith("__synthetic"))) {
      if (r.baseColorFactor === null) continue;
      if (originHoldsLiteral(r.origin)) continue;
      if (
        isHonestNoLiteral(r) &&
        (r.hasBaseColorTexture !== true || isWhite(r.baseColorFactor))
      ) {
        continue;
      }
      bad.push(`${r.body}::${r.material} -> ${r.origin.file}:${r.origin.line}`);
    }
    expect(bad).toEqual([]);
  });

  it("audit is regenerated by the producer script, not hand-edited", () => {
    const audit = readAudit();
    expect(
      existsSync(PRODUCER_SCRIPT),
      `producer script missing: ${PRODUCER_SCRIPT}`,
    ).toBe(true);
    const script = readFileSync(PRODUCER_SCRIPT, "utf8");
    expect(script.includes("live_materials"), "producer must measure live GLB bytes").toBe(true);
    expect(script.includes("bodyLastChanged"), "producer must cite the last commit per body").toBe(true);
    const raw = readFileSync(AUDIT_PATH, "utf8");
    expect(raw.includes("measure-humanoid-basecolorfactor.py")).toBe(true);
    const stale = audit.rows.filter((r) => !r.bodyLastChanged || !/^[0-9a-f]{40} \d{4}-\d{2}-\d{2} /.test(r.bodyLastChanged));
    expect(
      stale.map((r) => `${r.body}::${r.material}`),
      "every row cites the commit that last changed its body",
    ).toEqual([]);
  });
});
