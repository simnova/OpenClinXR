import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
    // Fixture bytes are arbitrary (HEAD:package.json); the .glb suffix exists
    // only to satisfy the production basename contract (basename(path,".glb")).
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
    const children2 = readdirSync(callDir).filter((n: string) => n.startsWith("shipped-"));
    expect(children2.length).toBe(2);
    expect(new Set(children2).size).toBe(2);
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
    const sidecarBeforeSha = sha256(Buffer.from(sidecarBefore));
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
    console.log(`h5 sidecar sha256 before=${sidecarBeforeSha} after=${sha256(Buffer.from(readFileSync(sidecar, "utf8")))}`);
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
});

describe("correct-sidecar-byte-lineage nesting + idempotence (e9-r2lineage)", () => {
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
    console.log(`nest depth after one correction on a lined sidecar: ${chainDepth(sidecar)}`);
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
    console.log(`idem depth run1=${depth1} run2=${depth2} sha1=${sha1.slice(0, 12)} sha2=${sha2.slice(0, 12)}`);
    expect(depth2).toBe(depth1);
    // Identical correction leaves the file byte-identical (no timestamp bump, no new level).
    expect(sha2).toBe(sha1);
    expect(file2).toBe(file1);
  });

  it("negative: same bytes+argv but a different pre-image descriptor or why NESTS", () => {
    const job = track(mkdtempSync(path.join(tmpdir(), "sc04-idem-neg-")));
    process.env.OWN_JOB_TMP = job;
    const fixture = gitShow("HEAD:package.json");
    writeFileSync(path.join(job, "shipped.glb"), fixture);
    const sidecar = path.join(job, "own.provenance.json");
    writeFileSync(sidecar, JSON.stringify({ outputSha256: "old", outputBytes: 1 }));
    const child = makeChildScript(job);
    const callDir = track(mkdtempSync(path.join(job, "call-")));
    const argv = ["node", child, "--input", "{pre}", "--out", "{out}", "--report", "{report}"];
    runOnce(job, sidecar, callDir, fixture, argv);
    const depth1 = chainDepth(sidecar);
    expect(depth1).toBe(1);
    // Same bytes+argv but a different rationale is a different correction: must nest.
    const rWhy = correctSidecarByteLineage({
      assetPath: path.join(job, "shipped.glb"),
      provenancePath: sidecar,
      preImage: { kind: "revision", revision: "HEAD:package.json" },
      expectedPreImageSha256: sha256(fixture),
      derivationArgv: argv,
      why: "a different audit rationale with identical bytes+argv",
      workingDirectory: callDir,
    });
    expect(rWhy.reproduced).toBe(true);
    const depthWhy = chainDepth(sidecar);
    console.log(`idem-neg different why depth ${depth1} -> ${depthWhy}`);
    expect(depthWhy).toBe(depth1 + 1);
    // Same bytes+argv+why but a different pre-image descriptor (file vs revision)
    // is a different correction: must nest even though the digest matches.
    // The why is kept EXACTLY equal to the current top level, so the
    // descriptor alone distinguishes this correction: removing the descriptor
    // from the production identity would leave this plant green.
    const preFile = path.join(job, "pre-copy.glb");
    writeFileSync(preFile, fixture);
    const rFile = correctSidecarByteLineage({
      assetPath: path.join(job, "shipped.glb"),
      provenancePath: sidecar,
      preImage: { kind: "file", path: preFile },
      expectedPreImageSha256: sha256(fixture),
      derivationArgv: argv,
      why: "a different audit rationale with identical bytes+argv",
      workingDirectory: callDir,
    });
    expect(rFile.reproduced).toBe(true);
    const depthFile = chainDepth(sidecar);
    console.log(`idem-neg different descriptor depth ${depthWhy} -> ${depthFile}`);
    expect(depthFile).toBe(depthWhy + 1);
    const lineage = (JSON.parse(readFileSync(sidecar, "utf8")) as Record<string, unknown>)[
      "byteLineage"
    ] as Record<string, unknown>;
    expect(lineage["preImageFile"]).toBe(preFile);
  });
});
