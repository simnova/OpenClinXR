/**
 * run-chain-materialize.test.ts — the optional per-actor materialize record.
 * Kevin's stage manifest carries the fix-c1 brow bake as per-actor DATA
 * (tool + argv with the --eyebrow-tris-budget pair + provenance); the fleet
 * default stays 9000 and no actor literal enters the materializer.
 * The invocation half resolves the recorded bake command through a stub
 * spawner that only records argv: no process is ever spawned for materialize.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { materializeInvocation, materializerFlagSet, runChain, validateManifest } from "./run-chain";

const KEVIN_FILES = [
  "tools/openclinxr/asset-pipeline/humanoid-chain/manifests/mpfb-peds-nurse-kevin.json",
  "tools/openclinxr/asset-pipeline/humanoid-chain/manifests/mpfb-peds-nurse-kevin.no-stage10.json",
];

const FAKE_TOOL = "tools/openclinxr/asset-pipeline/humanoid-chain/tests/helpers/fake-stage.mjs";

function manifestWith(materialize: unknown): Record<string, unknown> {
  return {
    actorId: "test-actor",
    materialize,
    stages: [{ id: "01", name: "x", tool: FAKE_TOOL, kind: "node", argv: ["{in}", "{out}"] }],
    excluded: [],
  };
}

describe("materialize record", () => {
  it("kevin manifests validate and carry the brow-budget argv pair", () => {
    for (const f of KEVIN_FILES) {
      const manifest = validateManifest(JSON.parse(readFileSync(join(process.cwd(), f), "utf8")));
      expect(manifest.materialize).toBeDefined();
      expect(manifest.materialize?.tool).toBe(
        "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py",
      );
      const argv = manifest.materialize?.argv ?? [];
      const i = argv.indexOf("--eyebrow-tris-budget");
      expect(i).toBeGreaterThanOrEqual(0);
      expect(argv[i + 1]).toBe("28716");
      expect(manifest.materialize?.provenance).toBe("style-08 undecimated, main e9ef9e3fb");
    }
  });

  it("refuses a materialize with an empty argv, naming argv", () => {
    expect(() =>
      validateManifest(manifestWith({ tool: FAKE_TOOL, argv: [], provenance: "p" })),
    ).toThrow(/materialize\.argv/);
  });

  it("refuses a materialize with an empty-string argv entry, naming argv", () => {
    expect(() =>
      validateManifest(manifestWith({ tool: FAKE_TOOL, argv: ["--output", ""], provenance: "p" })),
    ).toThrow(/materialize\.argv/);
  });

  it("refuses a materialize with an empty tool, naming tool", () => {
    expect(() =>
      validateManifest(manifestWith({ tool: "", argv: ["{out}"], provenance: "p" })),
    ).toThrow(/materialize\.tool/);
  });

  it("refuses a materialize missing provenance, naming provenance", () => {
    expect(() =>
      validateManifest(manifestWith({ tool: FAKE_TOOL, argv: ["{out}"] })),
    ).toThrow(/materialize\.provenance/);
    expect(() =>
      validateManifest(manifestWith({ tool: FAKE_TOOL, argv: ["{out}"], provenance: "" })),
    ).toThrow(/materialize\.provenance/);
  });

  it("a manifest without materialize still validates (other actors)", () => {
    const manifest = validateManifest({
      actorId: "other-actor",
      stages: [{ id: "01", name: "x", tool: FAKE_TOOL, kind: "node", argv: ["{in}", "{out}"] }],
      excluded: [],
    });
    expect(manifest.actorId).toBe("other-actor");
    expect(manifest.materialize).toBeUndefined();
  });

  // CI 44195741094 measured 5.7 s max; x3 ≈ 20 s
  it("echoes a non-existent materialize tool verbatim and never executes it", { timeout: 20_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "chain-mat-"));
    const input = join(dir, "input.glb");
    writeFileSync(input, Buffer.from("GLB0", "utf8"));
    const record = {
      tool: "__never_executed__/materialize-sentinel.mjs",
      argv: ["--input", "{in}", "--output", "{out}"],
      provenance: "sentinel",
    };
    const manifestPath = join(dir, "manifest.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        actorId: "test-actor",
        materialize: record,
        stages: [{ id: "01", name: "x", tool: FAKE_TOOL, kind: "node", argv: ["--input", "{in}", "--output", "{out}"] }],
        excluded: [],
      }),
    );
    const out = join(dir, "out");
    const report = runChain({ manifestPath, input, out });
    expect(report.status).toBe("complete");
    expect(report.materialize).toEqual(record);
    const onDisk = JSON.parse(readFileSync(join(out, "chain-report.json"), "utf8"));
    expect(onDisk.materialize).toEqual(record);
    expect(existsSync(resolve(process.cwd(), record.tool))).toBe(false);
  });

  // CI 44195741094 measured 5.7 s max; x3 ≈ 20 s
  it("omits the materialize key when the manifest has none", { timeout: 20_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "chain-mat-"));
    const input = join(dir, "input.glb");
    writeFileSync(input, Buffer.from("GLB0", "utf8"));
    const manifestPath = join(dir, "manifest.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        actorId: "test-actor",
        stages: [{ id: "01", name: "x", tool: FAKE_TOOL, kind: "node", argv: ["--input", "{in}", "--output", "{out}"] }],
        excluded: [],
      }),
    );
    const out = join(dir, "out");
    const report = runChain({ manifestPath, input, out });
    expect(report.status).toBe("complete");
    expect(report.materialize).toBeUndefined();
    const onDisk = JSON.parse(readFileSync(join(out, "chain-report.json"), "utf8"));
    expect("materialize" in onDisk).toBe(false);
  });

  // CI 44195741094 measured 5.7 s max; x3 ≈ 20 s
  it("resolves the materializer from a non-root cwd (N1: no cwd dependence)", { timeout: 20_000 }, () => {
    const root = process.cwd();
    const cli = join(root, "tools/openclinxr/asset-pipeline/humanoid-chain/print-materialize-invocation.ts");
    const tsx = join(root, "node_modules/.bin/tsx");
    const manifestPath = join(root, KEVIN_FILES[0] as string);
    const manifest = validateManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
    const dir = mkdtempSync(join(tmpdir(), "chain-mat-cwd-"));
    const out = join(dir, "out.glb");
    const expected = materializeInvocation(manifest, out, { knownFlags: materializerFlagSet() });
    const r = spawnSync(tsx, [cli, "--manifest", manifestPath, "--out", out], {
      cwd: tmpdir(),
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(r.error).toBeUndefined();
    expect(r.status).toBe(0);
    const lines = String(r.stdout).trim().split("\n");
    expect(lines[0]).toBe(`TOOL ${expected.tool}`);
    expect(lines.slice(1)).toEqual(expected.argv);
  });

  it("pins the fleet eyebrow default and keeps actor literals out of the materializer patch", () => {
    const root = process.cwd();
    const rel = "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py";
    const src = readFileSync(join(root, rel), "utf8");
    expect(src).toContain("DEFAULT_EYEBROW_BUDGET_TRIS = 9000");
    expect(src).toContain("_authored_hair_color_rgba(_hair_color_token)");
    // 29 actor literals predate the brow patch (main 44120f3bd); the patch may add none.
    expect(src.match(/kevin/gi)?.length ?? 0).toBeLessThanOrEqual(29);
  });
});

describe("materializeInvocation", () => {
  function kevinManifest(): ReturnType<typeof validateManifest> {
    return validateManifest(
      JSON.parse(readFileSync(join(process.cwd(), KEVIN_FILES[0] as string), "utf8")),
    );
  }

  function kevinFlags(argv: string[]): string[] {
    return [...new Set(argv.filter((a) => a.startsWith("--")).map((a) => a.split("=")[0] as string))];
  }

  it("resolves the Kevin bake argv with {out} substituted and records it via the stub", () => {
    const manifest = kevinManifest();
    const recorded = manifest.materialize?.argv ?? [];
    const captured: Array<{ tool: string; argv: string[] }> = [];
    const inv = materializeInvocation(manifest, "/x/out.glb", {
      knownFlags: materializerFlagSet(),
      spawn: (tool, argv) => {
        captured.push({ tool, argv });
      },
    });
    expect(inv.tool).toBe(
      "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py",
    );
    expect(inv.argv).toEqual(recorded.map((a) => a.split("{out}").join("/x/out.glb")));
    const i = inv.argv.indexOf("--eyebrow-tris-budget");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(inv.argv.slice(i, i + 2)).toEqual(["--eyebrow-tris-budget", "28716"]);
    expect(inv.argv).toContain("/x/out.glb");
    expect(inv.argv).not.toContain("{out}");
    expect(captured).toHaveLength(1);
    expect(captured[0]?.tool).toBe(inv.tool);
    expect(captured[0]?.argv).toEqual(inv.argv);
  });

  it("counterweight: a budget edit flows through verbatim, old value gone", () => {
    const manifest = kevinManifest();
    const argv = (manifest.materialize?.argv ?? []).map((a) =>
      a === "28716" ? "9000" : a,
    );
    const edited = validateManifest({
      ...(manifest as unknown as Record<string, unknown>),
      materialize: { ...(manifest.materialize as object), argv },
    });
    const captured: string[][] = [];
    const inv = materializeInvocation(edited, "/x/out.glb", {
      knownFlags: materializerFlagSet(),
      spawn: (_tool, a) => {
        captured.push(a);
      },
    });
    expect(inv.argv).toContain("9000");
    expect(inv.argv).not.toContain("28716");
    expect(captured[0]).toEqual(inv.argv);
  });

  it("refuses argv without {out}, an undeclared flag, and a missing required flag", () => {
    const manifest = kevinManifest();
    const flags = materializerFlagSet();
    // The parse must cover every flag the Kevin record uses — never pass on an empty set.
    expect(flags.size).toBeGreaterThanOrEqual(kevinFlags(manifest.materialize?.argv ?? []).length);
    for (const f of kevinFlags(manifest.materialize?.argv ?? [])) expect(flags.has(f)).toBe(true);

    const noOut = validateManifest(
      manifestWith({
        tool: manifest.materialize?.tool,
        argv: ["--output", "/x/out.glb"],
        provenance: "p",
      }),
    );
    expect(() => materializeInvocation(noOut, "/x/out.glb", { knownFlags: flags })).toThrow(
      /lacks \{out\}/,
    );

    const badFlag = validateManifest(
      manifestWith({
        tool: manifest.materialize?.tool,
        argv: ["--output", "{out}", "--definitely-not-a-materializer-flag", "x"],
        provenance: "p",
      }),
    );
    expect(() => materializeInvocation(badFlag, "/x/out.glb", { knownFlags: flags })).toThrow(
      /not declared/,
    );

    const noOutput = validateManifest(
      manifestWith({
        tool: manifest.materialize?.tool,
        argv: ["--reference", "peds_nurse_kevin", "{out}"],
        provenance: "p",
      }),
    );
    expect(() => materializeInvocation(noOutput, "/x/out.glb", { knownFlags: flags })).toThrow(
      /required flag --output/,
    );

    expect(() =>
      materializeInvocation({ actorId: "no-mat", stages: [], excluded: [] }, "/x/out.glb", {
        knownFlags: flags,
      }),
    ).toThrow(/no materialize record/);
  });
});
