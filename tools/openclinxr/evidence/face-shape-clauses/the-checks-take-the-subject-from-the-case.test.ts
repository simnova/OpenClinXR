import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * OBSERVABLE: the face checks take their subject from the case.
 * face-gate resolves its landmark model (--model > env > tree > store copy,
 * pinned sha256, refusal otherwise) and runs on aisha + body2; the shape
 * clauses cut eye crops from each subject's OWN render (landmarks detected
 * on that render) under the fixture rule and read thresholds from
 * shape-report.json instead of restating them.
 *
 * S = .openclinxr/realism-spike in worktree realism-95 (gitignored scratch).
 * Store = /Volumes/files/openclinxr-assets (subject renders + model copy).
 * Every number cites its file; reports live beside the two gates.
 */

const SHAPE_DIR = import.meta.dirname;
const GATE_DIR = join(SHAPE_DIR, "..", "face-gate");
const SHAPE_REPORT = join(SHAPE_DIR, "subject-report.json");
const GATE_REPORT = join(GATE_DIR, "subject-report.json");
const PIN_FILE = join(GATE_DIR, "landmark-model.json");
const STORE_PROBE = "/Volumes/files/openclinxr-assets/store/face-fit/face_landmarker.task";

const storePresent = existsSync(STORE_PROBE);
const suiteName = `the checks take the subject from the case ${storePresent ? "(store present)" : "(store absent)"}`;
const itStore = storePresent ? it : it.skip;

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function gitShow(refPath: string): string {
  return execFileSync("git", ["show", `origin/main:${refPath}`], {
    encoding: "utf8",
    timeout: 60000,
    cwd: join(SHAPE_DIR, "..", "..", "..", ".."),
  });
}

/** Numeric literals on module-constant lines + THRESHOLDS/INDICES blocks. */
function topNumbers(py: string): string[] {
  const lines = py.split("\n");
  const constLines = lines.filter((l) => /^[A-Z][A-Z0-9_]*(\s*,\s*[A-Z][A-Z0-9_]*)*\s*=(?!=)/.test(l));
  const blocks: string[] = [];
  for (const marker of ["THRESHOLDS = {", "INDICES = {"]) {
    const start = lines.findIndex((l) => l.startsWith(marker));
    if (start >= 0) {
      const end = lines.findIndex((l, i) => i > start && l === "}");
      blocks.push(lines.slice(start, end + 1).join("\n"));
    }
  }
  const text = [...constLines, ...blocks].join("\n");
  return text.match(/(?<![\w.])-?\d+(?:\.\d+)?(?![\w.])/g) ?? [];
}

function refusal(cmd: string[], model: string): { status: number; stderr: string } {
  try {
    execFileSync("python3", [...cmd, "--model", model], {
      encoding: "utf8",
      timeout: 120000,
    });
    return { status: 0, stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stderr?: string };
    return { status: err.status ?? -1, stderr: String(err.stderr ?? "") };
  }
}

describe(suiteName, () => {
  itStore("G1: face-gate ran on body2 and on aisha (exit 0 left a per-clause report)", () => {
    const rep = JSON.parse(readFileSync(GATE_REPORT, "utf8")) as {
      subjects: Record<string, {
        target: { path: string; sha256: string };
        render: { path: string; sha256: string };
        model: { path: string; sha256: string };
        detected: boolean;
        clauses: { clause: string; value: number; threshold: number; pass: boolean }[];
        skinPass: boolean;
        lightingPass: boolean;
      }>;
    };
    const pin = JSON.parse(readFileSync(PIN_FILE, "utf8")) as { sha256: string };
    for (const subject of ["aisha", "body2"]) {
      const s = rep.subjects[subject];
      expect(s.detected, `${subject}: no face detected`).toBe(true);
      // A fail is a result: clauses report pass OR fail, never missing.
      expect(s.clauses.length).toBeGreaterThan(0);
      for (const c of s.clauses) {
        expect(typeof c.value, `${subject}.${c.clause} value`).toBe("number");
        expect(typeof c.threshold, `${subject}.${c.clause} threshold`).toBe("number");
        expect(typeof c.pass, `${subject}.${c.clause} pass`).toBe("boolean");
      }
      // Model that measured this subject is the pinned one.
      expect(s.model.sha256, `${subject} model sha`).toBe(pin.sha256);
      // The report describes the bytes on disk, not a memory.
      expect(sha256(s.render.path), `${subject} render sha`).toBe(s.render.sha256);
      expect(sha256(s.target.path), `${subject} target sha`).toBe(s.target.sha256);
      expect(typeof s.skinPass).toBe("boolean");
      expect(typeof s.lightingPass).toBe("boolean");
    }
  });

  itStore("G2: subject mode reproduces the fixture values from the fixtures' own sources", () => {
    const rep = JSON.parse(readFileSync(SHAPE_REPORT, "utf8")) as {
      subjects: Record<string, {
        render: { path: string; sha256: string };
        eye_boxes: Record<string, number[]>;
      }>;
      known_good_reproduction: Record<string, {
        box: number[];
        value: number;
        recorded: number;
        diff: number;
        [k: string]: unknown;
      }>;
    };
    const kg = rep.known_good_reproduction;
    // shape-report.json noise is 0.0; recorded anchors are 6dp-rounded, so
    // byte-identical crops reproduce within 1e-6; the measured diff is stated.
    for (const [key, byteKey] of [
      ["lid_good", "crop_byte_equal_fixture"],
      ["lid_bad", "crop_byte_equal_fixture"],
      ["tint_good", "post_crop_byte_equal_fixture"],
      ["tint_bad", "post_crop_byte_equal_fixture"],
    ] as const) {
      expect(kg[key][byteKey], `${key} crop bytes`).toBe(true);
      expect(Math.abs(kg[key].diff), `${key} diff`).toBeLessThanOrEqual(1e-6);
    }
    expect(kg["lid_good"].recorded).toBe(0.0);
    expect(kg["lid_bad"].recorded).toBe(0.322581);
    expect(kg["tint_good"].recorded).toBe(0.092878);
    expect(kg["tint_bad"].recorded).toBe(0.559168);
    // Subject entries describe the bytes on disk.
    for (const subject of ["aisha", "body2"]) {
      expect(
        sha256(rep.subjects[subject].render.path),
        `${subject} render sha`,
      ).toBe(rep.subjects[subject].render.sha256);
    }
  });

  it("G3 counterweight: no threshold value changes", () => {
    for (const rel of [
      "tools/openclinxr/evidence/face-shape-clauses/shape-report.json",
      "tools/openclinxr/evidence/face-gate/clause-sources.json",
    ]) {
      const abs = join(SHAPE_DIR, "..", "..", "..", "..", rel);
      expect(readFileSync(abs, "utf8"), `${rel} drifted`).toBe(gitShow(rel));
    }
    for (const rel of [
      "tools/openclinxr/evidence/face-shape-clauses/shape_clauses.py",
      "tools/openclinxr/evidence/face-gate/face_gate.py",
      "tools/openclinxr/evidence/face-gate/face_gate_v2.py",
    ]) {
      const abs = join(SHAPE_DIR, "..", "..", "..", "..", rel);
      expect(
        topNumbers(readFileSync(abs, "utf8")),
        `${rel} top numeric constants drifted (threshold edit is a fail)`,
      ).toEqual(topNumbers(gitShow(rel)));
    }
  });

  itStore("G4 counterweight: the subject run reads landmarks detected on the subject's render", () => {
    const rep = JSON.parse(readFileSync(SHAPE_REPORT, "utf8")) as {
      subjects: Record<string, { eye_boxes: Record<string, number[]> }>;
    };
    const a = JSON.stringify(rep.subjects["aisha"].eye_boxes);
    const b = JSON.stringify(rep.subjects["body2"].eye_boxes);
    // A crop copied from Aisha fails here: identical boxes = shared landmarks.
    expect(a, "body2 eye boxes equal the aisha eye boxes").not.toBe(b);
    expect(rep.subjects["aisha"].eye_boxes["A"]).not.toEqual(
      rep.subjects["body2"].eye_boxes["A"],
    );
  });

  it("G5: the model refusal (missing file and wrong sha both refuse)", () => {
    const dir = mkdtempSync(join(tmpdir(), "checks-case-"));
    const wrong = join(dir, "wrong.task");
    writeFileSync(wrong, "not a landmark model");
    const missing = join(dir, "missing.task");
    const gateOut = join(dir, "out");
    const target = JSON.parse(readFileSync(GATE_REPORT, "utf8")) as {
      subjects: Record<string, { target: { path: string }; render: { path: string } }>;
    };
    const t = target.subjects["body2"].target.path;
    const r = target.subjects["body2"].render.path;
    const shapeOut = join(dir, "shape.json");
    const cases: [string, string[]][] = [
      ["face_gate missing", ["face_gate.py", "--target", t, "--render", r, "--out", gateOut]],
      ["face_gate wrong-sha", ["face_gate.py", "--target", t, "--render", r, "--out", gateOut]],
      ["face_gate_v2 missing", ["face_gate_v2.py", "--target", t, "--render", r, "--out", gateOut]],
      ["face_gate_v2 wrong-sha", ["face_gate_v2.py", "--target", t, "--render", r, "--out", gateOut]],
      ["shape_clauses missing", ["shape_clauses.py", "--subject", "probe", "--render", r, "--out", shapeOut]],
      ["shape_clauses wrong-sha", ["shape_clauses.py", "--subject", "probe", "--render", r, "--out", shapeOut]],
    ];
    for (const [name, cmd] of cases) {
      const script = cmd[0].endsWith("shape_clauses.py") ? join(SHAPE_DIR, cmd[0]) : join(GATE_DIR, cmd[0]);
      const model = name.endsWith("missing") ? missing : wrong;
      const got = refusal([script, ...cmd.slice(1)], model);
      expect(got.status, `${name} exited 0`).not.toBe(0);
      expect(got.stderr, `${name} refusal names no path`).toMatch(/face landmark model/);
      expect(got.stderr, `${name} refusal does not name ${model}`).toContain(model);
    }
  });
});
