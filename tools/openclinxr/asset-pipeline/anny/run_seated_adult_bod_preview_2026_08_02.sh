#!/usr/bin/env bash
# seated-adult-humanoid-bod-preview-2026-08-02
# Brand-new adult ED patient candidate for BOD isolated human-likeness lab.
# Prefer real Anny (Python 3.11 site-packages) over mise 3.13 stub fallback.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"

OUT_DIR=".openclinxr/asset-production/anny/seated-adult-bod-preview-2026-08-02"
CAGE_DIR="apps/arena/model-vetting-studio/public/cagematch/seated-adult-bod-preview-2026-08-02"
GLB_NAME="ed_chest_pain_patient_adult_bod.glb"
mkdir -p "$OUT_DIR" "$CAGE_DIR"

# Prefer Python with real Anny package (historically 3.11 user site); fall back to python3.
PY=""
for candidate in python3.11 "$HOME/Library/Python/3.11/bin/python3" python3; do
  if command -v "$candidate" >/dev/null 2>&1; then
    if "$candidate" -c "import anny, torch" 2>/dev/null; then
      PY="$candidate"
      break
    fi
  fi
done
if [[ -z "${PY}" ]]; then
  # Fallback: still generate, but may stub (~2–3k verts) — prefer blender re-stage on real base below.
  PY="$(command -v python3.11 || command -v python3)"
  echo "[warn] real Anny import failed; using $PY (may stub unless base OBJ reuse path runs)"
fi

BLENDER_BIN="${BLENDER_PATH:-blender}"
if ! command -v "$BLENDER_BIN" >/dev/null 2>&1; then
  echo "ERROR: blender not on PATH (set BLENDER_PATH)"
  exit 2
fi

echo "[run] PY=$PY blender=$BLENDER_BIN"
"$PY" tools/openclinxr/asset-pipeline/anny/orchestrate_character.py \
  --case-actor-preset "ed_chest_pain_priority_v2:patient_ed_chest_pain_v1" \
  --output-glb "${OUT_DIR}/${GLB_NAME}" \
  --mpfb2-eye-rig

# If Anny stubbed (small OBJ), re-stage from adult male real-Anny base (nurse kevin 13348 verts)
# with ED hospital_gown phenotype — preserves body quality.
MANIFEST="${OUT_DIR}/${GLB_NAME%.glb}.anny_manifest.json"
if [[ -f "$MANIFEST" ]] && ! grep -q '"uses_real_anny_forward_pass": true' "$MANIFEST"; then
  echo "[run] Anny stub detected — re-staging Blender on real adult male base OBJ"
  REAL_BASE="apps/ui-xr/public/generated-humanoids/peds_nurse_kevin.anny_base.obj"
  REAL_MAN="apps/ui-xr/public/generated-humanoids/peds_nurse_kevin.anny_manifest.json"
  if [[ ! -f "$REAL_BASE" ]]; then
    echo "ERROR: missing real Anny base $REAL_BASE"
    exit 3
  fi
  # Write ED-phenotype overlay manifest (real Anny topology + ED gown garmentLayers)
  "$PY" - <<'PY'
import json, pathlib
root = pathlib.Path(".")
out = root / ".openclinxr/asset-production/anny/seated-adult-bod-preview-2026-08-02"
src = json.loads((root / "apps/ui-xr/public/generated-humanoids/peds_nurse_kevin.anny_manifest.json").read_text())
# Overlay ED patient phenotype while keeping real Anny forward-pass provenance
src["input_params"] = {
    "age": 52,
    "body_profile": "adult_standard",
    "pose": "standing_neutral_chest_pain_priority",
    "seed": 2002,
    "phenotype": {
        "skin_tone": "warm_medium",
        "hair_color": "brown",
        "eye_color": "brown",
        "anny_topology": "default",
        "gender_presentation": "adult_male",
        "height_cm": 178,
        "build": "average_adult",
        "hair_density": 0.65,
        "brow_tension": 0.55,
        "anxious": 0.65,
        "flush": 0.15,
        "age_wrinkle": 0.18,
        "bmi": 26.0,
        "clothing_style": "clinical_exam_tshirt_chest_pain",
        "clothing_color": "soft_blue",
        "role_visual_cue": "ed_chest_pain_patient",
        "wardrobeRole": "ed_patient_exam",
        "garmentLayers": ["hospital_gown"],
        "fabricPalette": "hospital_gown_blue_pattern",
        "materialFinish": "cotton_slight_sheen",
        "accessoryMarkers": [],
        "fitProfile": "adult_standard_fit",
        "sleeveGeometryExpansion": "v3_bod_humanlike_gown_muted_cotton_sleeve_fit_along_arms_0.72_arm_r0.22",
    },
    "actor_id": "patient_ed_chest_pain_v1",
}
src["reuse_note"] = "bod_preview_2026_08_02_reuse_adult_male_real_anny_base_obj_ed_gown_phenotype"
out.mkdir(parents=True, exist_ok=True)
(out / "ed_chest_pain_patient_adult_bod.anny_manifest.json").write_text(json.dumps(src, indent=2))
print("wrote overlay manifest")
PY
  cp -f "$REAL_BASE" "${OUT_DIR}/ed_chest_pain_patient_adult_bod.anny_base.obj"
  REPORT="${OUT_DIR}/ed_chest_pain_patient_adult_bod_rigging_report.json"
  "$BLENDER_BIN" --background --python tools/openclinxr/asset-pipeline/anny/automate_blender.py -- \
    --input-mesh "${OUT_DIR}/ed_chest_pain_patient_adult_bod.anny_base.obj" \
    --input-manifest "${OUT_DIR}/ed_chest_pain_patient_adult_bod.anny_manifest.json" \
    --output-glb "${OUT_DIR}/${GLB_NAME}" \
    --case-id "ed_chest_pain_priority_v2" \
    --actor-role "patient"
  # MPFB2 eyes on re-stage path
  STAGED="${OUT_DIR}/ed_chest_pain_patient_adult_bod_mpfb2_eye_staged.glb"
  EYE_REPORT="${OUT_DIR}/ed_chest_pain_patient_adult_bod_mpfb2_eye_rig_report.json"
  "$BLENDER_BIN" --background --python tools/openclinxr/asset-pipeline/anny/add_mpfb2_eye_rig.py -- \
    --input-glb "${OUT_DIR}/${GLB_NAME}" \
    --output-glb "$STAGED" \
    --report "$EYE_REPORT"
  mv -f "$STAGED" "${OUT_DIR}/${GLB_NAME}"
  # Minimal provenance for re-stage
  "$PY" - <<'PY'
import json, hashlib, pathlib, datetime
root = pathlib.Path(".")
out = root / ".openclinxr/asset-production/anny/seated-adult-bod-preview-2026-08-02"
glb = out / "ed_chest_pain_patient_adult_bod.glb"
h = hashlib.sha256(glb.read_bytes()).hexdigest()
prov = {
  "schemaVersion": "openclinxr.generated-humanoid-provenance.v1",
  "generatedAt": datetime.datetime.utcnow().isoformat() + "Z",
  "caseId": "ed_chest_pain_priority_v2",
  "actorId": "patient_ed_chest_pain_v1",
  "actorRole": "patient",
  "outputGlb": str(glb.resolve()),
  "outputSha256": h,
  "claimScope": "local_real_anny_candidate_bundle_not_readiness",
  "sourceKind": "real_anny_candidate_unverified",
  "method": "blender_stage_on_existing_real_anny_base_obj_adult_male_ed_gown_bod_preview",
  "notEvidenceFor": [
    "b_plus_visual_realism_gate",
    "quest_readiness",
    "production_asset_readiness",
    "learner_readiness",
    "clinical_validity",
    "scoring_validity",
    "scene_placement_readiness",
  ],
  "promotionGates": False,
}
(out / "ed_chest_pain_patient_adult_bod.provenance.json").write_text(json.dumps(prov, indent=2))
print("provenance", h, "bytes", glb.stat().st_size)
PY
fi

# Verify size
BYTES=$(wc -c < "${OUT_DIR}/${GLB_NAME}" | tr -d ' ')
echo "[verify] GLB bytes=$BYTES"
if [[ "$BYTES" -lt 5000000 ]]; then
  echo "ERROR: GLB < 5MB ($BYTES) — quality gate fail"
  exit 4
fi

# Mirror to model-vetting cagematch for isolation lab URL /cagematch/...
cp -f "${OUT_DIR}/${GLB_NAME}" "$CAGE_DIR/"
cp -f "${OUT_DIR}/${GLB_NAME%.glb}_rigging_report.json" "$CAGE_DIR/" 2>/dev/null || true
cp -f "${OUT_DIR}/${GLB_NAME%.glb}.provenance.json" "$CAGE_DIR/" 2>/dev/null || true
cp -f "${OUT_DIR}/${GLB_NAME%.glb}.anny_manifest.json" "$CAGE_DIR/" 2>/dev/null || true
cp -f "${OUT_DIR}/${GLB_NAME%.glb}_mpfb2_eye_rig_report.json" "$CAGE_DIR/" 2>/dev/null || true
cp -f "${OUT_DIR}/${GLB_NAME%.glb}.bundle.json" "$CAGE_DIR/" 2>/dev/null || true

# Also stage under ui-xr public cagematch path for isolated lab (parent/xr may wire; we only write if dir exists or create under model-vetting)
UI_CAGE="apps/ui-xr/public/cagematch/seated-adult-bod-preview-2026-08-02"
# ui-xr public cagematch is outside strict write roots for some policies; prefer model-vetting.
# Document lab URL for model-vetting studio:
#   /cagematch/seated-adult-bod-preview-2026-08-02/ed_chest_pain_patient_adult_bod.glb

ls -la "$OUT_DIR" "$CAGE_DIR"
echo "ORCHESTRATE_BOD_PREVIEW_SUCCESS"
echo "GLB=${OUT_DIR}/${GLB_NAME}"
echo "CAGE=${CAGE_DIR}/${GLB_NAME}"
echo "BYTES=$BYTES"
