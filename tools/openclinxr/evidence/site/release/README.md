# Release bundle: rr1-2026-11-12 (planned)

Purpose: name the exact committed bytes that the site reference run (run-15) publishes
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

- `docs/site/data/rr1-trace/CBB5_UB-J.conversation-trace.json`
- `docs/site/data/rr1-trace/O4z72Ca-8.conversation-trace.json`
- `docs/site/data/rr1-trace/5JNYwgcSl.conversation-trace.json`
- `docs/site/data/rr1-trace/exam-session.review-index.json`
- `docs/site/data/mn1.json`
- `docs/site/data/trace-schema.json`
- `tools/openclinxr/evidence/site/release/README.md` (this file)

`SHA256SUMS` in this directory pins exactly these 7 files, and its 4 trace paths equal
the `docs/site/data/mn1.json` `sources[].path` set. The bundle references files by sha;
it carries no copies of trace or media files.

## How to verify SHA256SUMS

From the repo root:

```sh
sha256sum -c tools/openclinxr/evidence/site/release/SHA256SUMS
```

Every line must report `OK`. The file uses `sha256sum` format: `<hex>` followed by two
spaces followed by the repo-relative path.

## Large run-15 media (NOT committed)

The large run-15 capture media live in `/Volumes/files/openclinxr-assets/store/site-reimagine/rr1/run-15`
and are not committed. Named here by store path and sha256 only:

- `audio/actor-reply.aiff` `54749a213d0e48b6d025163671e1e567786607bc409f74b8b02a267fc52e17e4`
- `audio/actor-reply.wav` `ea8a6d8512b1aa75b8745f8a696f70b0b0b081734eb27debe19675afb6db84ba`
- `faculty-painted.webm` `7d797fe19fbe0f9562966d3c494f5ecf01ab7ec848836c3a9832441366f19f89`
- `faculty-video-raw/page@78480cbdb4e3df0480d9e3046c16ce40.webm` `1b97a2d0b42c35cf85b4e75d1f243c15937cea3c622a299a92aa1e2dac81f524`
- `frames/ch1.png` `c3f7b2ede28078f25f4d598519eb9548f03d672bf2a87b298108fdff09775b81`
- `frames/ch2.png` `93d6eebfc152d1b14068e55ea3c46058a3a0d5ee34af37753c6b0a3774321e43`
- `frames/ch5.png` `9b1626fb46e4e0d37b580d846dcdba53751a343eb6531256e73c78a28f27c552`
- `frames/rot-doorway.png` `f0c2d12484c3001b6cf656809c3c29390803ca74bdfe8c9c0a600a78f2ddb520`
- `frames/rot-encounter.png` `12ff6a6ffbc77d6aa0404701229ff592e4422695273feada8c0419f0863688d2`
- `learner-hold.png` `43578f482761cfdeb45d96ab698e2e40c6216613cb4f2ad23560840f86e5eae2`
- `learner-hold.webm` `9492eba312c2b0fcdf94d57061c31079b4343d60e8049069d43c499730b692d6`
- `learner-painted.webm` `563d415b192ba5b0069dfa597f4950c1f0d66d9637c75df561a6da593b8a3502`
- `panels/ch1-runtime-panel.png` `d7d94e2fdbc0287b71b37827ede464f9e3a44a312da9646d8c687404eac7598b`
- `panels/ch2-runtime-panel.png` `020dbadcac3f81692157689aac0016aefa47c148d02f272c8bd1e30c75bc9390`
- `panels/rot-doorway-runtime-panel.png` `a6b3f7f31a7bf174d68ccae81728358d51f66ffb5ad10fd2b0a9adcf72e82596`
- `panels/rot-encounter-runtime-panel.png` `e35be44f07cd044c45f210e4f8da752ce2229041c36796ebc6eaa0350e22347c`
- `rr1-min-video-only.webm` `2d18b37153ee286812c42465ca6c3f4d7b30c198793da35ddd3fd5136054ba0a`
- `rr1-min.webm` `65d5446b31e9ae8827afff5b00ffd85ddd420e6e26fcadaebd09c555837e1260`
- `video-raw/page@f3401b4c7d99b25f1f4467e19f11a99b.webm` `4f44606cafed74c5d6e2558554f9fb32435fd0764d67575111708c3b72d2485f`
