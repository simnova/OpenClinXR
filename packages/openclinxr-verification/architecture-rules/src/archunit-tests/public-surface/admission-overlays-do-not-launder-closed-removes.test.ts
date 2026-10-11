import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ADMISSION_GROUPS, REVIEW_GROUPS, resolveApplyId } from "../../checks/public-surface/apply-map.js";
import { groupHash, inventoryHash, requireApplied, requireAppliedWith } from "../../checks/public-surface/gates.js";
import { measureSurface, workspaceRoot } from "../../checks/public-surface/resolve.js";

/**
 * Admission overlays must not launder a closed remove, and unknown apply ids stay unknown.
 *
 * Plant (clauses 1–3) imports only today's apply/review surface: requireApplied,
 * resolveApplyId, REVIEW_GROUPS. Overlay clauses land in the implementation commit.
 */

const ROOT = workspaceRoot();
const FROZEN = {
  raw: "c37bea4199168cb11094db343e449e9da887e43d5c01e2c85fc24c16265446b6",
  "psr-01b": "74e4fb9a76a42899212b79988668ba396e07314b31d0620518430200af37e335",
  // 2026-10-08 (operator-approved pin move): shrink-b amendment, Codex session 01a11ad4 (was dfa31d1b).
  // 2026-10-08 (operator-approved pin move): shrink-a amendment, Codex session 01a11b94 (was 768a45da).
  "psr-01c": "c4057d50657ec25d75798087be5099d93ed0f36ad471c9eccfdbaf63d6cb2d95",
  // 2026-10-08 (operator-approved pin move): shrink-b amendment, Codex session 01a11ad4 (was bd4d8990).
  "psr-01d": "2bdc7f5e9b05d285a8b7f99e8fec2926fccf99659b32c60b839d364c28fd0acd",
  // 2026-10-08 (operator-approved pin move): psr-01e amendment moves 24 stale
  // xr-actor-dialogue keeps to remove; Codex session 01a11a71 approved it (was 59b530c7).
  // 2026-10-08 (operator-approved pin move): shrink-b amendment, Codex session 01a11ad4 (was a5292a82).
  // 2026-10-08 (operator-approved pin move): shrink-a amendment, Codex session 01a11b94 (was e81491ae).
  "psr-01e": "172ce4e7d454e62d46420e4e9d188ef52b3261521ab84c22a704e27a978af8fe",
} as const;
const PSR_DIR = "docs/openclinxr/package-public-surface-reduction";
const APPROVALS_DIR = `${PSR_DIR}/approvals`;
const ADMISSIONS_DIR = `${PSR_DIR}/admissions`;
const RAW_INVENTORY_REL = `${PSR_DIR}/raw-inventory.json`;
const GATES_REL = "packages/openclinxr-verification/architecture-rules/src/checks/public-surface/gates.ts";
const APPLY_MAP_REL = "packages/openclinxr-verification/architecture-rules/src/checks/public-surface/apply-map.ts";
const RUNNER_REL = "packages/openclinxr-verification/architecture-rules/src/checks/public-surface/runner.ts";
const ACCEPTANCE_REL = "packages/openclinxr-verification/architecture-rules/src/checks/public-surface/acceptance-criteria.ts";
const PKG_JSON_REL = "packages/openclinxr-verification/architecture-rules/package.json";

function withTree(files: Record<string, string>, run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "psr-admission-"));
  try {
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/**\n");
    for (const [rel, body] of Object.entries(files)) {
      const full = join(root, rel);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, body);
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const manifest = (name: string): string =>
  JSON.stringify({ name, exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } } });

function writeRawInventory(root: string): void {
  const report = measureSurface(root);
  const rows: { package: string; entrypoint: string; symbol: string; kind: string }[] = [];
  for (const pkg of report.packages) {
    for (const entry of pkg.entrypoints) {
      for (const symbol of entry.symbols) {
        rows.push({ package: pkg.packageDir, entrypoint: entry.specifier, symbol: symbol.name, kind: symbol.kind });
      }
    }
  }
  mkdirSync(join(root, PSR_DIR), { recursive: true });
  writeFileSync(join(root, RAW_INVENTORY_REL), JSON.stringify({ inventoryHash: inventoryHash(root, report), rows }, null, 2));
}

function writeGroup(
  root: string,
  group: string,
  rows: { package: string; entrypoint: string; symbol: string; kind: string; disposition: string }[],
): void {
  mkdirSync(join(root, APPROVALS_DIR), { recursive: true });
  const report = measureSurface(root);
  const table: { package: string; entrypoint: string; symbol: string; kind: string }[] = [];
  for (const pkg of report.packages) {
    for (const entry of pkg.entrypoints) {
      for (const symbol of entry.symbols) {
        table.push({ package: pkg.packageDir, entrypoint: entry.specifier, symbol: symbol.name, kind: symbol.kind });
      }
    }
  }
  const packages = new Set(rows.map((row) => row.package));
  writeFileSync(
    join(root, `${APPROVALS_DIR}/${group}.json`),
    JSON.stringify(
      {
        id: group,
        rawInventoryHash: inventoryHash(root, report),
        groupHash: groupHash(table, packages),
        rows: rows.map((row) => ({ ...row, owner: "fixture", rationale: "falsifier row" })),
      },
      null,
      2,
    ),
  );
}

function sha256File(rel: string): string {
  return createHash("sha256").update(readFileSync(join(ROOT, rel))).digest("hex");
}

type OverlayRow = {
  package: string;
  entrypoint: string;
  symbol: string;
  kind: string;
  disposition: string;
  owner: string;
  rationale: string;
  reviewedBy: string;
};

function overlayAdmissionHash(reviewedBy: string, rows: OverlayRow[]): string {
  const lines = [...rows]
    .sort((a, b) =>
      `${a.package}\t${a.entrypoint}\t${a.symbol}\t${a.kind}`.localeCompare(
        `${b.package}\t${b.entrypoint}\t${b.symbol}\t${b.kind}`,
      ),
    )
    .map(
      (row) =>
        `${row.package}\t${row.entrypoint}\t${row.symbol}\t${row.kind}\t${row.disposition}\t${row.owner}\t${row.reviewedBy}`,
    );
  return createHash("sha256").update([reviewedBy, ...lines].join("\n")).digest("hex");
}

function writeAdmission(
  root: string,
  id: string,
  rows: OverlayRow[],
  opts?: {
    reviewedBy?: string;
    baseRawInventoryHash?: string;
    admissionHash?: string;
    packages?: string[];
    schema?: string;
    fileId?: string;
  },
): void {
  const reviewedBy = opts?.reviewedBy ?? rows[0]?.reviewedBy ?? "reviewer";
  mkdirSync(join(root, ADMISSIONS_DIR), { recursive: true });
  const raw = JSON.parse(readFileSync(join(root, RAW_INVENTORY_REL), "utf8")) as { inventoryHash: string };
  writeFileSync(
    join(root, `${ADMISSIONS_DIR}/${id}.json`),
    JSON.stringify(
      {
        schema: opts?.schema ?? "openclinxr.psr-admission.v1",
        id: opts?.fileId ?? id,
        reviewedBy,
        baseRawInventoryHash: opts?.baseRawInventoryHash ?? raw.inventoryHash,
        admissionHash: opts?.admissionHash ?? overlayAdmissionHash(reviewedBy, rows),
        packages: opts?.packages ?? [...new Set(rows.map((row) => row.package))],
        rows,
      },
      null,
      2,
    ),
  );
}

const STRAY_KEEP: OverlayRow = {
  package: "packages/openclinxr/fixture-closed-remove",
  entrypoint: ".",
  symbol: "stray",
  kind: "runtime",
  disposition: "keep",
  owner: "author",
  rationale: "reviewed readmission",
  reviewedBy: "reviewer",
};

function closedRemoveTree(extraExport = "export const listed = 1;\nexport const stray = 2;\n"): Record<string, string> {
  return {
    "packages/openclinxr/fixture-closed-remove/package.json": manifest("@openclinxr/fixture-closed-remove"),
    "packages/openclinxr/fixture-closed-remove/src/index.ts": extraExport,
  };
}

function writeClosedRemoveGroup(
  root: string,
  extraRows: { symbol: string; disposition: string }[] = [{ symbol: "stray", disposition: "remove" }],
): void {
  writeRawInventory(root);
  writeGroup(root, "psr-01c", [
    {
      package: "packages/openclinxr/fixture-closed-remove",
      entrypoint: ".",
      symbol: "listed",
      kind: "runtime",
      disposition: "keep",
    },
    ...extraRows.map((row) => ({
      package: "packages/openclinxr/fixture-closed-remove",
      entrypoint: ".",
      symbol: row.symbol,
      kind: "runtime",
      disposition: row.disposition,
    })),
  ]);
}

describe("admission overlays do not launder closed removes", () => {
  it("(1) RED: a well-formed approvals/psr-99z.json still yields unknown apply id", () => {
    withTree(
      {
        "packages/openclinxr/fixture-99z/package.json": manifest("@openclinxr/fixture-99z"),
        "packages/openclinxr/fixture-99z/src/index.ts": "export const listed = 1;\n",
      },
      (root) => {
        writeRawInventory(root);
        writeGroup(root, "psr-99z", [
          {
            package: "packages/openclinxr/fixture-99z",
            entrypoint: ".",
            symbol: "listed",
            kind: "runtime",
            disposition: "keep",
          },
        ]);
        const result = requireApplied(root, "psr-99z");
        expect(result.ok).toBe(false);
        expect(result.detail).toBe("unknown apply id psr-99z");
      },
    );
  });

  it("(2) a closed-group remove of a still-published fixture symbol remains extra without an overlay", () => {
    withTree(
      {
        "packages/openclinxr/fixture-closed-remove/package.json": manifest("@openclinxr/fixture-closed-remove"),
        "packages/openclinxr/fixture-closed-remove/src/index.ts": "export const listed = 1;\nexport const stray = 2;\n",
      },
      (root) => {
        writeRawInventory(root);
        writeGroup(root, "psr-01c", [
          {
            package: "packages/openclinxr/fixture-closed-remove",
            entrypoint: ".",
            symbol: "listed",
            kind: "runtime",
            disposition: "keep",
          },
          {
            package: "packages/openclinxr/fixture-closed-remove",
            entrypoint: ".",
            symbol: "stray",
            kind: "runtime",
            disposition: "remove",
          },
        ]);
        const result = requireAppliedWith(root, "psr-01c", { admissionGroups: [] });
        expect(result.ok).toBe(false);
        expect(result.detail).toMatch(/extra:.*stray/u);
      },
    );
  });

  it("(3) resolveApplyId never learns admission ids; frozen byte pins hold", () => {
    expect(resolveApplyId("psr-01f")).toBeUndefined();
    expect(resolveApplyId("psr-99z")).toBeUndefined();
    expect([...REVIEW_GROUPS]).toEqual(["psr-01b", "psr-01c", "psr-01d", "psr-01e"]);
    expect(sha256File(RAW_INVENTORY_REL)).toBe(FROZEN.raw);
    expect(sha256File(`${APPROVALS_DIR}/psr-01b.json`)).toBe(FROZEN["psr-01b"]);
    expect(sha256File(`${APPROVALS_DIR}/psr-01c.json`)).toBe(FROZEN["psr-01c"]);
    expect(sha256File(`${APPROVALS_DIR}/psr-01d.json`)).toBe(FROZEN["psr-01d"]);
    expect(sha256File(`${APPROVALS_DIR}/psr-01e.json`)).toBe(FROZEN["psr-01e"]);
  });

  it("(4) an independently reviewed overlay keep removes only that named extra", () => {
    withTree(closedRemoveTree(), (root) => {
      writeClosedRemoveGroup(root);
      writeAdmission(root, "psr-ghost", [STRAY_KEEP]);
      const production = requireAppliedWith(root, "psr-01c", { admissionGroups: [] });
      expect(production.ok).toBe(false);
      expect(production.detail).toMatch(/extra:.*stray/u);
      const admitted = requireAppliedWith(root, "psr-01c", { admissionGroups: ["psr-ghost"] });
      expect(admitted.ok, admitted.detail).toBe(true);
    });
  });

  it("(5) two extras and one overlay keep: the omitted extra still fails", () => {
    withTree(
      closedRemoveTree("export const listed = 1;\nexport const stray = 2;\nexport const other = 3;\n"),
      (root) => {
        writeClosedRemoveGroup(root, [
          { symbol: "stray", disposition: "remove" },
          { symbol: "other", disposition: "remove" },
        ]);
        writeAdmission(root, "psr-ghost", [STRAY_KEEP]);
        const result = requireAppliedWith(root, "psr-01c", { admissionGroups: ["psr-ghost"] });
        expect(result.ok).toBe(false);
        expect(result.detail).toMatch(/extra:.*other/u);
        expect(result.detail).not.toMatch(/extra:.*stray/u);
      },
    );
  });

  it("(6a) overlay keep over a closed keep is refused", () => {
    withTree(closedRemoveTree(), (root) => {
      writeClosedRemoveGroup(root);
      writeAdmission(root, "psr-ghost", [
        {
          ...STRAY_KEEP,
          symbol: "listed",
          rationale: "illegal re-review of a closed keep",
        },
      ]);
      const result = requireAppliedWith(root, "psr-01c", { admissionGroups: ["psr-ghost"] });
      expect(result.ok).toBe(false);
      expect(result.detail).toBe("closed keep cannot be overlaid");
    });
  });

  it("(6b) overlay owner equals reviewer is refused", () => {
    withTree(closedRemoveTree(), (root) => {
      writeClosedRemoveGroup(root);
      writeAdmission(root, "psr-ghost", [{ ...STRAY_KEEP, owner: "reviewer", reviewedBy: "reviewer" }], {
        reviewedBy: "reviewer",
      });
      const result = requireAppliedWith(root, "psr-01c", { admissionGroups: ["psr-ghost"] });
      expect(result.ok).toBe(false);
      expect(result.detail).toBe("overlay owner equals reviewer");
    });
  });

  it("(6c) overlay wrong base hash is refused", () => {
    withTree(closedRemoveTree(), (root) => {
      writeClosedRemoveGroup(root);
      writeAdmission(root, "psr-ghost", [STRAY_KEEP], { baseRawInventoryHash: "0".repeat(64) });
      const result = requireAppliedWith(root, "psr-01c", { admissionGroups: ["psr-ghost"] });
      expect(result.ok).toBe(false);
      expect(result.detail).toBe("overlay baseRawInventoryHash does not match");
    });
  });

  it("(6d) overlay wrong admissionHash is refused", () => {
    withTree(closedRemoveTree(), (root) => {
      writeClosedRemoveGroup(root);
      writeAdmission(root, "psr-ghost", [STRAY_KEEP], { admissionHash: "0".repeat(64) });
      const result = requireAppliedWith(root, "psr-01c", { admissionGroups: ["psr-ghost"] });
      expect(result.ok).toBe(false);
      expect(result.detail).toBe("overlay admissionHash does not match");
    });
  });

  it("(6e) overlay id/filename mismatch is refused", () => {
    withTree(closedRemoveTree(), (root) => {
      writeClosedRemoveGroup(root);
      writeAdmission(root, "psr-ghost", [STRAY_KEEP], { fileId: "psr-other" });
      const result = requireAppliedWith(root, "psr-01c", { admissionGroups: ["psr-ghost"] });
      expect(result.ok).toBe(false);
      expect(result.detail).toBe("overlay id/filename mismatch");
    });
  });

  it("(6f) overlay traversal, absolute, and backslash paths are refused", () => {
    withTree(closedRemoveTree(), (root) => {
      writeClosedRemoveGroup(root);
      for (const id of ["../approvals/psr-01c", "/tmp/x", "foo\\bar"]) {
        const result = requireAppliedWith(root, "psr-01c", { admissionGroups: [id] });
        expect(result.ok, id).toBe(false);
        expect(result.detail, id).toBe("overlay path refused");
      }
    });
  });

  it("(6g) a well-formed overlay file not in ADMISSION_GROUPS does not admit, and the id stays unknown", () => {
    withTree(closedRemoveTree(), (root) => {
      writeClosedRemoveGroup(root);
      writeAdmission(root, "psr-ghost", [STRAY_KEEP]);
      const production = requireAppliedWith(root, "psr-01c", { admissionGroups: [] });
      expect(production.ok).toBe(false);
      expect(production.detail).toMatch(/extra:.*stray/u);
      const unknown = requireApplied(root, "psr-ghost");
      expect(unknown.ok).toBe(false);
      expect(unknown.detail).toBe("unknown apply id psr-ghost");
      const admitted = requireAppliedWith(root, "psr-01c", { admissionGroups: ["psr-ghost"] });
      expect(admitted.ok, admitted.detail).toBe(true);
    });
  });

  it("(7) frozen closed approvals and raw inventory retain their pinned byte hashes", () => {
    expect(sha256File(RAW_INVENTORY_REL)).toBe(FROZEN.raw);
    expect(sha256File(`${APPROVALS_DIR}/psr-01b.json`)).toBe(FROZEN["psr-01b"]);
    expect(sha256File(`${APPROVALS_DIR}/psr-01c.json`)).toBe(FROZEN["psr-01c"]);
    expect(sha256File(`${APPROVALS_DIR}/psr-01d.json`)).toBe(FROZEN["psr-01d"]);
    expect(sha256File(`${APPROVALS_DIR}/psr-01e.json`)).toBe(FROZEN["psr-01e"]);
  });

  it("(counterweight) production unknown id with a matching approvals file remains unknown", () => {
    withTree(
      {
        "packages/openclinxr/fixture-99z/package.json": manifest("@openclinxr/fixture-99z"),
        "packages/openclinxr/fixture-99z/src/index.ts": "export const listed = 1;\n",
      },
      (root) => {
        writeRawInventory(root);
        writeGroup(root, "psr-99z", [
          {
            package: "packages/openclinxr/fixture-99z",
            entrypoint: ".",
            symbol: "listed",
            kind: "runtime",
            disposition: "keep",
          },
        ]);
        const result = requireApplied(root, "psr-99z");
        expect(result.ok).toBe(false);
        expect(result.detail).toBe("unknown apply id psr-99z");
      },
    );
  });

  it("(counterweight) redirecting fixture group or subset/complement fixture scope is refused by name", () => {
    withTree(closedRemoveTree(), (root) => {
      writeClosedRemoveGroup(root);
      const redirect = requireAppliedWith(root, "psr-fake", {
        resolution: { group: "psr-01c", scope: { kind: "group" } },
      });
      expect(redirect.ok).toBe(false);
      expect(redirect.detail).toBe("invalid fixture resolution");
      const subset = requireAppliedWith(root, "psr-01c", {
        resolution: {
          group: "psr-01c",
          scope: { kind: "packages", packages: ["packages/openclinxr/fixture-closed-remove"] },
        },
      });
      expect(subset.ok).toBe(false);
      expect(subset.detail).toBe("invalid fixture resolution");
      const complement = requireAppliedWith(root, "psr-01c", {
        resolution: { group: "psr-01c", scope: { kind: "complement", exclude: [] } },
      });
      expect(complement.ok).toBe(false);
      expect(complement.detail).toBe("invalid fixture resolution");
    });
  });

  it("(source) requireAppliedWith is not exported by package index or used by production callers", () => {
    expect(readFileSync(join(ROOT, PKG_JSON_REL), "utf8")).not.toMatch(/requireAppliedWith/u);
    expect(readFileSync(join(ROOT, RUNNER_REL), "utf8")).not.toMatch(/requireAppliedWith/u);
    expect(readFileSync(join(ROOT, ACCEPTANCE_REL), "utf8")).not.toMatch(/requireAppliedWith/u);
    const applyMap = readFileSync(join(ROOT, APPLY_MAP_REL), "utf8");
    expect(applyMap).not.toMatch(/requireAppliedWith/u);
    // Initial empty allowlist was the PSR implementation prerequisite. The later
    // independently reviewed activation is exact, not an arbitrary admission id.
    expect(applyMap).toMatch(/export const ADMISSION_GROUPS: readonly string\[\] = \["psr-01f", "actor-audio-runtime-v1", "room-chain-wiring-v1", "teeth-viseme-consumers-v1", "startup-cast-v1", "viseme-motion-subpaths-v1", "xr-dialogue-consumer-split-v1", "staging-layout-view-v1", "live-voice-v1", "s1-stop-clip-runtime-v1"\]/u);
    const resolveStart = applyMap.indexOf("export function resolveApplyId");
    const resolveBody = applyMap.slice(resolveStart);
    expect(resolveBody).not.toMatch(/ADMISSION_GROUPS/u);
    expect(resolveBody).not.toMatch(/admission/iu);
    const gates = readFileSync(join(ROOT, GATES_REL), "utf8");
    expect(gates).toMatch(/export function requireAppliedWith/u);
    expect(gates).toMatch(
      /export function requireApplied\(root: string, id: string, report\?: SurfaceReport\): GateResult/u,
    );
  });
});

describe("the independently reviewed seven-row production activation", () => {
  it("binds the exact allowlist and reviewed admission row hash", () => {
    expect(ADMISSION_GROUPS).toEqual(["psr-01f", "actor-audio-runtime-v1", "room-chain-wiring-v1", "teeth-viseme-consumers-v1", "startup-cast-v1", "viseme-motion-subpaths-v1", "xr-dialogue-consumer-split-v1", "staging-layout-view-v1", "live-voice-v1", "s1-stop-clip-runtime-v1"]);
    const admission = JSON.parse(readFileSync(join(ROOT, ADMISSIONS_DIR, "psr-01f.json"), "utf8"));
    expect(admission.rows).toHaveLength(7);
    expect(admission.admissionHash).toBe("6a4df1fedee5ad0fae42e026eaf6e77c2f1a4155c117a1e3e0c9679f74f90d11");
    expect(overlayAdmissionHash(admission.reviewedBy, admission.rows)).toBe(admission.admissionHash);
    expect(admission.rows.every((row: OverlayRow) => row.owner !== admission.reviewedBy && row.reviewedBy === admission.reviewedBy)).toBe(true);
  });

  it("production applies every frozen group on the real tree while the admission id stays unknown", () => {
    const report = measureSurface(ROOT);
    for (const group of REVIEW_GROUPS) {
      const result = requireApplied(ROOT, group, report);
      expect(result.ok, result.detail).toBe(true);
    }
    expect(requireApplied(ROOT, "psr-01f", report)).toEqual({ ok: false, detail: "unknown apply id psr-01f" });
    expect(requireApplied(ROOT, "room-chain-wiring-v1", report)).toEqual({ ok: false, detail: "unknown apply id room-chain-wiring-v1" });
  });

  it("binds the independently reviewed room-chain subpath admission", () => {
    const admission = JSON.parse(readFileSync(join(ROOT, ADMISSIONS_DIR, "room-chain-wiring-v1.json"), "utf8"));
    expect(admission.reviewedSourceCandidate).toBe("49286f658cf0ddc7b41590b75b1cb09c49bbc05a");
    expect(admission.rows.map((row: OverlayRow) => [row.entrypoint, row.symbol])).toEqual([
      ["./room-chain", "ROOM_CHAIN_RECIPES"], ["./room-chain", "runRoomChain"],
    ]);
    expect(admission.admissionHash).toBe("ebe6ead21077e5f0de1c71c2f7ebb679f356cb61a8716464859a14ce66f1bf74");
    expect(overlayAdmissionHash(admission.reviewedBy, admission.rows)).toBe(admission.admissionHash);
    expect(admission.rows.every((row: OverlayRow) => row.owner !== admission.reviewedBy && row.reviewedBy === admission.reviewedBy)).toBe(true);
  });

  it("binds the independently reviewed viseme-motion subpath admission", () => {
    const admission = JSON.parse(readFileSync(join(ROOT, ADMISSIONS_DIR, "viseme-motion-subpaths-v1.json"), "utf8"));
    expect(admission.rows.map((row: OverlayRow) => [row.entrypoint, row.symbol])).toEqual([
      ["./viseme-runtime", "applyDialogueVisemeTimelineToRoot"],
      ["./viseme-runtime", "applyJawOpenToRoot"],
      ["./viseme-runtime", "mapDialoguePhonemesToCues"],
      ["./viseme-morph", "applyVisemeWeights"],
      ["./viseme-timeline", "jawOpenRadiansForPhoneme"],
      ["./compiler", "CompiledMotionClipV1"],
      ["./compiler", "compileMotionProgram"],
      ["./compiler", "deriveSkeletonProfileFromRigAsset"],
      ["./glb-bake", "MotionGlbBakeClip"],
      ["./glb-bake", "bakeMotionProgramToGlb"],
      ["./glb-bake", "readMotionGlbClipId"],
      ["./manifest-motion-clip-playback", "playManifestMotionClip"],
    ]);
    expect(admission.admissionHash).toBe("e9f056cbd5755242ed090309802ddd3ca649e832a5f89054757c773e6087d845");
    expect(overlayAdmissionHash(admission.reviewedBy, admission.rows)).toBe(admission.admissionHash);
    expect(admission.rows.every((row: OverlayRow) => row.owner !== admission.reviewedBy && row.reviewedBy === admission.reviewedBy)).toBe(true);
  });

  it("binds the independently reviewed consumer-split subpath admission", () => {
    const admission = JSON.parse(readFileSync(join(ROOT, ADMISSIONS_DIR, "xr-dialogue-consumer-split-v1.json"), "utf8"));
    expect(admission.reviewedBy).toBe("Codex gpt-5.6-terra independent review (not an author) of index tree e4cd9f775406e0e861c00bea4e3bf76a49c6c4ce: session 01a118fc-04df-7331-ae3d-2b752b1b4297 rejected the first draft (7 rationales cited non-importing lines); session 01a11901-531b-7d63-b3a4-4c58076b21f1 approved the corrected overlay: all 37 rows publish their symbol and cite a matching import, psr-01e root keeps intact, rootExports 1277->1272, median 20.5 and p90 41 unchanged; 2026-10-07");
    expect(admission.rows.map((row: OverlayRow) => [row.entrypoint, row.symbol])).toEqual([
      ["./evidence-viseme", "applyBlinkClosureToRoot"],
      ["./evidence-viseme", "applyDialogueVisemeTimelineToRoot"],
      ["./evidence-viseme", "applyGeneratedScalarVisemeToRoot"],
      ["./evidence-viseme", "applyJawOpenToRoot"],
      ["./evidence-viseme", "applyVisemeWeights"],
      ["./evidence-viseme", "JAW_OPEN_TEETH_CLEAR_RADIANS"],
      ["./evidence-viseme", "JAW_TEETH_GAIN"],
      ["./evidence-viseme", "jawOpenRadiansForPhoneme"],
      ["./evidence-viseme", "mapDialoguePhonemesToCues"],
      ["./evidence-viseme", "MOUTH_OPEN_CAP"],
      ["./evidence-viseme", "phonemesForText"],
      ["./evidence-viseme", "resolveMorphIndex"],
      ["./package-actor-turn", "ActorTurnPlayback"],
      ["./package-actor-turn", "ActorTurnPlaybackStartContext"],
      ["./package-actor-turn", "attachBakedCuesToSpeech"],
      ["./package-actor-turn", "createActorAudioRuntime"],
      ["./package-actor-turn", "initialDialogueTextForScenario"],
      ["./package-actor-turn", "LiveActorTurnConsumption"],
      ["./package-actor-turn", "phonemesForText"],
      ["./package-actor-turn", "playFrozenActorTurnOnSlot"],
      ["./package-actor-turn", "resolveLiveActorTurnForTrace"],
      ["./package-actor-turn", "visemesForText"],
      ["./package-viseme", "applyBlinkClosureToRoot"],
      ["./package-viseme", "applyGazeToHumanoid"],
      ["./package-viseme", "applyGeneratedScalarVisemeToRoot"],
      ["./package-viseme", "applyJawOpenToRoot"],
      ["./package-viseme", "applyNamedSpeechVisemes"],
      ["./package-viseme", "collectResolvedMorphTargets"],
      ["./package-viseme", "expressionWeightsForEmotion"],
      ["./package-viseme", "JAW_TEETH_GAIN"],
      ["./package-viseme", "jawOpenRadiansForPhoneme"],
      ["./package-viseme", "MOUTH_OPEN_CAP"],
      ["./package-viseme", "PhonemeCue"],
      ["./package-viseme", "SpeechSlotLike"],
      ["./package-viseme", "UiXrExpressionEmotion"],
      ["./package-viseme", "UiXrExpressionWeights"],
      ["./viseme-runtime", "JAW_TEETH_GAIN"],
    ]);
    expect(admission.admissionHash).toBe("941137ad3f663b8da81ed43f3c9856e5f0ce5e82bb3819fd42614ccf92d5b976");
    expect(overlayAdmissionHash(admission.reviewedBy, admission.rows)).toBe(admission.admissionHash);
    expect(admission.rows.every((row: OverlayRow) => row.owner !== admission.reviewedBy && row.reviewedBy === admission.reviewedBy)).toBe(true);
  });

  it("binds the staging layout view admission", () => {
    const admission = JSON.parse(readFileSync(join(ROOT, ADMISSIONS_DIR, "staging-layout-view-v1.json"), "utf8"));
    expect(overlayAdmissionHash(admission.reviewedBy, admission.rows)).toBe(admission.admissionHash);
    expect(admission.rows.every((row: OverlayRow) => row.owner !== admission.reviewedBy && row.reviewedBy === admission.reviewedBy)).toBe(true);
    expect(admission.rows.map((row: OverlayRow) => [row.package, row.entrypoint, row.symbol])).toEqual([
      ["packages/openclinxr/scenario-fixtures", ".", "AuthoredStagingCamera"],
      ["packages/openclinxr/scenario-fixtures", ".", "authoredStagingCameraForScenario"],
      ["packages/openclinxr/xr-scene", ".", "installStationLayoutView"],
    ]);
  });

  it("binds the independently reviewed live-voice client admission", () => {
    const admission = JSON.parse(readFileSync(join(ROOT, ADMISSIONS_DIR, "live-voice-v1.json"), "utf8"));
    expect(admission.reviewedBy).toBe("Codex gpt-5.6-terra independent review (not an author): session 01a11d52-6392-7962-81ce-e3c9bb67c03e approved items B-F on index tree e957cba466d19330669b9d81f958aee7477aba13 (publish all 7 names; own-test bindings count as consumers; no node: builtin in the client graph; ui-xr 10 files / 5993 lines; allowlist classes accurate; exception 1214/1000; no gate loosened) and rejected uncited rationales; session 01a11d55-86e3-75c0-a555-8aae555bb18c rejected one wording; session 01a11d56-20b9-7913-8c91-5b23370f118a approved index tree cb89714f4c06a767d87052279318f43ebb9e9a06: all seven citations resolve; 2026-10-08");
    expect(admission.rows.map((row: OverlayRow) => [row.entrypoint, row.symbol])).toEqual([
      ["./package-actor-turn", "requestUnscriptedLiveTurn"],
      ["./package-actor-turn", "LiveVoiceTurnRequest"],
      ["./package-actor-turn", "LiveVoiceSocket"],
      ["./package-actor-turn", "LiveVoiceAudioContext"],
      ["./package-actor-turn", "bakeLiveSttCueTrack"],
      ["./package-actor-turn", "buildPhonePlan"],
      ["./package-actor-turn", "SttWord"],
    ]);
    expect(admission.admissionHash).toBe("ce6bcbb4f5fd009036e21474a555260b2ccacd3cfa4d6cc39b3d0f37e6344361");
    expect(overlayAdmissionHash(admission.reviewedBy, admission.rows)).toBe(admission.admissionHash);
    expect(admission.rows.every((row: OverlayRow) => row.owner !== admission.reviewedBy && row.reviewedBy === admission.reviewedBy)).toBe(true);
  });

  function withActualEvidence(run: (root: string, admission: { reviewedBy: string; admissionHash: string; rows: OverlayRow[] }) => void): void {
    const admissionBody = readFileSync(join(ROOT, ADMISSIONS_DIR, "psr-01f.json"), "utf8");
    const files: Record<string, string> = {
      [RAW_INVENTORY_REL]: readFileSync(join(ROOT, RAW_INVENTORY_REL), "utf8"),
      [`${ADMISSIONS_DIR}/psr-01f.json`]: admissionBody,
      [`${ADMISSIONS_DIR}/actor-audio-runtime-v1.json`]: readFileSync(join(ROOT, ADMISSIONS_DIR, "actor-audio-runtime-v1.json"), "utf8"),
      [`${ADMISSIONS_DIR}/room-chain-wiring-v1.json`]: readFileSync(join(ROOT, ADMISSIONS_DIR, "room-chain-wiring-v1.json"), "utf8"),
      [`${ADMISSIONS_DIR}/teeth-viseme-consumers-v1.json`]: readFileSync(join(ROOT, ADMISSIONS_DIR, "teeth-viseme-consumers-v1.json"), "utf8"),
      [`${ADMISSIONS_DIR}/startup-cast-v1.json`]: readFileSync(join(ROOT, ADMISSIONS_DIR, "startup-cast-v1.json"), "utf8"),
      [`${ADMISSIONS_DIR}/viseme-motion-subpaths-v1.json`]: readFileSync(join(ROOT, ADMISSIONS_DIR, "viseme-motion-subpaths-v1.json"), "utf8"),
      [`${ADMISSIONS_DIR}/xr-dialogue-consumer-split-v1.json`]: readFileSync(join(ROOT, ADMISSIONS_DIR, "xr-dialogue-consumer-split-v1.json"), "utf8"),
      [`${ADMISSIONS_DIR}/live-voice-v1.json`]: readFileSync(join(ROOT, ADMISSIONS_DIR, "live-voice-v1.json"), "utf8"),
      [`${ADMISSIONS_DIR}/staging-layout-view-v1.json`]: readFileSync(join(ROOT, ADMISSIONS_DIR, "staging-layout-view-v1.json"), "utf8"),
      [`${ADMISSIONS_DIR}/s1-stop-clip-runtime-v1.json`]: readFileSync(join(ROOT, ADMISSIONS_DIR, "s1-stop-clip-runtime-v1.json"), "utf8"),
    };
    for (const group of REVIEW_GROUPS) files[`${APPROVALS_DIR}/${group}.json`] = readFileSync(join(ROOT, APPROVALS_DIR, `${group}.json`), "utf8");
    withTree(files, (root) => run(root, JSON.parse(admissionBody)));
  }

  it("omitting a genuinely admitted row leaves its published symbol as a named extra", () => {
    withActualEvidence((root) => {
      const subpaths = JSON.parse(readFileSync(join(root, `${ADMISSIONS_DIR}/viseme-motion-subpaths-v1.json`), "utf8")) as {
        reviewedBy: string;
        rows: OverlayRow[];
      };
      const rows = subpaths.rows.filter((row) => !(row.entrypoint === "./compiler" && row.symbol === "compileMotionProgram"));
      writeAdmission(root, "viseme-motion-subpaths-v1", rows, { reviewedBy: subpaths.reviewedBy });
      const result = requireApplied(root, "psr-01c", measureSurface(ROOT));
      expect(result.ok).toBe(false);
      expect(result.detail).toMatch(/extra:.*compileMotionProgram/u);
    });
  });

  it("adding an unreviewed row cannot reuse the actual admission hash", () => {
    withActualEvidence((root, admission) => {
      writeAdmission(root, "psr-01f", [...admission.rows, { ...admission.rows[0]!, symbol: "unreviewedExtra" }], { reviewedBy: admission.reviewedBy, admissionHash: admission.admissionHash });
      const result = requireApplied(root, "psr-01c", measureSurface(ROOT));
      expect(result.ok).toBe(false);
      expect(result.detail).toBe("overlay admissionHash does not match");
    });
  });

  it("a row whose owner is its reviewer is refused by name", () => {
    withActualEvidence((root, admission) => {
      const rows = admission.rows.map((row) => ({ ...row, owner: admission.reviewedBy }));
      writeAdmission(root, "psr-01f", rows, { reviewedBy: admission.reviewedBy });
      const result = requireApplied(root, "psr-01c", measureSurface(ROOT));
      expect(result.ok).toBe(false);
      expect(result.detail).toBe("overlay owner equals reviewer");
    });
  });

  it("a changed admission hash is refused even with all seven real rows intact", () => {
    withActualEvidence((root, admission) => {
      writeAdmission(root, "psr-01f", admission.rows, { reviewedBy: admission.reviewedBy, admissionHash: "0".repeat(64) });
      const result = requireApplied(root, "psr-01c", measureSurface(ROOT));
      expect(result.ok).toBe(false);
      expect(result.detail).toBe("overlay admissionHash does not match");
    });
  });
});
