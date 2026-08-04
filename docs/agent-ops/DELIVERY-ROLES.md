# Delivery roles + skill posture (RIF & skill-stub tax)

**Owner:** hrbp (roster / delivery mapping) · architect (composition residual)  
**Status:** Living notes (ATL patterns #2 RIF, #5 skill-stub-tax — doc-level adoption)  
**Established:** 2026-08-04  
**Related hard law:** `COMPOSITION-ROOTS.md` H4 · `PATH-SCOPE.md` Wave C-arch · `role-harness-policy.ts`

## Delivery role selection (RIF)

**Prefer NAMED domain roles** over bare harness `subagent_type=general-purpose` for **product write**.

| Intent | Do | Don’t |
|--------|----|--------|
| Product write (apps/packages/tools factory) | `pnpm grok:agent:spawn-spec --role <domainRole>` (`asset-pipeline-lead`, `xr-systems-architect`, `architect`, …) with pathScope `writeRoots` | Spawn anonymous `general-purpose` as full-stack catch-all |
| Scout / consult / verdict (read-heavy) | `explore` / `plan` or typed read-only role; bare GP only when **scoped scout/verdict** with no product write claim | Use GP “because it can write” for delivery |
| Coordination / hygiene | `chief-coordinator`, `hrbp`, `pmo`, `archivist`, drift/skeptic roles | CEO main session as product IC |

OpenClinXR is **not** classic FE/BE RIF — map columns per `COMPOSITION-ROOTS.md` domain role map. Helper: `assertDeliveryRoleMapped(roleId)`. Silent bare-GP delivery → SoD **major/critical** on roster review.

Harness note: typed roles may still *execute* on a GP capability tier; the **role id + pathScope** is what counts, not the bare type string alone.

## Skill stub tax

| Cost | What | Practice |
|------|------|----------|
| **Catalog always-on** | Skill name + short `description` in the skill catalog | Keep descriptions tight trigger text only |
| **Body on invoke** | Full `SKILL.md` body loaded when skill matches | Put **identity + short non-negotiables** in the body; not multi-KB playbooks |
| **Fat procedures** | Long runbooks, historical playbooks, rare edge tables | Archive under `references/` (or docs warehouse); load only when the thin skill points there |

**Pattern:** identity / long procedures → **thin skill stubs** (`disable-model-invocation` where the skill is catalog-only or pointer-only) + **fat playbooks under `references/`** (or `docs/**` SSOT). Do not pay body-on-invoke tax for cold procedure text every session.

Examples in-repo: keep `.agents/skills/*/SKILL.md` structural and short (e.g. `delegated-worker-contract`); deep Anny/runbook detail stays in skill body only when always needed for that trigger, else docs under `docs/openclinxr/**` / skill `references/`.

## Related

- `docs/agent-ops/COMPOSITION-ROOTS.md` — H4 role-mapped delivery  
- `docs/agent-ops/PATH-SCOPE.md` — writeRoots / sole-author  
- `docs/agent-ops/COMMIT-AUTHORITY.md` — who may commit where  
- `docs/agent-ops/TOOLING-TOPOLOGY.md` — CLI-first surfaces  
