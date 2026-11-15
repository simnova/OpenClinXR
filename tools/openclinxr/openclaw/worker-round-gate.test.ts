import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { declaredHiddenFacts, scanFileForHiddenFacts } from "../evidence/licence/hidden-case-facts.js";
import {
  type CommandRunner,
  defaultCommandRunner,
  runCheck,
  runClose,
  runFollowupCheck,
  toolsStrictErrorCeiling,
} from "./worker-round-gate.js";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const scratchDirs: string[] = [];

function cleanGitEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
}

function git(tree: string, args: string[]): string {
  return execFileSync("git", args, { cwd: tree, encoding: "utf8", env: cleanGitEnv() });
}

function put(tree: string, file: string, contents: string): void {
  const target = path.join(tree, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents, "utf8");
}

function fixture(initial: Record<string, string> = {}): string {
  const tree = mkdtempSync(path.join(tmpdir(), `worker-round-gate-test-${process.pid}-`));
  scratchDirs.push(tree);
  copyFileSync(path.join(ROOT, "biome.json"), path.join(tree, "biome.json"));
  copyFileSync(path.join(ROOT, ".gitignore"), path.join(tree, ".gitignore"));
  const hiddenModule = "tools/openclinxr/evidence/licence/hidden-case-facts.ts";
  put(tree, hiddenModule, readFileSync(path.join(ROOT, hiddenModule), "utf8"));
  for (const [file, contents] of Object.entries(initial)) put(tree, file, contents);
  git(tree, ["init", "-q"]);
  git(tree, ["add", "."]);
  git(tree, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "base"]);
  return tree;
}

async function captureCheck(tree: string, extra: Partial<Parameters<typeof runCheck>[0]> = {}) {
  const lines: string[] = [];
  const result = await runCheck({ tree, base: "HEAD", log: (line) => lines.push(line), ...extra });
  return { result, output: lines.join("\n") };
}

function diagnosticOutput(unique: number, duplicate = false): string {
  const lines = Array.from(
    { length: unique },
    (_, index) => `tools/f${index}.ts(1,1): error TS4111: planted ${index}`,
  );
  if (duplicate && lines[0] != null) lines.push(lines[0]);
  return lines.join("\n");
}

function recordingRunner(invocations: string[]): CommandRunner {
  return (spec) => {
    invocations.push([spec.command, ...spec.args].join(" "));
    return spec.command === "git" ? defaultCommandRunner(spec) : { rc: 0, stdout: "injected pass", stderr: "" };
  };
}

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("worker round gate", () => {
  it("R1 RED biome: a touched file that adds one error fails G1 and names the file", async () => {
    const tree = fixture({ "apps/example/src/clean.ts": "export const clean = 1;\n" });
    put(tree, "apps/example/src/clean.ts", "debugger;\nexport const clean = 1;\n");
    const { result, output } = await captureCheck(tree);
    expect(result.rc).toBe(1);
    expect(result.stages.find((stage) => stage.id === "G1")?.pass).toBe(false);
    expect(output).toContain("apps/example/src/clean.ts");
  });

  it("R2 RED hidden fact: an untracked scanned file fails while the tracked-only scan sees nothing", async () => {
    const source = readFileSync(
      path.join(ROOT, "packages/openclinxr/scenario-fixtures/src/adult-abdominal-pain.ts"),
      "utf8",
    );
    const planted = "Fixture-only hidden fact sentinel 2026-11-14";
    const tree = fixture({
      "packages/openclinxr/scenario-fixtures/src/adult-abdominal-pain.ts":
        `${source}\nexport const reviewFixtureOnly = { hiddenFacts: [${JSON.stringify(planted)}] };\n`,
    });
    expect(declaredHiddenFacts(tree).includes(planted)).toBe(true);
    put(tree, "docs/notes.json", `${JSON.stringify({ note: planted })}\n`);
    const tracked = git(tree, ["ls-files", "docs", "apps/ui-xr/public", "tools/openclinxr/evidence/site/fixtures/mn2"])
      .split("\n")
      .filter(Boolean)
      .flatMap((file) => scanFileForHiddenFacts(tree, file));
    expect(tracked).toEqual([]);
    const { result, output } = await captureCheck(tree);
    expect(result.rc).toBe(1);
    expect(result.stages.find((stage) => stage.id === "G4")?.pass).toBe(false);
    expect(output).toContain("docs/notes.json");
    expect(output.includes(planted)).toBe(false);
  });

  it("R3 COUNTERWEIGHT clean: an unchanged fixture skips every stage with a reason", async () => {
    const tree = fixture();
    const json = path.join(tree, "gate.json");
    const { result, output } = await captureCheck(tree, { json });
    expect(result.rc).toBe(0);
    expect(result.stages.map((stage) => stage.id)).toEqual(["G1", "G2", "G3", "G4", "G5", "G5b", "G6"]);
    expect(result.stages.every((stage) => !stage.selected && stage.reason.length > 0)).toBe(true);
    expect(output).toMatch(/STAGE G1 SKIPPED/u);
    expect(output).toMatch(/STAGE G6 SKIPPED/u);
    expect(JSON.parse(readFileSync(json, "utf8"))).toEqual({
      base: "HEAD",
      touched: [],
      stages: result.stages,
    });
  });

  it("R4 COUNTERWEIGHT baseline: existing Biome errors pass until the touched file adds another", async () => {
    const tree = fixture({ "apps/example/src/baseline.ts": "debugger;\nexport const baseline = 1;\n" });
    put(tree, "apps/example/src/baseline.ts", "debugger;\nexport const baseline = 2;\n");
    const same = await captureCheck(tree);
    expect(same.result.rc).toBe(0);
    expect(same.result.stages.find((stage) => stage.id === "G1")?.pass).toBe(true);
    put(tree, "apps/example/src/baseline.ts", "debugger;\nexport const value: any = 2;\n");
    const grown = await captureCheck(tree);
    expect(grown.result.rc).toBe(1);
    expect(grown.output).toContain("error-level diagnostics 1 -> 2");
  });

  it("R5 RED launcher: declared review rounds require a ruling while gate and legacy cases do not", () => {
    const job = mkdtempSync(path.join(tmpdir(), `worker-round-followup-${process.pid}-`));
    scratchDirs.push(job);
    put(job, "followup1.txt", "KIND::review\nfirst\n");
    put(job, "followup2.txt", "KIND::review\nsecond\n");
    expect(runFollowupCheck(job, path.join(job, "followup2.txt"), () => undefined)).toBe(3);
    put(job, "followup2.txt", "KIND::review RULING:super-ceo-cap28/x\nsecond\n");
    expect(runFollowupCheck(job, path.join(job, "followup2.txt"), () => undefined)).toBe(0);
    put(job, "followup2.txt", "KIND::gate\ncites REVIEW2.md\n");
    expect(runFollowupCheck(job, path.join(job, "followup2.txt"), () => undefined)).toBe(0);
    put(job, "followup2.txt", "no declaration\n");
    expect(runFollowupCheck(job, path.join(job, "followup2.txt"), () => undefined)).toBe(4);
    put(job, "followup1.txt", "legacy\n");
    put(job, "followup2.txt", "KIND::review\nfirst declared review\n");
    expect(runFollowupCheck(job, path.join(job, "followup2.txt"), () => undefined)).toBe(0);
    for (const earlier of ["kind::review", "KIND ::review", "  KIND::Review"]) {
      put(job, "followup1.txt", `${earlier}\nvariant first review\n`);
      put(job, "followup2.txt", "KIND::review\ncanonical second review\n");
      expect(runFollowupCheck(job, path.join(job, "followup2.txt"), () => undefined)).toBe(3);
    }
  });

  it("R6 stage selection: docs HTML, tools TypeScript, and Markdown select only their trigger-driven gates", async () => {
    const ceiling = await toolsStrictErrorCeiling();
    const htmlTree = fixture();
    put(htmlTree, "docs/x.html", "<!doctype html><title>x</title>\n");
    const htmlInvocations: string[] = [];
    const html = await captureCheck(htmlTree, { commandRunner: recordingRunner(htmlInvocations) });
    expect(html.result.stages.find((stage) => stage.id === "G4")?.selected).toBe(true);
    expect(html.result.stages.find((stage) => stage.id === "G5")?.selected).toBe(true);
    expect(html.output).toContain("STAGE G5b SKIPPED no-browser");
    expect(htmlInvocations.some((command) => command === "pnpm pages:validate")).toBe(true);
    expect(htmlInvocations.some((command) => command.includes(" typecheck"))).toBe(false);
    expect(htmlInvocations.some((command) => command === "pnpm docs:drift-check")).toBe(false);

    const toolsTree = fixture({
      "packages/example/package.json": JSON.stringify({ scripts: { typecheck: "tsc --noEmit" } }),
      "packages/example/src/example.ts": "export const before = 1;\n",
    });
    put(toolsTree, "tools/new.ts", "export const clean = 1;\n");
    put(toolsTree, "packages/example/src/example.ts", "export const after = 2;\n");
    const toolsInvocations: string[] = [];
    const tools = await captureCheck(toolsTree, {
      commandRunner: recordingRunner(toolsInvocations),
      diagnosticOutput: diagnosticOutput(ceiling, true),
    });
    expect(tools.result.stages.find((stage) => stage.id === "G2")?.selected).toBe(true);
    expect(
      toolsInvocations.some(
        (command) => command.startsWith("pnpm --dir ") && command.endsWith("/packages/example typecheck"),
      ),
    ).toBe(true);
    expect(toolsInvocations.some((command) => command === "pnpm pages:validate")).toBe(false);
    expect(toolsInvocations.some((command) => command === "pnpm docs:drift-check")).toBe(false);

    const markdownTree = fixture();
    put(markdownTree, "notes.md", "# note\n");
    const markdownInvocations: string[] = [];
    const markdown = await captureCheck(markdownTree, { commandRunner: recordingRunner(markdownInvocations) });
    expect(markdown.result.stages.find((stage) => stage.id === "G6")?.selected).toBe(true);
    expect(markdownInvocations.some((command) => command === "pnpm docs:drift-check")).toBe(true);
    expect(markdownInvocations.some((command) => command.includes(" typecheck"))).toBe(false);
    expect(markdownInvocations.some((command) => command === "pnpm pages:validate")).toBe(false);
  });

  it("R7 G2 production predicate: unique growth fails and a duplicated diagnostic at the ceiling passes", async () => {
    const ceiling = await toolsStrictErrorCeiling();
    const tree = fixture();
    put(tree, "tools/new.ts", "export const clean = 1;\n");
    const runner = recordingRunner([]);
    const grown = await captureCheck(tree, {
      commandRunner: runner,
      diagnosticOutput: diagnosticOutput(ceiling + 1),
    });
    expect(grown.result.stages.find((stage) => stage.id === "G2")?.pass).toBe(false);
    expect(grown.output).toContain(`> frozen ceiling ${ceiling}`);
    const atCeiling = await captureCheck(tree, {
      commandRunner: runner,
      diagnosticOutput: diagnosticOutput(ceiling, true),
    });
    expect(atCeiling.result.stages.find((stage) => stage.id === "G2")?.pass).toBe(true);
  });

  it("R8 RC5: close counts declared, legacy, and review artifacts and writes identical JSON", () => {
    const verifyPopulation = (
      suffix: string,
      files: Record<string, string>,
      expected: { review: number; gate: number; legacy: number; reviews: number },
    ) => {
      const job = mkdtempSync(path.join(tmpdir(), `worker-round-rc5-${suffix}-${process.pid}-`));
      scratchDirs.push(job);
      for (const [file, contents] of Object.entries(files)) put(job, file, contents);
      const lines: string[] = [];
      const metrics = runClose(job, (line) => lines.push(line));
      expect(lines).toEqual([
        `RC5 card=${path.basename(job)} followups review=${expected.review} gate=${expected.gate} legacy=${expected.legacy} reviews=${expected.reviews}`,
      ]);
      expect(metrics).toEqual({ card: path.basename(job), ...expected });
      expect(JSON.parse(readFileSync(path.join(job, "rc5.json"), "utf8"))).toEqual(metrics);
      expect(existsSync(path.join(job, "rc5.json"))).toBe(true);
    };
    verifyPopulation(
      "mixed",
      {
        "followup1.txt": "KIND::review\n",
        "followup2.txt": "KIND::review RULING:x\n",
        "followup3.txt": "KIND::gate\n",
        "followup4.txt": "legacy\n",
        "REVIEW1.md": "one\n",
        "REVIEW2.md": "two\n",
      },
      { review: 2, gate: 1, legacy: 1, reviews: 2 },
    );
    verifyPopulation(
      "gates",
      {
        "followup1.txt": "KIND::gate\n",
        "followup2.txt": "KIND :: gate\n",
        "followup3.txt": "  kind::Gate\n",
        "REVIEW1.md": "one\n",
      },
      { review: 0, gate: 3, legacy: 0, reviews: 1 },
    );
  });
});
