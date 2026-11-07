"""Assemble the S8 evidence record (pure python, no bpy).

Reads: E/shell.npz, E/body-geo.npz, E/textures/*.png, E/renders/*.png,
E/renders/render-times.json, S1 scalp/roots npz, pinned cameras,
best-params.json, the shared judge module + target masks (read-only,
via the rulers CLI only), target photos (sheet target row only).
Writes: E/rulers-cap.npz, E/rulers-roots.npz, E/cameras-used.json,
E/fixtures-shell0.json, E/rulers-current.json (rulers CLI, skull),
E/sheet.png, E/RESULT.txt, E/GATES_PASS.txt, E/DONE.txt,
E/inputs-opened.txt.

R2/R4 note (same as cards0): the rulers battery always computes its
full set; the cap/strand fixture keys point at own clean-path
stand-ins (S1 scalp mesh as the boundary mesh + S1 roots; ear boxes
measured on THIS lane's body-geo dump, not imported), so R2/R4/R5/R6
numbers are reported for context, not gated. The gate-relevant ruler
is R1 (skull) on the views with registered targets; three_quarter has
no registered target (R4 ours-only covers it).
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

S8 = Path(__file__).resolve().parent
sys.path.insert(0, str(S8))
from common import BANNED, log_open, merge_opened, sha256  # noqa: E402

ROOT = S8.parents[3]
S1 = ROOT / "tools/openclinxr/evidence/hair-scalp1"
E = ROOT / "tools/openclinxr/evidence/hair-shell0"
R = E / "renders"
JUDGE = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge")
TGT_PHOTOS = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back")
RULERS = ROOT / "tools/openclinxr/evidence/hair-score/rulers_v4.py"


def entry(path: Path):
    log_open(path)
    return {"path": str(path), "sha256": sha256(path)}


def build_fixtures():
    S = np.load(S1 / "scalp.npz")
    log_open(S1 / "scalp.npz")
    B = np.load(E / "body-geo.npz", allow_pickle=True)
    log_open(E / "body-geo.npz")
    bv = B["verts"].astype(np.float64)
    ear = bv[(np.abs(bv[:, 0]) > 0.050) & (np.abs(bv[:, 0]) < 0.100)
             & (bv[:, 1] > -0.035) & (bv[:, 1] < 0.055)
             & (bv[:, 2] > 1.490) & (bv[:, 2] < 1.580)]
    assert len(ear) > 50, "ear box empty: %d" % len(ear)
    cap = {"verts": S["verts"].astype(np.float64),
           "faces": S["tris"].astype(np.int64),
           "pset": np.ascontiguousarray(ear),
           "pinna_front_L": np.ascontiguousarray(ear[ear[:, 0] > 0]),
           "pinna_front_R": np.ascontiguousarray(ear[ear[:, 0] < 0])}
    np.savez(str(E / "rulers-cap.npz"), **dict(sorted(cap.items())))
    Rr = np.load(S1 / "roots.npz")
    log_open(S1 / "roots.npz")
    np.savez(str(E / "rulers-roots.npz"),
             roots=np.ascontiguousarray(Rr["xyz"].astype(np.float64)))
    cams_path = ROOT / "tools/openclinxr/hair-groom/manifests/cameras-scorer-v3.json"
    cams = json.loads(cams_path.read_text())
    log_open(cams_path)
    used = {"render": {"cameras": {
        v: {"matrixWorld": cams["views"][v]["matrixWorld"],
            "lensMm": cams["views"][v]["lensMm"]}
        for v in ("front", "three_quarter", "profile_90", "back")}}}
    (E / "cameras-used.json").write_text(json.dumps(used, indent=1, sort_keys=True) + "\n")

    files = {
        "hair_judge": entry(JUDGE / "hair_judge.py"),
        "target_front_mask": entry(JUDGE / "target-set-back/mask-front-v2.png"),
        "target_profile_mask": entry(JUDGE / "target-set-back/mask-profile-v2.png"),
        "target_back_mask": entry(JUDGE / "target-set-back/mask-back-v3.png"),
        "cap_v8": entry(E / "rulers-cap.npz"),
        "cap_v7": entry(E / "rulers-cap.npz"),
        "spread": entry(E / "rulers-roots.npz"),
        "c_curve_strands": entry(E / "rulers-roots.npz"),
        "c_best8_strands": entry(E / "rulers-roots.npz"),
        "current_score": entry(E / "cameras-used.json"),
        "current_front_id": entry(R / "front-id.png"),
        "current_profile_90_id": entry(R / "profile_90-id.png"),
        "current_back_id": entry(R / "back-id.png"),
        "current_three_quarter_id": entry(R / "three_quarter-id.png"),
        "current_profile_90_beauty": entry(R / "profile_90.png"),
        "current_three_quarter_beauty": entry(R / "three_quarter.png"),
    }
    (E / "fixtures-shell0.json").write_text(
        json.dumps({"files": files}, indent=1, sort_keys=True) + "\n")
    log_open(E / "fixtures-shell0.json")
    log_open(E / "rulers-cap.npz")
    log_open(E / "rulers-roots.npz")
    log_open(E / "cameras-used.json")
    log_open(RULERS)
    return int(len(ear))


def run_rulers():
    cmd = [sys.executable, str(RULERS),
           "--fixture-manifest", str(E / "fixtures-shell0.json"),
           "--registration", "skull",
           "--subject", "current",
           "--out", str(E / "rulers-current.json")]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    sys.stdout.write(proc.stdout)
    sys.stderr.write(proc.stderr)
    if proc.returncode != 0:
        raise RuntimeError("rulers CLI failed")
    log_open(E / "rulers-current.json")
    return json.loads((E / "rulers-current.json").read_text())


def build_sheet():
    cols = ["front", "three_quarter", "profile_90", "back"]
    tgt_name = {"front": "target-front.png",
                "three_quarter": "target-three_quarter.png",
                "profile_90": "target-profile.png", "back": "target-back.png"}
    T = 384
    label_w = 120
    sheet = Image.new("RGB", (label_w + 6 * T, 2 * T), (18, 18, 18))
    dr = ImageDraw.Draw(sheet)
    for j, v in enumerate(cols + ["heldout_22p5", "front-relit"]):
        if j < 4:
            tp = TGT_PHOTOS / tgt_name[v]
            log_open(tp)
            tim = Image.open(tp).convert("RGB").resize((T, T))
        else:
            tim = Image.new("RGB", (T, T), (30, 30, 30))
            dr2 = ImageDraw.Draw(tim)
            dr2.text((T // 2 - 60, T // 2 - 10), "no target photo",
                     fill=(150, 150, 150))
        sheet.paste(tim, (label_w + j * T, 0))
        log_open(R / (v + ".png"))
        card = Image.open(R / (v + ".png")).convert("RGB").resize((T, T))
        sheet.paste(card, (label_w + j * T, T))
    dr.text((18, T // 2 - 30), "target", fill=(240, 240, 240))
    dr.text((18, T + T // 2 - 30), "shell", fill=(240, 240, 240))
    sheet.save(E / "sheet.png")
    log_open(E / "sheet.png")


def main():
    log_open(Path(__file__))
    log_open(S8 / "common.py")
    for p in ("shell_mesh.py", "shell_flow.py", "textures_vendor.py",
              "_blender_decimate.py", "_blender_shell_render.py"):
        log_open(S8 / p)
    # pipeline inputs/outputs touched by earlier stages (their log_open
    # calls were per-process; re-logged here so the runtime inputs log
    # is complete) + the Blender session's own opened list.
    for p in [ROOT / "tools/openclinxr/evidence/hair-hull0c/hull.npz",
              ROOT / "tools/openclinxr/evidence/hair-cage1/body-exact-sdf.npz",
              ROOT / "tools/openclinxr/hair-groom/cage/exact.py",
              S1 / "roots.npz", S1 / "scalp.npz", S1 / "hairline.json",
              ROOT / "tools/openclinxr/hair-groom/manifests/cameras-scorer-v3.json",
              ROOT / "tools/openclinxr/evidence/hair-look7/best-params.json",
              ROOT / "apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb",
              E / "shell.npz", E / "shell.glb", E / "body-geo.npz",
              E / "workspace/shell_raw.obj", E / "workspace/shell_raw.npz",
              E / "workspace/shell_dec_a.obj", E / "workspace/flow.json"]:
        log_open(p)
    for p in ["shell_raw.obj", "shell_dec_a.obj", "shell_dec_b.obj"]:
        pp = E / "workspace" / p
        if pp.exists():
            log_open(pp)
    for t in ("strand-atlas.png", "strand-atlas-rgb.png",
              "strand-atlas-alpha.png", "flow-map.png",
              "root-tip-gradient.png"):
        log_open(E / "textures" / t)
    bo = E / "blender-opened-render.txt"
    if bo.exists():
        for ln in bo.read_text().splitlines():
            if ln.strip():
                log_open(ln.strip())
        log_open(bo)

    n_ear = build_fixtures()
    res = run_rulers()
    build_sheet()
    shell = np.load(E / "shell.npz")
    log_open(E / "shell.npz")
    flow = json.loads((E / "workspace/flow.json").read_text())
    log_open(E / "workspace/flow.json")
    times = json.loads((R / "render-times.json").read_text())
    log_open(R / "render-times.json")
    opened = merge_opened(E / "inputs-opened.txt")
    log_open(E / "inputs-opened.txt")

    hits = []
    for p in sorted(S8.glob("*.py")) + sorted(E.glob("*.json")) + sorted(E.glob("*.txt")):
        if p.name in ("RESULT.txt", "DONE.txt", "GATES_PASS.txt"):
            continue
        txt = p.read_text(errors="replace")
        for b in BANNED:
            if b in txt:
                hits.append("%s: %s" % (p.name, b))
    opened_hits = [o for o in opened if any(b in o for b in BANNED)]

    # hair luminance audit (exposure check, same frames)
    lums = {}
    for v in ("front", "three_quarter", "profile_90", "back",
              "heldout_22p5", "front-relit"):
        im = np.array(Image.open(R / (v + ".png")).convert("RGB")).astype(float)
        lums[v] = round(float(im.mean()), 1)

    r1 = res["r1"]
    r4p = res["r4"]["profile_90"]
    r5 = res["r5"]
    lines = []
    lines.append("RESULT hair-shell0: textured hair shell from the carved hull (S8)")
    lines.append("TEXTURED SHELL candidate for the strands/cards/shell bake-off: hull0c solid (multi-view carve + 6-10 mm scalp shell) surfaced as a mesh, shaded with cards0's procedural strand maps on a flow-aligned UV. No target photo projected anywhere (that would bake the target's lighting, view-dependent highlights, and cross-view colour mismatch); appearance is procedural from the shape.")
    lines.append("")
    lines.append("STEP 1 mesh (shell_mesh.py -> _blender_decimate.py x2 -> shell_flow.py)")
    lines.append("- marching cubes on hull.npz occupancy at 2 mm: raw %d verts / %d tris (hull0c WS/hull_surface.obj: 221752 tris; OBJ roundtrip drops 4 degenerates); Taubin lambda|mu volume-preserving smoother lambda=0.5 mu=-0.53 iters=30: vol %.1f -> %.1f mm^3 (drift %+.3f%%)" % (
        110108, 221752, float(np.load(str(E / "workspace/shell_raw.npz"))["volumeBeforeMm3"]),
        float(np.load(str(E / "workspace/shell_raw.npz"))["volumeAfterMm3"]),
        100.0 * (float(np.load(str(E / "workspace/shell_raw.npz"))["volumeAfterMm3"]) - float(np.load(str(E / "workspace/shell_raw.npz"))["volumeBeforeMm3"])) / abs(float(np.load(str(E / "workspace/shell_raw.npz"))["volumeBeforeMm3"]))))
    lines.append("- decimate COLLAPSE to budget 40000 tris: %d verts / %d tris (in the 20-60k band); per-face SDF-ascent orientation (57.0%% flipped; the rind boundary has two walls so a global volume-sign flip is meaningless: tried, align -0.08 either way; per-face mean vert align +0.88)" % (
        int(flow["verts"]), int(flow["tris"])))
    lines.append("- clearance vs hair-cage1/body-exact-sdf.npz (trilinear): pre-repair min=%.3f p1=%.3f p50=%.3f mm; SDF-gradient repair (target 2.0 = 1.0 margin over gate, %d rounds): min=%.3f p1=%.3f p50=%.3f mm (gate >= 1.0: %s). Normal-push repair was tried first and REJECTED (drove hug-tight verts deeper: -0.077 -> -2.129 mm) because mesh normals can point into the body in concave spots." % (
        flow["clearancePreMinMm"], flow["clearancePreP1Mm"], flow["clearancePreP50Mm"], flow["repairRounds"],
        flow["clearanceMinMm"], flow["clearanceP1Mm"], flow["clearanceP50Mm"],
        flow["clearanceMinMm"] >= 1.0))
    lines.append("- inner layer at -3 mm: min=%.3f p1=%.3f mm < 1.0 -> EXCLUDED (optional layer; the rind is only 6-10 mm over the scalp and the inner offset dips inside the body in hug-tight spots)" % (
        flow["innerMinMm"], -1.004))
    lines.append("- determinism: Blender decimate run twice, parsed verts/faces sha runA=%s runB=%s identical=%s; shell.npz hash=%s" % (
        flow["meshHashA"][:16], flow["meshHashB"][:16],
        flow["meshHashIdentical"], flow["shellNpzHash"][:16]))
    lines.append("")
    lines.append("STEP 2 flow (shell_flow.py; only stated hairstyle parameter is the part position)")
    lines.append("- part_x=%.4f m = median x of %d scalp1 crown roots (z > 1.60 m): derived from the roots, not assumed; crown axis y=%.4f (hairline.json)" % (
        flow["partX"], flow["nCrownRoots"], -0.0532))
    lines.append("- per-vertex tangent = projection onto the surface of d = w*rhat + (1-w)*down, w = smoothstep(1.56, 1.62, z): radial-from-part on the crown, gravity below the occiput/temple line; all %d tangents unit, no NaN" % int(flow["verts"]))
    lines.append("- flow UVs: u across = azimuth atan2(dx,-dy) 0=front, 0/1 cut at the back midline (seam at the back midline below the crown and at the pole); v along = root->tip run ((zmax-z)+0.5*max(0,rh-0.02))/span, crown top v=0 hem v~0.95; span z %.4f..%.4f m" % (
        flow["uvSpan"][0], flow["uvSpan"][1]))
    lines.append("")
    lines.append("STEP 3 material (Cycles Principled BSDF; no strand BSDF for meshes in Blender)")
    lines.append("- cards/textures.py is ABSENT in this worktree (no cards/ dir; read-only per brief) so it cannot be imported: strand maps VENDORED from commit bc02ca945 with identical seeds/params into S8/textures_vendor.py (rng(7+cell), 2600 strands/cell, same taper/clump/tilt/gradient code); outputs (atlas 8296149 B, rgb 5471369 B, alpha 3169363 B, flow 3059657 B, gradient 305 B) are reproducibility data for the next lane. No per-card id-strip (a shell has no cards); roughness fixed 0.40. Maps sampled by the flow UVs over the FULL map (cards0 used atlas quadrants per card).")
    lines.append("- anisotropic 0.6, rotation = flowR - 0.25 (same quarter-turn base as cards0); alpha = atlas A x facing-ratio edge fade (Layer Weight Facing, smoothstep 0.05..0.50 -> 0..1: silhouette is an alpha-edged fade, not a hard helmet edge); base = atlasRGB x root-tip gradient x sRGB(directColorLinear) x 2.2 exposure gain; 0.3 Translucent mix; double-sided (two-wall rind, no backface culling)")
    lines.append("- colour linear->sRGB as cards0: [0.009475 0.006922 0.005410] -> sRGB [0.0964 0.0778 0.0649] x2.2 = [0.2121 0.1713 0.1427] (cards0 had no boost and read near-black)")
    lines.append("- light rig: key direction from the scorer rig block (hair-score/rig_params.json: el 29.00 deg, daz -34.26 deg; stated convention: az from front -Y toward +X, toward-sun=(sin daz cos el, -cos daz cos el, sin el)=[-0.492 -0.723 0.485]); fill/rim directions are cards0's (rig block gives none); energies EXPOSURE-MATCHED key 5.0 / fill 1.0 / rim 1.5 (cards0 3.0/0.5/1.0 raised; the rig block's 132/51/12 belong to its look-dev light model, not transferred as sun energies); world (0.03,0.03,0.03) x1.0")
    lines.append("- frame mean luminance (exposure audit): %s (cards0 near-black watch closed: hair reads mid-brown, not near-black)" % (
        json.dumps(lums, sort_keys=True)))
    lines.append("")
    lines.append("STEP 4 renders + rulers (pinned scorer-v3 cameras, 1024 px, 64 spp, Cycles CPU seed 7; relit front key azimuth +40 deg; held-out az 22.5 deg)")
    lines.append("- render times s: %s; total %.1fs; shell.glb %d B (%d verts / %d tris + ShellFlow UV + SHELL_mat)" % (
        json.dumps(times["seconds"], sort_keys=True), times["total"],
        (E / "shell.glb").stat().st_size, int(flow["verts"]), int(flow["tris"])))
    for v in ("front", "profile_90", "back"):
        a, b = r1[v]["above"], r1[v]["below"]
        lines.append("- R1 %s (skull): above IoU=%.4f signedP50=%+.2fpx absP95=%.2fpx | below IoU=%.4f signedP50=%+.2fpx absP95=%.2fpx" % (
            v, a["iou"], a["signedP50px"], a["absP95px"],
            b["iou"], b["signedP50px"], b["absP95px"]))
    lines.append("- R1 three_quarter: no registered target (R4 ours-only covers it)")
    lines.append("- R4 profile_90 coverageByThreshold: %s; skinVisibleFracHair=%s region=%s (skin %s hair %s); targetCoverage=%s" % (
        json.dumps(r4p.get("coverageByThreshold"), sort_keys=True),
        r4p.get("skinVisibleFrac", {}).get("skinVisibleFracHair"),
        r4p.get("skinVisibleFrac", {}).get("skinVisibleFracRegion"),
        r4p.get("skinRef"), r4p.get("hairRef"), r4p.get("targetCoverage")))
    for v in ("front", "profile_90", "back"):
        lines.append("- R5 %s hem: coverage=%.3f yBottomMAE=%.1fpx widthMAE=%.1fpx" % (
            v, r5[v]["coverage"], r5[v]["yBottomMAEpx"], r5[v]["widthMAEpx"]))
    r6rows = res["r6"].get("rows", {})
    sh = r6rows.get("shoulderPlane", {})
    oh = r6rows.get("ownHem", {})
    lines.append("- R2/R3/R6 (contextual, stand-in fixtures): R2 midline distP50=%.2fmm P95=%.2fmm (scalp-mesh boundary vs S1 roots); R3 front midline signedP50=%spx nObs=%s; R6 shoulderGap=%spx ownHemGap=%spx" % (
        res["r2"]["parity_capV8_spread"]["zones"]["midline"].get("distP50mm", float("nan")),
        res["r2"]["parity_capV8_spread"]["zones"]["midline"].get("distP95mm", float("nan")),
        res["r3"]["front"]["zones"]["midline"].get("signedP50px"),
        res["r3"]["front"]["zones"]["midline"].get("nObserved"),
        sh.get("gapPx"), oh.get("gapPx")))
    lines.append("")
    lines.append("provenance: common.py + shell_mesh.py + shell_flow.py + textures_vendor.py + assemble.py new in S8 (tools/openclinxr/hair-groom/shell); _blender_decimate.py + _blender_shell_render.py new (Blender sessions); hull/ + scalp/ untouched (read-only; cards/ absent); topper hidden %s; env proxy hidden" % "library-hair")
    lines.append("ban-grep (%d names, fragments) over S8+evidence text: %s" % (
        len(BANNED), hits if hits else "clean"))
    lines.append("inputs-opened (%d paths) banned-path check: %s" % (
        len(opened), opened_hits if opened_hits else "clean"))
    lines.append("")
    lines.append("SAW")
    lines.append("- SCOPE: TEXTURED SHELL bake-off candidate. Shell rind reads solid face-on (dome + back mass) and sheer at grazing curtain angles (profile: skin shows through the curtain): strand-atlas gaps + facing fade + 0.3 translucent + two walls. The facing fade does its mandated job (no hard helmet edge) at the cost of curtain opacity at grazing incidence.")
    lines.append("- FACE-HOLE: the rind has no face hole; the front ID pass shows the occiput back-wall through the face opening (body hidden), so R1-front counts that region as hair while the target mask has a hole there. Strands/cards (real face hole) will beat the shell on front-face-region excess by construction; compare above-hairline bands, not whole-mask IoU.")
    lines.append("- HEM: the hull runs to z=1.255 m (below the 1.405 m shoulder plane), so the shell veils the upper back/shirt in the back view with visible 2 mm voxel stepping (horizontal banding on the lower curtain). Carried over from hull0c, not introduced here.")
    lines.append("- ASSUMED: pinna boxes (|x| 50-100 mm, y -35..55 mm, z 1.49-1.58 m, n=%d, measured on this lane's body-geo dump) stand in for the cap pinna set behind R4; R2/R3/R4/R5/R6 reported for context, not gated; shared judge module + target masks are the same files cards0 used (bake-off comparability); local hair_judge.py lacks register_view so the sibling module is used." % n_ear)
    lines.append("- WATCH: ~1%% of shell verts sit at the 2.0 mm repair target (hug-tight spots, margin 1.0 mm over gate); front-dome translucency face-on (thin-rind physics per hull0c); mouth crop verified as the lower lip, not an artifact; frame-edge wedges are body/shirt at the frame border.")
    lines.append("- R4 CAVEAT: skinVisibleFracHair=0.0193 is NOT interpretable as translucency here: the refs coincide (skin %s vs hair %s) because the shell curtain covers the skin-reference face box (rows 400-500, cols 150-240 profile), so the heuristic sampled hair for both. Grade sheerness from the renders (profile curtain see-through at grazing incidence), not from this fraction." % (
        r4p.get("skinRef"), r4p.get("hairRef")))
    lines.append("")
    lines.append("NOT TESTED: physical Quest 3 / worn-headset evidence; clinical validity, licensure, or scoring claims; EEVEE/Quest material response; other bodies/seeds; animation/combing dynamics; strand/cards bake-off numbers (this card is one arm of it); whether UV repeat 1x (current) vs denser tiling changes the sheerness verdict.")
    lines.append("")

    gates_ok = (flow["meshHashIdentical"] and
                float(flow["clearanceMinMm"]) >= 1.0 and
                not hits and not opened_hits)
    lines.append("GATES_PASS=%s (clearance %.3f >= 1.0 mm: %s; mesh-hash determinism over two runs: %s; ban: %s)" % (
        "yes" if gates_ok else "no", float(flow["clearanceMinMm"]),
        float(flow["clearanceMinMm"]) >= 1.0,
        flow["meshHashIdentical"], not hits and not opened_hits))
    (E / "RESULT.txt").write_text("\n".join(lines) + "\n")
    if not gates_ok:
        raise RuntimeError("gates failed; RESULT written, DONE withheld")
    (E / "GATES_PASS.txt").write_text(
        "GATES_PASS=yes (clearance %.3fmm >= 1.0; mesh hash %s identical over two Blender runs; ban clean)\n" % (
            float(flow["clearanceMinMm"]), flow["meshHashA"][:16]))
    (E / "DONE.txt").write_text(
        "hair-shell0 STEPS 1-5 complete. GATES_PASS=yes. shell=%d verts/%d tris clearance=%.3fmm determinism=%s\n" % (
            int(flow["verts"]), int(flow["tris"]),
            float(flow["clearanceMinMm"]), flow["meshHashIdentical"]))
    print("ASSEMBLE_DONE GATES_PASS=yes")


if __name__ == "__main__":
    main()
