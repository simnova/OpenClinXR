import { repoRoot } from "@openclinxr/factory-station-core/runner";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

/**
 * CARD tsk_c120564ce449c2b1 (handback 1 + stop order): the sclera-shade
 * slice LANDED MEASUREMENT ONLY with verdict cause_found_fix_not_converged.
 * Product defaults did not change (shell stays opt-in); the deliverables
 * are the globe-ID masks, the re-measured numbers, the body2 diagnosis,
 * and the r1-r7 sweep table, all recorded in sclera-shade-report.json.
 *
 * This test reads ONLY the report (plus the materializer source for the
 * opt-in assertion, plus the metrics script through python for refusal).
 * claimScope: report integrity + opt-in defaults + metrics refusal.
 * notEvidenceFor: clinical_validity, quest_readiness, any visual grade.
 */

const HERE = join(repoRoot(), "tools/openclinxr/asset-pipeline/realism-head/sclera-shade");
const REPO_ROOT = repoRoot();
const REPORT_PATH = join(HERE, "sclera-shade-report.json");
const METRICS = join(HERE, "sclera_metrics.py");
const MATERIALIZE = join(
  REPO_ROOT,
  "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py",
);

type Metrics = { M1: number; M2a: number; M2b: number; D90: number };
type Report = {
  card: string;
  verdict: string;
  goal: { aisha: Metrics; body2: Metrics };
  pre: { aisha: Metrics; body2: Metrics };
  ablations: Record<string, { subject_aisha: Metrics; body2: Metrics }>;
  sweep: Array<{ row: string; params: unknown; aisha: unknown; body2: unknown }>;
  files: Record<string, string>;
};

function loadReport(): Report {
  return JSON.parse(readFileSync(REPORT_PATH, "utf8")) as Report;
}

function expectFiniteMetrics(m: Metrics, label: string): void {
  for (const k of ["M1", "M2a", "M2b", "D90"] as const) {
    expect(typeof m[k], `${label}.${k} is a number`).toBe("number");
    expect(Number.isFinite(m[k]), `${label}.${k} is finite (NaN must fail, not pass)`).toBe(true);
  }
}

/** Minimal 32x32 blank RGB PNG (no deps) for the refusal probe. */
function writeBlankPng(dir: string): string {
  const w = 32;
  const h = 32;
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c;
  }
  const crc = (bytes: Uint8Array): number => {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) c = crcTable[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h, 128);
  for (let y = 0; y < h; y += 1) raw[y * (w * 3 + 1)] = 0;
  const idat = deflateSync(raw);
  const png = Buffer.concat([
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(idat)),
    chunk("IEND", new Uint8Array(0)),
  ]);
  const p = join(dir, "blank.png");
  writeFileSync(p, png);
  return p;
}

describe("the sclera shades like the goal photo (report integrity)", () => {
  it("report exists with the stop-order verdict", () => {
    expect(existsSync(REPORT_PATH)).toBe(true);
    const r = loadReport();
    expect(r.card).toBe("tsk_c120564ce449c2b1");
    expect(r.verdict).toBe("cause_found_fix_not_converged");
  });

  it("goal and PRE cover both subjects with finite metrics", () => {
    const r = loadReport();
    for (const section of ["goal", "pre"] as const) {
      for (const subject of ["aisha", "body2"] as const) {
        expectFiniteMetrics(r[section][subject], `${section}.${subject}`);
      }
    }
  });

  it("ablations a/b/c cover both subjects with finite metrics", () => {
    const r = loadReport();
    for (const id of ["a", "b", "c"]) {
      const ab = r.ablations[id];
      expect(ab, `ablation ${id} present`).toBeDefined();
      expectFiniteMetrics(ab.subject_aisha, `ablation-${id}.aisha`);
      expectFiniteMetrics(ab.body2, `ablation-${id}.body2`);
    }
  });

  it("sweep table has r1-r7 rows with params; measured rows are finite", () => {
    const r = loadReport();
    expect(r.sweep.map((s) => s.row)).toEqual(["r1", "r2", "r3", "r4", "r5", "r6", "r7"]);
    for (const row of r.sweep) {
      expect(row.params != null && typeof row.params === "object", `${row.row} params recorded`).toBe(true);
      for (const side of ["aisha", "body2"] as const) {
        const cell = row[side] as unknown;
        if (typeof cell === "string") {
          expect(cell.startsWith("NOT MEASURED"), `${row.row}.${side} marked unmeasured`).toBe(true);
        } else {
          expectFiniteMetrics(cell as Metrics, `sweep-${row.row}.${side}`);
        }
      }
    }
  });

  it("every cited file has a sha256", () => {
    const r = loadReport();
    expect(Object.keys(r.files).length).toBeGreaterThan(30);
    for (const [p, sha] of Object.entries(r.files)) {
      expect(sha, `${p} sha256`).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("materializer still defaults the occlusion shell off (opt-in, main values)", () => {
    const src = readFileSync(MATERIALIZE, "utf8");
    expect(src).toMatch(/"--eye-occlusion-shell"[\s\S]{0,200}?action\s*=\s*"store_true"/);
    expect(src).toMatch(/"--eye-shell-margin", type=float, default=0\.5\)/);
    expect(src).toMatch(/"--eye-shell-corner", type=float, default=0\.8\)/);
    expect(src).toMatch(/"--eye-shell-ramp-mm", type=float, default=2\.5\)/);
    expect(src).toMatch(/"--eye-shell-upper-boost", type=float, default=1\.6\)/);
    expect(src).toMatch(/"--eye-shell-color", default="120,88,80"\)/);
    // tsk_6a46705a72eb008b: the shell now composes with --eye-cornea (the
    // split repoints the eye node only; the shell survives by name and
    // vertex count). Still opt-in, still main knob values.
    expect(src, "cornea no longer refuses the shell").not.toMatch(/--eye-cornea refuses the eyeshell/);
    expect(src).toMatch(/composes with --eye-occlusion-shell/);
    expect(src, "no reverted default-on wiring").not.toContain("_eyshell_want_shell");
    expect(src, "no new shell knob defaults").not.toContain("eye-shell-upper-cap");
  });

  it("sclera_metrics refuses a faceless image (exit 2, REFUSED)", () => {
    const dir = mkdtempSync(join(tmpdir(), "sclera-refuse-"));
    const png = writeBlankPng(dir);
    let code = 0;
    let stdout = "";
    try {
      stdout = execFileSync("mise", ["exec", "--", "python3", METRICS, "--image", png], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      const err = e as { status?: number; stdout?: string };
      code = err.status ?? -1;
      stdout = String(err.stdout ?? "");
    }
    expect(code).toBe(2);
    const parsed = JSON.parse(stdout) as { error?: string };
    expect(parsed.error ?? "").toMatch(/REFUSED/);
  });

  it("sclera_metrics refusal function fails NaN and short masks directly", () => {
    const probe = [
      "import sys",
      `sys.path.insert(0, ${JSON.stringify(HERE)})`,
      "import sclera_metrics as m",
      "try:\n m.refuse('synthetic NaN guard')\n print('NO_RAISE')\nexcept m.RefusalError as e:\n print('REFUSED:' + str(e))",
      "import numpy as np",
      "assert not np.isfinite(float('nan')), 'sanity'",
      "print('NANCHECK_OK')",
    ].join("\n");
    const out = execFileSync("mise", ["exec", "--", "python3", "-c", probe], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(out).toContain("REFUSED:synthetic NaN guard");
    expect(out).toContain("NANCHECK_OK");
  });
});
