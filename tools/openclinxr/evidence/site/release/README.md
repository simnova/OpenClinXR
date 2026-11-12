# Release bundle: rr1-2026-11-12 (planned)

Purpose: name the exact committed bytes that the site reference run (run-7) publishes
through the planned GitHub Release `rr1-2026-11-12`, so the site footer Release link,
`docs/site/data/media.json` `releaseTag`, and the validator rule WV1c all point at one
tag. Creating the GitHub Release itself is on the lander checklist; this bundle only
pins the bytes.

Release status: release not yet published. `rr1-2026-11-12` names the planned release;
no GitHub Release with that tag exists yet.

## Non-claims footer text

Verbatim from `docs/site/partials/footer.html` (the footer every page carries):

> Not exam-equivalent. No clinical validity. No validity is claimed for faculty marks or learner readiness. No Quest readiness claim. History-taking and communication only; no physical examination or touch is assessed. Formative practice and case authoring.

## Voice label

Learner voice: synthetic (injected)

(`docs/site/data/mn1.json` `labels.voice`; PLAN-draft section 1 voice label.)

## File list (committed files this bundle ships)

All paths are repo-relative:

- `docs/site/data/rr1-trace/72yIxt5aR.conversation-trace.json`
- `docs/site/data/rr1-trace/D_b8Lwrpa.conversation-trace.json`
- `docs/site/data/rr1-trace/SsdBgH288.conversation-trace.json`
- `docs/site/data/rr1-trace/exam-session.review-index.json`
- `docs/site/data/mn1.json`
- `tools/openclinxr/evidence/site/release/README.md` (this file)

`SHA256SUMS` in this directory pins exactly these 6 files, and its 4 trace paths equal
the `docs/site/data/mn1.json` `sources[].path` set. The bundle references files by sha;
it carries no copies of trace or media files.

## How to verify SHA256SUMS

From the repo root:

```sh
sha256sum -c tools/openclinxr/evidence/site/release/SHA256SUMS
```

Every line must report `OK`. The file uses `sha256sum` format: `<hex>` followed by two
spaces followed by the repo-relative path.

## Large run-7 media (NOT committed)

The large run-7 capture media live in `/Volumes/files/openclinxr-assets/store/site-reimagine/rr1/run-7`
and are not committed. Named here by store path and sha256 only:

- `audio/actor-reply.aiff` `54749a213d0e48b6d025163671e1e567786607bc409f74b8b02a267fc52e17e4`
- `audio/actor-reply.wav` `ea8a6d8512b1aa75b8745f8a696f70b0b0b081734eb27debe19675afb6db84ba`
- `faculty-painted.webm` `2f9ecbd056aa9d0ce0a95e08e46059b4d868cab7feb9eb62d9d121abe9c99cb4`
- `faculty-video-raw/page@2a22ff29737c867d3d4f92e1970bd90e.webm` `f907502ba8a1de782213a062a58e01c1cd8993a15ce849451ab8765e66da7186`
- `frames/ch1.png` `d901a3c0a1d835582cc35a62f5b96440840665b2a4f3b7f9d92e82688682aa8e`
- `frames/ch2.png` `68b801518aff2f208a1e2aa2b2bff09447ffe75a894c975a08b14c7de0e4b821`
- `frames/ch5.png` `766e74e246b193674ea4d43fda53ea13d7db8c63938f9510c19ac4c5ee8160f1`
- `frames/rot-doorway.png` `6276eb34db55834f24cbdc7ab41e0a90504364309a95f89c5d57fb7c3e89e480`
- `frames/rot-encounter.png` `670698b1dcfd559b32bf2cf2f27a11d84c3ca670edb59baf03f954d4086fb767`
- `learner-hold.png` `4e6ce42ce5d2bdd15e054905622969f4a67f51a724085b7bdc38b4be7195dddf`
- `learner-hold.webm` `d1281167317324613a53f8cec7a91b3ef516ed95f729416d3c4ae816526020f8`
- `learner-painted.webm` `b1bd7f4a189681949b41a7b2dafce42e862671b6310c9edf234c4b15f9c04945`
- `panels/ch1-runtime-panel.png` `d7d94e2fdbc0287b71b37827ede464f9e3a44a312da9646d8c687404eac7598b`
- `panels/ch2-runtime-panel.png` `020dbadcac3f81692157689aac0016aefa47c148d02f272c8bd1e30c75bc9390`
- `panels/rot-doorway-runtime-panel.png` `6aca9bc2d2c6205ba32869e16e9ccb1b5e8a368c3fa4e793e414f60dc49be61a`
- `panels/rot-encounter-runtime-panel.png` `1d2419b53ed59bbbb3734a5f2d7bbf812d9f7f80f5bad3dd771aabd97d3b7c76`
- `rr1-min-video-only.webm` `bf692e688919f6c4599ff2bde19853f288b4dc31d3500ba8304827df74fb82a4`
- `rr1-min.webm` `2fda783a9f7076442fa3a401d6b5b6ecbafd9d2fe531608b1333667d9af8d014`
- `video-raw/page@3dc70bbffcdd2bf4efc77ce780838071.webm` `8ef4182c4d3499d933131d605e179e35c444b69c3df5496c9dff185223976022`
