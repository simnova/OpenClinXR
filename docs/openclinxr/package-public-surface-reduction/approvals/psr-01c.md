# PSR-01C approval — data/model/motion review

Machine-readable contract: `psr-01c.json` in this directory (read by `pnpm arch:public-surface:verify -- --require-reviewed-group psr-01c`).
`rawInventoryHash` `e43ee9c249ee7469828c39a265b9b1fdffc614a71768b5bbe419e5380bb70026`; `groupHash` `a8bd55837e0db542cf66dee57048b6dbac253f7eb6e175e15c6919bf59c89b24`.
Scope: 332 rows covering exactly `data-mongodb`, `motion-compiler`, `conversation-policy`, `model-gateway`, `graphql`; zero unresolved.

| Package | Keep | Remove | Migrate | Projected root |
| --- | ---: | ---: | ---: | ---: |
| data-mongodb | 0 | 73 | 0 | 0 |
| motion-compiler | 7 | 76 | 0 | 0 |
| conversation-policy | 27 | 32 | 0 | 27 |
| model-gateway | 11 | 23 | 0 | 11 |
| graphql | 38 | 43 | 2 | 9 |

Migrations use only the existing `./documents` subpath. No new subpaths, namespaces, facades, or splits. Review only; implementation belongs to PSR-03.

## Amendment at shrink-b (worker, 2026-10-08; reviewedBy reviewed by Codex gpt-5.6-terra, session 01a11ad4-675a-7ac1-a55e-8ed57ee28447)
1 `packages/openclinxr/graphql` row moves `keep` to `remove`: `./documents` `AdminGraphqlDocument`. Keep evidence cited `packages/openclinxr/rest/src/routes/admin-graphql-routes.ts:22`, which returns `adminGraphqlDocuments` (plural) with no type reference. No specifier, path-reach, dynamic, or own-test entrypoint consumer binds the type. Definition stays internal in `documents.ts:1`.

## Amendment at shrink-a consumer-contracts (worker, 2026-10-08; reviewedBy reviewed by Codex gpt-5.6-terra, session 01a11b94-7ca3-7d11-a644-1a2a3a020ea8)

5 `packages/openclinxr/motion-compiler` rows move from `keep` to `remove`: `ScenarioMotionCompileInput`
on `.`, plus `DerivedPlantedEntry`, `DiscoveredPlantedClause`, `INSTRUMENT_FAILURES`, `PlantedRed`
on `./planted-red-manifest`. The cited keeps pointed at
`src/test/planted-red-manifest.derived.test.ts:10`, whose import binds only `derivePlantedEntries`,
`discoverPlantedClauses`, `PLANTED_REDS`, or at a grep note recording the absence of an importer.
Consumer contracts on shrink-a @ d387f30fe bind none of the five via specifier, own-test entrypoint,
path-reach, dynamic, or export-star use. Each amended row names the provider package as owner with
`reviewedBy: reviewed by Codex gpt-5.6-terra, session 01a11b94-7ca3-7d11-a644-1a2a3a020ea8`; the coordinator arranges the independent review.
