# S3 humanoid A/B: NoToneMapping vs ACESFilmicToneMapping

Subject: `mpfb-peds-parent-aisha.motion-bind.glb` (same humanoid for both pairs).

- Face closeup: `tools/openclinxr/evidence/mouth-frame-grade/mouth-frame-grade.ts`
  (AA-phoneme head still, same pose/framaming both runs).
  - `face-notonemapping.png` — lab renderer default (three.js NoToneMapping).
  - `face-aces.png` — same harness with the lab renderer set to
    `ACESFilmicToneMapping` (temporary local patch, reverted after capture).
- Full-body standing: `tools/openclinxr/evidence/model-vetting-turntable-capture.ts`
  `--glb <aisha motion-bind> --capture-views front` (front lit still).
  - `fullbody-notonemapping.png` — studio renderer default.
  - `fullbody-aces.png` — same harness with the studio renderer set to
    `ACESFilmicToneMapping` (temporary local patch, reverted after capture).

Scope note: the S3 change (`apps/ui-xr/src/main.ts` station renderer) does not
touch these two harness renderers, so the ACES halves simulate applying the
same curve to humanoid rendering. Lab key intensities (~2.2) are close to the
station rig key (~2.35), so the direction of the skin shift should transfer.

Measured (skin-pixel mask on baseline): skin mean luminance +14.6 (face) /
+11.6 (full-body) under ACES; per-channel means shift about +9R / +13G / +12B,
so the lift leans marginally cool. Hottest highlight falls (face-box max
224 -> 216). Max per-pixel abs diff 26-28. No clipping introduced, no washout,
no color cast that reads wrong in isolation. Operator does the final grade;
the room-pass-only fallback was not triggered by this read.

Caveat: `model-vetting-turntable-capture.ts` crashes on this tree without the
`BROWSER_PAGE_GLOBALS_INIT_SCRIPT` init line (`browserPageWindow is not
defined` in the capture predicate; see `tools/openclinxr/evidence/lib/evidence-page.ts`).
Captures above ran with that one-line init added temporarily and reverted, so
the tool file on this branch is byte-identical to base. Recommend landing that
one-line repair separately.
