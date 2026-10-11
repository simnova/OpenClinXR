// Hair evaluator v1 test: plain node script, no dependencies.
// Runs python3 evaluate.py as a child process and asserts the v0 cases
// plus the four v1 metric cases (S/H/F/P).
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

// (S) structure ordering: target > r45 > r13 (falsifiable; attempt history
// lives in findings.txt and report.json negative.attempts)
check(
  "structure(target) > structure(r45) > structure(r13)",
  r13 && r45 && target
    && target.structure > r45.structure && r45.structure > r13.structure,
  `r13=${r13?.structure} r45=${r45?.structure} target=${target?.structure}`
);

// (H) hairlineRatio: number in (0,1] for r45 and target; null (not 0) for blank
const hlInRange = (m) => typeof m?.hairlineRatio === "number"
  && m.hairlineRatio > 0 && m.hairlineRatio <= 1;
check("hairlineRatio r45 in (0,1]", hlInRange(r45), String(r45?.hairlineRatio));
check("hairlineRatio target in (0,1]", hlInRange(target), String(target?.hairlineRatio));
check("hairlineRatio blank is null",
  blank.json && blank.json.hairlineRatio === null,
  JSON.stringify(blank.json?.hairlineRatio));

// (F) fringeDetected is a boolean for all three fixtures
for (const [label, m] of [["r13", r13], ["r45", r45], ["target", target]]) {
  check(`fringeDetected ${label} is boolean`,
    typeof m?.fringeDetected === "boolean", String(m?.fringeDetected));
}

// (P) partGapMm number-or-null per fixture; partGapScore matches accordingly
for (const [label, m] of [["r13", r13], ["r45", r45], ["target", target]]) {
  const gapOk = m && (typeof m.partGapMm === "number" || m.partGapMm === null);
  const scoreOk = m && ((m.partGapMm === null && m.partGapScore === null)
    || (typeof m.partGapMm === "number" && typeof m.partGapScore === "number"
      && Math.abs(m.partGapScore - Math.abs(m.partGapMm - 3)) < 1e-9));
  check(`partGap ${label} number-or-null + score`, gapOk && scoreOk,
    `gap=${m?.partGapMm} score=${m?.partGapScore}`);
}

const negative = {
  attempts: [
    {
      formula: "mean over erode(mask,3px) of (hp/local)^2, hp=lum-gauss(lum,2), local=gauss(lum,8)+0.02",
      targetValue: 0.012843415518896053,
      r45Value: 0.003918973999809881,
      r13Value: 0.014370619514376586,
    },
  ],
};

const report = {
  r13,
  r45,
  target,
  structure: {
    r13: r13 ? r13.structure : null,
    r45: r45 ? r45.structure : null,
    target: target ? target.structure : null,
  },
  hairlineRatio: {
    r13: r13 ? r13.hairlineRatio : null,
    r45: r45 ? r45.hairlineRatio : null,
    target: target ? target.hairlineRatio : null,
  },
  fringeDetected: {
    r13: r13 ? r13.fringeDetected : null,
    r45: r45 ? r45.fringeDetected : null,
    target: target ? target.fringeDetected : null,
  },
  partGapMm: {
    r13: r13 ? r13.partGapMm : null,
    r45: r45 ? r45.partGapMm : null,
    target: target ? target.partGapMm : null,
  },
  partGapScore: {
    r13: r13 ? r13.partGapScore : null,
    r45: r45 ? r45.partGapScore : null,
    target: target ? target.partGapScore : null,
  },
  negative,
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
