import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * OBSERVABLE: a fresh Claude agent produced a ~136k-token first turn, ~37k of it the modular
 * ruleset, because `scripts/sync-harness-agent-files.sh` linked all 22 `agents/rules/*.md` into
 * `.claude/rules/` (150,589 B). The fix: Claude's startup tier is `CLAUDE_CORE_RULES` (4 files,
 * ~12 KB); the other 19 rule files load on demand through skills `delegation-rules` and
 * `orchestrator-rules`.
 *
 * claimScope: the startup tier is what the sync script links, and that tier stays small while the
 *   rest of the ruleset remains reachable (byte-identical on disk, named by a skill).
 * notEvidenceFor: that any harness actually enforces the load-on-demand boundary, or that the
 *   descriptions trigger in practice. Numbers are bytes on disk, not tokens.
 */

const REPO = join(import.meta.dirname, "../..");
const CORE_SCRIPT = join(REPO, "scripts/sync-harness-agent-files.sh");

/** agents/rules/*.md at base 94f0aff62 (22 files); the 21 rule files + README.md. */
const BASELINE_RULES = [
  "EXEC_AUTONOMY.md",
  "EXEC_REHYDRATE.md",
  "GUARD_BLUEPRINT.md",
  "GUARD_DRIFT.md",
  "LEX_AGENTIC.md",
  "MANDATE_VISIBILITY.md",
  "PROTO_BOARD_LOOP.md",
  "PROTO_CURIOUS_RESEARCHER.md",
  "PROTO_SUBAGENT.md",
  "PROTO_VERIFY_DELEGATION.md",
  "README.md",
  "TIER_GROK.md",
  "agent-consult.md",
  "grok-harness-usage.md",
  "hyper-token-efficient-long-run-practices.md",
  "long-running-autonomy.md",
  "orchestrator-only-main.md",
  "persistent-memory-scoring.md",
  "platform-autonomy-override.md",
  "rehydration-low-token.md",
  "repo-defined-agents-worker-roles.md",
  "source-of-truth.md",
] as const;

/** Stub files that point at their successors; never promoted into a startup tier. */
const STUBS = [
  "hyper-token-efficient-long-run-practices.md",
  "long-running-autonomy.md",
  "platform-autonomy-override.md",
  "rehydration-low-token.md",
  "TIER_GROK.md",
] as const;

/** Read `NAME=( ... )` out of the sync script. Anchored so CORE_RULES != CLAUDE_CORE_RULES. */
function parseArray(script: string, name: string): string[] {
  const match = new RegExp(`(?:^|\\n)${name}=\\(([^)]*)\\)`).exec(script);
  return match ? match[1]!.split(/\s+/).filter(Boolean) : [];
}

function replaceArray(script: string, name: string, names: string[]): string {
  const body = names.map((n) => `  ${n}`).join("\n");
  return script.replace(new RegExp(`(?:^|\\n)${name}=\\([^)]*\\)`), `\n${name}=(\n${body}\n)`);
}

type Measured = { core: string[]; claude: string[]; bytes: number };

/** The whole measurement in one function so a planted script can be re-measured (T7). */
function measure(scriptText: string): Measured {
  const core = parseArray(scriptText, "CORE_RULES");
  const claude = parseArray(scriptText, "CLAUDE_CORE_RULES");
  if (claude.length === 0) throw new Error("CLAUDE_CORE_RULES is empty: vacuity guard");
  const bytes = claude.reduce(
    (total, name) => total + statSync(join(REPO, "agents/rules", name)).size,
    0,
  );
  return { core, claude, bytes };
}

function frontmatter(text: string): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) throw new Error("file has no frontmatter");
  return match[1]!;
}

/** Parse the `description` scalar (plain, quoted, or folded `>`), whitespace-collapsed. */
function descriptionOf(text: string): string {
  const lines = frontmatter(text).split(/\r?\n/);
  const index = lines.findIndex((line) => /^description:/.test(line));
  if (index < 0) throw new Error("frontmatter has no description");
  const first = lines[index]!.replace(/^description:\s*/, "");
  const parts: string[] = [];
  if (first && first !== ">" && first !== "|") {
    parts.push(first);
  } else {
    for (let next = index + 1; next < lines.length; next += 1) {
      if (/^[A-Za-z0-9_-]+:/.test(lines[next]!)) break;
      parts.push(lines[next]!.trim());
    }
  }
  return parts
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^"|"$/g, "")
    .replace(/^>|^|$/g, "")
    .trim();
}

function skillNames(): string[] {
  const dir = join(REPO, ".claude/skills");
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => existsSync(join(dir, entry.name, "SKILL.md")))
    .map((entry) => entry.name);
}

/** True when the repo can edit this SKILL.md; symlinks from .agents/skills are out of root. */
function isEditableSkill(name: string): boolean {
  const dir = join(REPO, ".claude/skills", name);
  return !lstatSync(dir).isSymbolicLink() && !lstatSync(join(dir, "SKILL.md")).isSymbolicLink();
}

function trackedUnder(rel: string): string[] {
  return execFileSync("git", ["ls-files", rel], { cwd: REPO, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

function assertSymlinkSet(rel: string, names: readonly string[]): void {
  const tracked = trackedUnder(rel).map((p) => p.slice(rel.length + 1));
  expect([...tracked].sort(), `${rel} tracked set must equal the array`).toEqual(
    [...names].sort(),
  );
  for (const name of names) {
    const link = join(REPO, rel, name);
    expect(lstatSync(link).isSymbolicLink(), `${rel}/${name} must be a symlink`).toBe(true);
    expect(readlinkSync(link), `${rel}/${name} target`).toBe(`../../agents/rules/${name}`);
  }
}

describe("the Claude startup context stays small", () => {
  const script = readFileSync(CORE_SCRIPT, "utf8");

  it("(T1) parses a non-empty CLAUDE_CORE_RULES and CORE_RULES from the sync script", () => {
    const { core, claude } = measure(script);
    expect(core.length, "CORE_RULES must be non-empty").toBeGreaterThan(0);
    expect(claude.length, "CLAUDE_CORE_RULES must be non-empty").toBeGreaterThan(0);
  });

  it("(T2) the CLAUDE_CORE_RULES byte total is <= 16384", () => {
    // 3,561 + 4,774 + 1,738 + <= 2,048 = <= 12,121; rounded up to 16 KiB. Baseline 150,589 B.
    const { claude, bytes } = measure(script);
    expect(bytes, `CLAUDE_CORE_RULES [${claude.join(", ")}] = ${bytes} B`).toBeLessThanOrEqual(16384);
  });

  it("(T3) .claude/rules is exactly CLAUDE_CORE_RULES, .grok/rules exactly CORE_RULES, as symlinks", () => {
    const { core, claude } = measure(script);
    assertSymlinkSet(".claude/rules", claude);
    assertSymlinkSet(".grok/rules", core);
  });

  it("(T4) counterweight: the safety files are in, the heavy protocols are out, nothing is lost", () => {
    const { core, claude } = measure(script);
    expect(claude).toContain("GUARD_BLUEPRINT.md");
    expect(claude).toContain("GUARD_SAFETY.md");
    expect(core).toContain("GUARD_SAFETY.md");
    for (const heavy of ["LEX_AGENTIC.md", "PROTO_VERIFY_DELEGATION.md", "PROTO_BOARD_LOOP.md"]) {
      expect(claude, `${heavy} must not be in the startup tier`).not.toContain(heavy);
    }
    for (const stub of STUBS) expect(claude, `${stub} must not be in the startup tier`).not.toContain(stub);

    const onDisk = readdirSync(join(REPO, "agents/rules"));
    for (const name of [...BASELINE_RULES, "GUARD_SAFETY.md"]) {
      expect(onDisk, `agents/rules/${name} must still exist`).toContain(name);
    }

    const skillText = skillNames()
      .map((name) => readFileSync(join(REPO, ".claude/skills", name, "SKILL.md"), "utf8"))
      .join("\n");
    for (const name of onDisk) {
      if (claude.includes(name)) continue;
      expect(skillText, `${name} must be named by a skill`).toContain(name);
    }
  });

  it("(T5) GUARD_SAFETY.md is small and carries the danger lines verbatim", () => {
    const safety = readFileSync(join(REPO, "agents/rules/GUARD_SAFETY.md"));
    expect(safety.byteLength, "GUARD_SAFETY.md bytes").toBeLessThanOrEqual(2560);
    const text = safety.toString("utf8");
    for (const token of [
      "--no-verify",
      "OPENCLAW_SKIP_HOOKS",
      "core.hooksPath",
      "/Volumes/files/src/openclinxr",
      "RUST_LOG",
      "plaintext",
      "without `worktree`",
      "resume",
      "PROTO_VERIFY_DELEGATION.md",
      "delegation-rules",
      "orchestrator-rules",
    ]) {
      expect(text, `GUARD_SAFETY.md must contain ${token}`).toContain(token);
    }
    const ids = [...text.matchAll(/^D(\d+) /gm)].map((m) => Number(m[1]));
    expect(ids, "D-lines must be ids 1..14 in order, once each").toEqual(
      Array.from({ length: 14 }, (_, i) => i + 1),
    );
  });

  it("(T6) skill descriptions are capped and keep their recorded trigger keywords", () => {
    const fixture = JSON.parse(
      readFileSync(join(REPO, "tools/agent-factory/skill-description-triggers.json"), "utf8"),
    ) as Record<string, string[]>;

    const names = skillNames();
    expect(names.length, `skill count ${names.length}`).toBeGreaterThanOrEqual(27);

    let total = 0;
    for (const name of names) {
      if (!isEditableSkill(name)) continue;
      const description = descriptionOf(
        readFileSync(join(REPO, ".claude/skills", name, "SKILL.md"), "utf8"),
      );
      expect(description.length, `${name} description is ${description.length} chars`).toBeLessThanOrEqual(250);
      total += description.length;
    }
    expect(total, `editable skill description total ${total} chars`).toBeLessThanOrEqual(6750);

    expect(Object.keys(fixture).length, "over-cap skills recorded").toBeGreaterThanOrEqual(20);
    for (const [name, keywords] of Object.entries(fixture)) {
      expect(keywords.length, `${name} needs >= 4 keywords`).toBeGreaterThanOrEqual(4);
      const description = descriptionOf(
        readFileSync(join(REPO, ".claude/skills", name, "SKILL.md"), "utf8"),
      ).toLowerCase();
      for (const keyword of keywords) {
        expect(description, `${name} lost keyword "${keyword}"`).toContain(keyword.toLowerCase());
      }
    }
  });

  it("(T7) DESTRUCTIVE PROBE: the byte clause fails when a heavy rule is spliced in", () => {
    const baseline = measure(script);
    const withLex = replaceArray(script, "CLAUDE_CORE_RULES", [
      "GUARD_BLUEPRINT.md",
      "GUARD_DRIFT.md",
      "EXEC_AUTONOMY.md",
      "GUARD_SAFETY.md",
      "LEX_AGENTIC.md",
    ]);
    expect(withLex, "the splice must change the script").not.toBe(script);
    const planted = measure(withLex);
    console.log(`planted bytes ${baseline.bytes} -> ${planted.bytes}`);
    expect(planted.bytes, "splicing LEX_AGENTIC.md must exceed 16384").toBeGreaterThan(16384);

    const emptied = replaceArray(script, "CLAUDE_CORE_RULES", []);
    expect(emptied, "the emptying must change the script").not.toBe(script);
    expect(() => measure(emptied), "an empty array must trip the vacuity guard").toThrow();
  });
});
