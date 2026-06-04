#!/bin/bash
# Sync script for agentic files (rules + hooks) to harness-specific directories for multi-harness standardization.
# Run from repo root.
# Canonical: agents/rules/*.md (with frontmatter for doc-authority-registry) and .grok/hooks/*.json (plus .agents/skills/ via config).
# Produces relative symlinks in .grok/rules/ + .claude/rules/ + .cursor/rules/ and copies hooks.json for claude/cursor compat.
# Skills discovery is via [skills] paths = [".agents/skills"] (and equiv in other harness configs); no skills symlinks.
# Idempotent. See AGENTS.md, agents/rules/README.md, .grok/config.toml.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "Syncing agentic files for multi-harness support (rules + hooks from canonical; skills via [skills]paths in each harness config, no symlinks per standardization choice)."

# Clean first to avoid stale symlinks on renames (skills fully removed from sync per config-only choice; rules/hooks maintained)
rm -rf .grok/skills/* .claude/skills/* .cursor/skills/* .grok/rules/* .claude/rules/* .cursor/rules/* 2>/dev/null || true
rm -rf .claude/hooks .cursor/hooks 2>/dev/null || true

# SKILLS: intentionally no symlinks created here.
# Canonical source: .agents/skills/
# Grok discovery: [skills] paths = [".agents/skills"] in .grok/config.toml (and user ~/.grok/config.toml)
# Other harnesses configure equivalently or use their global skills + compat.
# We keep empty .grok/skills/ etc for any fallback discovery but do not populate with lns.
mkdir -p .grok/skills .claude/skills .cursor/skills
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

# AGENTS (project-scoped agent definitions; .grok/agents/ per Grok docs)
# Note: The source agents/ (with role charters/memory) is already at repo root and discoverable.
# Symlinking under .grok/agents/ creates additional paths that trigger drift/registry issues (new paths for existing MDs).
# For now, rely on root agents/ and the agents/rules/ for modularity. Uncomment selective if registry updated to cover .grok/agents/* paths.
# rm -rf .grok/agents .claude/agents .cursor/agents 2>/dev/null || true
# mkdir -p .grok/agents .claude/agents .cursor/agents
# for role in adversarial coordinator core leadership physicians; do
#   ln -sfn ../../agents/$role .grok/agents/$role
#   ...
# done
# echo "  Synced selective agents/ roles"
echo "  (Agents roles: using root agents/ to avoid registry path duplication; see .grok/config.toml note)"

# HOOKS (canonical in .grok/hooks/*.json per Grok project hooks; auto guards + rehydrate reminders)
# Do not rm .grok/hooks (the *.json are committed source for Grok native + plugin discovery).
mkdir -p .grok/hooks
# For claude/cursor compat: place hooks.json at the .claude/ .cursor/ root (their expected location for hooks.json compat).
# Overwrite with content from the grok canonical post-coord guard (keeps single source of truth for the guard logic).
# Merge all .grok/hooks/*.json into single hooks.json for claude/cursor compat (their loader expects one file with all events).
if ls .grok/hooks/*.json >/dev/null 2>&1; then
  node -e '
    const fs = require("fs");
    const hooks = {};
    for (const f of fs.readdirSync(".grok/hooks").filter(n => n.endsWith(".json"))) {
      const j = JSON.parse(fs.readFileSync(".grok/hooks/" + f, "utf8"));
      for (const [ev, arr] of Object.entries(j.hooks || {})) {
        hooks[ev] = (hooks[ev] || []).concat(arr);
      }
    }
    const out = { hooks };
    fs.writeFileSync(".claude/hooks.json", JSON.stringify(out, null, 2) + "\n");
    fs.writeFileSync(".cursor/hooks.json", JSON.stringify(out, null, 2) + "\n");
    console.log("  Merged .grok/hooks/*.json -> .claude/hooks.json + .cursor/hooks.json (all events)");
  '
else
  echo "  Warning: no .grok/hooks/*.json found."
fi
# Note: .claude/settings.json or other may also be used by some; hooks.json is the one we maintain for Cursor/Claude compat here.
echo "  (Grok native loads from .grok/hooks/*.json automatically when project trusted via /hooks-trust or modal.)"

echo "Done. Use 'grok inspect' to verify loaded rules/hooks/skills/subagents. Re-run after adding rules or hooks."
echo "After sync: pnpm agent:alignment && pnpm docs:drift-check"
