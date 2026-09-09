import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  INDEX_FILENAME,
  buildPackageAgentIndex,
  checkNoOrphanedPackageAgentIndexes,
  checkPackageAgentIndexesAreCurrent,
  entrypointPurpose,
  indexedPackages,
  serializePackageAgentIndex,
} from "../checks/package-agent-index.js";

/**
 * OBSERVABLE: a delegated worker pays its localization cost in grep and read.
 *
 * MEASURED 2026-09-08 across seven Grok worker transcripts for this repo, counting tool names in
 * each session's updates.jsonl:
 *
 *   run_terminal_command   grep   read_file   search_replace   list_dir   write   LSP
 *   53 .. 196              6..104  4..168      22..372          2..6       2..6    0
 *
 * The LSP column is zero in every session. `.grok/config.toml` sets `lsp_tools = true`, so the
 * capability is configured and unused, and the only mention of LSP in those transcripts is a
 * worker reasoning about diagnostics pushed to it after an edit. arXiv 2608.13568 measures the
 * same preference independently and puts LSP at +6% to +118% tokens against grep for symbol
 * localization.
 *
 * So the lever is not a better search tool, it is handing the worker the answer. arch-index.json
 * is that answer, and board-brief.ts injects it into every generated brief — the one artifact
 * every worker reads.
 *
 * WHY A GATE. An index nobody regenerates is a second description of the code, and this repo has
 * already paid for that in prose: PROTO_VERIFY_DELEGATION reached 4,456 lines of instructions that
 * no test enforced. A stale index is worse than a missing one, because a worker reads it, acts on
 * it, and the error surfaces as a wrong edit rather than as an absent file.
 *
 * notEvidenceFor: that injecting the index reduces worker tokens. That claim needs the before and
 * after comparison recorded beside this slice, not a passing gate.
 */

/** A minimal workspace whose shape is the real one: packages/openclinxr/<pkg>/src/index.ts. */
function withFixturePackage(
  files: Record<string, string>,
  run: (root: string, pkg: string) => void,
): void {
  const root = mkdtempSync(join(tmpdir(), "arch-index-"));
  const pkg = "fixture-package";
  try {
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/**\n");
    for (const [rel, body] of Object.entries(files)) {
      const full = join(root, "packages", "openclinxr", pkg, rel);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, body);
    }
    run(root, pkg);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const MANIFEST = JSON.stringify({
  name: "@openclinxr/fixture-package",
  dependencies: { "@openclinxr/domain": "workspace:*", three: "catalog:" },
  scripts: { test: "vitest run --root .", typecheck: "tsgo --noEmit", dev: "vite" },
});

describe("packages carry a derived agent index", () => {
  it("(1) every package with an entrypoint has a CURRENT index", () => {
    const violations = checkPackageAgentIndexesAreCurrent();
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("(2) no index file describes a directory that stopped publishing an entrypoint", () => {
    const violations = checkNoOrphanedPackageAgentIndexes();
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("(3) the live tree actually has indexes, so clauses (1) and (2) are not green about nothing", () => {
    // Without this, deleting all 42 index files satisfies (1) and (2) by having nothing to check.
    const packages = indexedPackages();
    expect(packages.length).toBeGreaterThan(20);
    for (const pkg of packages) {
      const built = buildPackageAgentIndex(pkg);
      expect(built, `${pkg} builds an index`).not.toBeNull();
    }
  });
});

describe("agent index detector (fixture-level — proves it can fail)", () => {
  it("(4) a STALE index is reported", () => {
    // The failure that matters: the file exists, so nothing looks wrong, and it describes a tree
    // that no longer exists.
    withFixturePackage(
      { "package.json": MANIFEST, "src/index.ts": 'export const alpha = 1;\n' },
      (root, pkg) => {
        const built = buildPackageAgentIndex(pkg, root);
        expect(built?.exports).toEqual(["alpha"]);
        writeFileSync(
          join(root, "packages", "openclinxr", pkg, INDEX_FILENAME),
          serializePackageAgentIndex(built as NonNullable<typeof built>),
        );
        expect(checkPackageAgentIndexesAreCurrent(root)).toEqual([]);

        // The code gains an export and the committed index does not.
        writeFileSync(
          join(root, "packages", "openclinxr", pkg, "src", "index.ts"),
          "export const alpha = 1;\nexport const beta = 2;\n",
        );
        const stale = checkPackageAgentIndexesAreCurrent(root);
        expect(stale).toHaveLength(1);
        expect(stale[0]).toContain("stale");
      },
    );
  });

  it("(5) COUNTERWEIGHT: deleting the index is reported, so removal is not a way to pass", () => {
    withFixturePackage(
      { "package.json": MANIFEST, "src/index.ts": "export const alpha = 1;\n" },
      (root) => {
        const missing = checkPackageAgentIndexesAreCurrent(root);
        expect(missing).toHaveLength(1);
        expect(missing[0]).toContain("missing");
      },
    );
  });

  it("(6) every field is DERIVED from the tree, not carried from the committed file", () => {
    withFixturePackage(
      {
        "package.json": MANIFEST,
        "src/index.ts": "export { helper } from './helper.js';\nexport type Thing = { a: 1 };\n",
        "src/helper.ts": "export const helper = 1;\n",
        "src/helper.test.ts": "export const t = 1;\n",
        [INDEX_FILENAME]: '{ "package": "lies", "exports": ["nothing-like-this"] }\n',
      },
      (root, pkg) => {
        const built = buildPackageAgentIndex(pkg, root);
        expect(built?.package).toBe(pkg);
        expect(built?.name).toBe("@openclinxr/fixture-package");
        expect(built?.exports).toEqual(["Thing", "helper"]);
        // Only workspace: ranges are dependency-layer facts; a catalog: pin is a version.
        expect(built?.workspaceDependencies).toEqual(["@openclinxr/domain"]);
        expect(built?.tests).toEqual(["src/helper.test.ts"]);
        // Only the verification scripts, and each one runnable as written.
        expect(built?.commands).toEqual({
          test: "pnpm --filter @openclinxr/fixture-package test",
          typecheck: "pnpm --filter @openclinxr/fixture-package typecheck",
        });
      },
    );
  });

  it("(7) purpose comes from the entrypoint's leading TSDoc, and is absent when there is none", () => {
    expect(entrypointPurpose("export { a } from './a.js';\n")).toBeUndefined();
    expect(
      entrypointPurpose("/**\n * Stages a station scene. Later prose is not the purpose.\n */\nexport const a = 1;\n"),
    ).toBe("Stages a station scene.");
    // A path inside the first sentence must not end it early.
    expect(
      entrypointPurpose("/**\n * Extracted from apps/ui-xr/src/main.ts for the composition root. Rest.\n */\n"),
    ).toBe("Extracted from apps/ui-xr/src/main.ts for the composition root.");
  });
});
