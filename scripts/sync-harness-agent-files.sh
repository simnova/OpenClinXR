#!/bin/bash
# Sync script for agentic files (rules + hooks) to harness-specific directories for multi-harness standardization.
# Run from repo root.
# Canonical: agents/rules/*.md (with frontmatter for doc-authority-registry) and .grok/hooks/*.json (plus .agents/skills/ via config).
# Produces relative symlinks in .grok/rules/ + .claude/rules/ + .cursor/rules/,
# safe role pointer files in harness agent directories, and hooks.json for claude/cursor compat.
# Skills discovery is via [skills] paths = [".agents/skills"] (and equiv in other harness configs); no skills symlinks.
# Idempotent. See AGENTS.md, agents/rules/README.md, .grok/config.toml.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "Syncing agentic files for multi-harness support (rules + hooks from canonical; skills via [skills]paths in each harness config, no symlinks per standardization choice)."

# Clean first to avoid stale symlinks on renames (skills fully removed from sync per config-only choice; rules/hooks maintained)
rm -rf .grok/skills/* .claude/skills/* .cursor/skills/* .codex/skills/* .grok/rules/* .claude/rules/* .cursor/rules/* 2>/dev/null || true
rm -rf .claude/hooks .cursor/hooks 2>/dev/null || true

# SKILLS: intentionally no symlinks created here.
# Canonical source: .agents/skills/
# Grok discovery: [skills] paths = [".agents/skills"] in .grok/config.toml (and user ~/.grok/config.toml)
# Other harnesses configure equivalently or use their global skills + compat.
# We keep empty .grok/skills/ etc for any fallback discovery but do not populate with lns.
mkdir -p .grok/skills .claude/skills .cursor/skills .codex/skills
echo "  Skills: using config [skills].paths (no symlinks synced; removed per multi-harness standardization)"

# RULES (canonical agents/rules/; Grok scans .grok/rules/*.md + compat .claude/rules/ .cursor/rules/)
mkdir -p .grok/rules .claude/rules .cursor/rules
for rule in agents/rules/*.md; do
  [ -f "$rule" ] || continue
  name=$(basename "$rule")
  ln -sfn "../../$rule" ".grok/rules/$name"
  ln -sfn "../../$rule" ".claude/rules/$name"
  ln -sfn "../../$rule" ".cursor/rules/$name"
  echo "  Synced rule: $name"
done

# AGENTS (project-scoped role pointers; canonical content remains root agents/**)
# Keep pointer files intentionally tiny: no charter/memory duplication, no symlinks to role folders.
# This gives Grok/Claude/Cursor/Codex a symmetric discovery surface while preserving agents/** as the source of truth.
rm -rf .grok/agents .claude/agents .cursor/agents .codex/agents 2>/dev/null || true
mkdir -p .grok/agents .claude/agents .cursor/agents .codex/agents
node - <<'NODE'
const fs = require("fs");
const path = require("path");

const harnesses = [".grok", ".claude", ".cursor", ".codex"];
const roles = [];
for (const group of fs.readdirSync("agents", { withFileTypes: true }).filter((d) => d.isDirectory())) {
  const groupDir = path.join("agents", group.name);
  for (const role of fs.readdirSync(groupDir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    const roleDir = path.join(groupDir, role.name);
    if (["charter.md", "memory.md", "index.json"].every((file) => fs.existsSync(path.join(roleDir, file)))) {
      roles.push({ group: group.name, role: role.name, roleDir });
    }
  }
}
roles.sort((a, b) => a.role.localeCompare(b.role));

const list = roles.map(({ role }) => `- ${role}`).join("\n");
for (const harness of harnesses) {
  const dir = path.join(harness, "agents");
  fs.writeFileSync(
    path.join(dir, "README.md"),
    `# Repo-defined agent role pointers\n\nCanonical role definitions live under root \`agents/**\` with \`charter.md\`, \`memory.md\`, and \`index.json\`.\n\nThese files are safe harness-local pointers only. They do not duplicate role memory or replace the source-of-truth order in \`AGENTS.md\`.\n\nRoles:\n${list}\n\nUse \`agents/rules/agent-consult.md\` and \`agents/rules/subagent-protocol.md\` before mapping a live subagent or local role consultation.\n`,
  );

  for (const { group, role, roleDir } of roles) {
    fs.writeFileSync(
      path.join(dir, `${role}.md`),
      `# ${role} (repo role pointer)\n\nCanonical: \`${roleDir}/charter.md\`, \`${roleDir}/memory.md\`, and \`${roleDir}/index.json\`.\n\nGroup: \`${group}\`.\n\nUse for: role-mapped repo-agent consultation or a live subagent prompt when the current harness supports subagents and the task materially reduces drift, review cost, or implementation risk.\n\nTarget repo /Volumes/files/src/openclinxr.\n\nSpawn/local-consult prompt seed: \"You are \`${role}\` for /Volumes/files/src/openclinxr. First confirm AGENTS.md, PROJECT_COORDINATION_INDEX.md, AUTONOMOUS_WORK_PLAN.md, docs/agent-factory/**, agents/**, and tools/agent-factory/** exist. Read your canonical charter and memory with a tight limit. Follow agents/rules/agent-consult.md and agents/rules/subagent-protocol.md. Return concise findings, blockers, and recommended next slice. Do not edit unless explicitly assigned a non-overlapping write scope.\"\n`,
    );
  }
}
console.log(`  Generated ${roles.length} role pointer files for ${harnesses.join(", ")}`);
NODE

# HOOKS (canonical in .grok/hooks/*.json per Grok project hooks; auto guards + rehydrate reminders)
# Do not rm .grok/hooks (the *.json are committed source for Grok native + plugin discovery).
mkdir -p .grok/hooks
# For claude/cursor compat: place hooks.json at the .claude/ .cursor/ root (their expected location for hooks.json compat).
# Overwrite with content from the grok canonical post-coord guard (keeps single source of truth for the guard logic).
# Merge all .grok/hooks/*.json into single hooks.json for claude/cursor compat (their loader expects one file with all events).
if ls .grok/hooks/*.json >/dev/null 2>&1; then
  node - <<'NODE'
    const fs = require("fs");
    const hooks = {};
    for (const f of fs.readdirSync(".grok/hooks").filter(n => n.endsWith(".json"))) {
      const j = JSON.parse(fs.readFileSync(".grok/hooks/" + f, "utf8"));
      for (const [ev, arr] of Object.entries(j.hooks || {})) {
        hooks[ev] = (hooks[ev] || []).concat(arr);
      }
    }
    const neutralizeForCompat = (value) => typeof value === "string"
      ? value
        .replaceAll("grok-autonomy", "harness-autonomy")
        .replaceAll("In this TUI env Grok has FULL local execution (shell, edit, spawn_subagent, scheduler_create, monitor, pnpm openclaw:*) so it is PRIMARY OpenClaw runner per Grok adapter in docs/openclinxr/openclaw-tool-adapters-2026-05-27.md (not just bounded specialist). ", "Use this harness as an OpenClaw runner only to the extent it has local file, shell, edit, browser, and subagent capabilities; otherwise follow the adapter fallback matrix. ")
        .replaceAll("Grok notes:", "Harness notes:")
        .replaceAll("sed -n '/## Grok Adapter/,/## Cursor Adapter/p' | head -20", "sed -n '/## Shared Host Requirements/,/## Universal OpenClaw Prompt/p' | head -40")
      : value;
    const walk = (value) => {
      if (Array.isArray(value)) return value.map(walk);
      if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]));
      }
      return neutralizeForCompat(value);
    };
    const out = walk({ hooks });
    fs.writeFileSync(".claude/hooks.json", JSON.stringify(out, null, 2) + "\n");
    fs.writeFileSync(".cursor/hooks.json", JSON.stringify(out, null, 2) + "\n");
    console.log("  Merged .grok/hooks/*.json -> .claude/hooks.json + .cursor/hooks.json (all events)");
NODE
else
  echo "  Warning: no .grok/hooks/*.json found."
fi
# Note: .claude/settings.json or other may also be used by some; hooks.json is the one we maintain for Cursor/Claude compat here.
echo "  (Grok native loads from .grok/hooks/*.json automatically when project trusted via /hooks-trust or modal.)"

echo "Done. Use 'grok inspect' to verify loaded rules/hooks/skills/subagents. Re-run after adding rules or hooks."
echo "After sync: pnpm agent:alignment && pnpm docs:drift-check"
