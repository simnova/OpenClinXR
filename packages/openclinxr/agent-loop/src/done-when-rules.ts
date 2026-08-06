import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import type { DoneWhenCheck, HandoffStatus, SkepticVerdict, SliceHandoff } from "./slice-team.js";

/**
 * `done_when` rule evaluation — the machine-checked half of a slice contract.
 *
 * Split out of slice-team.ts when adding `run:` and `changed:` pushed that file past its frozen
 * size ceiling. The ratchet's instruction is split, never raise, and this is the natural seam:
 * globMatch / walkFiles / resolveExistsTargets are used ONLY by the rule evaluator, and rule kinds
 * are the surface most likely to keep growing as new proof types are needed.
 */

function globMatch(pattern: string, candidate: string): boolean {
  const normalizedPattern = pattern.replaceAll("\\", "/");
  const normalizedCandidate = candidate.replaceAll("\\", "/");
  if (!normalizedPattern.includes("*")) {
    return normalizedCandidate === normalizedPattern || normalizedCandidate.endsWith(`/${normalizedPattern}`);
  }
  const regex = new RegExp(
    `^${normalizedPattern
      .split("*")
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`,
  );
  return regex.test(normalizedCandidate);
}

async function walkFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walkFiles(full)));
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}

async function resolveExistsTargets(repoRoot: string, target: string): Promise<string[]> {
  const absolute = path.isAbsolute(target) ? target : path.join(repoRoot, target);
  if (!target.includes("*")) {
    return existsSync(absolute) ? [absolute] : [];
  }
  const normalizedTarget = target.replaceAll("\\", "/");
  const wildcardIndex = normalizedTarget.split("/").findIndex((segment) => segment.includes("*"));
  if (wildcardIndex < 0) {
    return [];
  }
  const searchRoot = path.join(
    repoRoot,
    ...normalizedTarget.split("/").slice(0, wildcardIndex),
  );
  const pattern = normalizedTarget.split("/").slice(wildcardIndex).join("/");
  const files = await walkFiles(searchRoot);
  return files.filter((file) => {
    const rel = path.relative(searchRoot, file).replaceAll("\\", "/");
    return globMatch(pattern, rel);
  });
}

export async function evaluateDoneWhenRule(
  repoRoot: string,
  rule: string,
  sliceId: string,
  handoffs: Record<string, SliceHandoff | null>,
): Promise<DoneWhenCheck> {
  if (rule.startsWith("exists:")) {
    const target = rule.slice("exists:".length).trim();
    const matches = await resolveExistsTargets(repoRoot, target);
    return {
      rule,
      passed: matches.length > 0,
      detail: matches.length > 0 ? `found ${matches.join(", ")}` : `missing ${target}`,
    };
  }

  if (rule.startsWith("min-bytes:")) {
    const [, target, minBytesRaw] = rule.split(":");
    if (!target || !minBytesRaw) {
      return { rule, passed: false, detail: "invalid min-bytes rule" };
    }
    const minBytes = Number(minBytesRaw);
    const matches = await resolveExistsTargets(repoRoot, target);
    if (matches.length === 0) {
      return { rule, passed: false, detail: `missing ${target}` };
    }
    const sizeInfos: Array<{ rel: string; size: number }> = matches.map((m) => ({
      rel: path.relative(repoRoot, m).replaceAll("\\", "/"),
      size: statSync(m).size,
    }));
    const allSufficient = sizeInfos.every((info) => info.size >= minBytes);
    const detail = sizeInfos.map((info) => `${info.rel} size=${info.size}`).join("; ") + ` min=${minBytes}`;
    return {
      rule,
      passed: allSufficient,
      detail,
    };
  }

  if (rule.startsWith("run:")) {
    // The proof kind that was missing when it mattered.
    //
    // A worker was told a concurrency proof was NON-NEGOTIABLE and shipped without one: its commit
    // was green, its report claimed success, and nothing mechanical noticed. `exists:` cannot
    // express "re-run the experiment"; only executing a command can. The ORCHESTRATOR runs it, so
    // the worker's narrative is not evidence.
    //
    // Deliberately NOT included as a sibling kind: matching a pattern in the diff. A worker can
    // satisfy that without doing the work (a test named correctly that asserts nothing), and
    // shipping a gameable check teaches the loop to game rather than to prove.
    const command = rule.slice("run:".length).trim();
    if (!command) {
      return { rule, passed: false, detail: "invalid run rule (empty command)" };
    }
    try {
      execSync(command, { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 900_000 });
      return { rule, passed: true, detail: `exited zero: ${command}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Fail CLOSED: a command that cannot be executed has not been satisfied.
      return { rule, passed: false, detail: `failed: ${command} — ${message.slice(0, 300)}` };
    }
  }

  if (rule.startsWith("changed:")) {
    // Presence is not production. `exists:` passes for a file that was already there before the
    // slice began, so a worker "satisfies" it by doing nothing. This requires the content to differ
    // from a baseline hash recorded when the slice opened.
    //
    // Hashing rather than mtime is deliberate: we learned from turbo that mtime is not a change
    // signal (`touch` never invalidated its cache), and an mtime check here would be satisfied by
    // opening a file and saving it unchanged.
    const target = rule.slice("changed:".length).trim();
    const baselinePath = path.join(repoRoot, ".openclinxr", "slices", sliceId, "baseline-hashes.json");
    const matches = await resolveExistsTargets(repoRoot, target);
    if (matches.length === 0) {
      return { rule, passed: false, detail: `missing ${target}` };
    }
    let baseline: Record<string, string> = {};
    if (existsSync(baselinePath)) {
      try {
        baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as Record<string, string>;
      } catch {
        baseline = {};
      }
    }
    const changed: string[] = [];
    const unchanged: string[] = [];
    for (const match of matches) {
      const rel = path.relative(repoRoot, match).replaceAll("\\", "/");
      const hash = createHash("sha256").update(readFileSync(match)).digest("hex");
      if (baseline[rel] !== undefined && baseline[rel] === hash) unchanged.push(rel);
      else changed.push(rel);
    }
    return {
      rule,
      passed: unchanged.length === 0,
      detail:
        unchanged.length === 0
          ? `changed during this slice: ${changed.join(", ")}`
          : `unchanged since slice baseline (present before the work began): ${unchanged.join(", ")}`,
    };
  }

  if (rule.startsWith("handoff:")) {
    const parts = rule.slice("handoff:".length).split(":");
    const roleId = parts[0]?.trim();
    const expectedStatus = (parts[1]?.trim() ?? "done") as HandoffStatus;
    if (!roleId) {
      return { rule, passed: false, detail: "missing role id" };
    }
    const handoff = handoffs[roleId];
    if (!handoff) {
      return { rule, passed: false, detail: `no handoff for ${roleId}` };
    }
    const passed = handoff.status === expectedStatus;
    return {
      rule,
      passed,
      detail: `${roleId} status=${handoff.status} expected=${expectedStatus}`,
    };
  }

  if (rule.startsWith("skeptic:")) {
    const expected = rule.slice("skeptic:".length).trim() as SkepticVerdict;
    const handoff = handoffs["productivity-skeptic"];
    const verdict = handoff?.skeptic_verdict ?? "pending";
    return {
      rule,
      passed: verdict === expected,
      detail: `skeptic_verdict=${verdict} expected=${expected}`,
    };
  }

  if (rule === "handoffs:all-done") {
    const pending = Object.entries(handoffs).filter(([, h]) => h?.status !== "done");
    return {
      rule,
      passed: pending.length === 0 && Object.keys(handoffs).length > 0,
      detail:
        pending.length === 0
          ? `all ${Object.keys(handoffs).length} handoffs done`
          : `pending: ${pending.map(([role]) => role).join(", ")}`,
    };
  }

  return {
    rule,
    passed: false,
    detail: `unsupported rule (slice ${sliceId})`,
  };
}
