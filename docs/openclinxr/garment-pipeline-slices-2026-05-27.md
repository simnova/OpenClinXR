# Garment pipeline slices - 2026-05-27

## Completed in this pass

1. Marked `tools/openclinxr/garment-ingest-and-fit.mjs` as the approved garment fitting entrypoint.
2. Blocked direct Blender fitting as a pipeline entry except through the ingestion wrapper.
3. Added work-order metadata for approved entrypoint.
4. Added cache metadata fields for source garment and license record.
5. Added provider-gate failure when work orders bypass the approved entrypoint.
6. Added promotion-gate cache reuse policy.
7. Added ingestion contract artifact.
8. Added garment source allowlist template.
9. Added autonomous garment queue state.
10. Updated durable project coordination docs.

## Next executable slice

Find or create a real license-compatible garment allowlist entry. Until then, external garment fitting remains blocked before materialization by design.
