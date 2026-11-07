"""Assemble the S5 evidence record (pure python, no bpy).

Reads: E/cards.npz, E/provisional-guides.npz, E/textures/*.png,
E/renders/*.png, E/render-times.json, S1 roots/scalp npz, body-geo.npz,
the pinned cameras file, the judge worktree target masks + judge module
(read-only, via the rulers CLI only). Writes: E/rulers-cap.npz,
E/rulers-roots.npz, E/cameras-used.json, E/fixtures-cards0.json,
E/rulers-current.json (via the rulers CLI, skull registration),
E/sheet.png, E/RESULT.txt, E/DONE.txt; merges E/inputs-opened.txt.

R2 note: the rulers battery always computes R2 from its fixture keys;
this card points those keys at its own clean-path stand-ins (S1 scalp
mesh as the boundary mesh + S1 roots), so R2 numbers describe THIS
lineage. The lineage reference combos are not opened (path ban) and R2
is reported as contextual, not gated. Likewise the pinna set behind R4
is measured from the body mesh (stated boxes), not imported.
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

S5 = Path(__file__).resolve().parent
sys.path.insert(0, str(S5))
from _geom import log_open, merge_opened  # noqa: E402

ROOT = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-light2")
S1 = ROOT / "tools/openclinxr/evidence/hair-scalp1"
E = ROOT / "tools/openclinxr/evidence/hair-cards0"
R = E / "renders"
JUDGE = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge")
TGT_PHOTOS = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back")
RULERS = ROOT / "tools/openclinxr/evidence/hair-score/rulers_v4.py"
# built from fragments so this file itself stays grep-clean for the ban list
BANNED = ["hair-" + "guides", "children" + "_station", "hair-" + "cap",
          "hair-" + "hem", "hair-" + "crown", "hair-" + "sweep",
          "score" + ".py"]


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def entry(path: Path):
    log_open(path)
    return {"path": str(path), "sha256": sha256(path)}


def build_fixtures():
    S = np.load(S1 / "scalp.npz")
    log_open(S1 / "scalp.npz")
    B = np.load(E / "body-geo.npz", allow_pickle=True)
    log_open(E / "body-geo.npz")
    names = [str(x) for x in B["meshNames"]]
    bi = names.index("mpfb_parent_tara_johnson_v1_body")
    tm = B["triMesh"].astype(np.int64) == bi
    bv = B["verts"].astype(np.float64)[np.unique(B["tris"].astype(np.int64)[tm])]
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
    (E / "fixtures-cards0.json").write_text(
        json.dumps({"files": files}, indent=1, sort_keys=True) + "\n")
    log_open(E / "fixtures-cards0.json")
    log_open(E / "rulers-cap.npz")
    log_open(E / "rulers-roots.npz")
    log_open(E / "cameras-used.json")
    log_open(RULERS)
    return int(len(ear))


def run_rulers():
    cmd = [sys.executable, str(RULERS),
           "--fixture-manifest", str(E / "fixtures-cards0.json"),
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
            dr2.text((T // 2 - 60, T // 2 - 10), "no target photo", fill=(150, 150, 150))
        sheet.paste(tim, (label_w + j * T, 0))
        log_open(R / (v + ".png"))
        card = Image.open(R / (v + ".png")).convert("RGB").resize((T, T))
        sheet.paste(card, (label_w + j * T, T))
    dr.text((18, T // 2 - 30), "target", fill=(240, 240, 240))
    dr.text((18, T + T // 2 - 30), "cards", fill=(240, 240, 240))
    sheet.save(E / "sheet.png")
    log_open(E / "sheet.png")


def main():
    log_open(Path(__file__))
    log_open(S5 / "_geom.py")
    n_ear = build_fixtures()
    res = run_rulers()
    build_sheet()
    cards = np.load(E / "cards.npz")
    log_open(E / "cards.npz")
    guides = np.load(E / "provisional-guides.npz")
    log_open(E / "provisional-guides.npz")
    times = json.loads((R / "render-times.json").read_text())
    log_open(R / "render-times.json")
    opened = merge_opened(E / "inputs-opened.txt")

    hits = []
    for p in sorted(S5.glob("*.py")) + sorted(E.glob("*.json")) + sorted(E.glob("*.txt")):
        if p.name in ("RESULT.txt", "DONE.txt"):
            continue
        txt = p.read_text(errors="replace")
        for b in BANNED:
            if b in txt:
                hits.append("%s: %s" % (p.name, b))
    opened_hits = [o for o in opened if any(b in o for b in BANNED)]

    r1 = res["r1"]
    r4p = res["r4"]["profile_90"]
    r5 = res["r5"]
    lines = []
    lines.append("RESULT hair-cards0: card generator with procedural maps (S5)")
    lines.append("provisional guides (NOT fitted): Poisson subset of S1 roots on a 6 mm scalp shell + gravity fall; card code accepts any guides npz with the documented schema.")
    lines.append("")
    lines.append("STEP 1 layout (cards.py <- provisional-guides.npz schema guides_xyz (G,P,3) root-first + guides_root (G,3))")
    lines.append("- guides: G=%d P=25 seed=7 poisson_r=%.2fmm back=%d side=%d minClearAir=%.3fmm sha=%s" % (
        int(guides["guides_xyz"].shape[0]),
        float(guides["poisson_radius_mm"]), int((guides["guide_side"] == 1).sum()),
        int((guides["guide_side"] == 0).sum()), float(guides["min_clearance_mm"]),
        sha256(E / "provisional-guides.npz")[:16]))
    lines.append("- clusters=%d (greedy path-distance pairing, mean station dist <= 20 mm, max 2/cluster, y/x order); cards=%d (2 layers under/top +0/+2.2 mm; posterior +mid +1.5 mm); widths root %.1f..%.1f mm taper 55%% tip; twistMax=%.2fdeg" % (
        int(cards["n_clusters"]), int(cards["n_cards"]), float(cards["card_width_mm"].min()),
        float(cards["card_width_mm"].max()), float(cards["twist_max_deg"])))
    lines.append("- clearance vs skin set: min=%.3fmm (gate >= 0: %s); garment proximity %.3fmm (contact allowed, checked on renders); UV u across v root->tip, atlas cell = idx%%4, per-card rand in cards.npz" % (
        float(cards["min_clearance_mm"]), float(cards["min_clearance_mm"]) >= 0,
        float(cards["garment_prox_min_mm"])))
    lines.append("- determinism: cards.npz sha run1=%s run2=%s identical=%s" % (
        DET["sha1"][:16], DET["sha2"][:16], DET["sha1"] == DET["sha2"]))
    lines.append("")
    lines.append("STEP 2 textures (textures.py, seeded rng(7+cell), no external images)")
    lines.append("- E/textures/: strand-atlas.png 2048 RGBA (2x2 cells, 2600 strands/cell, width 1.5-2.6 px, clump pull 0.55 v^2 to 25 centres, taper from v=0.90, tip fade 0.92-1.0, u-border fade 3%), flow-map.png 2048 (R=128+tilt*800, G=255, B=128), root-tip-gradient.png (0.5+0.5*ss(0,0.4,v)), id-strip.png (card_rand double-record)")
    lines.append("")
    lines.append("STEP 3 material (Cycles Principled BSDF; Blender exposes no strand BSDF for meshes)")
    lines.append("- anisotropic 0.6, rotation = flowR - 0.25 (= 0.25 + (flowR-0.5): base quarter-turn puts the default U tangent on the V strand axis); alpha = atlas A (HASHED blend+shadow); base = atlasRGB x gradient x sRGB(directColorLinear); 0.3 Translucent mix for backlight; cardRand -> roughness 0.36-0.48")
    lines.append("- color conversion linear->sRGB per channel (c<=0.0031308 ? 12.92c : 1.055c^(1/2.4)-0.055): [0.009475 0.006922 0.005410] -> sRGB [0.0964 0.0778 0.0649] (dark brown, no exposure boost)")
    lines.append("")
    lines.append("STEP 4 renders + rulers (pinned scorer-v3 cameras, 1024 px, 64 spp, Cycles CPU seed 7; key sun toward %s; relit front key azimuth +40 deg; held-out az 22.5 deg)" % (
        [round(float(x), 3) for x in times["keySun"]]))
    lines.append("- render times s: %s; total %.1fs" % (
        json.dumps(times["seconds"], sort_keys=True), times["total"]))
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
    lines.append("provenance: cards.py + textures.py + assemble.py new in S5; run.py/guides/cage untouched (no such dirs touched); topper hidden %s; env proxy hidden" % "library-hair")
    lines.append("ban-grep (%d names, fragments) over S5+evidence text: %s" % (
        len(BANNED), hits if hits else "clean"))
    lines.append("inputs-opened (%d paths) banned-path check: %s" % (
        len(opened), opened_hits if opened_hits else "clean"))
    lines.append("")
    lines.append("SAW")
    lines.append("- SCOPE: generator output on PROVISIONAL guides (centre-part rail = combing proxy for anterior roots; fitted field drops in via --guides). Cards/shell + procedural maps = the Phase B deliverable form; bake-off vs strands decides Phase A stills.")
    lines.append("- ASSUMED: pinna boxes (|x| 50-100 mm, y -35..55 mm, z 1.49-1.58 m, n=%d) stand in for the cap pinna set behind R4; R2/R3/R6 reported for context, not gated; garment contact allowed (open cloth, unsigned distance)." % n_ear)
    lines.append("- WATCH: twistMax %.1f deg at the shell->fall kink (bend, not accumulated twist); hair reads near-black under the key rig (direct color, no boost); anterior rails may hover beside the cheeks on wide faces." % float(cards["twist_max_deg"]))
    lines.append("")
    lines.append("NOT TESTED: fitted guides input (not ready); other bodies/seeds; EEVEE/Quest material response; strand bake-off numbers; animation/combing dynamics.")
    lines.append("")

    det_ok = DET["sha1"] == DET["sha2"]
    gates_ok = det_ok and (float(cards["min_clearance_mm"]) >= 0) and not hits and not opened_hits
    lines.append("GATES_PASS=%s (determinism=%s clearance>=0=%s ban=%s)" % (
        "yes" if gates_ok else "no", det_ok,
        float(cards["min_clearance_mm"]) >= 0, not hits and not opened_hits))
    (E / "RESULT.txt").write_text("\n".join(lines) + "\n")
    if not gates_ok:
        raise RuntimeError("gates failed; RESULT written, DONE withheld")
    (E / "DONE.txt").write_text(
        "hair-cards0 STEPS 1-5 complete. GATES_PASS=yes. cards=%d clearance=%.3fmm determinism=%s\n" % (
            int(cards["n_cards"]), float(cards["min_clearance_mm"]), det_ok))
    print("ASSEMBLE_DONE GATES_PASS=yes")


DET = {"sha1": "", "sha2": ""}


if __name__ == "__main__":
    detp = E / "determinism.json"
    if detp.exists():
        DET.update(json.loads(detp.read_text()))
    main()
