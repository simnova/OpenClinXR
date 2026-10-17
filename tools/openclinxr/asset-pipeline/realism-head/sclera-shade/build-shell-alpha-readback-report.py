"""Build shell-alpha-readback-report.json (CARD tsk_6c0405833c1f5952)."""
import hashlib, json, math, os

HERE = os.path.dirname(os.path.abspath(__file__))
STORE = "/Volumes/files/openclinxr-assets/store/shell-alpha-readback"
SCLERA = "/Volumes/files/openclinxr-assets/store/sclera-shade"
SHELL_PLACEMENT = "/Volumes/files/openclinxr-assets/store/shell-placement"

def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        h.update(f.read())
    return h.hexdigest()

# define readback from probe
probe = json.load(open(f"{STORE}/probe-readback.json"))
dr = probe["defineReadback"]
define = {
    "materialName": dr["shellInfo"]["materialName"],
    "meshName": dr["shellInfo"]["meshName"],
    "geometryColorItemSize": dr["shellInfo"]["colorItemSize"],
    "materialVertexColors": dr["shellInfo"]["vertexColors"],
    "materialTransparent": dr["shellInfo"]["transparent"],
    "materialDepthWrite": dr["shellInfo"]["depthWrite"],
    "useColorAlpha": dr["useColorAlpha"],
    "hasUseColorAlpha": dr["useColorAlpha"],
    "vec4VColor": dr["vec4VColor"],
    "hasVec4VColor": dr["vec4VColor"],
    "nPrograms": dr["nPrograms"],
    "nTracked": dr["nTracked"],
    "nFragmentShaders": dr["nFrag"],
}
# aliases
define["USE_COLOR_ALPHA"] = define["useColorAlpha"]
define["vColor"] = define["vec4VColor"]

# iris floors from shell-placement-report
sp = json.load(open(f"{SCLERA}/shell-placement-report.json")) if os.path.exists(f"{SCLERA}/shell-placement-report.json") else {}
iris_floor = sp.get("noise", {}).get("irisEuclidFloor", {"aisha": 6.896, "body2": 5.159})
mask_noise = sp.get("noise", {}).get("mask", {"aisha": {"M1": 0.759}, "body2": {"M1": 1.107}})

def iris_euclid(mA, mB):
    a = mA["irisMeanRGB"]; b = mB["irisMeanRGB"]
    return math.sqrt(sum((a[k]-b[k])**2 for k in ("R","G","B")))

subjects = {}
for s in ("aisha", "body2"):
    frames = {}
    for st in ("A", "B", "C"):
        metrics = json.load(open(f"{STORE}/{s}-{st}-metrics.json"))
        cw = json.load(open(f"{STORE}/{s}-{st}-catchlight.json"))
        render_path = f"{STORE}/{s}-{st}.png"
        frame = {
            "render": render_path,
            "image": render_path,
            "path": render_path,
            "sha256": sha(render_path),
            "mask": "id-globe",
            "maskKind": metrics.get("maskKind"),
            "idImage": metrics.get("idImage"),
            "idSha256": metrics.get("idSha256"),
            "maskImage": metrics.get("idImage"),
            "metrics": metrics,
            "catchlight": cw,
            "M1": metrics["M1"],
            "M2a": metrics["M2a"],
            "M2b": metrics["M2b"],
            "D90": metrics["D90"],
            "irisMeanRGB": metrics["irisMeanRGB"],
            "catchlightPeakL": cw["catchlightPeakL"],
            "catchlightNoiseL": cw["catchlightNoiseL"],
            "nSclera": metrics["nSclera"],
        }
        frames[st] = frame
        frames[st.lower()] = frame
    # comparisons
    A = frames["A"]["metrics"]; B = frames["B"]["metrics"]; C = frames["C"]["metrics"]
    cA = frames["A"]["catchlight"]; cB = frames["B"]["catchlight"]; cC = frames["C"]["catchlight"]
    irisBC = iris_euclid(B, C)
    irisAC = iris_euclid(A, C)
    cwBC = abs(cB["catchlightPeakL"] - cC["catchlightPeakL"])
    cwAC = abs(cA["catchlightPeakL"] - cC["catchlightPeakL"])
    catchNoiseBC = max(cB["catchlightNoiseL"], cC["catchlightNoiseL"])
    catchNoiseAC = max(cA["catchlightNoiseL"], cC["catchlightNoiseL"])
    subj = {
        "frames": frames,
        "A": frames["A"],
        "B": frames["B"],
        "C": frames["C"],
        "irisEuclidBC": round(irisBC, 3),
        "irisEuclidAC": round(irisAC, 3),
        "catchlightDeltaBC": round(cwBC, 3),
        "catchlightDeltaAC": round(cwAC, 3),
        "irisFloor": iris_floor[s],
        "catchlightNoiseBC": round(catchNoiseBC, 3),
        "catchlightNoiseAC": round(catchNoiseAC, 3),
        "bEqualsCWithinNoise": bool(irisBC <= iris_floor[s] and cwBC <= catchNoiseBC),
        "aDiffersC": bool(irisAC > iris_floor[s] or cwAC > catchNoiseAC),
    }
    subjects[s] = subj

# verdict
useCA = define["useColorAlpha"]
useVC = define["vec4VColor"]
bc_ok = all(subjects[s]["bEqualsCWithinNoise"] for s in subjects)
if not (useCA and useVC):
    verdict = "alpha_ignored"
elif not bc_ok:
    verdict = "alpha_ignored"
else:
    verdict = "alpha_applied_shell_occludes_iris"

# sheet
sheet_dir = STORE
sheet_files = {}
for name in ("sheet-aisha-front.png", "sheet-body2-front.png"):
    p = os.path.join(sheet_dir, name)
    if os.path.exists(p):
        sheet_files[name] = sha(p)

# files map
files = {}
def add(p):
    if os.path.exists(p):
        files[p] = {"sha256": sha(p)}

for s in ("aisha", "body2"):
    for st in ("A", "B", "C"):
        add(f"{STORE}/{s}-{st}.png")
        add(f"{STORE}/{s}-{st}-metrics.json")
        add(f"{STORE}/{s}-{st}-catchlight.json")
    add(f"{STORE}/{s}-id.png")
for name in sheet_files:
    add(f"{STORE}/{name}")
add(f"{STORE}/probe-readback.json")
# id metrics? not generated
# stripped glbs
for s in ("aisha", "body2"):
    add(f"{STORE}/{s}-id.glb")

report = {
    "card": "tsk_6c0405833c1f5952",
    "verdict": verdict,
    "defineReadback": define,
    "define": define,
    "subjects": subjects,
    "frames": subjects,
    "aisha": subjects["aisha"],
    "body2": subjects["body2"],
    "noise": {
        "irisEuclidFloor": iris_floor,
        "mask": mask_noise,
        "irisMethod": "1px dilation/erosion of iris circle radius (shell-placement-report)",
    },
    "verdictRule": {
        "alpha_ignored": "B differs from C beyond noise on iris or catch-light, OR compiled shader lacks USE_COLOR_ALPHA/vec4 vColor",
        "alpha_applied_shell_occludes_iris": "B equals C within noise AND USE_COLOR_ALPHA present; A-vs-C differences come from alpha field",
    },
    "files": files,
    "sheet": {"root": sheet_dir, "files": sheet_files},
}

out = os.path.join(HERE, "shell-alpha-readback-report.json")
with open(out, "w") as f:
    json.dump(report, f, indent=2)
    f.write("\n")
print("wrote", out)
print("verdict", verdict)
