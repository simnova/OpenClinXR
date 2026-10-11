// Hair evaluator v0 test: plain node script, no dependencies.
// Runs python3 evaluate.py as a child process and asserts four cases.
// Writes every metric for r13, r45, target into report.json.
import { execFileSync } from "node:child_process";
import { writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const evalPy = join(dir, "evaluate.py");
const fixtures = join(dir, "fixtures");
const reportPath = join(dir, "report.json");

function run(args) {
  try {
    const out = execFileSync("python3", [evalPy, ...args], { encoding: "utf8" });
    return { code: 0, json: JSON.parse(out) };
  } catch (err) {
    let json = null;
    try {
      json = JSON.parse(String(err.stdout || ""));
    } catch {
      json = null;
    }
    return { code: err.status ?? 1, json };
  }
}

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) {
    pass += 1;
    console.log(`ok: ${name}`);
  } else {
    fail += 1;
    console.log(`FAIL: ${name} :: ${detail}`);
  }
}

const r13 = run([join(fixtures, "r13.png"), "--json"]).json;
const r45 = run([join(fixtures, "r45.png"), "--json"]).json;
const target = run([join(fixtures, "target.png"), "--json"]).json;

for (const [label, m] of [["r13", r13], ["r45", r45], ["target", target]]) {
  check(`${label} evaluated`, !!m && typeof m.volume === "number", String(m));
}

// (1) discrimination test: r45 has visibly more hair mass than r13
check(
  "volume(r45) > volume(r13)",
  r13 && r45 && r45.volume > r13.volume,
  `r13=${r13?.volume} r45=${r45?.volume}`
);

// (2) vacuity guard: blank mid-grey image -> maskPixels 0, exit 0, volume 0
// Generate blank mid-grey 512x512 via python (PIL already required by evaluator)
execFileSync("python3", ["-c",
  "from PIL import Image; Image.new('RGB',(512,512),(128,128,128)).save('/tmp/hair-blank-grey.png')"]);
const blank = run(["/tmp/hair-blank-grey.png", "--json"]);
check("blank exits 0", blank.code === 0, `code=${blank.code}`);
check("blank maskPixels 0", blank.json && blank.json.maskPixels === 0,
  JSON.stringify(blank.json));
check("blank volume 0", blank.json && blank.json.volume === 0,
  JSON.stringify(blank.json));
void 0;

// (3) all-black image: volume at most 1.0, no crash
execFileSync("python3", ["-c",
  "from PIL import Image; Image.new('RGB',(512,512),(0,0,0)).save('/tmp/hair-all-black.png')"]);
const black = run(["/tmp/hair-all-black.png", "--json"]);
check("all-black exits 0", black.code === 0, `code=${black.code}`);
check("all-black volume <= 1.0",
  black.json && black.json.volume <= 1.0,
  JSON.stringify(black.json));

// (4) missing path exits non-zero
const missing = run([join(fixtures, "does-not-exist.png"), "--json"]);
check("missing path exits non-zero", missing.code !== 0, `code=${missing.code}`);

const report = {
  r13,
  r45,
  target,
  structure: {
    r13: r13 ? r13.structure : null,
    r45: r45 ? r45.structure : null,
    target: target ? target.structure : null,
  },
  cases: { pass, fail: fail + 0 },
  discrimination: r13 && r45
    ? { "volume(r13)": r13.volume, "volume(r45)": r45.volume,
        pass: r45.volume > r13.volume }
    : null,
};
if (!existsSync(fixtures)) {
  check("fixtures dir exists", false, "missing");
}
writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(`report: ${reportPath} pass=${pass} fail=${fail}`);

process.exit(fail === 0 ? 0 : 1);
