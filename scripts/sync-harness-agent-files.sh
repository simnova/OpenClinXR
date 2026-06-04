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
if [ -f .grok/hooks/post-coord-edit-guards.json ]; then
  cp .grok/hooks/post-coord-edit-guards.json .claude/hooks.json
  cp .grok/hooks/post-coord-edit-guards.json .cursor/hooks.json
  echo "  Synced hooks: .grok/hooks/post-coord-edit-guards.json -> .claude/hooks.json + .cursor/hooks.json"
else
  echo "  Warning: .grok/hooks/post-coord-edit-guards.json not found; run after creating it."
fi
# Note: .claude/settings.json or other may also be used by some; hooks.json is the one we maintain for Cursor/Claude compat here.
echo "  (Grok native loads from .grok/hooks/*.json automatically when project trusted via /hooks-trust or modal.)"

echo "Done. Use 'grok inspect' to verify loaded rules/hooks/skills/subagents. Re-run after adding rules or hooks."
echo "After sync: pnpm agent:alignment && pnpm docs:drift-check"
