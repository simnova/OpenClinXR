/**
 * Immutable golden promotion.
 *
 * A promoted golden is the last accepted whole-face state. Promotion writes a
 * NEW version dir (store/face-regression/golden/<version>/) and rewrites the
 * tracked pointer; an existing version dir is never opened for write, so a
 * re-promotion cannot rewrite accepted bytes. A planted render (a known-bad
 * GLB swapped in to prove the check catches it) can never be promoted.
 */
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type PromoteResult = { ok: boolean; versionDir?: string; reason?: string };

export function promoteGolden(input: {
  goldenRoot: string;
  version: string;
  approvedBy: string;
  from: string;
  /** case -> view -> source PNG absolute path (copied into the version dir). */
  cases: Record<string, Record<string, string>>;
  planted?: boolean;
  extra?: Record<string, unknown>;
}): PromoteResult {
  if (!/^[a-z0-9._-]+$/i.test(input.version)) {
    return { ok: false, reason: `refused: version '${input.version}' is not a simple dir name` };
  }
  if (input.planted) {
    return { ok: false, reason: "refused: a planted render can never be promoted" };
  }
  const versionDir = join(input.goldenRoot, input.version);
  if (existsSync(versionDir)) {
    return { ok: false, reason: `refused: version dir ${versionDir} already exists and is immutable` };
  }
  for (const [caseId, views] of Object.entries(input.cases)) {
    for (const [view, src] of Object.entries(views)) {
      if (!existsSync(src)) return { ok: false, reason: `refused: source ${src} for ${caseId}/${view} does not exist` };
    }
  }
  mkdirSync(versionDir, { recursive: true });
  const written: Record<string, Record<string, string>> = {};
  for (const [caseId, views] of Object.entries(input.cases)) {
    mkdirSync(join(versionDir, caseId), { recursive: true });
    written[caseId] = {};
    for (const [view, src] of Object.entries(views)) {
      const dst = join(versionDir, caseId, `${view}.png`);
      cpSync(src, dst);
      written[caseId]![view] = `${caseId}/${view}.png`;
    }
  }
  writeFileSync(
    join(versionDir, "golden.json"),
    `${JSON.stringify({ version: input.version, approvedBy: input.approvedBy, from: input.from, files: written, ...(input.extra ?? {}) }, null, 2)}\n`,
    "utf8",
  );
  return { ok: true, versionDir };
}
