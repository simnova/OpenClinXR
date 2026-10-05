## Verdict

### 1. The 18 moves

**REJECT as currently landed.** The implementations are behavior-equivalent, but four executable consumers were missed.

- `compute-services-spec`: declarations are identical after the header change; correctly exposed as `./contracts` ([package.json](/Volumes/files/src/openclinxr-wt/main-green/packages/openclinxr/compute-services-spec/package.json:11)).
- `compute-slots`: implementation remains unchanged in `slots.ts`; correctly exposed as `./slots` ([package.json](/Volumes/files/src/openclinxr-wt/main-green/packages/openclinxr/compute-slots/package.json:11)).
- `service-local-compute`: implementation is identical after normalizing its two import specifiers; correctly exposed as `./local` ([local.ts](/Volumes/files/src/openclinxr-wt/main-green/packages/openclinxr/service-local-compute/src/local.ts:7), [package.json](/Volumes/files/src/openclinxr-wt/main-green/packages/openclinxr/service-local-compute/package.json:11)).
- All changed consumers under `apps/`, `packages/`, and `tools/` use the new subpaths.

Missed consumers still importing the now-empty root:

- [round4/run-compute.mts](/Volumes/files/src/openclinxr-wt/main-green/docs/openclinxr/asset-cagematch/image-to-3dlab-ecg-cart-2026-10-01/round4/run-compute.mts:1)
- [round5/run-compute.mts](/Volumes/files/src/openclinxr-wt/main-green/docs/openclinxr/asset-cagematch/image-to-3dlab-ecg-cart-2026-10-01/round5/run-compute.mts:1)
- [round5/render-round5.mts](/Volumes/files/src/openclinxr-wt/main-green/docs/openclinxr/asset-cagematch/image-to-3dlab-ecg-cart-2026-10-01/round5/render-round5.mts:1)
- [round5b/render-round5b.mts](/Volumes/files/src/openclinxr-wt/main-green/docs/openclinxr/asset-cagematch/image-to-3dlab-ecg-cart-2026-10-01/round5b/render-round5b.mts:1)

These must use `@openclinxr/service-local-compute/local`.

Also, the worktree contains an unrelated assertion weakening from `>0.1/<0.2` to `>0.05/<0.1` ([jaw-viseme-drive.test.ts](/Volumes/files/src/openclinxr-wt/main-green/packages/openclinxr/xr-humanoid-animation/src/jaw-viseme-drive.test.ts:101)). It does not alter runtime behavior, but the whole diff is not solely a no-behavior-change migration.

### 2. The 15 exports

No root admission is justified. All 15 should leave package roots.

| Export | Independently verified consumer(s) | Verdict |
|---|---|---|
| `JAW_OPEN_TEETH_CLEAR_RADIANS` | Only the jaw evidence test imports it ([jaw-lip-couple.test.ts](/Volumes/files/src/openclinxr-wt/main-green/tools/openclinxr/evidence/parent-fitted-teeth/jaw-lip-couple.test.ts:31)); that test already reads and verifies the defining expression at line 370. | **DROP from public API.** Keep internal. |
| `JAW_TEETH_GAIN` | Only the same evidence test imports it at root ([line 32](/Volumes/files/src/openclinxr-wt/main-green/tools/openclinxr/evidence/parent-fitted-teeth/jaw-lip-couple.test.ts:32)); the capture already asserts literal `0.5`. | **DROP from public API.** Keep internal. |
| `applyDialogueVisemeTimelineToRoot` | Jaw evidence test ([line 34](/Volumes/files/src/openclinxr-wt/main-green/tools/openclinxr/evidence/parent-fitted-teeth/jaw-lip-couple.test.ts:34)); capture scripts bundle the source module directly, not the package root. | **MOVE → `./viseme-runtime`.** Shipped behavior must be exercised, not recomputed. |
| `applyJawOpenToRoot` | MakeClothes tool ([line 42](/Volumes/files/src/openclinxr-wt/main-green/tools/openclinxr/asset-pipeline/makeclothes/couple-fitted-teeth-to-lip-viseme.ts:42)) and jaw evidence test ([line 35](/Volumes/files/src/openclinxr-wt/main-green/tools/openclinxr/evidence/parent-fitted-teeth/jaw-lip-couple.test.ts:35)). | **MOVE → `./viseme-runtime`.** |
| `applyVisemeWeights` | MakeClothes tool ([line 43](/Volumes/files/src/openclinxr-wt/main-green/tools/openclinxr/asset-pipeline/makeclothes/couple-fitted-teeth-to-lip-viseme.ts:43)) and jaw evidence test ([line 36](/Volumes/files/src/openclinxr-wt/main-green/tools/openclinxr/evidence/parent-fitted-teeth/jaw-lip-couple.test.ts:36)). | **MOVE → `./viseme-morph`.** It exercises alias resolution and the graded mouth cap. |
| `jawApertureFractionTable` | MakeClothes tool only ([line 44](/Volumes/files/src/openclinxr-wt/main-green/tools/openclinxr/asset-pipeline/makeclothes/couple-fitted-teeth-to-lip-viseme.ts:44)), used solely to obtain one fraction ([line 656](/Volumes/files/src/openclinxr-wt/main-green/tools/openclinxr/asset-pipeline/makeclothes/couple-fitted-teeth-to-lip-viseme.ts:656)). | **DROP from public API.** Compute the fraction from `jawOpenRadiansForPhoneme(token) / jawOpenRadiansForPhoneme("AA")`. |
| `jawOpenRadiansForPhoneme` | MakeClothes tool ([line 45](/Volumes/files/src/openclinxr-wt/main-green/tools/openclinxr/asset-pipeline/makeclothes/couple-fitted-teeth-to-lip-viseme.ts:45)) and jaw evidence test ([line 37](/Volumes/files/src/openclinxr-wt/main-green/tools/openclinxr/evidence/parent-fitted-teeth/jaw-lip-couple.test.ts:37)). | **MOVE → `./viseme-timeline`.** Canonical mapping should not be duplicated. |
| `mapDialoguePhonemesToCues` | Speech-sync capture only ([speech-sync-capture.ts](/Volumes/files/src/openclinxr-wt/main-green/tools/openclinxr/evidence/parent-fitted-teeth/speech-sync-capture.ts:15)). | **MOVE → `./viseme-runtime`.** It is the canonical dwell-timing contract. |
| `CompiledMotionClipV1` | Capability gateway ([motion-manifest-publication.ts](/Volumes/files/src/openclinxr-wt/main-green/packages/openclinxr/capability-gateway/src/motion-manifest-publication.ts:4)). | **MOVE → `./compiler`.** |
| `compileMotionProgram` | Capability gateway ([line 7](/Volumes/files/src/openclinxr-wt/main-green/packages/openclinxr/capability-gateway/src/motion-manifest-publication.ts:7)). | **MOVE → `./compiler`.** |
| `deriveSkeletonProfileFromRigAsset` | Capability gateway ([line 8](/Volumes/files/src/openclinxr-wt/main-green/packages/openclinxr/capability-gateway/src/motion-manifest-publication.ts:8)). | **MOVE → `./compiler`.** |
| `MotionGlbBakeClip` | Capability gateway ([line 4](/Volumes/files/src/openclinxr-wt/main-green/packages/openclinxr/capability-gateway/src/motion-manifest-publication.ts:4)) **and a missed tool consumer** using a relative source import ([motion/index.ts](/Volumes/files/src/openclinxr-wt/main-green/tools/openclinxr/asset-pipeline/motion/index.ts:14)). | **MOVE → `./glb-bake`.** Update the tool to the package subpath. |
| `bakeMotionProgramToGlb` | Capability gateway ([line 6](/Volumes/files/src/openclinxr-wt/main-green/packages/openclinxr/capability-gateway/src/motion-manifest-publication.ts:6)) and relative-importing tool ([motion/index.ts](/Volumes/files/src/openclinxr-wt/main-green/tools/openclinxr/asset-pipeline/motion/index.ts:13)). | **MOVE → `./glb-bake`.** |
| `readMotionGlbClipId` | Capability gateway ([line 10](/Volumes/files/src/openclinxr-wt/main-green/packages/openclinxr/capability-gateway/src/motion-manifest-publication.ts:10)) and relative-importing tool ([motion/index.ts](/Volumes/files/src/openclinxr-wt/main-green/tools/openclinxr/asset-pipeline/motion/index.ts:13)). | **MOVE → `./glb-bake`.** |
| `playManifestMotionClip` | UI-XR shim only ([motion-manifest-motion-address.ts](/Volumes/files/src/openclinxr-wt/main-green/apps/ui-xr/src/motion-manifest-motion-address.ts:1)); called from `main.ts` ([main.ts](/Volumes/files/src/openclinxr-wt/main-green/apps/ui-xr/src/main.ts:4164)). | **MOVE → `./manifest-motion-clip-playback`.** |

### 3. Metrics and residual

Current compiler measurement is **rootExports 1235, p90 50**. The meter counts only `"."` exports ([resolve.ts](/Volumes/files/src/openclinxr-wt/main-green/packages/openclinxr-verification/architecture-rules/src/checks/public-surface/resolve.ts:277)) and uses nearest-rank p90 ([acceptance-criteria.ts](/Volumes/files/src/openclinxr-wt/main-green/packages/openclinxr-verification/architecture-rules/src/checks/public-surface/acceptance-criteria.ts:114)).

Removing all 15 from roots gives:

- `1235 − 15 = 1220`
- `xr-dialogue: 55 − 8 = 47`, restoring p90 to **47**

Therefore **1220 / 47 is achievable exactly**. I would not sign a higher residual. The existing reviewed residual values already state 1220 and 47 ([psr-c6-residual.json](/Volumes/files/src/openclinxr-wt/main-green/docs/openclinxr/package-public-surface-reduction/exceptions/psr-c6-residual.json:7), [p90 entry](/Volumes/files/src/openclinxr-wt/main-green/docs/openclinxr/package-public-surface-reduction/exceptions/psr-c6-residual.json:23)); only its measurement provenance should be refreshed to the eventual integration commit. No files were edited and no build/test suite was run.

Reviewed by: gpt-5 (Codex), read-only, 2026-10-05