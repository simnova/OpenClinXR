# PMO memory

## Lessons

- Temporal hygiene must be **unattended**: SessionStart auto-runs force path; weekly script/cron; multi-week offline caught by days_since_hygiene ≥ 14.
- **Temporal decisions catalog (2026-08-02):** time-bound workarounds/pins live in `docs/agent-ops/temporal-decisions-catalog.json` + process `TEMPORAL-DECISIONS.md`. PMO owns due/queue (`pnpm temporal:review`); analysis is analysisOwnerRole. Seeded: ccusage dual-path, Grok subagent tokens, DeepSeek vision, IWSDK pin, Turbo, product-under-os metrics. SessionStart hygiene banner includes TEMPORAL DUE line.
- Never per-task archive (anti-toil). Thresholds live in DOC-HYGIENE-CADENCE.md.
- PMO designs cadence; hooks/CLI execute without operator; CEO only notified when force ran or failed.
