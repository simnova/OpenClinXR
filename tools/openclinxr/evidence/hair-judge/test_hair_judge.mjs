// Plain node test runner for hair_judge.py. Spawns python3. Exits non-zero on failure.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = "/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge";
const JUDGE = "tools/openclinxr/evidence/hair-judge/hair_judge.py";
const TARGET_PHOTO = "/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/target-front.png";
const TARGET_MASK = "/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/mask-front.png";
const PACKDUP_BEAUTY = "/Users/patrick/.grok/worktrees/src-openclinxr/hair-guides/tools/openclinxr/evidence/hair-guides/G0/front.png";
const TLM = JSON.stringify({ crown_top_row: 127, chin_row: 607, face_centre_col: 514 });

const tmp = mkdtempSync(join(tmpdir(), "hj-test-"));
const env = { ...process.env };
const failures = [];

function py(args, opts = {}) {
  return execFileSync("python3", args, { cwd: ROOT, env, encoding: "utf8", ...opts });
}

function judge(beauty, mask, name, landmarks, out) {
  const args = [JUDGE, "--beauty", beauty, "--mask", mask, "--name", name, "--out", out];
  if (landmarks) args.push("--landmarks", JSON.stringify(landmarks));
  py(args);
  return JSON.parse(readFileSync(join(out, name + ".json"), "utf8"));
}

function check(id, cond, detail) {
  console.log((cond ? "PASS" : "FAIL") + " " + id + (detail ? " :: " + detail : ""));
  if (!cond) failures.push(id);
}

const GEN = `
from PIL import Image
from PIL.ImageFilter import MaxFilter
import numpy as np, sys, json
tmp = sys.argv[1]
packdup = sys.argv[2]
ph = Image.open(${JSON.stringify(TARGET_PHOTO)}).convert("RGB")
mk = Image.open(${JSON.stringify(TARGET_MASK)}).convert("L").resize((1024,1024), Image.NEAREST)
inv = (1/0.8, 0, -60/0.8, 0, 1/0.8, 40/0.8)
ph.transform((1024,1024), Image.AFFINE, inv, Image.BICUBIC).save(tmp + "/b-photo.png")
mk.transform((1024,1024), Image.AFFINE, inv, Image.NEAREST).save(tmp + "/b-mask.png")
a = np.array(mk); a[608:,:] = 0
Image.fromarray(a).save(tmp + "/c-mask.png")
Image.fromarray(np.array(mk.filter(MaxFilter(59)))).save(tmp + "/d-mask.png")
pb = Image.open(packdup).convert("RGB").resize((1024,1024), Image.BILINEAR)
yy, xx = np.ogrid[:1024,:1024]
blob = ((yy-560)/180)**2 + ((xx-513)/120)**2 <= 1
Image.fromarray((blob.astype(np.uint8))*255).save(tmp + "/e-mask.png")
print("fixtures ok")
`;

// (a) target vs itself
{
  const j = judge(TARGET_PHOTO, TARGET_MASK, "a", JSON.parse(TLM), tmp);
  check("a-iou", j.iou === 1, "iou=" + j.iou);
  check("a-width", j.width_rms === 0, "width_rms=" + j.width_rms);
  check("a-overall", j.overall === true, "overall=" + j.overall);
}

// fixtures for b-e
writeFileSync(join(tmp, "gen.py"), GEN);
console.log(py([join(tmp, "gen.py"), tmp, PACKDUP_BEAUTY]).trim());

// (b) scaled 0.8 + shifted (60,-40), landmarks transformed accordingly
{
  const lm = { crown_top_row: 0.8 * 127 - 40, chin_row: 0.8 * 607 - 40, face_centre_col: 0.8 * 514 + 60 };
  const j = judge(join(tmp, "b-photo.png"), join(tmp, "b-mask.png"), "b", lm, tmp);
  check("b-iou", j.iou >= 0.97, "iou=" + j.iou);
  check("b-width", j.width_rms <= 0.03, "width_rms=" + j.width_rms);
}

// (c) bob truncated at chin: fails below_chin and IoU
{
  const j = judge(TARGET_PHOTO, join(tmp, "c-mask.png"), "c", JSON.parse(TLM), tmp);
  check("c-below", j.clauses.below_chin === false, "below_chin=" + JSON.stringify(j.clauses.below_chin));
  check("c-iou", j.clauses.iou === false, "iou=" + j.iou);
}

// (d) dilated by 0.06H: fails width_rms
{
  const j = judge(TARGET_PHOTO, join(tmp, "d-mask.png"), "d", JSON.parse(TLM), tmp);
  check("d-width", j.clauses.width_rms === false, "width_rms=" + j.width_rms);
}

// (e) face-sized skin blob mask: contaminated tripwire
{
  const lm = { crown_top_row: 67, chin_row: 710, face_centre_col: 513 };
  const j = judge(PACKDUP_BEAUTY, join(tmp, "e-mask.png"), "e", lm, tmp);
  check("e-flag", j.photometrics_render.meanRminusB > 0.20, "meanR-B=" + j.photometrics_render.meanRminusB);
  check("e-contam", j.contaminated === true, "contaminated=" + j.contaminated);
  check("e-overall", j.overall === false, "overall=" + j.overall);
}

// (f) determinism: byte-identical JSON
{
  const o1 = join(tmp, "f1"), o2 = join(tmp, "f2");
  py([JUDGE, "--beauty", TARGET_PHOTO, "--mask", TARGET_MASK, "--name", "f", "--landmarks", TLM, "--out", o1]);
  py([JUDGE, "--beauty", TARGET_PHOTO, "--mask", TARGET_MASK, "--name", "f", "--landmarks", TLM, "--out", o2]);
  const b1 = readFileSync(join(o1, "f.json")), b2 = readFileSync(join(o2, "f.json"));
  check("f-bytes", b1.equals(b2), b1.length + " bytes");
}

rmSync(tmp, { recursive: true, force: true });
if (failures.length) {
  console.log("FAILURES: " + failures.join(","));
  process.exit(1);
}
console.log("all cases a-f pass");
