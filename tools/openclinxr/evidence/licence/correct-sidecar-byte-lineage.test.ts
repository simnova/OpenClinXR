import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { correctSidecarByteLineage } from "./correct-sidecar-byte-lineage.js";

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
      preImageRevision: preRev,
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
      preImageRevision: preRev,
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
        preImageRevision: preRev,
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
          preImageRevision: "HEAD:package.json",
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
