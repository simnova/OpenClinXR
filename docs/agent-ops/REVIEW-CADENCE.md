# Review cadence (agent roster)

| Event | Action | Owner |
|-------|--------|--------|
| **New agent/role added** | Full SoD + success + tools/MCP + effort review before merge | hrbp |
| **Monthly** (or major program replan) | Full roster scan → dated `docs/agent-ops/YYYY-MM-DD-roster-review.md` | hrbp |
| **After MCP/CLI policy change** | Spot-check all agent prompts for disabled MCP references | hrbp |
| **After model catalog / tier policy change** | Re-score expensive models on non-judgment roles | hrbp |
| **Path-lock / SoD incident** | Spot audit of violated roles; patch definitions | hrbp + chief-coordinator |
| **Commit / promote incident** (force-push, main-merge by child, secret in commit) | Audit vs **`COMMIT-AUTHORITY.md`** + worktree promote allowlist | hrbp + chief-coordinator |
| **Capability constraint residual** | Triage `docs/agent-ops/capability-requests/` | hrbp |
| **Doc warehouse hygiene** (checkpoint archive, dated freeze, worktree residual, anti-backlog) | **Not** per-task — thresholds + weekly/biweekly/monthly defaults; see **[`DOC-HYGIENE-CADENCE.md`](./DOC-HYGIENE-CADENCE.md)** (SSOT) | **pmo** (temporal + unattended SessionStart auto-run) · hrbp (roster process) · archivist (optional cold verify) · orchestrator (force gate) · drift-police (process holes) |
| **Temporal decision revisit** (workarounds, stack pins, model capability assumptions) | Per catalog `nextReviewAt` (not every session thrash) — see **[`TEMPORAL-DECISIONS.md`](./TEMPORAL-DECISIONS.md)** | **pmo** (catalog/due/queue) · **analysisOwnerRole** (verdict) · **executeOwnerRole** (work) · orchestrator (promote to product dequeue) |

**Critical:** main Composer session doing IC product work while claiming orchestration-only — restore chief-coordinator discipline (LEX_AGENTIC servant leadership).
