# Clean Checkout Workspace Evidence - 2026-05-06

## Purpose

This report records a detached clean-worktree dependency and package-workspace smoke for `evidence-leadership-0005-001`: "Validate dependency install and package workspace behavior on a clean checkout."

## Environment

| Field | Value |
| --- | --- |
| Run time | 2026-05-06T08:47:29Z |
| Evidence recorded | 2026-05-06T08:50:52Z |
| Clean worktree | `/Volumes/files/src/openclinxr-clean-checkout-2026-05-06` |
| Source commit | `fd726926e149c0b20ce51b610915c3f1e1372753` |
| Node | `v22.19.0` |
| PNPM | `10.33.0` |
| Package manager | `pnpm@10.33.0` |
| Log SHA-256 | `bf31dc6498c30733fa455ad4de1b9b6b5a24b4a2860ef631a8d22acfb5e0c08b` |

The detached worktree was created from the active branch HEAD and had no committed or user-authored local changes. The only untracked file after the run was the generated smoke log itself.

## Commands And Results

| Command | Result | Notes |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | Pass | Lockfile was up to date; 870 packages were linked from the existing store with `downloaded 0`. |
| `pnpm store status` | Pass | Reported packages in the store were untouched. |
| `pnpm agent:validate` | Pass | Validated 69 agent charters and machine-readable artifacts. |
| `pnpm typecheck` | Pass | `tsgo --noEmit` and all 34 `@openclinxr/*` / `@cellix/*` package typechecks passed. |
| `pnpm test:tools` | Pass | 49 tool test files passed, 316 tests total. |
| `pnpm packages:test` | Pass | 33 workspace package test tasks passed. |
| `pnpm security:audit-policy` | Pass | 0 active audit-policy exceptions. |
| `pnpm security:licenses` | Pass | Checked 798 dependency license records; 12 review-only findings. |

## Observations

- PNPM ignored build scripts for `esbuild@0.27.7`, `mongodb-memory-server@11.1.0`, `protobufjs@8.0.3`, and `sharp@0.33.5` under the current PNPM build-approval posture.
- The clean install did not require `pnpm install --force`.
- The package workspace behavior was verified through both repository-level tools and package-level Turbo tasks.
- The original log has one misquoted metadata line for `packageManager`; it was corrected immediately after the run with `node -e` and confirmed as `pnpm@10.33.0`.

## Debt Impact

Closes `evidence-leadership-0005-001`.

Does not close Quest 3 immersive/performance evidence, local realtime voice model evidence, local model quality evidence, IWSDK sidecar Quest evidence, production asset evidence, or clinical validation evidence.

