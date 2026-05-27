# Dynamic Session Asset Strategy

Date: 2026-05-22
Status: implementation strategy with first runtime slice in place

## Goal

OpenClinXR should not hardcode station-specific generated assets inside the learner XR application. Humanoid models, room shells, equipment, animation clips, phoneme maps, audio, textures, and schema-rendered UI surfaces should be generated, reviewed, stored, bound to a session or encounter, and then resolved by the main application through a stable asset-bundle contract.

## Runtime Contract

The runtime contract is `EncounterRuntimeAssetBundle` in `@openclinxr/asset-registry/runtime-bundles`.

The bundle is frozen per encounter and contains:

- tenant, learner, exam run, encounter, station, and scenario identity.
- environment model asset.
- actor model assets plus animation, phoneme, and gaze-profile slots.
- equipment model assets.
- schema-rendered UI surface assets.
- blob/object-store references.
- review/provenance status.
- explicit non-claim boundaries for production asset readiness, Quest readiness, clinical validity, and scoring validity.

The learner runtime should consume the bundle and call `resolveRuntimeAssetUrl(asset)` instead of importing scenario-specific path constants.

## Storage Strategy

Use the same logical blob layout across local and hosted environments.

```txt
tenants/{tenantId}/asset-library/{assetId}/{version}/asset.manifest.json
tenants/{tenantId}/asset-library/{assetId}/{version}/model.glb
tenants/{tenantId}/asset-library/{assetId}/{version}/animations/idle.glb
tenants/{tenantId}/asset-library/{assetId}/{version}/phonemes/map.json
tenants/{tenantId}/sessions/{examRunId}/encounters/{encounterId}/asset-bundle.json
```

Supported store kinds:

- `app_public_fixture`: current local static files under the Vite public root.
- `azurite_blob`: local Azure Blob emulator, defaulting to `http://127.0.0.1:10000/devstoreaccount1/openclinxr-assets/...`.
- `azure_blob`: Azure Blob Storage, defaulting to `https://{account}.blob.core.windows.net/{container}/...`.

The current implementation intentionally avoids making cloud calls from the XR runtime. It resolves URLs from reviewed bundle metadata. Upload, SAS generation, and access-control policy should live in server/tooling packages, not in `apps/ui-xr`.

## Generation Flow

1. A generation job creates a model, animation, audio, texture, phoneme map, or UI schema artifact.
2. The job writes files to Blob or Azurite and emits an asset manifest with content hashes, provenance, license status, optimization metadata, and review status.
3. A review workflow promotes the asset to an approved local-runtime status.
4. Exam/session assembly freezes selected assets into an encounter-specific `asset-bundle.json`.
5. The learner XR application loads only the frozen bundle for the active encounter.

## UI Component Policy

Do not dynamically import arbitrary generated React code into the learner XR scene.

Preferred pattern:

- learner runtime uses schema-rendered surfaces such as `schema_panel` and static data assets.
- admin/faculty tooling may use reviewed generated components after build-time registration.
- experimental dynamic components stay in sandbox/dev tools until security and review gates exist.

## Implemented Slice

- `packages/openclinxr/asset-registry/src/runtime-bundles.ts` defines lightweight runtime bundle contracts and URL resolution for public fixtures, Azurite, and Azure Blob Storage.
- `apps/ui-xr` now resolves generated ED chest-pain humanoid, equipment, and environment GLBs through the encounter asset bundle instead of direct generated-asset path constants.
- Focused tests verify fixture, Azurite, and Azure URL resolution without making production-readiness, Quest-readiness, clinical-validity, or scoring claims.

## Next Implementation Slices

1. Add a server/tooling-side `AssetObjectStore` implementation that can write generated artifacts and manifests to Azurite locally and Azure Blob in hosted environments.
2. Add a bundle persistence record in MongoDB that freezes assets per encounter and references the blob-stored `asset-bundle.json`.
3. Add review workflow surfaces for promoting generated assets from `generated` to `approved_for_local_runtime`.
4. Add UI-XR boot-time bundle loading from an API endpoint while preserving the current static fixture bundle as offline fallback.
5. Extend asset generation tools so every generated humanoid, equipment model, environment shell, animation clip, and phoneme map registers into the asset registry rather than requiring manual public-file placement.

## 2026-05-22 Implementation Addendum

Generated-human-rigging reports now expose `buildGeneratedHumanRiggingRuntimeAssetReference`, which converts the local rigged humanoid GLB report into a bundle-ready `EncounterRuntimeAsset` reference. This is the first bridge from asset generation output into the dynamic session bundle model.

The helper is intentionally reference-only. It records where the artifact should live in Blob/Azurite-compatible addressing, plus review status, provenance references, and non-claim boundaries. Actual upload/auth/SAS work remains outside the learner runtime.

## 2026-05-22 Azurite Object Store Addendum

`@openclinxr/asset-registry/object-store` now provides a server/tooling-side `createAzuriteAssetObjectStore` adapter. It can write and read generated runtime assets through Azurite-compatible Blob endpoints while keeping the learner XR runtime on URL-only bundle resolution.

The adapter accepts an account key and signs emulator requests with SharedKey headers when provided. Tests use a fetch adapter so normal package verification does not require a running emulator. A live emulator run should use Azurite on `http://127.0.0.1:10000/devstoreaccount1` with the `openclinxr-assets` container and should remain local-only unless a separate Azure access-control/SAS proposal is approved.

## 2026-05-22 Multi-Agent Iteration Addendum

Repo-defined agent roles reviewed and advanced this strategy. The Asset Pipeline/Solution Architect review identified missing end-to-end write and bundle assembly paths. The Security/Supply-Chain adversarial review identified local-boundary and metadata risks. The Asset Pipeline worker added bundle-ready references for equipment and environment artifacts.

Mitigations and product additions now in place:

- Azurite helpers hard-fail when pointed at non-local or non-HTTP endpoints.
- Blob metadata is limited to an allowlist and intentionally excludes tenant, user, exam, and encounter identifiers.
- UI-XR consumes a learner-facing bundle view that strips tenant/user/exam/encounter identifiers from the runtime asset set.
- Asset writer helpers can write generated asset bytes, sidecar runtime manifests, and frozen encounter bundle JSON through the object-store contract.
- Generated humanoid, equipment, and environment reports can be assembled into one generated ED station runtime asset bundle.
- Optional Azurite smoke scripts report `not_configured` when local emulator credentials/artifacts are absent, preserving default verification while enabling live emulator use.

The remaining feature frontier is server/API retrieval and review promotion: the app should fetch a frozen reviewed bundle by opaque bundle id, then fall back to local fixtures offline. Review promotion should remain outside the learner runtime and should be the only path from generated or blocked assets to `approved_for_local_runtime`.

## 2026-05-22 Implementation Addendum: Persistence-Preferred Runtime Bundle Route

The learner XR runtime now has an API retrieval seam for generated session assets:

- `apps/api` checks an optional `ApiPersistenceSink.getLearnerRuntimeAssetBundle(bundleId)` before serving the local ED chest-pain fixture fallback.
- Returned bundles keep the learner-safe `identityScope: learner_runtime_opaque_bundle` posture and do not expose tenant, user, exam-run, or encounter identifiers.
- The local fallback remains deterministic and reports `retrievalMode: local_fixture_fallback`; persistence-backed bundles report `retrievalMode: persistence_sink`.
- This is still a local/product skeleton path, not evidence for production blob storage, Quest readiness, clinical validity, or scoring readiness.

Next implementation step: attach this retrieval seam to a durable local bundle-record repository or approved Azurite bundle manifest writer so generated humanoid, equipment, environment, animation, and affordance assets can be selected by encounter/session without hardcoding app-static paths.

## 2026-05-22 Implementation Addendum: Mongo Bundle Record Store

A local durable retrieval path now exists for learner-safe generated-session bundles:

- `MongoRuntimeAssetBundleRepository` persists opaque learner runtime asset bundles by `bundleId`.
- `MongoApiPersistenceSink` exposes `saveLearnerRuntimeAssetBundle` and `getLearnerRuntimeAssetBundle`, allowing the API route to retrieve a stored bundle after app recreation.
- The repository rejects identity field leakage and remains local/deterministic; it is not a production storage, Quest readiness, or clinical-validity claim.

Next implementation step: connect generated ED station bundle creation to this repository or the Azurite object-store writer so generated humanoid, equipment, environment, animation, phoneme, gaze, and interaction affordance assets become selectable session assets instead of static application assumptions.

## 2026-05-22 Implementation Addendum: Learner Bundle Emission

The generated ED station bundle report now carries two layers:

- `bundle`: the full encounter-scoped asset bundle used by tools/review and optional Azurite manifest writing.
- `learnerBundle`: the learner-safe opaque bundle suitable for API retrieval and local persistence.

This reduces downstream hardcoding and prevents each publisher from having to independently strip tenant, user, exam-run, and encounter identifiers.

## 2026-05-22 Implementation Addendum: Generated Report Publisher

Generated station reports can now be promoted into local Mongo-backed learner runtime storage by `saveLearnerRuntimeAssetBundleFromGeneratedReport` after they are bundle-ready. This keeps the dynamic asset path evidence-gated: blocked generated reports do not become learner-visible runtime bundles.
