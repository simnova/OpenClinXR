import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

/**
 * Baked-with materializer provenance (ci-w9 P1).
 *
 * A shipped body records the materializer it was BAKED WITH, not the live
 * script: the sidecar recipe sha pins the materializer bytes at bake time,
 * and later script edits must not rewrite that record. Membership is checked
 * against git history — the recorded sha must equal the file's content sha256
 * at some commit touching the path (single `git cat-file --batch` pass, no
 * per-commit subprocess).
 *
 * Recorded pins (verified 2026-10-30 in WT ci/w9-provenance-adopt):
 * - mpfb-peds-patient-child recipe 120b56cb… = materializer at c441312ec
 *   (2026-09-21), stamped by 287edc35c (2026-09-22 "name the learner-loaded
 *   body materializer in its provenance recipe").
 * - mouth compat-report producer 4c35ea1c… = materializer at 4dbcfb899
 *   (2026-10-15 tsk_667587349a455eec, the realism-head card itself).
 */

export const MATERIALIZER_PATH =
  "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py";

const historyCache = new Map<string, Set<string>>();

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Content-sha256 of the materializer at every commit that touched it. */
export function materializerBakedWithShas(repoRoot: string): Set<string> {
  const hit = historyCache.get(repoRoot);
  if (hit) return hit;
  const commits = execFileSync("git", ["log", "--format=%H", "--", MATERIALIZER_PATH], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (commits.length === 0) throw new Error(`no history for ${MATERIALIZER_PATH}`);
  const stdin = commits.map((c) => `${c}:${MATERIALIZER_PATH}\n`).join("");
  const raw = execFileSync("git", ["cat-file", "--batch"], {
    cwd: repoRoot,
    input: stdin,
    maxBuffer: 1024 * 1024 * 1024,
  }) as unknown as Buffer;
  const shas = new Set<string>();
  let offset = 0;
  const nl = (from: number): number => {
    const i = raw.indexOf(0x0a, from);
    if (i < 0) throw new Error("truncated git cat-file --batch output");
    return i;
  };
  for (let n = 0; n < commits.length; n += 1) {
    const eol = nl(offset);
    const header = raw.subarray(offset, eol).toString("utf8");
    offset = eol + 1;
    const parts = header.split(" ");
    if (parts[1] === "missing") continue;
    const size = Number(parts[2]);
    if (!Number.isFinite(size) || size < 0) throw new Error(`bad batch header: ${header}`);
    const content = raw.subarray(offset, offset + size);
    if (content.length !== size) throw new Error("truncated batch object");
    shas.add(sha256Hex(content));
    offset += size + 1; // trailing newline
  }
  if (shas.size === 0) throw new Error(`empty baked-with set for ${MATERIALIZER_PATH}`);
  historyCache.set(repoRoot, shas);
  return shas;
}
