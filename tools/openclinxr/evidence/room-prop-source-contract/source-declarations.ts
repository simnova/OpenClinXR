/**
 * Source-bound room-prop declarations (#223 option B).
 *
 * Test-only reader. Independent of the evidence collector and of the live
 * report rows: shipped manifests are read as JSON, factory residuals are
 * read by TypeScript AST of real runtimeScenarioRoomProp calls, and
 * runtime-bundles direct declarations by AST of runtimeRoomProp calls.
 * Non-literal call forms fail closed instead of dropping silently.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  type CallExpression,
  createSourceFile,
  forEachChild,
  isCallExpression,
  isIdentifier,
  isStringLiteral,
  type Node,
  ScriptTarget,
  type SourceFile,
} from "typescript";

export type SourcePropDeclaration = {
  propId: string;
  label: string;
  semanticRole: string | null;
  source: string;
};

const CONTRACT_DIR = path.dirname(fileURLToPath(import.meta.url));
/** room-prop-source-contract -> evidence -> openclinxr -> tools -> repo root. */
export function repoRoot(): string {
  return path.resolve(CONTRACT_DIR, "..", "..", "..", "..");
}

export function generatedRoot(): string {
  return path.join(repoRoot(), "apps/ui-xr/public/xr-assets/generated");
}

export function factoryBundlePath(): string {
  return path.join(repoRoot(), "tools/openclinxr/factory/generated-ed-station-runtime-bundle.ts");
}

export function runtimeBundleDirectPaths(): string[] {
  return [
    path.join(repoRoot(), "packages/openclinxr/asset-registry/src/runtime-bundles.ts"),
    path.join(repoRoot(), "packages/openclinxr/asset-registry/src/runtime-room-props.ts"),
  ];
}

const execFileAsync = promisify(execFile);

/** Canonical tracked scene-manifest paths from Git; never filesystem readdir. */
export async function listTrackedManifestPaths(): Promise<string[]> {
  const root = repoRoot();
  const { stdout } = await execFileAsync("git", ["ls-files", "--", "apps/ui-xr/public/xr-assets/generated/*/scene-manifest.v1.json"], { cwd: root });
  const paths = stdout.split("\n").map((s) => s.trim()).filter((s) => s.length > 0).sort();
  if (paths.length === 0) {
    throw new Error("room-prop-source-contract: no tracked scene manifests — failing closed");
  }
  return paths;
}

export async function listShippedManifestIds(): Promise<string[]> {
  const paths = await listTrackedManifestPaths();
  return paths.map((p) => path.basename(path.dirname(p))).sort();
}

export async function readShippedDeclarations(): Promise<SourcePropDeclaration[]> {
  const out: SourcePropDeclaration[] = [];
  for (const rel of await listTrackedManifestPaths()) {
    const scenarioId = path.basename(path.dirname(rel));
    const abs = path.join(repoRoot(), rel);
    if (!existsSync(abs)) {
      throw new Error(`room-prop-source-contract: missing canonical tracked file ${rel} — failing closed`);
    }
    const raw = JSON.parse(await readFile(abs, "utf8")) as {
      roomProps?: Array<{ propId?: unknown; label?: unknown; semanticRole?: unknown }>;
    };
    const rows = raw.roomProps ?? [];
    for (const prop of rows) {
      if (typeof prop.propId !== "string" || prop.propId.length === 0) {
        throw new Error(`room-prop-source-contract: malformed authored prop row in ${rel} — failing closed`);
      }
      out.push({
        propId: prop.propId,
        label: typeof prop.label === "string" ? prop.label : prop.propId,
        semanticRole: prop.semanticRole === undefined || prop.semanticRole === null
          ? null
          : typeof prop.semanticRole === "string" ? prop.semanticRole : (() => { throw new Error(`room-prop-source-contract: malformed semanticRole in ${rel} — failing closed`); })(),
        source: `manifest:${scenarioId}`,
      });
    }
  }
  if (out.length === 0) {
    throw new Error("room-prop-source-contract: empty shipped authoring — failing closed");
  }
  return out;
}

function collectCalls(source: SourceFile, callee: string): CallExpression[] {
  const out: CallExpression[] = [];
  const visit = (node: Node): void => {
    if (isCallExpression(node) && isIdentifier(node.expression) && node.expression.text === callee) {
      out.push(node);
    }
    forEachChild(node, visit);
  };
  visit(source);
  return out;
}

function literalArg(call: CallExpression, index: number, file: string, callee: string): string {
  const arg = call.arguments[index];
  if (arg !== undefined && isStringLiteral(arg)) return arg.text;
  throw new Error(
    `room-prop-source-contract: non-literal ${callee} arg ${index} in ${file} — failing closed`,
  );
}

export async function readFactoryResidualDeclarations(): Promise<SourcePropDeclaration[]> {
  const file = factoryBundlePath();
  if (!existsSync(file)) {
    throw new Error("room-prop-source-contract: missing factory bundle source — failing closed");
  }
  const source = createSourceFile(file, await readFile(file, "utf8"), ScriptTarget.Latest, true);
  const rows = collectCalls(source, "runtimeScenarioRoomProp").map((call) => ({
    propId: literalArg(call, 0, file, "runtimeScenarioRoomProp"),
    label: literalArg(call, 1, file, "runtimeScenarioRoomProp"),
    semanticRole: literalArg(call, 2, file, "runtimeScenarioRoomProp"),
    source: "factory:residual",
  }));
  if (rows.length === 0) {
    throw new Error("room-prop-source-contract: empty factory residual calls — failing closed");
  }
  return rows;
}

export async function readRuntimeBundleDirectDeclarations(): Promise<SourcePropDeclaration[]> {
  const out: SourcePropDeclaration[] = [];
  for (const file of runtimeBundleDirectPaths()) {
    if (!existsSync(file)) {
      throw new Error(`room-prop-source-contract: missing canonical runtime bundle source ${file} — failing closed`);
    }
    const source = createSourceFile(file, await readFile(file, "utf8"), ScriptTarget.Latest, true);
    // Direct literal declarations only. runtime-bundles.ts assembles scenes through
    // an imported per-environment helper, which is a dynamic assembly form, not a
    // literal declaration — never silently expanded.
    for (const call of collectCalls(source, "runtimeRoomProp")) {
      out.push({
        propId: literalArg(call, 0, file, "runtimeRoomProp"),
        label: literalArg(call, 1, file, "runtimeRoomProp"),
        semanticRole: "environmental_detail",
        source: `runtime-bundles:direct:${path.basename(file)}`,
      });
    }
    for (const call of collectCalls(source, "authoredPhysicalRoomProp")) {
      out.push({
        propId: literalArg(call, 0, file, "authoredPhysicalRoomProp"),
        label: literalArg(call, 1, file, "authoredPhysicalRoomProp"),
        semanticRole: literalArg(call, 2, file, "authoredPhysicalRoomProp"),
        source: `runtime-bundles:authored:${path.basename(file)}`,
      });
    }
  }
  return out;
}

/** Literal ED anchor ids; root test asserts these literals, not this export. */
export const TRACKED_ED_ANCHORS = [
  "monitor-waveform-card",
  "monitor-vitals-badge",
  "ekg-leads-on-bed",
] as const;
