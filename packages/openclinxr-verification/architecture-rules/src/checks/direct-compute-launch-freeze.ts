import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export type DirectComputeLaunchKind = "blender" | "ml-python" | "chromium";
export type DirectComputeLaunchSite = {
  file: string;
  line: number;
  kind: DirectComputeLaunchKind;
};

const LOCAL_COMPUTE_ROOT = "packages/openclinxr/service-local-compute/";
const PROCESS_LAUNCHERS = new Set(["spawn", "spawnSync", "exec", "execFile"]);

function workspaceRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("workspace root (pnpm-workspace.yaml) not found");
}

function isMlPythonMarker(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes(".venv/bin/python") ||
    lower.includes("infinigen/venv") ||
    ((lower.includes("trellis") || lower.includes("comfy")) && lower.includes("venv/bin/python"))
  );
}

export function countDirectComputeLaunchesInSource(source: string, file = "fixture.ts"): DirectComputeLaunchSite[] {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const sites: DirectComputeLaunchSite[] = [];
  const sourceHasBlender = source.toLowerCase().includes("blender.app") || /["']blender["']/iu.test(source);
  const sourceHasMlPython = isMlPythonMarker(source);

  const add = (node: ts.Node, kind: DirectComputeLaunchKind): void => {
    const line = parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1;
    sites.push({ file, line, kind });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "launch" &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "chromium"
      ) {
        add(node, "chromium");
      } else if (ts.isIdentifier(node.expression) && PROCESS_LAUNCHERS.has(node.expression.text)) {
        const command = node.arguments[0]?.getText(parsed) ?? "";
        const lower = command.toLowerCase();
        if (lower.includes("blender") || (command === "c" && sourceHasBlender)) {
          add(node, "blender");
        } else if (isMlPythonMarker(command) || (/^[a-z_$][\w$]*$/iu.test(command) && sourceHasMlPython)) {
          add(node, "ml-python");
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return sites;
}

/** Measure every TypeScript source outside the one infrastructure package allowed to launch compute. */
export function measureDirectComputeLaunches(root = workspaceRoot()): DirectComputeLaunchSite[] {
  const sites: DirectComputeLaunchSite[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts")) continue;
      const rel = relative(root, full).replaceAll("\\", "/");
      if (rel.startsWith(LOCAL_COMPUTE_ROOT)) continue;
      sites.push(...countDirectComputeLaunchesInSource(readFileSync(full, "utf8"), rel));
    }
  };
  walk(root);
  return sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.kind.localeCompare(b.kind));
}

/** Exact post-migration measurement. This ceiling may only shrink. */
export const DIRECT_COMPUTE_LAUNCH_CEILING = 141;
/** Before spawn-blender.ts and room_generate/generate.ts moved behind the facade. */
export const DIRECT_COMPUTE_LAUNCH_INITIAL_COUNT = 143;

export function checkDirectComputeLaunchFreeze(
  ceiling = DIRECT_COMPUTE_LAUNCH_CEILING,
  sites = measureDirectComputeLaunches(),
): string[] {
  if (sites.length <= ceiling) return [];
  return [
    `direct heavy-compute launches grew to ${sites.length} > shrink-only ceiling ${ceiling}: ` +
      sites.map((site) => `${site.file}:${site.line} (${site.kind})`).join(", ") +
      ". Move the launcher into @openclinxr/service-local-compute; do NOT raise the ceiling.",
  ];
}

export function checkDirectComputeLaunchFreezeIsHonest(
  ceiling = DIRECT_COMPUTE_LAUNCH_CEILING,
  sites = measureDirectComputeLaunches(),
): string[] {
  if (sites.length >= ceiling) return [];
  return [
    `direct heavy-compute ceiling ${ceiling} is above measured ${sites.length}; lower it so the ratchet only shrinks.`,
  ];
}
