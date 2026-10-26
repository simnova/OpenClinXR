import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const DIR = path.dirname(fileURLToPath(import.meta.url));

// Portable repo-root discovery: canonical layout is
// <root>/tools/openclinxr/asset-pipeline/skin/coherent-normal (5 parents);
// otherwise walk up until the workspace marker is found.
function findRepoRoot() {
  if (process.env.OPENCLINXR_REPO) return process.env.OPENCLINXR_REPO;
  const marker = path.join("apps", "ui-xr", "public", "generated-humanoids");
  const canonical = path.resolve(DIR, "..", "..", "..", "..", "..");
  if (existsSync(path.join(canonical, marker))) return canonical;
  let d = DIR;
  while (true) {
    if (existsSync(path.join(d, marker))) return d;
    const up = path.dirname(d);
    if (up === d) throw new Error("repo root marker not found");
    d = up;
  }
}
const ROOT = findRepoRoot();
const GEN = path.join(ROOT, "apps", "ui-xr", "public", "generated-humanoids");

function glbJson(glbPath) {
  const b = readFileSync(glbPath);
  const jl = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + jl).toString("utf8"));
}

const CASES = [
  ["mpfb-family-partner-adult", "mpfb_skin_ed_chest_pain_spouse_adult"],
  ["mpfb-gown-adult-patient", "mpfb_skin_robert_reference"],
  ["mpfb-ob-patient-aisha", "mpfb_skin_ob_patient_aisha_v1"],
  ["mpfb-peds-patient-child", "mpfb_skin_peds_patient_child"],
];

describe("the coherent normal binds and replays byte-exact", () => {
  it("python binder guards pass (35 retained + 17 tangent guards)", () => {
    execFileSync(process.env.PYTHON ?? "python3", ["-m", "unittest", "discover", "-s", path.join(DIR, "tests")], { stdio: "inherit" });
  });
  it("procedural receipt passes through the actual binder", () => {
    execFileSync("python3", [path.join(DIR, "tests", "test_procedural_truthfulness.py"), "-v"], { stdio: "inherit" });
  });
  it("current repo actors bind normalTexture scale>=1 on the skin material", () => {
    for (const [actor, skinSub] of CASES) {
      const glbPath = path.join(GEN, `${actor}.glb`);
      if (!existsSync(glbPath)) throw new Error(`missing current actor: ${glbPath}`);
      const j = glbJson(glbPath);
      const si = j.materials.findIndex((m) => (m.name ?? "").includes(skinSub));
      if (si < 0) throw new Error(`skin material missing in ${actor}`);
      const nt = j.materials[si].normalTexture;
      if (!nt || !(nt.scale >= 1)) throw new Error(`normalTexture unbound in ${actor}`);
      if (nt.index == null || !j.textures[nt.index]) throw new Error(`texture missing in ${actor}`);
    }
  });
});
