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
 * The counterweight row (synthetic unexplained factor) proves the refusal
 * fires: delete it and the refusal clause passes on nothing.
 *
 * CLAIM: factor spread is recorded for HB-02 (bake must not burn tints in).
 * NOT TESTED: pixel appearance of any factor; bake/decimation/packing.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = join(import.meta.dirname, "../../../..");
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

/** Synthetic unexplained textured factor: the refusal clause must fire on it. */
const SYNTHETIC_REFUSAL_ROW: AuditRow = {
  body: "__synthetic_refusal_probe__.glb",
  material: "mat_synthetic_unexplained_tex",
  baseColorFactor: [0.11, 0.22, 0.33, 1],
  hasBaseColorTexture: true,
  origin: { file: "docs/openclinxr/humanoid-glb-bake-and-vetting-2026-09-10.md", line: 1, literal: "no literal" },
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

  it("COUNTERWEIGHT: every row origin cites a numeric literal in the tree", () => {
    const audit = readAudit();
    const bad: string[] = [];
    for (const r of audit.rows.filter((ro) => !ro.body.startsWith("__synthetic"))) {
      if (r.baseColorFactor === null) continue;
      if (!originHoldsLiteral(r.origin)) {
        bad.push(`${r.body}::${r.material} -> ${r.origin.file}:${r.origin.line}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
