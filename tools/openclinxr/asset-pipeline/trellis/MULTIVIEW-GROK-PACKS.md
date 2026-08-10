# OpenClinXR TRELLIS Multi-View Grok Packs — Operator Spec

**Audience:** Grok Code / local agent on the OpenClinXR machine  
**Purpose:** Produce clean multi-view image packs from Grok Imagine, then bake them through the existing TRELLIS Metal path (`factory:trellis:bake` → `run_bake_isolated.py`) with full multi-view conditioning.  
**Status:** Factory CLI today is single-view (front.png only). Multi-view conditioning already exists in `run_bake_isolated.py` (#255). This document defines the optimized generation prompts, pack layout, and the minimal CLI change required.

---

## 1. BLUF — What to do

1. Generate **4 consistent views** per equipment subject with Grok Imagine using the prompts and invariance rules below.
2. Drop them into the pack layout under `.openclinxr/evidence/issue-232/<subject>/`.
3. Apply the small factory CLI change so `pnpm factory:trellis:bake --subject <id>` passes **all available views**, not just `front.png`.
4. Bake. The isolated runner will sequence-concat embeddings → `(1, N·L, C)` and produce the GLB.
5. Run the existing post-opt ladder (#239) on the exported mesh.

Do **not** collage the views into one image. Feed them as separate files.

---

## 2. Multi-view consistency rules (hard requirements)

Every view of the same subject **must** satisfy all of the following. Violations cause the TRELLIS multi-view path to fight itself.

| Rule | Requirement |
|------|-------------|
| Same object | Identical enclosure dimensions, bevel radii, screen size/position, button layout, connectors. No invented features on previously hidden faces. |
| Background | Transparent (RGBA preferred) or pure neutral. No floor, no studio backdrop, no shadows on a ground plane. |
| Scale & centering | Object fills the frame similarly across all views; same relative size; centered. |
| Lighting & materials | Identical lighting, identical PBR response (plastic, metal, glass, matte screen). |
| No annotation | No text, arrows, labels, dimension lines, watermarks, or UI chrome. |
| Camera only | Views differ **only** by pure camera rotation / azimuth / elevation. Object pose is fixed. |
| Canonical first | `front.png` is the strongest / canonical conditioning image. Other views are pure rotations of the same object. |

**Preferred view set (4-view, matches current #232 packs):**

| Filename | Camera |
|----------|--------|
| `front.png` | Front orthographic / slight three-quarter (canonical) |
| `side.png` | Pure side (90° azimuth) |
| `three_quarter_left.png` | ~35–45° left of front |
| `three_quarter_right.png` | ~35–45° right of front |

Optional extensions (6-view) if you expand packs later: `rear.png`, `top.png`. Keep the same invariance rules.

---

## 3. Optimized Grok Imagine prompts

### 3.1 Shared object description (edit per subject)

Keep this block identical across all four prompts for a given subject. Only the camera sentence changes.

**Example — 12-lead ECG cart / EKG machine (adapt for wall-clock, bedside-monitor, etc.):**

```text
A realistic medical 12-lead ECG cart / portable electrocardiograph machine for a clinical skills simulation.
Compact wheeled cart base with locking casters, vertical equipment column, and a rectangular main enclosure.
Front face has a large flat LCD monitor (dark powered-off or neutral clinical waveform display — no readable text), a small set of physical control buttons and a rotary dial below the screen, and clearly visible ECG lead connector ports / trunk cable receptacle on the lower front or side of the enclosure.
Materials: matte medical-grade plastic body, subtle metal accents, clean clinical finish, no logos, no brand names, no readable labels or text of any kind.
Clean isolated product shot, object centered, consistent scale, soft even studio lighting, no floor, no shadows on ground, no background, transparent or pure neutral background.
High geometric fidelity suitable for image-to-3D reconstruction. Sharp edges, correct proportions, no stylization, no cartoon, no low-poly look.
```

### 3.2 Per-view camera instructions

Append **exactly one** of these to the shared description. Keep everything else identical.

**front.png (canonical — generate this first):**
```text
Camera: front three-quarter view, slightly elevated, looking at the main screen and control panel. Primary reference view.
```

**side.png:**
```text
Camera: pure side elevation, 90 degrees from front, same height and distance as the front view. Same object, same lighting, same scale. Only the camera has rotated.
```

**three_quarter_left.png:**
```text
Camera: three-quarter view from the left, approximately 40 degrees off the front axis, same height and distance. Same object, same lighting, same scale. Only the camera has rotated.
```

**three_quarter_right.png:**
```text
Camera: three-quarter view from the right, approximately 40 degrees off the front axis, same height and distance. Same object, same lighting, same scale. Only the camera has rotated.
```

### 3.3 Generation workflow (recommended)

1. Generate `front.png` with the full shared description + front camera line.
2. Use that image as a strong reference (image-to-image / edit) for the other three views, changing **only** the camera sentence. This maximizes geometric consistency.
3. Alternatively regenerate each view from the identical text prompt with the camera line swapped — still enforce “same object, pure camera rotation only.”
4. Export as PNG, preferably RGBA with transparent background. Crop so the object is centered and scale-matched.
5. Reject any view that invents new buttons, changes enclosure proportions, adds text, or alters lighting.

---

## 4. Pack directory structure (ingestion contract)

Expected layout (already used by #232 / factory resolution):

```text
.openclinxr/evidence/issue-232/
├── wall-clock/
│   ├── front.png
│   ├── side.png
│   ├── three_quarter_left.png
│   └── three_quarter_right.png
├── bedside-monitor/
│   └── … (same four files)
├── ecg-cart/
│   └── … (same four files)
├── iv_pole_equipment/
│   └── …
└── oxygen_wall_port_equipment/
    └── …
```

Resolution order in the factory CLI:

1. `OPENCLINXR_TRELLIS_PACKS` env var (absolute packs root)
2. `.openclinxr/evidence/issue-232/` in the current repo
3. Absolute fallback to the #235 worktree packs path (legacy)

All four filenames are required for multi-view. Missing views may be skipped only if the CLI is updated to pass “whatever exists,” but the preferred contract is all four present and consistent.

---

## 5. Current pipeline vs required change

### 5.1 What already works

| Component | Behavior |
|-----------|----------|
| `run_bake_isolated.py` | Accepts repeated `--input-image`. When N > 1, calls `run_multiview()` which sequence-concatenates embeddings to `(1, N·L, C)`. |
| Multi-view conditioning (#255) | Implemented. Mirrors training-time `MultiImageConditionedMixin.encode_images`. |
| Isolation | Fresh OS subprocess per subject — no shared MPS context. |
| Backend | `trellis2-apple` MLX (Apple Silicon). |
| Post-opt | Existing #239 ladder runs on the exported GLB. |

### 5.2 What is still single-view

`tools/openclinxr/asset-pipeline/trellis/trellis-bake-cli.ts`:

- Subject registry only stores `frontImageRel`.
- `liveBake()` always passes a single `--input-image` pointing at `front.png`.

### 5.3 Minimal change required

Update the subject registry and the bake invocation so every available view is passed.

**A. Expand subject entry type**

```ts
interface SubjectEntry {
  subjectId: string;
  displayName: string;
  /** Relative paths under the packs root. front.png must be first (canonical). */
  viewRels: string[];
}
```

**B. Registry example (ecg-cart)**

```ts
{
  subjectId: "ecg-cart",
  displayName: "12-lead ECG cart",
  viewRels: [
    "ecg-cart/front.png",
    "ecg-cart/side.png",
    "ecg-cart/three_quarter_left.png",
    "ecg-cart/three_quarter_right.png",
  ],
},
```

Repeat the same pattern for `wall-clock`, `bedside-monitor`, `iv-pole`, `o2-port` (adjust folder names to match existing packs).

**C. Resolve and pass all views in `liveBake()`**

Replace the single-image path with:

```ts
const inputImagePaths = entry.viewRels
  .map((rel) => resolvePackPath(rel))
  .filter((p) => existsSync(p));

if (inputImagePaths.length === 0) {
  process.stderr.write(`No input images found for subject ${subjectId}\n`);
  process.exit(2);
}

// Prefer at least the canonical front; warn if multi-view is incomplete.
if (inputImagePaths.length === 1) {
  process.stdout.write(`[factory:trellis:bake] ${subjectId}: only 1 view found — single-view bake\n`);
} else {
  process.stdout.write(`[factory:trellis:bake] ${subjectId}: ${inputImagePaths.length} views → multi-view conditioning\n`);
}

const argv = [
  RUN_BAKE_SCRIPT,
  "--subject-id", subjectId,
  "--display-name", entry.displayName,
  "--output-dir", outputDir,
  "--weights-path", WEIGHTS_PATH,
  "--dinov3-path", DINOV3_PATH,
  "--trellis-root", TRELLIS_ROOT,
];

for (const img of inputImagePaths) {
  argv.push("--input-image", img);
}

const result = execFileSync(VENV_PYTHON, argv, { /* existing options */ });
```

**D. Dry-run plan**

Include `inputImagePaths: string[]` and `viewCount: number` in the dry-run JSON so operators can verify multi-view resolution without GPU.

**E. Keep backward compatibility**

If only `front.png` exists, the filter still produces a one-element list and the runner takes the original single-view path. No behavior change for incomplete packs.

---

## 6. Invocation after the change

```bash
# Dry-run (no GPU) — inspect resolved views
pnpm factory:trellis:bake --subject ecg-cart --dry-run

# Live multi-view bake (fresh subprocess)
pnpm factory:trellis:bake --subject ecg-cart

# Validate last reports
pnpm factory:trellis:bake --validate-latest
```

Environment overrides (unchanged):

- `OPENCLINXR_TRELLIS_OUT` — output root (default `.openclinxr/evidence/trellis-bake`)
- `OPENCLINXR_TRELLIS_PACKS` — packs root override

---

## 7. Bake + post-opt expectations

| Stage | Target / note |
|-------|----------------|
| Shape + texture SLAT | Multi-view conditioned when N > 1 |
| Raw GLB export | `decimation_target=1_000_000` inside isolated runner (captures raw triangle count) |
| Evidence | `bake-measure.json` records `viewCount`, `inputImagePaths`, triangle count, wall clock |
| Post-opt ladder (#239) | Apply after export — lower face count for VR / Quest readiness (typical clinical prop target ~15k–40k faces depending on subject complexity) |
| Texture | 1024 is the current isolated-runner default; raise only if post-opt budget allows |

Claim scope remains the same as the existing bake measure:

- TRELLIS Metal image→shape→mesh→GLB on Apple Silicon
- Not evidence for Quest 3 readiness, clinical accuracy, or production learner-runtime adoption until the post-opt + evidence ladder passes.

---

## 8. Operator checklist (generate → bake)

- [ ] Shared object description locked; only camera sentence differs across views.
- [ ] `front.png` generated first and used as reference for the other three.
- [ ] All four PNGs: transparent/neutral background, no text, no floor, matched scale/lighting.
- [ ] Files named exactly: `front.png`, `side.png`, `three_quarter_left.png`, `three_quarter_right.png`.
- [ ] Placed under `.openclinxr/evidence/issue-232/<subject>/` (or `OPENCLINXR_TRELLIS_PACKS`).
- [ ] Factory CLI updated to pass all existing views via repeated `--input-image`.
- [ ] `pnpm factory:trellis:bake --subject <id> --dry-run` shows `viewCount ≥ 2`.
- [ ] Live bake produces `bake-measure.json` with `"viewCount": 4` (or N) and `verdict: "mesh_exported"`.
- [ ] Post-opt ladder (#239) run on the exported GLB; triangle count recorded for MADR / evidence.

---

## 9. File map (for Grok Code)

| Path | Role |
|------|------|
| `tools/openclinxr/asset-pipeline/trellis/trellis-bake-cli.ts` | Factory CLI — **change required** (multi-view image list) |
| `tools/openclinxr/evidence/blender/run_bake_isolated.py` | Isolated bake — **already multi-view capable** |
| `tools/openclinxr/evidence/blender/probe_multiview_cond.py` | Pre-fix probe for cond tensor behavior (#255) |
| `.openclinxr/evidence/issue-232/<subject>/` | Grok image packs |
| `.openclinxr/evidence/trellis-bake/<subject>/` | Bake outputs + `bake-measure.json` |

---

## 10. Prompt template ready to paste into Grok Imagine

Copy the shared description, then append the single camera line for the view you are generating. Generate front first.

```text
A realistic medical 12-lead ECG cart / portable electrocardiograph machine for a clinical skills simulation.
Compact wheeled cart base with locking casters, vertical equipment column, and a rectangular main enclosure.
Front face has a large flat LCD monitor (dark powered-off or neutral clinical waveform display — no readable text), a small set of physical control buttons and a rotary dial below the screen, and clearly visible ECG lead connector ports / trunk cable receptacle on the lower front or side of the enclosure.
Materials: matte medical-grade plastic body, subtle metal accents, clean clinical finish, no logos, no brand names, no readable labels or text of any kind.
Clean isolated product shot, object centered, consistent scale, soft even studio lighting, no floor, no shadows on ground, no background, transparent or pure neutral background.
High geometric fidelity suitable for image-to-3D reconstruction. Sharp edges, correct proportions, no stylization, no cartoon, no low-poly look.

Camera: front three-quarter view, slightly elevated, looking at the main screen and control panel. Primary reference view.
```

(Replace the final camera sentence for side / left three-quarter / right three-quarter as specified in §3.2.)

---

*End of spec. Hand this file to Grok Code on the OpenClinXR machine; the required CLI edit is localized to `trellis-bake-cli.ts` subject registry + `liveBake()` argument assembly. No changes are required to `run_bake_isolated.py` for multi-view ingestion.*


## Implementation status (repo, 2026-08-10)

- **CLI multi-view wiring: DONE** in `trellis-bake-cli.ts` (`viewRels` + dry-run `viewCount` / `inputImagePaths` / `conditioning`).
- Tracked fixtures: `fixtures/multi-view-pack/ecg-cart/`.
- Live packs: `.openclinxr/evidence/issue-232/` (gitignored) or `OPENCLINXR_TRELLIS_PACKS`.
- Smoke: `OPENCLINXR_TRELLIS_PACKS=...fixtures/multi-view-pack pnpm factory:trellis:bake --subject ecg-cart --dry-run` → `viewCount: 4`.
