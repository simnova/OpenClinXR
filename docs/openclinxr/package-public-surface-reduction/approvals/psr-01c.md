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
