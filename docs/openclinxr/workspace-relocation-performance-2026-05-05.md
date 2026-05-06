# Workspace Relocation Performance Evidence - 2026-05-05

## Context

Patrick suggested moving active OpenClinXR work from `/Users/patrick/Documents/New project 2` to `/Volumes/files/src/openclinxr` because the Documents path can trigger iCloud sync.

Codex created a source clone at `/Volumes/files/src/openclinxr` after a full `rsync` copy proved too slow for unattended work. The new workspace was installed with `pnpm install --frozen-lockfile --prefer-offline`, then a forced relink was required to materialize Rolldown native optional bindings.

## Runtime Notes

- Node used for comparable benchmarks: `v22.19.0`
- PNPM: `10.33.0`
- Node `v21.7.1` failed to start Vitest through Rolldown because its `util.styleText` implementation rejected array formatting.
- `.node-version` and `package.json` engines now advertise the working Node and PNPM posture.
- `.turbo/` is now ignored because cached typecheck/test runs create per-package Turbo cache folders.

## Quick Benchmark

Commands were run from both workspaces with the same Node `v22.19.0`. These are local warm-cache timings and should be treated as directional, not laboratory-grade.

| Command | Documents/iCloud Path | `/Volumes/files` Path | Observation |
| --- | ---: | ---: | --- |
| `pnpm exec vitest run tools/openclinxr/blueprint-voice-simulation-spike.test.ts` run 1 | 1718.6 ms | 1313.2 ms | `/Volumes/files` faster |
| same run 2 | 1304.8 ms | 1291.7 ms | roughly equal |
| same run 3 | 2105.2 ms | 2016.6 ms | `/Volumes/files` slightly faster |
| `pnpm agent:sources` run 1 | 1165.2 ms | 1093.3 ms | `/Volumes/files` slightly faster |
| same run 2 | 1006.2 ms | 1040.9 ms | Documents slightly faster |
| same run 3 | 1059.9 ms | 1270.9 ms | Documents faster |
| `pnpm typecheck` cached run 1 | 1820.0 ms | 1735.8 ms | `/Volumes/files` slightly faster |
| same run 2 | 1590.0 ms | 1664.4 ms | Documents slightly faster |

## Conclusion

The quick benchmark does not prove a dramatic steady-state speedup. It shows:

- Targeted Vitest is modestly better on `/Volumes/files`.
- Cached typecheck is roughly equivalent after Turbo has warmed.
- Source-ledger checks are dominated by normal run-to-run noise.

The relocation still appears worthwhile for unattended Codex work because it avoids iCloud sync churn and the earlier temporary disappearance of the Documents workspace. Treat the measurable performance gain as modest until longer multi-hour runs produce stronger evidence.

## Follow-Up

- Use `/Volumes/files/src/openclinxr` as the active Codex workspace for future long unattended work.
- Keep `/Users/patrick/Documents/New project 2` as a recovery/source copy unless Patrick explicitly asks to remove or replace it.
- The partial interrupted copy remains at `/Volumes/files/src/openclinxr.partial-rsync-20260505-2052` and can be removed after Patrick confirms it is not needed.
