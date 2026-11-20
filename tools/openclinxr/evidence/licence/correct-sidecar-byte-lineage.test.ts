import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertLineageContinuity, lineageLevels } from "@openclinxr/factory-station-core/runner";
import { afterEach, describe, expect, it } from "vitest";
import { correctSidecarByteLineage, readPreImageBytes } from "./correct-sidecar-byte-lineage.js";

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const CLI = path.resolve("tools/openclinxr/evidence/licence/correct-sidecar-byte-lineage.ts");
const CANON_DIR = path.resolve(".openclinxr/evidence/scene-closure/sc-04/rederive");
const CANON_NAMES = ["nurse-rederive-report.json", "gown-rederive-report.json", "family-rederive-report.json"];

const created: string[] = [];
const prevOwn = process.env.OWN_JOB_TMP;
function track(p: string): string {
  created.push(p);
  return p;
}

afterEach(() => {
  for (const p of created.splice(0)) {
    try {
      rmSync(p, { recursive: true, force: true });
    } catch {
      /* cleanup best effort */
    }
  }
  if (prevOwn === undefined) delete process.env.OWN_JOB_TMP;
  else process.env.OWN_JOB_TMP = prevOwn;
});

function snap(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).sort() : ["<absent>"];
}

function gitShow(rev: string): Buffer {
  return execFileSync("git", ["show", rev], { maxBuffer: 64 * 1024 * 1024 });
}

function chainDepth(sidecar: string): number {
  let depth = 0;
  let cur = (JSON.parse(readFileSync(sidecar, "utf8")) as Record<string, unknown>)["byteLineage"] as unknown;
  while (cur !== null && typeof cur === "object" && !Array.isArray(cur)) {
    depth += 1;
    const recordedBefore = (cur as Record<string, unknown>)["recordedBefore"] as unknown;
    const next =
      recordedBefore !== null && typeof recordedBefore === "object" && !Array.isArray(recordedBefore)
        ? (recordedBefore as Record<string, unknown>)["byteLineage"]
        : undefined;
    cur = next;
  }
  return depth;
}

function makeChildScript(dir: string): string {
  const p = path.join(dir, "child-copy.mjs");
  writeFileSync(
    p,
    `import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";\nimport path from "node:path";\n`
      + `const a = Object.fromEntries([["input",process.argv[3]],["out",process.argv[5]],["report",process.argv[7]]]);\n`
      + `const root = process.env.OWN_JOB_TMP ?? "";\n`
      + `for (const k of ["report","out"]) { const r = path.resolve(a[k] ?? "");\n`
      + `if (!root || !r.startsWith(path.resolve(root)+path.sep)) { console.error("refuse outside job tmp"); process.exit(3); } }\n`
      + `mkdirSync(path.dirname(a.report),{recursive:true}); copyFileSync(a.input,a.out);\n`
      + `writeFileSync(a.report, JSON.stringify({ok:true}));\n`,
  );
  return p;
}

function canonSnapshot(): Map<string, string | null> {
  const m = new Map<string, string | null>();
  for (const n of CANON_NAMES) {
    const p = path.join(CANON_DIR, n);
    m.set(n, existsSync(p) ? sha256(readFileSync(p)) : null);
  }
  return m;
}

describe("correct-sidecar-byte-lineage writer isolation", () => {
  it("byte equality updates only own sidecar; mismatch leaves own sidecar unchanged", () => {
    const job = track(mkdtempSync(path.join(tmpdir(), "sc04-iso-")));
    process.env.OWN_JOB_TMP = job;
    const beforeCanon = canonSnapshot();
    const fixture = gitShow("HEAD:package.json");
    // Fixture bytes are arbitrary (HEAD:package.json); .glb satisfies basename(path,".glb").
    const shipped = path.join(job, "shipped.glb");
    writeFileSync(shipped, fixture);
    const sidecar = path.join(job, "own.provenance.json");
    writeFileSync(sidecar, JSON.stringify({ outputSha256: "old", outputBytes: 1 }));
    const child = makeChildScript(job);
    const callDir = track(mkdtempSync(path.join(job, "call-")));
    const preRev = "HEAD:package.json";
    const r = correctSidecarByteLineage({
      assetPath: shipped,
      provenancePath: sidecar,
      preImage: { kind: "revision", revision: preRev },
      expectedPreImageSha256: sha256(fixture),
      derivationArgv: ["node", child, "--input", "{pre}", "--out", "{out}", "--report", "{report}"],
      why: "isolation test",
      workingDirectory: callDir,
    });
    expect(r.reproduced).toBe(true);
    expect(r.sha256).toBe(sha256(fixture));
    expect(JSON.parse(readFileSync(sidecar, "utf8")).outputSha256).toBe(sha256(fixture));
    const children = readdirSync(callDir).filter((n: string) => n.startsWith("shipped-"));
    expect(children.length).toBe(1);
    expect(existsSync(path.join(callDir, children[0]!, "shipped-report.json"))).toBe(true);
    const firstReport = readFileSync(path.join(callDir, children[0]!, "shipped-report.json"));
    const firstPre = readFileSync(path.join(callDir, children[0]!, "shipped-pre.glb"));
    const firstOut = readFileSync(path.join(callDir, children[0]!, "shipped-rederived.glb"));
    writeFileSync(shipped, fixture);
    const r2 = correctSidecarByteLineage({
      assetPath: shipped,
      provenancePath: sidecar,
      preImage: { kind: "revision", revision: preRev },
      expectedPreImageSha256: sha256(fixture),
      derivationArgv: ["node", child, "--input", "{pre}", "--out", "{out}", "--report", "{report}"],
      why: "isolation test",
      workingDirectory: callDir,
    });
    expect(r2.reproduced).toBe(true);
    // Identical re-runs skip before derivation IO: no second child dir, first-run files byte-identical.
    const children2 = readdirSync(callDir).filter((n: string) => n.startsWith("shipped-"));
    expect(children2).toEqual(children);
    expect(readFileSync(path.join(callDir, children[0]!, "shipped-report.json")).equals(firstReport)).toBe(true);
    expect(readFileSync(path.join(callDir, children[0]!, "shipped-pre.glb")).equals(firstPre)).toBe(true);
    expect(readFileSync(path.join(callDir, children[0]!, "shipped-rederived.glb")).equals(firstOut)).toBe(true);
    const other = track(mkdtempSync(path.join(job, "call2-")));
    writeFileSync(shipped, Buffer.from("different-bytes"));
    const before = readFileSync(sidecar, "utf8");
    expect(() =>
      correctSidecarByteLineage({
        assetPath: shipped,
        provenancePath: sidecar,
        preImage: { kind: "revision", revision: preRev },
        expectedPreImageSha256: sha256(fixture),
        derivationArgv: ["node", child, "--input", "{pre}", "--out", "{out}", "--report", "{report}"],
        why: "isolation test",
        workingDirectory: other,
      }),
    ).toThrow();
    expect(readFileSync(sidecar, "utf8")).toBe(before);
    expect(canonSnapshot()).toEqual(beforeCanon);
  });

  it("library rejects blank workingDirectory before IO", () => {
    const job = track(mkdtempSync(path.join(tmpdir(), "sc04-blank-")));
    const shipped = path.join(job, "s.bin");
    writeFileSync(shipped, "x");
    for (const bad of ["", "   ", "-x"]) {
      expect(() =>
        correctSidecarByteLineage({
          assetPath: shipped,
          provenancePath: path.join(job, "p.json"),
          preImage: { kind: "revision", revision: "HEAD:package.json" },
          expectedPreImageSha256: sha256(gitShow("HEAD:package.json")),
          derivationArgv: ["node", "--version"],
          why: "t",
          workingDirectory: bad,
        }),
      ).toThrow(/working-directory/);
    }
  });

  it("child refuses report outside own job temp", () => {
    const job = track(mkdtempSync(path.join(tmpdir(), "sc04-refuse-")));
    process.env.OWN_JOB_TMP = job;
    const child = makeChildScript(job);
    const src = path.join(job, "a.bin");
    writeFileSync(src, "x");
    const outside = track(mkdtempSync(path.join(tmpdir(), "sc04-outside-")));
    const outsideReport = path.join(outside, "outside.json");
    let code = 0;
    try {
      execFileSync("node", [child, "--input", src, "--out", path.join(job, "o.bin"), "--report", outsideReport], {
        env: { ...process.env, OWN_JOB_TMP: job },
        stdio: "pipe",
      });
    } catch (e) {
      code = (e as { status?: number }).status ?? 1;
    }
    expect(code).toBe(3);
    expect(existsSync(outsideReport)).toBe(false);
  });

  it("H4a file source records preImageFile + preImageSha256 and no preImageRevision key", () => {
    const job = track(mkdtempSync(path.join(tmpdir(), "sc04-file-")));
    process.env.OWN_JOB_TMP = job;
    const fixture = gitShow("HEAD:package.json");
    const shipped = path.join(job, "shipped.glb");
    writeFileSync(shipped, fixture);
    const sidecar = path.join(job, "own.provenance.json");
    writeFileSync(sidecar, JSON.stringify({ outputSha256: "old", outputBytes: 1 }));
    const preFile = path.join(job, "pre.glb");
    writeFileSync(preFile, fixture);
    const child = makeChildScript(job);
    const callDir = track(mkdtempSync(path.join(job, "call-")));
    const r = correctSidecarByteLineage({
      assetPath: shipped,
      provenancePath: sidecar,
      preImage: { kind: "file", path: preFile },
      expectedPreImageSha256: sha256(fixture),
      derivationArgv: ["node", child, "--input", "{pre}", "--out", "{out}", "--report", "{report}"],
      why: "file-source lineage test",
      workingDirectory: callDir,
    });
    expect(r.reproduced).toBe(true);
    const lineage = (JSON.parse(readFileSync(sidecar, "utf8")) as Record<string, unknown>)["byteLineage"] as Record<string, unknown>;
    expect(lineage["preImageFile"]).toBe(preFile);
    expect(lineage["preImageSha256"]).toBe(sha256(fixture));
    expect("preImageRevision" in lineage).toBe(false);
    expect(readPreImageBytes({ kind: "file", path: preFile }).equals(fixture)).toBe(true);
  });

  it("H5 refuses before any write when the file changes after the gate read, naming both shas", () => {
    const job = track(mkdtempSync(path.join(tmpdir(), "sc04-h5-")));
    const before = gitShow("HEAD:package.json");
    const preFile = path.join(job, "pre.glb");
    writeFileSync(preFile, before);
    const gateSha = sha256(readPreImageBytes({ kind: "file", path: preFile }));
    // The gate checked gateSha; the file changes before the corrector reads.
    writeFileSync(preFile, Buffer.from("changed-after-gate"));
    const afterSha = sha256(readFileSync(preFile));
    const shipped = path.join(job, "shipped.glb");
    writeFileSync(shipped, before);
    const sidecar = path.join(job, "own.provenance.json");
    writeFileSync(sidecar, JSON.stringify({ outputSha256: "old", outputBytes: 1 }));
    const sidecarBefore = readFileSync(sidecar, "utf8");
    const child = makeChildScript(job);
    const callDir = track(mkdtempSync(path.join(job, "call-")));
    let message = "";
    try {
      correctSidecarByteLineage({
        assetPath: shipped,
        provenancePath: sidecar,
        preImage: { kind: "file", path: preFile },
        expectedPreImageSha256: gateSha,
        derivationArgv: ["node", child, "--input", "{pre}", "--out", "{out}", "--report", "{report}"],
        why: "h5 test",
        workingDirectory: callDir,
      });
    } catch (e) {
      message = String(e);
    }
    expect(message).toContain(gateSha);
    expect(message).toContain(afterSha);
    expect(message).toContain("--pre-image-file");
    expect(readFileSync(sidecar, "utf8")).toBe(sidecarBefore);
  });

  it("real CLI help/invalid cases leave cwd and canonical reports unchanged", () => {
    const cwd = track(mkdtempSync(path.join(tmpdir(), "sc04-clicwd-")));
    const beforeCanon = canonSnapshot();
    const beforeEntries = snap(cwd);
    const help = execFileSync("node", ["--experimental-strip-types", CLI, "--help"], { cwd, encoding: "utf8" });
    expect(help).toContain("--working-directory");
    expect(snap(cwd)).toEqual(beforeEntries);
    for (const args of [[], ["--working-directory", ""], ["--working-directory", "   "], ["--working-directory", "--other-flag"]] as string[][]) {
      let err = "";
      let failed = false;
      try {
        execFileSync("node", ["--experimental-strip-types", CLI, ...args], { cwd, encoding: "utf8", stdio: "pipe" });
      } catch (e) {
        failed = true;
        err = String((e as { stderr?: unknown }).stderr ?? e);
      }
      expect(failed).toBe(true);
      expect(err).toMatch(/working-directory/);
      expect(snap(cwd)).toEqual(beforeEntries);
    }
    expect(canonSnapshot()).toEqual(beforeCanon);
  });

  it("h5 S2 refuses before any write when the pre-image digest != the reviewed preImageSha256", () => {
    const job = track(mkdtempSync(path.join(tmpdir(), "sc04-h5-pre-")));
    process.env.OWN_JOB_TMP = job;
    const fixture = gitShow("HEAD:package.json");
    const shipped = path.join(job, "shipped.glb");
    writeFileSync(shipped, fixture);
    const sidecar = path.join(job, "own.provenance.json");
    writeFileSync(sidecar, JSON.stringify({ outputSha256: "old", outputBytes: 1 }));
    const sidecarBefore = readFileSync(sidecar, "utf8");
    const child = makeChildScript(job);
    const callDir = track(mkdtempSync(path.join(job, "call-")));
    expect(() =>
      correctSidecarByteLineage({
        assetPath: shipped,
        provenancePath: sidecar,
        preImage: { kind: "revision", revision: "HEAD:package.json" },
        expectedPreImageSha256: sha256(fixture),
        preImageSha256: "0".repeat(64),
        outputSha256: sha256(fixture),
        derivationArgv: ["node", child, "--input", "{pre}", "--out", "{out}", "--report", "{report}"],
        why: "h5 pre-literal refusal test",
        workingDirectory: callDir,
      }),
    ).toThrow(/reviewed row pins/);
    expect(readFileSync(sidecar, "utf8"), "refused correction writes nothing").toBe(sidecarBefore);
  });

  it("h5 S2 refuses before any write when the re-derived digest != the reviewed outputSha256", () => {
    const job = track(mkdtempSync(path.join(tmpdir(), "sc04-h5-out-")));
    process.env.OWN_JOB_TMP = job;
    const fixture = gitShow("HEAD:package.json");
    const shipped = path.join(job, "shipped.glb");
    writeFileSync(shipped, fixture);
    const sidecar = path.join(job, "own.provenance.json");
    writeFileSync(sidecar, JSON.stringify({ outputSha256: "old", outputBytes: 1 }));
    const sidecarBefore = readFileSync(sidecar, "utf8");
    const child = makeChildScript(job);
    const callDir = track(mkdtempSync(path.join(job, "call-")));
    expect(() =>
      correctSidecarByteLineage({
        assetPath: shipped,
        provenancePath: sidecar,
        preImage: { kind: "revision", revision: "HEAD:package.json" },
        expectedPreImageSha256: sha256(fixture),
        preImageSha256: sha256(fixture),
        outputSha256: "f".repeat(64),
        derivationArgv: ["node", child, "--input", "{pre}", "--out", "{out}", "--report", "{report}"],
        why: "h5 output-literal refusal test",
        workingDirectory: callDir,
      }),
    ).toThrow(/reviewed row pins output/);
    expect(readFileSync(sidecar, "utf8"), "refused correction writes nothing").toBe(sidecarBefore);
  });
});

describe("correct-sidecar-byte-lineage nesting + idempotence (e9-r2lineage)", () => {
  function runOnce(job: string, sidecar: string, callDir: string, fixture: Buffer, argv: string[]) {
    return correctSidecarByteLineage({
      assetPath: path.join(job, "shipped.glb"),
      provenancePath: sidecar,
      preImage: { kind: "revision", revision: "HEAD:package.json" },
      expectedPreImageSha256: sha256(fixture),
      derivationArgv: argv,
      why: "e9-r2lineage nesting test",
      workingDirectory: callDir,
    });
  }

  it("nesting: a prior byteLineage is preserved under recordedBefore.byteLineage", () => {
    const job = track(mkdtempSync(path.join(tmpdir(), "sc04-nest-")));
    process.env.OWN_JOB_TMP = job;
    const fixture = gitShow("HEAD:package.json");
    writeFileSync(path.join(job, "shipped.glb"), fixture);
    const prior = {
      correctedBy: "prior-test",
      correctedAt: "2026-01-01T00:00:00.000Z",
      recordedBefore: { outputSha256: "older", outputBytes: 1 },
      preImageSha256: "aaa",
      derivationArgv: ["x"],
      reproduction: "prior",
      why: "prior",
    };
    const sidecar = path.join(job, "own.provenance.json");
    writeFileSync(sidecar, JSON.stringify({ outputSha256: "prev-sha", outputBytes: 7, byteLineage: prior }));
    const child = makeChildScript(job);
    const callDir = track(mkdtempSync(path.join(job, "call-")));
    const argv = ["node", child, "--input", "{pre}", "--out", "{out}", "--report", "{report}"];
    const r = runOnce(job, sidecar, callDir, fixture, argv);
    expect(r.reproduced).toBe(true);
    const after = JSON.parse(readFileSync(sidecar, "utf8")) as Record<string, unknown>;
    const lineage = after["byteLineage"] as Record<string, unknown>;
    expect(lineage["recordedBefore"]).toMatchObject({ outputSha256: "prev-sha", outputBytes: 7 });
    expect((lineage["recordedBefore"] as Record<string, unknown>)["byteLineage"]).toEqual(prior);
    expect(chainDepth(sidecar)).toBe(2);
  });

  it("idempotence: re-running the identical correction adds no level", () => {
    const job = track(mkdtempSync(path.join(tmpdir(), "sc04-idem-")));
    process.env.OWN_JOB_TMP = job;
    const fixture = gitShow("HEAD:package.json");
    writeFileSync(path.join(job, "shipped.glb"), fixture);
    const sidecar = path.join(job, "own.provenance.json");
    writeFileSync(sidecar, JSON.stringify({ outputSha256: "old", outputBytes: 1 }));
    const child = makeChildScript(job);
    const callDir = track(mkdtempSync(path.join(job, "call-")));
    const argv = ["node", child, "--input", "{pre}", "--out", "{out}", "--report", "{report}"];
    runOnce(job, sidecar, callDir, fixture, argv);
    const file1 = readFileSync(sidecar, "utf8");
    const sha1 = sha256(Buffer.from(file1));
    const depth1 = chainDepth(sidecar);
    const r2 = runOnce(job, sidecar, callDir, fixture, argv);
    expect(r2.reproduced).toBe(true);
    const file2 = readFileSync(sidecar, "utf8");
    const sha2 = sha256(Buffer.from(file2));
    const depth2 = chainDepth(sidecar);
    expect(depth2).toBe(depth1);
    // Identical correction leaves the file byte-identical (no timestamp bump, no new level).
    expect(sha2).toBe(sha1);
    expect(file2).toBe(file1);
  });

  function writeProveChild(dir: string, name: string, marker: string, fail: boolean): string {
    const p = path.join(dir, name);
    const body = fail ? "process.exit(1)" : "copyFileSync(process.argv[2],process.argv[3])";
    writeFileSync(p, `import{copyFileSync,writeFileSync}from"node:fs";\nwriteFileSync(${JSON.stringify(marker)},"r");\n${body};\n`);
    return p;
  }

  it("same-transition re-proof RUNS the derivation: reproduce -> no write, failure -> throw", () => {
    const job = track(mkdtempSync(path.join(tmpdir(), "sc04-rp-")));
    const fixture = gitShow("HEAD:package.json");
    const shipped = path.join(job, "shipped.glb");
    writeFileSync(shipped, fixture);
    const sidecar = path.join(job, "own.provenance.json");
    writeFileSync(sidecar, JSON.stringify({ outputSha256: "old", outputBytes: 1 }));
    const callDir = track(mkdtempSync(path.join(job, "call-")));
    const base = writeProveChild(job, "base.mjs", path.join(job, "b.marker"), false);
    runOnce(job, sidecar, callDir, fixture, ["node", base, "{pre}", "{out}"]);
    const file1 = readFileSync(sidecar, "utf8");
    const runChanged = (name: string, fail: boolean) => {
      const marker = path.join(job, `${name}.marker`);
      const child = writeProveChild(job, `${name}.mjs`, marker, fail);
      let message = "";
      let reproduced = false;
      try {
        reproduced = correctSidecarByteLineage({
          assetPath: shipped,
          provenancePath: sidecar,
          preImage: { kind: "revision", revision: "HEAD:package.json" },
          expectedPreImageSha256: sha256(fixture),
          derivationArgv: ["node", child, "{pre}", "{out}"],
          why: `re-proof changed ${fail ? "failing" : "reproducing"} command`,
          workingDirectory: callDir,
        }).reproduced;
      } catch (e) {
        message = String(e);
      }
      return { marker, reproduced, message };
    };
    const ok = runChanged("repro", false);
    expect(ok.reproduced).toBe(true);
    expect(existsSync(ok.marker)).toBe(true);
    expect(readFileSync(sidecar, "utf8")).toBe(file1);
    const bad = runChanged("fail", true);
    expect(bad.message).toContain("Command failed");
    expect(existsSync(bad.marker)).toBe(true);
    expect(readFileSync(sidecar, "utf8")).toBe(file1);
  });

  it("F3: a below-top match with altered shipped bytes refuses instead of reproducing", () => {
    // Below-top identity match against altered shipped bytes must refuse, not
    // reproduce: falls through to a real re-derivation, which mismatches.
    const job = track(mkdtempSync(path.join(tmpdir(), "sc04-f3-")));
    process.env.OWN_JOB_TMP = job;
    const fixture = gitShow("HEAD:package.json");
    const fixtureSha = sha256(fixture);
    const child = makeChildScript(job);
    const callDir = track(mkdtempSync(path.join(job, "call-")));
    const belowArgv = ["node", child, "--input", "{pre}", "--out", "{out}", "--report", "{report}"];
    const below = {
      correctedBy: "f3-below",
      correctedAt: "2026-01-01T00:00:00.000Z",
      recordedBefore: { outputSha256: "older", outputBytes: 1 },
      preImageRevision: "HEAD:package.json",
      preImageSha256: fixtureSha,
      preImageBytes: fixture.byteLength,
      derivationArgv: belowArgv,
      reproduction: "byte-identical to the shipped file",
      why: "f3 below-top level",
    };
    const top = {
      correctedBy: "f3-top",
      correctedAt: "2026-01-02T00:00:00.000Z",
      recordedBefore: { outputSha256: fixtureSha, outputBytes: fixture.byteLength, byteLineage: below },
      preImageRevision: "HEAD:package.json",
      preImageSha256: fixtureSha,
      preImageBytes: fixture.byteLength,
      derivationArgv: belowArgv,
      reproduction: "byte-identical to the shipped file",
      why: "f3 newer top level",
    };
    const sidecar = path.join(job, "own.provenance.json");
    writeFileSync(sidecar, JSON.stringify({ outputSha256: fixtureSha, outputBytes: fixture.byteLength, byteLineage: top }));
    // Alter the shipped bytes after the pin (what F3's caller validates).
    const shipped = path.join(job, "shipped.glb");
    writeFileSync(shipped, Buffer.from("altered-shipped-bytes"));
    const sidecarBefore = readFileSync(sidecar, "utf8");
    let message = "";
    try {
      correctSidecarByteLineage({
        assetPath: shipped,
        provenancePath: sidecar,
        preImage: { kind: "revision", revision: "HEAD:package.json" },
        expectedPreImageSha256: fixtureSha,
        derivationArgv: belowArgv,
        why: "f3 below-top level",
        workingDirectory: callDir,
      });
    } catch (e) {
      message = String(e);
    }
    expect(message, "below-top match against altered bytes refuses").toContain("NOT explained");
    expect(readFileSync(sidecar, "utf8"), "sidecar unchanged by the refused correction").toBe(sidecarBefore);
  });
});

describe("correct-sidecar-byte-lineage --asset selection + termination (corrector-one)", () => {
  const FIXTURES_ENV = "CORRECT_SIDECAR_CORRECTIONS_FILE";

  function writeCopyChild(dir: string, name: string, marker?: string): string {
    const p = path.join(dir, name);
    const markLine =
      marker === undefined ? "" : `writeFileSync(${JSON.stringify(marker)}, "marker");\n`;
    writeFileSync(
      p,
      `import { copyFileSync, writeFileSync } from "node:fs";\n${markLine}copyFileSync(process.argv[2], process.argv[3]);\n`,
    );
    return p;
  }

  function writeEntryFiles(
    job: string,
    tag: string,
    opts: { shippedDiffers: boolean; marker?: string },
  ): { assetPath: string; provenancePath: string; preImage: { kind: "file"; path: string }; derivationArgv: string[] } {
    const pre = path.join(job, `${tag}-pre.glb`);
    writeFileSync(pre, Buffer.from(`${tag}-pre-image-bytes`));
    const shipped = path.join(job, `${tag}-shipped.glb`);
    writeFileSync(shipped, opts.shippedDiffers ? Buffer.from(`${tag}-SHIPPED-DIFFERS`) : Buffer.from(`${tag}-pre-image-bytes`));
    const sidecar = path.join(job, `${tag}.provenance.json`);
    writeFileSync(sidecar, JSON.stringify({ outputSha256: "old", outputBytes: 1 }));
    const child = writeCopyChild(job, `${tag}-child.mjs`, opts.marker);
    return {
      assetPath: shipped,
      provenancePath: sidecar,
      preImage: { kind: "file", path: pre },
      derivationArgv: ["node", child, "{pre}", "{out}"],
    };
  }

  function writeCorrectionsFile(job: string, entries: Array<Record<string, unknown>>): string {
    const p = path.join(job, "corrections.json");
    writeFileSync(p, JSON.stringify(entries));
    return p;
  }

  function gateOnEnv(correctionsFile: string): NodeJS.ProcessEnv {
    return { ...process.env, VITEST: "true", [FIXTURES_ENV]: correctionsFile };
  }

  function gateOffEnv(correctionsFile: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, [FIXTURES_ENV]: correctionsFile };
    delete env["VITEST"];
    env["NODE_ENV"] = "production";
    return env;
  }

  function runCliExpectStatus(args: string[], env: NodeJS.ProcessEnv): { status: number; stderr: string; stdout: string } {
    let status = -1;
    let stderr = "";
    let stdout = "";
    try {
      stdout = execFileSync("node", ["--experimental-strip-types", CLI, ...args], {
        env,
        encoding: "utf8",
        stdio: "pipe",
        timeout: 20_000,
      });
      status = 0;
    } catch (e) {
      status = (e as { status?: number }).status ?? -1;
      stderr = String((e as { stderr?: unknown }).stderr ?? e);
      stdout = String((e as { stdout?: unknown }).stdout ?? "");
    }
    return { status, stderr, stdout };
  }

  it("--asset runs only the named entry; the stale first entry's derivation never runs", () => {
    const job = track(mkdtempSync(path.join(tmpdir(), "sc04-asset-")));
    const marker = path.join(job, "first-derivation-ran.marker");
    const first = writeEntryFiles(job, "first", { shippedDiffers: true, marker });
    const second = writeEntryFiles(job, "second", { shippedDiffers: false });
    const correctionsFile = writeCorrectionsFile(job, [
      { ...first, why: "asset-selection test" },
      { ...second, why: "asset-selection test" },
    ]);
    const callDir = track(mkdtempSync(path.join(job, "call-")));
    const env = gateOnEnv(correctionsFile);
    const out = execFileSync(
      "node",
      ["--experimental-strip-types", CLI, "--working-directory", callDir, "--asset", second.assetPath],
      { env, encoding: "utf8", stdio: "pipe", timeout: 20_000 },
    );
    expect(out).toContain(`${second.assetPath}: reproduced`);
    expect(out).not.toContain(first.assetPath);
    expect(existsSync(marker), "first entry derivation must not run (marker absent)").toBe(false);
    const secondSidecar = JSON.parse(readFileSync(second.provenancePath, "utf8")) as Record<string, unknown>;
    expect(secondSidecar["outputSha256"]).toBe(sha256(readFileSync(second.assetPath)));
    const firstSidecarBefore = JSON.stringify({ outputSha256: "old", outputBytes: 1 });
    expect(readFileSync(first.provenancePath, "utf8")).toBe(firstSidecarBefore);
  });

  it("CHAIN (cap50 r5h1, illustrative values): two rows one asset run in order; only r2 meets shipped", () => {
    // Illustrative tiny file-backed rows (not real GLBs): r1 copies A->A,
    // r2 appends to A. Junction r1->r2 holds (r1 output == r2 pre-image).
    const job = track(mkdtempSync(path.join(tmpdir(), "sc04-chain-")));
    const start = Buffer.from("chain-start-bytes");
    const shippedBytes = Buffer.from("chain-start-bytes-chain-end");
    const pre = path.join(job, "pre.glb");
    writeFileSync(pre, start);
    const shipped = path.join(job, "asset-shipped.glb");
    writeFileSync(shipped, shippedBytes);
    const sidecar = path.join(job, "asset.provenance.json");
    writeFileSync(sidecar, JSON.stringify({ outputSha256: sha256(start), outputBytes: start.byteLength }));
    const copy = writeCopyChild(job, "r1-copy.mjs", path.join(job, "r1.marker"));
    const app = path.join(job, "r2-append.mjs");
    writeFileSync(app, `import { copyFileSync, appendFileSync, writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(path.join(job, "r2.marker"))}, "marker");\ncopyFileSync(process.argv[2], process.argv[3]);\nappendFileSync(process.argv[3], "-chain-end");\n`);
    const correctionsFile = writeCorrectionsFile(job, [
      { assetPath: shipped, provenancePath: sidecar, preImage: { kind: "file", path: pre }, derivationArgv: ["node", copy, "{pre}", "{out}"], why: "chain r1 test" },
      { assetPath: shipped, provenancePath: sidecar, preImage: { kind: "file", path: pre }, derivationArgv: ["node", app, "{pre}", "{out}"], why: "chain r2 test" },
    ]);
    const callDir = track(mkdtempSync(path.join(job, "call-")));
    const r = runCliExpectStatus(["--working-directory", callDir], gateOnEnv(correctionsFile));
    expect(r.status, `chain must reproduce; stderr=${r.stderr.slice(0, 500)}`).toBe(0);
    expect(r.stdout).toContain(`${shipped}: reproduced`);
    expect(existsSync(path.join(job, "r1.marker")), "row 1 derivation ran").toBe(true);
    expect(existsSync(path.join(job, "r2.marker")), "row 2 derivation ran").toBe(true);
    const after = JSON.parse(readFileSync(sidecar, "utf8")) as Record<string, unknown>;
    expect(after["outputSha256"]).toBe(sha256(shippedBytes));
    expect(chainDepth(sidecar), "only the final row writes one level").toBe(1);
    assertLineageContinuity("sc04-chain", lineageLevels(after));
  });

  function writeF1Fixture(job: string, finalKind: "copy" | "wrong"): {
    entries: Array<Record<string, unknown>>;
    shipped: string;
    sidecar: string;
    sidecarBefore: string;
    finalDigest: string;
    shippedDigest: string;
  } {
    // Pinned-sidecar fixture: the sidecar top entry already names the shipped
    // digest with row 2's identity, so the old code skipped re-derivation and
    // reported reproduced even when the final row produced wrong bytes.
    const rowBytes = Buffer.from("f1-row-bytes");
    const shippedBytes = finalKind === "wrong" ? Buffer.from("f1-shipped-bytes") : rowBytes;
    const pre = path.join(job, "pre.glb");
    writeFileSync(pre, rowBytes);
    const shipped = path.join(job, "asset-shipped.glb");
    writeFileSync(shipped, shippedBytes);
    const copy = writeCopyChild(job, "r1-copy.mjs");
    const finalChild = path.join(job, "r2-final.mjs");
    if (finalKind === "wrong") {
      writeFileSync(
        finalChild,
        `import { appendFileSync, copyFileSync } from "node:fs";\ncopyFileSync(process.argv[2], process.argv[3]);\nappendFileSync(process.argv[3], "-wrong");\n`,
      );
    } else {
      writeFileSync(finalChild, `import { copyFileSync } from "node:fs";\ncopyFileSync(process.argv[2], process.argv[3]);\n`);
    }
    const r2argv = ["node", finalChild, "{pre}", "{out}"];
    const why = "f1 pinned-final test";
    const sidecar = path.join(job, "asset.provenance.json");
    writeFileSync(
      sidecar,
      JSON.stringify({
        outputSha256: sha256(shippedBytes),
        outputBytes: shippedBytes.byteLength,
        byteLineage: {
          correctedBy: "f1-pinned-fixture",
          correctedAt: "2026-01-01T00:00:00.000Z",
          recordedBefore: { outputSha256: sha256(shippedBytes), outputBytes: shippedBytes.byteLength },
          preImageFile: pre,
          preImageSha256: sha256(rowBytes),
          preImageBytes: rowBytes.byteLength,
          derivationArgv: r2argv,
          reproduction: "byte-identical to the shipped file",
          why,
        },
      }),
    );
    return {
      entries: [
        { assetPath: shipped, provenancePath: sidecar, preImage: { kind: "file", path: pre }, derivationArgv: ["node", copy, "{pre}", "{out}"], why },
        { assetPath: shipped, provenancePath: sidecar, preImage: { kind: "file", path: pre }, derivationArgv: r2argv, why },
      ],
      shipped,
      sidecar,
      sidecarBefore: readFileSync(sidecar, "utf8"),
      finalDigest: sha256(finalKind === "wrong" ? Buffer.concat([rowBytes, Buffer.from("-wrong")]) : rowBytes),
      shippedDigest: sha256(shippedBytes),
    };
  }

  it("F1: pinned sidecar plus wrong final bytes refuses naming both digests, sidecar unchanged", () => {
    const job = track(mkdtempSync(path.join(tmpdir(), "sc04-f1red-")));
    const fixture = writeF1Fixture(job, "wrong");
    const correctionsFile = writeCorrectionsFile(job, fixture.entries);
    const callDir = track(mkdtempSync(path.join(job, "call-")));
    const r = runCliExpectStatus(["--working-directory", callDir], gateOnEnv(correctionsFile));
    expect(r.status, `pinned wrong final bytes must refuse; stdout=${r.stdout.slice(0, 300)}`).not.toBe(0);
    expect(r.stderr, "refusal names the fresh final digest").toContain(fixture.finalDigest);
    expect(r.stderr, "refusal names the shipped digest").toContain(fixture.shippedDigest);
    expect(readFileSync(fixture.sidecar, "utf8"), "sidecar unchanged by the refused chain").toBe(fixture.sidecarBefore);
  });

  it("F1 counterweight: pinned sidecar plus correct final bytes still reproduces with no write", () => {
    const job = track(mkdtempSync(path.join(tmpdir(), "sc04-f1cw-")));
    const fixture = writeF1Fixture(job, "copy");
    const correctionsFile = writeCorrectionsFile(job, fixture.entries);
    const callDir = track(mkdtempSync(path.join(job, "call-")));
    const r = runCliExpectStatus(["--working-directory", callDir], gateOnEnv(correctionsFile));
    expect(r.status, `pinned correct final bytes must reproduce; stderr=${r.stderr.slice(0, 500)}`).toBe(0);
    expect(r.stdout).toContain(`${fixture.shipped}: reproduced`);
    expect(readFileSync(fixture.sidecar, "utf8"), "reproduction writes nothing when already pinned").toBe(
      fixture.sidecarBefore,
    );
  });

  it("F2: two rows one asset naming two provenance paths refuse naming both paths", () => {
    const job = track(mkdtempSync(path.join(tmpdir(), "sc04-f2prov-")));
    const marker = path.join(job, "derivation-ran.marker");
    const first = writeEntryFiles(job, "first", { shippedDiffers: false, marker });
    const secondSidecar = path.join(job, "second.provenance.json");
    writeFileSync(secondSidecar, JSON.stringify({ outputSha256: "old", outputBytes: 1 }));
    const correctionsFile = writeCorrectionsFile(job, [
      { ...first, why: "f2 first row" },
      { ...first, provenancePath: secondSidecar, why: "f2 second row" },
    ]);
    const callDir = track(mkdtempSync(path.join(job, "call-")));
    const sidecarBefore = readFileSync(first.provenancePath, "utf8");
    const r = runCliExpectStatus(["--working-directory", callDir], gateOnEnv(correctionsFile));
    expect(r.status, `split provenance paths must refuse; stdout=${r.stdout.slice(0, 300)}`).not.toBe(0);
    expect(r.stderr, "refusal names the first path").toContain(first.provenancePath);
    expect(r.stderr, "refusal names the second path").toContain(secondSidecar);
    expect(existsSync(marker), "row validation runs before any derivation IO").toBe(false);
    expect(readFileSync(first.provenancePath, "utf8")).toBe(sidecarBefore);
  });

  it("unknown --asset exits 2 and names --asset and the value on stderr", () => {
    const job = track(mkdtempSync(path.join(tmpdir(), "sc04-asset-unknown-")));
    const only = writeEntryFiles(job, "only", { shippedDiffers: false });
    const correctionsFile = writeCorrectionsFile(job, [{ ...only, why: "asset-unknown test" }]);
    const callDir = track(mkdtempSync(path.join(job, "call-")));
    const r = runCliExpectStatus(
      ["--working-directory", callDir, "--asset", "nope.glb"],
      gateOnEnv(correctionsFile),
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--asset");
    expect(r.stderr).toContain("nope.glb");
  });

  it("H1+H5 refusing fixture via tsx exits integer 1 with refusal on stderr, no Node.js footer, null signal", async () => {
    const job = track(mkdtempSync(path.join(tmpdir(), "sc04-h1-refuse-")));
    const refusing = writeEntryFiles(job, "refusing", { shippedDiffers: true });
    const correctionsFile = writeCorrectionsFile(job, [{ ...refusing, why: "h1 refusing-fixture test" }]);
    const callDir = track(mkdtempSync(path.join(job, "call-")));
    const env = gateOnEnv(correctionsFile);
    const child = spawn("pnpm", ["exec", "tsx", CLI, "--working-directory", callDir], { env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString("utf8"); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString("utf8"); });
    const outcome = await new Promise<{ hung: boolean; code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        const deadline = setTimeout(() => {
          child.kill("SIGKILL");
          resolve({ hung: true, code: null, signal: null });
        }, 30_000);
        if (deadline.unref) deadline.unref();
        child.on("close", (code, signal) => {
          clearTimeout(deadline);
          resolve({ hung: false, code, signal });
        });
        child.on("error", reject);
      },
    );
    expect(outcome.hung, `CLI did not terminate within 30000ms (hang); stdout=${stdout.slice(0, 300)}`).toBe(false);
    expect(Number.isInteger(outcome.code), `exit code must be an integer; stderr=${stderr.slice(0, 500)}`).toBe(true);
    expect(outcome.code, `refusing fixture must exit 1; stderr=${stderr.slice(0, 500)}`).toBe(1);
    expect(outcome.signal, "no terminating signal expected").toBe(null);
    expect(stderr, "stderr carries the refusal message").toContain("refused");
    expect(stderr, "no node uncaught-exception footer: the H1 catch owns the exit path").not.toMatch(/^Node\.js v\d+/m);
  }, 60_000);

  it.each([
    { tag: "H2a", tmp: "sc04-asset-trailing-", extra: [] },
    { tag: "H2b", tmp: "sc04-asset-flagfollows-", extra: ["--other-flag"] },
    { tag: "H2c", tmp: "sc04-asset-twice-", extra: ["__ASSET__", "--asset", "__ASSET__"] },
  ])("$tag exits 2 naming --asset before any IO", ({ tmp, extra }) => {
    const job = track(mkdtempSync(path.join(tmpdir(), tmp)));
    const marker = path.join(job, "derivation-ran.marker");
    const only = writeEntryFiles(job, "only", { shippedDiffers: false, marker });
    const correctionsFile = writeCorrectionsFile(job, [{ ...only, why: "h2 test" }]);
    const callDir = track(mkdtempSync(path.join(job, "call-")));
    const sidecarBefore = readFileSync(only.provenancePath, "utf8");
    const tail = extra.map((t) => (t === "__ASSET__" ? only.assetPath : t));
    const r = runCliExpectStatus(
      ["--working-directory", callDir, "--asset", ...tail],
      gateOnEnv(correctionsFile),
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--asset");
    expect(existsSync(marker), "no derivation IO before the --asset usage refusal").toBe(false);
    expect(readFileSync(only.provenancePath, "utf8")).toBe(sidecarBefore);
  });

  it("H3 gated off: fixture file without VITEST/NODE_ENV=test exits 2 naming the env var before any IO", () => {
    const job = track(mkdtempSync(path.join(tmpdir(), "sc04-gate-off-")));
    const marker = path.join(job, "derivation-ran.marker");
    const only = writeEntryFiles(job, "only", { shippedDiffers: false, marker });
    const correctionsFile = writeCorrectionsFile(job, [{ ...only, why: "h3 gate-off test" }]);
    const callDir = track(mkdtempSync(path.join(job, "call-")));
    const sidecarBefore = readFileSync(only.provenancePath, "utf8");
    const r = runCliExpectStatus(
      ["--working-directory", callDir],
      gateOffEnv(correctionsFile),
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("CORRECT_SIDECAR_CORRECTIONS_FILE");
    expect(existsSync(marker), "no derivation IO once the test gate refuses").toBe(false);
    expect(readFileSync(only.provenancePath, "utf8")).toBe(sidecarBefore);
  });

  it("H3 on: NODE_ENV=test without VITEST honours the fixture table", () => {
    const job = track(mkdtempSync(path.join(tmpdir(), "sc04-gate-on-")));
    const only = writeEntryFiles(job, "only", { shippedDiffers: false });
    const correctionsFile = writeCorrectionsFile(job, [{ ...only, why: "h3 gate-on test" }]);
    const callDir = track(mkdtempSync(path.join(job, "call-")));
    const env: NodeJS.ProcessEnv = { ...process.env, [FIXTURES_ENV]: correctionsFile };
    delete env["VITEST"];
    env["NODE_ENV"] = "test";
    const r = runCliExpectStatus(["--working-directory", callDir], env);
    expect(r.status, `fixture table must run under NODE_ENV=test; stderr=${r.stderr.slice(0, 500)}`).toBe(0);
    expect(r.stdout).toContain(`${only.assetPath}: reproduced`);
  });

  it("H4 malformed fixture row refuses before any IO naming file, row index, and field", () => {
    const job = track(mkdtempSync(path.join(tmpdir(), "sc04-row-validate-")));
    const marker = path.join(job, "derivation-ran.marker");
    const ok = writeEntryFiles(job, "ok", { shippedDiffers: false, marker });
    const bad = writeEntryFiles(job, "bad", { shippedDiffers: false });
    const malformed = { ...bad, derivationArgv: [] as string[], why: "h4 malformed test" };
    const correctionsFile = writeCorrectionsFile(job, [
      { ...ok, why: "h4 valid first row" },
      malformed,
    ]);
    const callDir = track(mkdtempSync(path.join(job, "call-")));
    const sidecarBefore = readFileSync(ok.provenancePath, "utf8");
    const r = runCliExpectStatus(
      ["--working-directory", callDir],
      gateOnEnv(correctionsFile),
    );
    expect(r.status, `malformed row must fail; stdout=${r.stdout.slice(0, 300)}`).not.toBe(0);
    expect(r.stderr).toContain(correctionsFile);
    expect(r.stderr).toContain("row 1");
    expect(r.stderr).toContain("derivationArgv");
    expect(existsSync(marker), "row validation runs before any derivation IO").toBe(false);
    expect(readFileSync(ok.provenancePath, "utf8")).toBe(sidecarBefore);
  });
});
