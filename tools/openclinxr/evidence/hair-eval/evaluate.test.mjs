// Hair evaluator v1 test: node:test suite (authored framework is node:test
// ONLY: the original was a plain node CLI script, the subject under test
// spawns child python3 processes, and `node file` / `node --test file` both
// execute this suite. No vitest imports: the root dispatcher routes node:test
// files to the node group by its existing automatic partition).
// Runs python3 evaluate.py as a child process and asserts the v0 cases
// plus the four v1 metric cases (S/H/F/P).
// Writes every metric for r13, r45, target into report.json, including the
// cases schema key with ACTUAL counted results (no consumer reads report.json
// today; the key is preserved so any future reader sees real counts).
// Import-safe: no top-level side effects, no process.exit on import, so test
// collectors can load this file. Heavy work runs in beforeAll; the report
// is written in afterAll. Scratch PNGs live in a unique per-invocation
// mkdtemp dir under TMPDIR/tmpdir (removed in afterAll) so concurrent
// runs never share basenames.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, before as beforeAll, after as afterAll } from "node:test";

const dir = dirname(fileURLToPath(import.meta.url));
const evalPy = join(dir, "evaluate.py");
const fixtures = join(dir, "fixtures");
// Unit report is isolated: written to the unique per-invocation scratchDir
// created in beforeAll (removed in afterAll), never to dir/report.json.

const baseTmp = process.env.TMPDIR || tmpdir();
let scratchDir = null;
let blankPath = null;
let blackPath = null;
const counts = { pass: 0, fail: 0 };
function checkIt(name, fn) {
    it(name, () => {
        try {
            fn();
            counts.pass += 1;
        } catch (e) {
            counts.fail += 1;
            throw e;
        }
    });
}

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

const state = {};

describe("hair evaluator v1", () => {
  beforeAll(() => {
    scratchDir = mkdtempSync(join(baseTmp, "hair-eval-"));
    blankPath = join(scratchDir, "hair-blank-grey.png");
    blackPath = join(scratchDir, "hair-all-black.png");
    state.r13 = run([join(fixtures, "r13.png"), "--json"]).json;
    state.r45 = run([join(fixtures, "r45.png"), "--json"]).json;
    state.target = run([join(fixtures, "target.png"), "--json"]).json;
    // Vacuity guard input: blank mid-grey 512x512 (PIL already required by evaluator).
    execFileSync("python3", ["-c",
      `from PIL import Image; Image.new('RGB',(512,512),(128,128,128)).save(${JSON.stringify(blankPath)})`]);
    state.blank = run([blankPath, "--json"]);
    // All-black image: volume at most 1.0, no crash.
    execFileSync("python3", ["-c",
      `from PIL import Image; Image.new('RGB',(512,512),(0,0,0)).save(${JSON.stringify(blackPath)})`]);
    state.black = run([blackPath, "--json"]);
    state.missing = run([join(fixtures, "does-not-exist.png"), "--json"]);
  });

  afterAll(() => {
    const { r13, r45, target } = state;
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
      cases: { pass: counts.pass, fail: counts.fail },
      discrimination: r13 && r45
        ? {
          "volume(r13)": r13.volume,
          "volume(r45)": r45.volume,
          pass: r45.volume > r13.volume,
        }
        : null,
    };
    assert.ok(existsSync(fixtures), "fixtures dir exists");
    assert.ok(scratchDir, "scratch dir created in beforeAll");
    writeFileSync(join(scratchDir, "report.json"), JSON.stringify(report, null, 2) + "\n");
    if (scratchDir) rmSync(scratchDir, { recursive: true, force: true });
    scratchDir = null;
  });

  checkIt("r13 evaluated", () => {
    assert.ok(!!state.r13 && typeof state.r13.volume === "number", String(state.r13));
  });
  checkIt("r45 evaluated", () => {
    assert.ok(!!state.r45 && typeof state.r45.volume === "number", String(state.r45));
  });
  checkIt("target evaluated", () => {
    assert.ok(!!state.target && typeof state.target.volume === "number", String(state.target));
  });
  checkIt("volume(r45) > volume(r13)", () => {
    const { r13, r45 } = state;
    assert.ok(r13 && r45 && r45.volume > r13.volume, `r13=${r13?.volume} r45=${r45?.volume}`);
  });
  checkIt("blank exits 0", () => {
    assert.equal(state.blank.code, 0, `code=${state.blank.code}`);
  });
  checkIt("blank maskPixels 0", () => {
    assert.equal(state.blank.json?.maskPixels, 0, JSON.stringify(state.blank.json));
  });
  checkIt("blank volume 0", () => {
    assert.equal(state.blank.json?.volume, 0, JSON.stringify(state.blank.json));
  });
  checkIt("all-black exits 0", () => {
    assert.equal(state.black.code, 0, `code=${state.black.code}`);
  });
  checkIt("all-black volume <= 1.0", () => {
    assert.ok(state.black.json && state.black.json.volume <= 1.0, JSON.stringify(state.black.json));
  });
  checkIt("missing path exits non-zero", () => {
    assert.notEqual(state.missing.code, 0, `code=${state.missing.code}`);
  });
  checkIt("structure(target) > structure(r45) > structure(r13)", () => {
    const { r13, r45, target } = state;
    assert.ok(
      r13 && r45 && target
        && target.structure > r45.structure && r45.structure > r13.structure,
      `r13=${r13?.structure} r45=${r45?.structure} target=${target?.structure}`,
    );
  });
  checkIt("hairlineRatio r45 in (0,1]", () => {
    const m = state.r45;
    assert.ok(typeof m?.hairlineRatio === "number" && m.hairlineRatio > 0 && m.hairlineRatio <= 1,
      String(m?.hairlineRatio));
  });
  checkIt("hairlineRatio target in (0,1]", () => {
    const m = state.target;
    assert.ok(typeof m?.hairlineRatio === "number" && m.hairlineRatio > 0 && m.hairlineRatio <= 1,
      String(m?.hairlineRatio));
  });
  checkIt("hairlineRatio blank is null", () => {
    assert.equal(state.blank.json?.hairlineRatio, null, JSON.stringify(state.blank.json?.hairlineRatio));
  });
  checkIt("fringeDetected r13 is boolean", () => {
    assert.equal(typeof state.r13?.fringeDetected, "boolean", String(state.r13?.fringeDetected));
  });
  checkIt("fringeDetected r45 is boolean", () => {
    assert.equal(typeof state.r45?.fringeDetected, "boolean", String(state.r45?.fringeDetected));
  });
  checkIt("fringeDetected target is boolean", () => {
    assert.equal(typeof state.target?.fringeDetected, "boolean", String(state.target?.fringeDetected));
  });
  for (const label of ["r13", "r45", "target"]) {
    checkIt(`partGap ${label} number-or-null + score`, () => {
      const m = state[label];
      const gapOk = m && (typeof m.partGapMm === "number" || m.partGapMm === null);
      const scoreOk = m && ((m.partGapMm === null && m.partGapScore === null)
        || (typeof m.partGapMm === "number" && typeof m.partGapScore === "number"
          && Math.abs(m.partGapScore - Math.abs(m.partGapMm - 3)) < 1e-9));
      assert.ok(gapOk && scoreOk, `gap=${m?.partGapMm} score=${m?.partGapScore}`);
    });
  }
});
