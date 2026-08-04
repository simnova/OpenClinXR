# Composition roots (OCX hard law, ATL-inspired)

**Owner:** `architect` (sole-author lock `composition-roots`)  
**Policy tier:** standard_execution · **BOD status:** APPROVED 2026-08-02 (context-opt-wave-c / Wave C-arch)  
**Related:** `docs/agent-ops/PATH-SCOPE.md` (pathScope writeRoots SSOT + Wave C-arch delivery mapping)

## Doctrine

OpenClinXR is a **composition-root monorepo**: feature logic lives in **packages**; **apps are composition hosts / runtime shells** that wire and boot packages, not places to dump feature logic; **tools are factory/pipeline CLIs**.

Inspired by the ATL (atlantis-cameras-v2) path-scope discipline: keep libraries/features reusable and packages-owned, keep apps thin (bootstrap, wiring, runtime shell), and keep pipeline logic in CLI tools so it is invokable headlessly.

## Hard rules (agents — non-negotiable)

| # | Rule | Fail mode |
|---|------|-----------|
| **H1** | **Features live in packages** (`packages/openclinxr/*`, `packages/cellix/*` seedwork). Domain behavior, UI feature modules, persistence, factory consumers → packages. | SoD **critical** if dumped into apps without package extraction path |
| **H2** | **Apps compose/boot only** — bootstrap, DI wiring, host shell, route mount, runtime entry. No feature logic growth in apps unless residual is explicit host-only. | Domain role writeRoots may touch app shells; still no feature dumps that belong in packages |
| **H3** | **Tools are CLI / factory pipelines** (`tools/openclinxr/*`). Headless invocable; not app-only side effects. | Pipeline logic in apps → residual to asset/factory owners |
| **H4** | **Product delivery is role-mapped** — never spawn bare harness `general-purpose` / `explore` / `plan` for product write. Use `pnpm grok:agent:spawn-spec --role <roleId>` + `assertDeliveryRoleMapped(roleId)`. See also `DELIVERY-ROLES.md` (RIF). | PATH-SCOPE Wave C-arch; parent checklist **critical** |
| **H5** | **Residual out-of-scope topology → `architect`** — cellix, architecture-rules, composition doctrine, cross-package wiring patterns. Domain roles do not “just fix” seedwork. | sole-author lock `composition-roots` hard-fails verify |

## Architect residual table

When to residual **`architect`** (not do it as ui-xr / asset / harness IC):

| Trigger | Residual to architect | Keep on domain role |
|---------|----------------------|---------------------|
| New package / boundary / ArchUnit rule | Yes — `packages/openclinxr/architecture-rules/**`, cellix configs | Feature body after boundary exists |
| Feature dump into app host | Architect names extraction path; domain implements in package | Domain owns package feature + thin app wire |
| Shared TS/vitest seedwork (`packages/cellix/**`) | Yes | Consumers only |
| Composition doctrine edit (`COMPOSITION-ROOTS.md`) | Yes (lock owner) | Point only |
| Rolldown / compose wiring config | Yes when cross-app topology | App-local bootstrap stays domain |
| Learner WebXR / admin UI behavior | No | `xr-systems-architect` / ui-admin owners |
| Asset pipeline / cagematch | No | `asset-pipeline-lead` |
| Agent pathScope / roster | No | `hrbp` |

App shell ownership **stays** with domain roles (`xr-systems-architect` → `apps/ui-xr/**`+`apps/arena/**`; `asset-pipeline-lead` → model-vetting studio). Architect reviews **patterns** and owns **seedwork/topology** — not broad `apps/*/src/main.ts` writeRoots.

## Domain role map (OCX — not pure FE/BE)

OpenClinXR is not classic FE/BE RIF. Map product work to these **domain columns**:

| Domain column | Primary roles | Typical roots |
|---------------|---------------|---------------|
| **ui-xr** (learner WebXR runtime) | `xr-systems-architect` | `apps/ui-xr/**`, `packages/openclinxr/arena/**`, XR packages |
| **ui-admin** | residual / future admin owners; avoid catch-all | `apps/ui-admin/**`, `packages/openclinxr/ui-route-admin/**` |
| **data / persistence** | data package owners (scoped slices) | `packages/openclinxr/data-mongodb/**`, shared-schemas, repositories |
| **factory / assets** | `asset-pipeline-lead`, `rigging-animation-specialist` | `tools/openclinxr/asset-pipeline/**`, model-vetting studio |
| **agent-loop / harness** | `hrbp`, `openclaw-drift-police`, `chief-coordinator` (CEO hygiene) | `packages/openclinxr/agent-loop/**` (path-scope lock: hrbp), agent-ops, slice hygiene |
| **composition / topology** | **`architect`** | cellix, architecture-rules, COMPOSITION-ROOTS, optional config-rolldown, MADRs topology |

## OCX map (layers)

| Layer | Path | Kind | Examples |
|---|---|---|---|
| **Shells / UI hosts** | `apps/ui-xr`, `apps/ui-admin` | Composition hosts / runtime shells (learner WebXR runtime, admin UX) | `apps/ui-xr/**` main.ts runtime surface; `apps/ui-admin/**` |
| **Other hosts** | `apps/api`, `apps/arena` | Runtime shells (server / tester host) | `apps/api/**`, `apps/arena/model-vetting-studio/**` (tester app) |
| **Features** | `packages/openclinxr/*` | Feature packages (domain, runtime, persistence, review, gateways) | `agent-loop`, `domain`, `scenario-runtime`, `trace-ledger`, `data-mongodb`, `voice-gateway`, `exam-assembly` |
| **Seedwork** | `packages/cellix/*` | Shared TS/vitest monorepo seedwork | `config-typescript`, `config-vitest` |
| **Architecture gate** | `packages/openclinxr/architecture-rules/**` | ArchUnit-style workspace rules | `workspace-architecture.test.ts` |
| **Factory / pipeline CLIs** | `tools/openclinxr/*` | Factory/pipeline command-line tools | `asset-pipeline`, `evidence`, `factory`, `openclaw` |

## Agent implication

- Writers route through **pathScope writeRoots** (see `docs/agent-ops/PATH-SCOPE.md`): feature logic → `packages/openclinxr/*`; pipeline logic → `tools/openclinxr/*`; composition/runtime shell → the app shell whose role owns it; topology/seedwork → **`architect`**.
- **Do not dump features into apps** unless the role's `writeRoots` explicitly allow the shell path **and** the change is host/boot/wire only. Only app-owning roles (`xr-systems-architect` → `apps/ui-xr/**`+`apps/arena/**`; `asset-pipeline-lead` → `apps/arena/model-vetting-studio/**`) may write into app shells for their domain.
- Coordinators (chief-coordinator, hrbp, drift-police, skeptics, planners) write coordination/governance docs only — never product features in `apps/**` or domain packages.
- SoD guard: `assertTouchedWithinWriteRoots()` + `auditHandoffsPathScope()` fail slice verify (`ok: false`) on any `touched` path outside `writeRoots`.
- Sole-author lock **`composition-roots`** (owner: `architect`): `docs/agent-ops/COMPOSITION-ROOTS.md`, `packages/cellix/**`, `packages/openclinxr/architecture-rules/**`.
- Residual work outside a role's roots → hand off to the owning role or parent; do not widen your own scope.
- Write-role spawn prompts include a short **COMPOSITION-ROOTS** pointer (Wave C-arch).

## Why hard (not lite)

ATL tracks full composition-root graphs. OpenClinXR previously kept a light 3-layer map. Wave C-arch elevates composition to **hard law**: machine pathScope + sole-author lock + delivery-role mapping + architect residual table so agents cannot silently reintroduce full-stack catch-alls.
