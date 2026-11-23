import { readFileSync } from "node:fs";
import type { ReaderTraceFS } from "./trace.js";
/** Test-only filesystem plumbing for the accessor-digest reader guard spec.
 *  NOT part of the published root: the guard test imports this module
 *  directly so src/index.ts exports the guard API only. */
/** Resolve a relative import to the on-disk fixture or reader that holds its text. */
export function resolveDiskRelative(from: string, spec: string, read: (p: string) => string | undefined): string | undefined {
  const parts: string[] = [];
  for (const s of `${from.split("/").slice(0, -1).join("/")}/${spec}`.split("/")) {
    if (s === "" && parts.length === 0) parts.push("");
    else if (s === "" || s === ".") continue;
    else if (s === "..") parts.pop();
    else parts.push(s);
  }
  const base = parts.join("/") || "/";
  for (const c of [base, `${base}.ts`, base.replace(/\.js$/, ".ts"), base.replace(/\.js$/, ".ts.txt"), `${base}.ts.txt`]) if (read(c) !== undefined) return c;
  return undefined;
}
/** Filesystem adapter over the real disk. */
export const nodeDiskFS: ReaderTraceFS = {
  readText: (p) => { try { return readFileSync(p, "utf8"); } catch { return undefined; } },
  resolveRelative: (f, s) => resolveDiskRelative(f, s, nodeDiskFS.readText),
};
