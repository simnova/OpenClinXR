// Tests for show_through_id.py (hair-part-1 M5 / G6).
// Three fixtures on a 1024 frame with skull landmarks 103,583,512
// (H=480, brow = 103 + 0.40*480 = 295):
//   1. solid sheet            -> ID show-through < 1%
//   2. sheet + 30px bald stripe at the part (enclosed by hair) -> > 5%
//   3. sheet with a face opening (gap containing the brow-row centre) -> opening not counted (< 1%)
// Usage: node tools/openclinxr/evidence/hair-part/test_show_through.mjs
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const E = dirname(fileURLToPath(import.meta.url));
const CLI = join(E, "show_through_id.py");
const LM = "103,583,512";
const tmp = mkdtempSync(join(tmpdir(), "stid-test-"));
const failures = [];

function check(id, cond, detail) {
  console.log((cond ? "PASS" : "FAIL") + " " + id + (detail ? " :: " + detail : ""));
  if (!cond) failures.push(id);
}

const GEN = `
from PIL import Image
import numpy as np, sys
tmp = sys.argv[1]
def sheet():
    a = np.zeros((1024, 1024), np.uint8)
    a[127:608, 400:625] = 255
    return a
def save(a, name):
    rgb = np.zeros((1024, 1024, 3), np.uint8) + 128
    rgba = np.dstack([rgb, a])
    Image.fromarray(rgba, "RGBA").save(tmp + "/" + name)
save(sheet(), "solid.png")
b = sheet(); b[150:270, 497:527] = 0
save(b, "stripe.png")
c = np.zeros((1024, 1024), np.uint8)
c[127:608, 400:501] = 255
c[127:608, 524:625] = 255
save(c, "opening.png")
print("fixtures ok")
`;
writeFileSync(join(tmp, "gen.py"), GEN);
console.log(execFileSync("python3", [join(tmp, "gen.py"), tmp], { encoding: "utf8" }).trim());

function run(mask) {
  const out = execFileSync("python3", [CLI, "--mask", mask, "--landmarks", LM, "--json"], { encoding: "utf8" });
  return JSON.parse(out);
}

const solid = run(join(tmp, "solid.png"));
check("solid-low", solid.fraction < 0.01, `fraction=${solid.fraction} region=${solid.region_px}`);

const stripe = run(join(tmp, "stripe.png"));
check("stripe-high", stripe.fraction > 0.05, `fraction=${stripe.fraction} region=${stripe.region_px}`);

const opening = run(join(tmp, "opening.png"));
check("opening-excluded", opening.fraction < 0.01, `fraction=${opening.fraction} opening=${opening.opening_px} region=${opening.region_px}`);

rmSync(tmp, { recursive: true, force: true });
if (failures.length) {
  console.log("FAILURES: " + failures.join(","));
  process.exit(1);
}
console.log("all show-through cases pass");
