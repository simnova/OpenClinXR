# CEO BOD Voice Revision — 2026-08-02

**Owner:** hrbp  
**Type:** voice / roster revision  
**Source:** human feedback — CEO final replies end with soft "possible next steps" that are not BOD-actionable

## VERDICT: ROSTER_HEALTHY (voice upgrade applied)

BOD-actionable voice contract now in place. No roster structural defect; existing orchestrator agent + persona + voice docs were sound but lacked explicit BOD-facing decision structure.

## BOD APPROVAL

| Field | Value |
|-------|--------|
| Decision | Approve CEO voice contract as standing rule for all main-session human replies |
| Status | **APPROVED** |
| Date | 2026-08-02 |
| Effect | Immediate on next orchestrator session load; HRBP scores soft-menu / no-research asks as major |

## Deltas

| File | Change |
|------|--------|
| `docs/agent-ops/CEO-VOICE.md` | **Rewritten.** Added BOD decision contract: anti-pattern ban list, decision-bearing template (RECOMMENDATION → STATUS → OPTIONS → RESEARCH BASIS → BOD APPROVAL REQUESTED → DEFAULT IF SILENT), status update template, Research Protocol before any BOD ask. Banned phrases table. Severity: CEO soft-menu = major. |
| `.grok/agents/orchestrator.md` | **Removed `web_search` + `web_fetch` from `disallowedTools`** (allowed for BOD research only, never product IC). Added research duty + hrbp staffing consult. Updated human reply templates to match new CEO-VOICE structure. Self-test item: BOD ask without research basis → stop. |
| `.grok/personas/orchestrator.toml` | **Added BOD-assertive voice section**: anti-pattern ban, decision template, status template, principles (recommendation-first, assert default plan, single ask, research before ask). Explicitly bans "possible next steps" / "you might consider" / "let me know if you want me to…" / "should I continue?" |
| `agents/coordinator/hrbp/charter.md` | **Added BOD voice duties**: coach CEO BOD communication (Persona line); review dimension "BOD voice" (score soft menus as major); voice revision records output root. Severity table: BOD ask without research = major. |
| `agents/coordinator/hrbp/memory.md` | **Appended Lesson 2026-08-02 — BOD-actionable CEO voice** with full summary of decision contract, banned phrases, research requirement, severity scoring. |
| `docs/agent-ops/README.md` | **Updated CEO-VOICE.md row** to note BOD decision contract + recommendation-first; **added** voice revision record row; BOD voice mention in spawn task text. |
| `agents/rules/orchestrator-only-main.md` | **Added** `## BOD-facing asks` — pointer to CEO-VOICE decision contract (research before ask, single approval string, no soft menus). |

## Residuals

- **CEO must internalize new voice.** Frontmatter/tool allowlist changes do not rebind live sessions mid-chat — open a **new session** (or reselect orchestrator agent) after these config changes per `docs/agent-ops/MAIN-SESSION-ORCHESTRATOR-ONLY.md`.
- **First roster review** after this revision should verify CEO replies in transcript exhibit the new decision template structure (recommendation-first, no soft menus, research basis cited).
- **web_search/web_fetch** now available to CEO — HRBP should audit that they are used **only** for BOD research (not product implementation) in next roster review.
- **hrbp staffing consult** duty added to orchestrator — verify it's exercised when CEO faces ambiguous staffing decisions.
- Binding chain: `CEO-VOICE.md` → `.grok/personas/orchestrator.toml` → `.grok/agents/orchestrator.md` → `orchestrator-only-main.md` BOD-facing asks section.
