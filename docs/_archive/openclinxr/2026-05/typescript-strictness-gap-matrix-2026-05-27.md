# TypeScript Strictness Gap Matrix - 2026-05-27

## Scope

This matrix tracks OpenClinXR TypeScript strictness alignment work against the remaining CellixJS strictness deltas. Worker Batch 2 adopts the bounded CellixJS flags that the current root compiler check can satisfy, and records the deltas that remain deferred.

## Batch 2 evidence

| Probe | Exit code | Diagnostics | Conclusion |
| --- | ---: | ---: | --- |
| `noImplicitReturns` | 0 | 0 | Clean in OpenClinXR; ready to adopt. |
| `noImplicitOverride` | 0 | 0 | Clean in OpenClinXR; ready to adopt. |
| Combined strictness probe | 0 | 0 | The Batch 2 adopted flags are compatible when enabled together. |
| `noFallthroughCasesInSwitch` | 0 | 0 | Clean in OpenClinXR root typecheck; adopted. |
| `allowUnreachableCode: false` | 0 | 0 | Clean in OpenClinXR root typecheck; adopted. |
| `allowUnusedLabels: false` | 0 | 0 | Clean in OpenClinXR root typecheck; adopted. |
| `noPropertyAccessFromIndexSignature` | 0 | 0 | Clean in OpenClinXR root typecheck after guardrail-safe bracket access audit; adopted. |
| `noUncheckedSideEffectImports` | 0 | 0 | Clean in OpenClinXR root typecheck; adopted. |

## Gap matrix

| Strictness delta | OpenClinXR status after Batch 2 | Batch 2 evidence | Next action |
| --- | --- | --- | --- |
| `noImplicitReturns` | Adopted | Dedicated probe exited 0 with zero diagnostics. | Keep enabled in OpenClinXR strictness baseline. |
| `noImplicitOverride` | Adopted | Dedicated probe exited 0 with zero diagnostics. | Keep enabled in OpenClinXR strictness baseline. |
| `noFallthroughCasesInSwitch` | Adopted | Root `tsc` accepts the flag with zero diagnostics. | Keep enabled in OpenClinXR strictness baseline. |
| `allowUnreachableCode: false` | Adopted | Root `tsc` accepts the flag with zero diagnostics. | Keep enabled in OpenClinXR strictness baseline. |
| `allowUnusedLabels: false` | Adopted | Root `tsc` accepts the flag with zero diagnostics. | Keep enabled in OpenClinXR strictness baseline. |
| `noPropertyAccessFromIndexSignature` | Adopted | Root `tsc` accepts the flag; guardrail script uses bracket access for dynamic compiler option reads. | Keep enabled in OpenClinXR strictness baseline. |
| `noUncheckedSideEffectImports` | Adopted | Root `tsc` accepts the flag with zero diagnostics. | Keep enabled in OpenClinXR strictness baseline. |
| `noUnusedLocals` | Deferred | Not part of the bounded clean set for this worker batch. | Re-probe after current unused cleanup. |
| `noUnusedParameters` | Deferred | Not part of the bounded clean set for this worker batch. | Re-probe after current unused cleanup. |
| `verbatimModuleSyntax` | Deferred | Expected to require import/export churn beyond bounded config hardening. | Evaluate in a later syntax-focused batch. |
| `erasableSyntaxOnly` | Deferred | Requires syntax audit beyond this worker batch. | Evaluate in a later syntax-focused batch. |
| `composite` / `incremental` | Deferred | Package-build architecture decision, not a root strictness-only toggle. | Evaluate with package build architecture work. |
| `skipLibCheck: false` | Deferred | Dependency-health gate beyond current bounded root compiler check. | Revisit after dependency type health is audited. |

## Key conclusions

- OpenClinXR adopts `noImplicitReturns` after Batch 2 because the isolated probe exited 0 with zero diagnostics.
- OpenClinXR adopts `noImplicitOverride` after Batch 2 because the isolated probe exited 0 with zero diagnostics.
- OpenClinXR also adopts `noFallthroughCasesInSwitch`, `allowUnreachableCode: false`, `allowUnusedLabels: false`, `noPropertyAccessFromIndexSignature`, and `noUncheckedSideEffectImports` because the current root compiler check can satisfy them together.
- Guardrails now require the adopted true-valued flags to remain true and the adopted false-valued flags to remain false in the inherited Cellix base config.
- Remaining CellixJS deltas are explicitly deferred because they require cleanup, syntax churn, package architecture work, or dependency-health validation beyond this bounded batch.
