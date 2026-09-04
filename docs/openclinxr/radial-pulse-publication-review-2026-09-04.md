# Radial Pulse Evidence Publication Review

Date: 2026-09-04

Decision: **cleared for publication in the OpenClinXR GitHub repository** as a
bounded IWSDK interaction-evidence artifact. This is a project publication
decision, not legal advice and not a production-promotion decision.

## Artifact

- Video: `docs/openclinxr/videos/iwsdk-mpfb-radial-pulse-interaction-2026-09-04.webm`
- Poster: `docs/openclinxr/videos/iwsdk-mpfb-radial-pulse-interaction-poster-2026-09-04.png`
- Evidence report: `docs/openclinxr/evidence/iwsdk-mpfb-radial-pulse-interaction-2026-09-04.json`
- Humanoid: `apps/ui-xr/public/generated-humanoids/mpfb-street-adult-male.glb`

## Promotion Decision

This review separates **publication of rendered evidence** from promotion of the
source humanoid into production or learner-ready status. The rendered evidence
may be published. The source provenance file's `promotionGates: false` remains
unchanged.

| Visible element | Repository evidence | Decision |
| --- | --- | --- |
| MPFB/MakeHuman body, rig, skin, and generated output | MPFB's split license places bundled graphical assets under CC0 and states that exported/rendered output is user-owned | Cleared |
| `toigo_basic_tucked_t-shirt` | Per-asset CC0 header recorded in the license ledger | Cleared |
| `cortu_cargo_pants` | 2026-08-25 repository ruling: asset descriptor/catalog record prevails over stale external-tools boilerplate | Cleared |
| `culturalibre_male_boots` | Per-asset `CC-0` descriptor plus matching publisher record | Cleared |
| MakeHuman system eyes and MPFB skin textures | Per-asset/bundled CC0 records in the license ledger | Cleared |
| `mhair02` | Publisher page records CC0; staged descriptor says AGPL3. The repository's 2026-08-14 operator ruling permits this exact UUID only | Cleared under the recorded UUID-specific operator assumption |
| Procedural wrist pose, operator-hand proxy, capture, and transcode | OpenClinXR-authored project output | Cleared |

Primary upstream references:

- [MPFB license and generated-output statement](https://github.com/makehumancommunity/mpfb2/blob/master/LICENSE.md)
- [MPFB asset license](https://github.com/makehumancommunity/mpfb2/blob/master/LICENSE.ASSETS.md)
- [MakeHuman exported-model FAQ](https://static.makehumancommunity.org/makehuman/faq/can_i_sell_models_created_with_makehuman.html)
- [MPFB third-party asset boundary](https://static.makehumancommunity.org/mpfb/faq/use_in_closed_source.html)

The durable local decisions and component-specific evidence remain in
`docs/openclinxr/third-party-asset-licence-ledger.md` and
`apps/ui-xr/public/generated-humanoids/mpfb-street-adult-male.provenance.json`.

## Remaining Closed Gates

Publication does not establish or promote:

- physical Quest hand-tracking or haptic quality;
- production runtime, learner, or scene-placement readiness;
- B+ visual realism;
- clinical pulse-assessment validity or scoring validity;
- general permission for other AGPL-labeled community hair assets.

The `mhair02` exception must be revisited if its author or publisher clarifies
that the staged AGPL3 header, rather than the page's CC0 record, is controlling.
Any replacement should be re-baked and recaptured before this evidence is reused.

## Reproducibility

Run `pnpm iwsdk:radial-pulse:capture` with explicit `--video` and `--report`
paths. The capture fails unless it observes every interaction phase, the exact
`mpfb-street-adult-male.glb` asset, the consented wrist-presentation pose, and a
live target attached to `wrist.R`. The checked-in video is an eight-second,
1440x900, 30 fps VP9 transcode with no audio.
