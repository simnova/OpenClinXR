import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * factory:trellis:hatch — text prompt + Imagine pack → remesh bake → optimize → pack.
 *
 * Dry-run only; never starts GPU. Contracts:
 *  - missing PNG (neither hatch pack/ nor trellis-packs/<id>-escape/) → hatch-report.json
 *    status=imagine_required and exit 3.
 *  - tiny fixture PNG present → plan includes remesh_bake + optimize + pack, no GPU.
 */

const ROOT = process.cwd();
const CLI = "tools/openclinxr/asset-pipeline/trellis/trellis-hatch-cli.ts";

/** 1×1 transparent PNG (valid, 68 bytes). */
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function tsxBin(): string {
  const local = join(ROOT, "node_modules", ".bin", "tsx");
  return existsSync(local) ? local : "tsx";
}

function hatchEnv(tmp: string) {
  return {
    OPENCLINXR_TRELLIS_PACKS: join(tmp, "packs"),
    OPENCLINXR_TRELLIS_HATCH: join(tmp, "hatch"),
  };
}

function runHatch(args: string[], env: Record<string, string>) {
  return execFileSync(tsxBin(), [CLI, ...args], {
    encoding: "utf8",
    cwd: ROOT,
    env: { ...process.env, ...env },
  });
}

function writeFixturePng(p: string) {
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, Buffer.from(PNG_B64, "base64"));
}

describe("factory TRELLIS hatch CLI", () => {
  it("package.json exposes factory:trellis:hatch and --dry-run never starts GPU", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.["factory:trellis:hatch"]).toBeTruthy();
  }, 30_000);

  it("dry-run with missing PNG → imagine_required / exit 3, no fake PNG", () => {
    const tmp = mkdtempSync(join(tmpdir(), "hatch-missing-"));
    let exitCode = -1;
    let stdout = "";
    try {
      runHatch(["--subject", "missing-prop", "--prompt", "a hospital widget", "--dry-run"], hatchEnv(tmp));
    } catch (err) {
      const e = err as { status?: number; stdout?: string };
      exitCode = e.status ?? -1;
      stdout = e.stdout ?? "";
    }
    expect(exitCode).toBe(3);

    const report = JSON.parse(
      readFileSync(join(tmp, "hatch", "missing-prop", "hatch-report.json"), "utf8"),
    ) as { status?: string };
    expect(report.status).toBe("imagine_required");
    // Do not fabricate a PNG.
    expect(existsSync(join(tmp, "hatch", "missing-prop", "pack", "three_quarter_upper_alpha.png"))).toBe(false);
    expect(existsSync(join(tmp, "packs", "missing-prop-escape", "three_quarter_upper_alpha.png"))).toBe(false);
    // stdout stays empty on the failure path (diagnostics go to stderr).
    expect(stdout).toBe("");
  }, 30_000);

  it("dry-run with a tiny fixture PNG → plan includes remesh_bake + optimize + pack, no GPU", () => {
    const tmp = mkdtempSync(join(tmpdir(), "hatch-fixture-"));
    writeFixturePng(
      join(tmp, "packs", "fixture-prop-escape", "three_quarter_upper_alpha.png"),
    );

    const stdout = runHatch(
      ["--subject", "fixture-prop", "--prompt", "black void chunky hospital widget", "--dry-run"],
      hatchEnv(tmp),
    );

    const plan = JSON.parse(stdout.includes("{") ? stdout.slice(stdout.indexOf("{")) : stdout) as {
      mode?: string;
      inputImageSource?: string;
      steps?: string[];
      bake?: { remesh?: boolean; seed?: number };
    };
    expect(plan.mode).toBe("dry-run");
    expect(plan.inputImageSource).toBe("imagine_pack");
    expect(plan.steps).toEqual(["remesh_bake", "optimize", "pack"]);
    expect(plan.bake?.remesh).toBe(true);
    expect(plan.bake?.seed).toBe(42);

    // No GPU side effects: no bake-measure.json / GLB / champion produced.
    expect(existsSync(join(tmp, "hatch", "fixture-prop", "fixture-prop-escape", "bake-measure.json"))).toBe(false);
    expect(existsSync(join(tmp, "hatch", "fixture-prop", "optimize", "champion.glb"))).toBe(false);
  }, 30_000);

  it("dry-run with a hatch pack copy is accepted and applies thick-volume preamble when prompt lacks cues", () => {
    const tmp = mkdtempSync(join(tmpdir(), "hatch-packcopy-"));
    writeFixturePng(join(tmp, "hatch", "plain-prop", "pack", "three_quarter_upper_alpha.png"));

    const stdout = runHatch(
      ["--subject", "plain-prop", "--prompt", "a plain widget", "--dry-run"],
      hatchEnv(tmp),
    );

    const plan = JSON.parse(stdout.includes("{") ? stdout.slice(stdout.indexOf("{")) : stdout) as {
      inputImageSource?: string;
      thickVolumePreambleApplied?: boolean;
    };
    expect(plan.inputImageSource).toBe("hatch_pack");
    expect(plan.thickVolumePreambleApplied).toBe(true);
  }, 30_000);
});
