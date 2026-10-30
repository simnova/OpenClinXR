import { repoRoot } from "@openclinxr/factory-station-core/runner";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as typeScript from "typescript";

/**
 * OBSERVABLE: a TRELLIS bake can be run at sampler parameters other than the shipped defaults, and
 * records which ones it used.
 *
 * MEASURED 2026-08-25, do not re-derive. The pipeline exposes three samplers, each
 * `FlowEulerGuidanceIntervalSampler`, with five knobs apiece — read from
 * `~/ComfyUI/models/trellis2/pipeline.json`:
 *
 *   sampler                   steps  guidance_strength  guidance_rescale  interval     rescale_t
 *   sparse_structure_sampler     12                7.5               0.7  [0.6, 1.0]         5.0
 *   shape_slat_sampler           12                7.5               0.5  [0.6, 1.0]         3.0
 *   tex_slat_sampler             12                1.0               0.0  [0.6, 0.9]         3.0
 *
 * **None of the fifteen is settable from this repo.** `run_bake_isolated.py` declares only
 * `--subject-id`, `--display-name`, `--input-image`, `--output-dir`, `--seed`, `--weights-path`,
 * `--dinov3-path`, `--trellis-root`, `--hf-demo`, `--remesh`, `--no-remesh`, `--decimation-target`
 * and `--texture-size`.
 *
 * **`--hf-demo` is a no-op by construction.** At `run_bake_isolated.py:243-252` it reads the
 * pipeline's own defaults with `getattr(pipeline, "sparse_structure_sampler_params", {})` and passes
 * them straight back. It changes the shape of the call and never a value, so every bake this repo has
 * ever produced ran at the table above.
 *
 * WHY THIS BLOCKS REAL WORK. #661's TRELLIS shoe carries 76 disconnected components with the largest
 * at 93.8%, and the raw bake already shows 76 at 96.7% — **so the debris originates in generation,
 * not in decimation or meshopt.** `sparse_structure` builds the coarse occupancy grid, which is where
 * stray voxels become floating fragments. **That hypothesis cannot be tested at all until the knob is
 * reachable.**
 *
 * KNOWN-GOOD COLUMN - clause (2): `--seed` and `--decimation-target` are already threaded end to end,
 * from the TypeScript CLI's argv builder through to a Python `add_argument`. They are the shape a
 * correctly wired knob has in this codebase, and they must keep working.
 *
 * COUNTERWEIGHT - clause (3): the defaults must not move. A bake invoked with no sampler flags has to
 * behave exactly as it does today, or every prior measurement on this bank silently changes meaning.
 * The Python must keep its `--hf-demo`, `--remesh`, `--no-remesh` and `--decimation-target` arguments.
 *
 * FAILED TREATMENT, do not repeat: making `--hf-demo` write different values. It exists to reproduce
 * the HF Space call shape and is referenced by prior bake records; changing what it means retroactively
 * rewrites what those runs were.
 *
 * claimScope: which arguments the bake CLI and the Python script accept, read from their source.
 * notEvidenceFor: what any sampler value does to output quality — nothing has been varied yet; whether
 *   the pipeline honours a passed value; the multi-view path, which takes a different branch.
 *
 * ## FIXED (#662)
 *
 * All fifteen knobs are reachable end to end. Flag naming: `--<prefix>-<knob>` with prefix
 * ss|shape|tex and knob steps|guidance-strength|guidance-rescale|guidance-interval (two floats
 * LO HI)|rescale-t — e.g. `--ss-steps 8 --shape-guidance-interval 0.4 1.0`. Only explicitly
 * passed values are forwarded; run_bake_isolated.py merges them over the pipeline defaults
 * (user wins) in both single-view and multi-view branches, and records the effective merged
 * table under `effectiveSamplerParams` plus explicit overrides under `samplerOverrides`
 * (`--hf-demo`'s `samplerParams` key is untouched). The second gap is closed in the same pass:
 * `--decimation-target` and `--texture-size` were declared in Python but never forwarded by
 * trellis-bake-cli.ts; they now parse, appear in dry-run plans, and reach argv.
 */

import { join } from "node:path";

const PY = join(repoRoot(), "tools/openclinxr/evidence/blender/run_bake_isolated.py");
const TS = join(repoRoot(), "tools/openclinxr/asset-pipeline/trellis/trellis-bake-cli.ts");
const RUN = join(repoRoot(), "packages/openclinxr/factory-stations/src/equipment_generate/run.ts");
/** One flag per sampler is enough to prove the surface is reachable; steps is the cheapest to vary. */
const REQUIRED_FLAGS = ["--ss-steps", "--shape-steps", "--tex-steps"] as const;

const py = (): string => readFileSync(PY, "utf8");
const ts = (): string => readFileSync(TS, "utf8");
const run = (): string => readFileSync(RUN, "utf8");

/**
 * AST-scoped reader: return the body text of a top-level `function NAME(...)`
 * via the TypeScript compiler API. No brace counting, no regex over the file:
 * comments, strings, and default parameters (e.g. `options = {}`) cannot
 * confuse node boundaries. Returns null when the declaration is absent.
 */
function fnBodyText(src: string, name: string): string | null {
  const sf = typeScript.createSourceFile("probe.ts", src, typeScript.ScriptTarget.Latest, true);
  for (const stmt of sf.statements) {
    if (
      typeScript.isFunctionDeclaration(stmt)
      && stmt.name?.text === name
      && stmt.body
    ) {
      return stmt.body.getText(sf);
    }
  }
  return null;
}

/** All descendant nodes of `node` in source order. */
function descendants(node: typeScript.Node): typeScript.Node[] {
  const out: typeScript.Node[] = [];
  const visit = (n: typeScript.Node): void => {
    out.push(n);
    typeScript.forEachChild(n, (c) => { visit(c); });
  };
  typeScript.forEachChild(node, visit);
  return out;
}

function parseFn(src: string, name: string): { sf: typeScript.SourceFile; fn: typeScript.FunctionDeclaration } | null {
  const sf = typeScript.createSourceFile("probe.ts", src, typeScript.ScriptTarget.Latest, true);
  for (const stmt of sf.statements) {
    if (typeScript.isFunctionDeclaration(stmt) && stmt.name?.text === name && stmt.body) return { sf, fn: stmt };
  }
  return null;
}

/**
 * True when liveBake's actual `runEquipmentGenerate({...})` call binds
 * `seed:` to the `args.seed ?? 0` coalescence. Scoped to the liveBake AST:
 * tokens in dryRunPlan or a dead helper cannot satisfy it. The initializer
 * must be a real BinaryExpression with a QuestionQuestionToken whose left
 * is `args.seed` PropertyAccess and whose right is numeric literal 0: a
 * string holding "args.seed ?? 0" is a StringLiteral, not a BinaryExpression.
 */
function cliSeedCallBound(cliSrc: string): boolean {
  const parsed = parseFn(cliSrc, "liveBake");
  if (!parsed) return false;
  const { fn } = parsed;
  for (const n of descendants(fn.body!)) {
    if (
      typeScript.isCallExpression(n)
      && typeScript.isIdentifier(n.expression)
      && n.expression.text === "runEquipmentGenerate"
      && n.arguments.length > 0
      && typeScript.isObjectLiteralExpression(n.arguments[0])
    ) {
      for (const prop of n.arguments[0].properties) {
        if (
          typeScript.isPropertyAssignment(prop)
          && typeScript.isIdentifier(prop.name)
          && prop.name.text === "seed"
          && typeScript.isBinaryExpression(prop.initializer)
          && prop.initializer.operatorToken.kind === typeScript.SyntaxKind.QuestionQuestionToken
          && typeScript.isPropertyAccessExpression(prop.initializer.left)
          && typeScript.isIdentifier(prop.initializer.left.expression)
          && prop.initializer.left.expression.text === "args"
          && prop.initializer.left.name.text === "seed"
          && typeScript.isNumericLiteral(prop.initializer.right)
          && prop.initializer.right.text === "0"
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * True when parseArgs actually assigns `result.seed` on the `--seed` branch.
 * The assignment must sit inside the `a === "--seed"` branch body of the
 * parseArgs AST — a loose `result.seed` token elsewhere fails.
 */
function cliSeedParsed(cliSrc: string): boolean {
  const parsed = parseFn(cliSrc, "parseArgs");
  if (!parsed) return false;
  const { sf, fn } = parsed;
  for (const n of descendants(fn.body!)) {
    if (
      typeScript.isIfStatement(n)
      && /a\s*===\s*"--seed"/.test(n.expression.getText(sf))
    ) {
      const branchSrc = n.thenStatement.getText(sf);
      const branchSf = typeScript.createSourceFile("branch.ts", branchSrc, typeScript.ScriptTarget.Latest, true);
      for (const m of descendants(branchSf)) {
        if (
          typeScript.isBinaryExpression(m)
          && m.operatorToken.kind === typeScript.SyntaxKind.EqualsToken
          && /result\.seed/.test(m.left.getText(branchSf))
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * True when runEquipmentGenerate passes the argv array as the second
 * argument to execFileSync and argv holds a real StringLiteral "--seed"
 * immediately followed by a CallExpression `String(plan.seed)` with exactly
 * one argument that is PropertyAccess `plan.seed`. A string holding
 * "String(plan.seed)" is a StringLiteral, not a CallExpression. Scoped to
 * the runEquipmentGenerate AST.
 */
function runnerSeedArgvIntact(runSrc: string): boolean {
  const parsed = parseFn(runSrc, "runEquipmentGenerate");
  if (!parsed) return false;
  const { fn } = parsed;
  let argvHasSeedPair = false;
  let argvReachesExec = false;
  for (const n of descendants(fn.body!)) {
    if (
      typeScript.isVariableDeclaration(n)
      && typeScript.isIdentifier(n.name)
      && n.name.text === "argv"
      && n.initializer
      && typeScript.isArrayLiteralExpression(n.initializer)
    ) {
      const els = n.initializer.elements;
      for (let i = 0; i + 1 < els.length; i++) {
        const flag = els[i];
        const val = els[i + 1];
        if (
          typeScript.isStringLiteral(flag)
          && flag.text === "--seed"
          && typeScript.isCallExpression(val)
          && typeScript.isIdentifier(val.expression)
          && val.expression.text === "String"
          && val.arguments.length === 1
          && typeScript.isPropertyAccessExpression(val.arguments[0])
          && typeScript.isIdentifier(val.arguments[0].expression)
          && val.arguments[0].expression.text === "plan"
          && val.arguments[0].name.text === "seed"
        ) {
          argvHasSeedPair = true;
        }
      }
    }
    if (
      typeScript.isCallExpression(n)
      && typeScript.isIdentifier(n.expression)
      && n.expression.text === "execFileSync"
      && n.arguments.length >= 2
      && typeScript.isIdentifier(n.arguments[1])
      && n.arguments[1].text === "argv"
    ) {
      argvReachesExec = true;
    }
  }
  return argvHasSeedPair && argvReachesExec;
}

/** Replace `oldSnippet` only inside the AST body of `fnName`; throws when absent. */
function replaceInFnBody(src: string, fnName: string, oldSnippet: string, next: string): string {
  const body = fnBodyText(src, fnName);
  if (!body || !body.includes(oldSnippet)) throw new Error(`snippet not in ${fnName} body`);
  return src.replace(body, body.replace(oldSnippet, next));
}

describe("a trellis bake can set its sampler", () => {
  it("(1) the bake exposes sampler knobs and forwards them", () => {
    const p = py(); const t = ts();
    const missingPython = REQUIRED_FLAGS.filter((f) => !p.includes(`"${f}"`));
    expect(
      missingPython,
      "run_bake_isolated.py declares no sampler arguments, so every bake this repo has produced ran "
      + "at the shipped defaults and the #661 debris hypothesis cannot be tested",
    ).toHaveLength(0);
    const missingForward = REQUIRED_FLAGS.filter((f) => !t.includes(f));
    expect(
      missingForward,
      "the TypeScript CLI does not forward the sampler flags into argv, so the Python surface would "
      + "be unreachable from the factory station",
    ).toHaveLength(0);
  });

  it("(2) KNOWN-GOOD COLUMN: the knobs that ARE wired stay wired end to end", () => {
    // --seed and --decimation-target are the shape a correctly threaded knob has here: declared in
    // Python, reaching argv in TypeScript. A fix that rewires the CLI must not break them.
    // --seed travels by delegation: parseArgs assigns result.seed on the --seed branch and
    // liveBake binds seed: args.seed ?? 0 into runEquipmentGenerate, whose producer
    // (equipment_generate/run.ts) builds argv "--seed", String(plan.seed) for execFileSync.
    // Every check is AST-scoped to its live function body, so loose tokens in a dead
    // helper, a comment, or another function elsewhere in either file cannot pass.
    const p = py(); const t = ts(); const r = run();
    for (const flag of ["--seed", "--decimation-target"]) {
      expect(p.includes(`"${flag}"`), `${flag} must stay declared in ${PY}`).toBe(true);
    }
    expect(cliSeedParsed(t), "parseArgs must assign result.seed on the --seed branch").toBe(true);
    expect(cliSeedCallBound(t), "liveBake must bind seed: args.seed ?? 0 into runEquipmentGenerate").toBe(true);
    expect(runnerSeedArgvIntact(r), 'runEquipmentGenerate must build argv "--seed", String(plan.seed) for execFileSync').toBe(true);
    // Mutation counterweights on the exact live AST ranges (not first-file-occurrence edits).
    expect(
      cliSeedCallBound(replaceInFnBody(t, "liveBake", "seed: args.seed ?? 0", "seed: 0")),
      "counterweight: constant seed binding must fail",
    ).toBe(false);
    expect(
      runnerSeedArgvIntact(replaceInFnBody(r, "runEquipmentGenerate", '"--seed",', '"--session-seed",')),
      "counterweight: dropping the runner seed argument must fail",
    ).toBe(false);
    expect(
      runnerSeedArgvIntact(replaceInFnBody(r, "runEquipmentGenerate", "String(plan.seed)", "String(0)")),
      "counterweight: constant runner seed value must fail",
    ).toBe(false);
    // String-decoy counterweights: production input is unknown at type level, so a
    // string carrying the right characters must not satisfy a typed shape check.
    expect(
      cliSeedCallBound(replaceInFnBody(t, "liveBake", "seed: args.seed ?? 0", 'seed: "args.seed ?? 0"')),
      "counterweight: string decoy of the CLI seed coalescence must fail",
    ).toBe(false);
    expect(
      runnerSeedArgvIntact(replaceInFnBody(r, "runEquipmentGenerate", "String(plan.seed)", '"String(plan.seed)"')),
      "counterweight: string decoy of the runner seed call must fail",
    ).toBe(false);
    // Dead-token decoys: all four tokens present but outside the live functions must not pass.
    const decoy = 'function deadHelper() { return a === "--seed"; }\n// seed: args.seed runEquipmentGenerate( "--seed", String(plan.seed) )';
    expect(cliSeedParsed(decoy), "counterweight: dead tokens outside parseArgs must not pass").toBe(false);
    expect(cliSeedCallBound(decoy), "counterweight: dead tokens outside liveBake must not pass").toBe(false);
    expect(runnerSeedArgvIntact(decoy), "counterweight: dead tokens outside runEquipmentGenerate must not pass").toBe(false);
  });

  it("(3) COUNTERWEIGHT: the existing arguments and defaults survive", () => {
    // Every prior measurement on this bank was taken at the shipped defaults. If a no-flag bake stops
    // behaving as it does today, those records silently change meaning.
    const p = py();
    for (const flag of ["--hf-demo", "--remesh", "--no-remesh", "--texture-size"]) {
      expect(p.includes(`"${flag}"`), `${flag} must survive the rewiring`).toBe(true);
    }
    expect(p.includes("default=300_000"), "the decimation default must not move").toBe(true);
  });

  it("(4) VACUITY GUARD: the reader is parsing the real sources", () => {
    // Without this, clause (1) passes on an empty read and clause (3) on a file that no longer exists.
    expect(py().length, `${PY} must be a real file`).toBeGreaterThan(2000);
    expect(ts().length, `${TS} must be a real file`).toBeGreaterThan(2000);
    expect(py().includes("add_argument"), "the Python must be an argparse CLI").toBe(true);
  });

  it("## FIXED (#663)", () => {
    // AST-bound seed delegation: liveBake's runEquipmentGenerate call carries
    // seed: args.seed ?? 0 (not a dry-run-plan edit), parseArgs assigns
    // result.seed on the --seed branch, and the runner builds
    // "--seed", String(plan.seed) into the execFileSync argv.
    expect(cliSeedParsed(ts())).toBe(true);
    expect(cliSeedCallBound(ts())).toBe(true);
    expect(runnerSeedArgvIntact(run())).toBe(true);
  });
});
