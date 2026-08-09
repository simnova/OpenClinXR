import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

/**
 * PLANTED CONTRACTS (#238). Factory CLI: pnpm factory:trellis:bake --subject <id>
 *
 * #237 proved isolation bake works. Package it as a factory station entry so multi-case
 * is not ad-hoc shell scripts under evidence/.
 *
 * CLI must:
 *  - accept --subject wall-clock|bedside-monitor|ecg-cart|...
 *  - spawn **fresh subprocess** per subject (isolation from #237)
 *  - write measure + glb under a stable evidence/output path
 *  - support --dry-run (no GPU) proving argv + isolation plan
 *  - support --validate-latest (read last bake report without re-running)
 *
 * Header IMMUTABLE — append ## FIXED (#238).
 */

const ROOT = process.cwd();

describe("factory TRELLIS bake CLI (#238)", () => {
  it("pnpm factory:trellis:bake --help and --dry-run document isolation and subjects", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.["factory:trellis:bake"], "package.json script factory:trellis:bake").toBeTruthy();
    expect(pkg.scripts?.["factory:trellis:bake:validate"]).toBeTruthy();

    const help = execFileSync(
      "pnpm",
      ["exec", "tsx", "tools/openclinxr/asset-pipeline/trellis/trellis-bake-cli.ts", "--help"],
      { encoding: "utf8", cwd: ROOT },
    );
    expect(help.toLowerCase()).toMatch(/subject|isolation|subprocess|dry-run/);

    const dry = execFileSync(
      "pnpm",
      [
        "exec",
        "tsx",
        "tools/openclinxr/asset-pipeline/trellis/trellis-bake-cli.ts",
        "--subject",
        "wall-clock",
        "--dry-run",
      ],
      { encoding: "utf8", cwd: ROOT },
    );
    const plan = JSON.parse(dry.includes("{") ? dry.slice(dry.indexOf("{")) : dry) as {
      processIsolation?: string;
      subjectId?: string;
    };
    expect(plan.subjectId).toBe("wall-clock");
    expect(String(plan.processIsolation || dry).toLowerCase()).toMatch(
      /fresh_subprocess|subprocess|isolated/,
    );
  }, 120_000);

  it("validate-latest reads a bake report without GPU (COUNTERWEIGHT)", () => {
    // Prefer issue-237 wall-clock measure if present; else CLI must still exit 0 with clear missing-report message
    const out = execFileSync(
      "pnpm",
      ["exec", "tsx", "tools/openclinxr/asset-pipeline/trellis/trellis-bake-cli.ts", "--validate-latest"],
      { encoding: "utf8", cwd: ROOT },
    );
    expect(out.length).toBeGreaterThan(20);
    // Either validated or explicit missing — never silent success with empty stdout
    expect(out.toLowerCase()).toMatch(/valid|triangle|subject|missing|report/);
  }, 120_000);
});
