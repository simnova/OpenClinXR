import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assessDataRow, assessReader, assessReaderCompares, mapProblem, REASON_BYTES, REASON_EMPTY_MAP, REASON_LANGUAGE, REASON_PIN, REASON_SIDECAR, type ReaderTraceFS } from "./index.js";
import { nodeDiskFS, resolveDiskRelative } from "./reader-trace/test-fs.js";

/** Post-export-stage accessor-digest reader guard (G1, binding-traced).
 * MISLABELLED iff a comparison pairs a LIVE whole-GLB value with a STORED pin.
 * Higher-order/callback flows (array.map(fn), function values) are NOT traced. */
const REPO = join(import.meta.dirname, "..", "..", "..", "..");
const COMPACT = "packages/openclinxr/factory-station-core/src/post-export-stage-consumers.json";
const FIX = join(import.meta.dirname, "accessor-digest-reader-guard-fixtures");
const overlay = new Map([[join(FIX, "r2-py-reader.py"), readFileSync(join(FIX, "r2-py-reader.ts.txt"), "utf8")]]);
const readText = (p: string): string | undefined => overlay.get(p) ?? nodeDiskFS.readText(p);
const fs: ReaderTraceFS = { readText, resolveRelative: (f, s) => resolveDiskRelative(f, s, readText) };
/** Data (.json) row -> reader .ts file(s). Every accessor-digest .json row must appear here. */
const DATA_READERS: Record<string, string[]> = {
  ".openclinxr/evidence/issue-276/pre-fix.json": ["packages/openclinxr/stations/cast-readiness-evidence/src/cast-readiness/humanoid-body-signature.test.ts"],
  "docs/openclinxr/humanoid-vetting-captures/mpfb-peds-patient-child-defect-sites.json": ["packages/openclinxr/stations/humanoid-vetting-evidence/src/humanoid-vetting/the-child-defect-sites-are-attributed-from-the-glb.test.ts"],
  "packages/openclinxr/asset-registry/src/measured-station-geometry.json": ["tools/openclinxr/evidence/cast-readiness-stale/the-measured-geometry-artifact-knows-when-it-is-stale.test.ts"],
  "packages/openclinxr/stations/humanoid-bake-evidence/src/humanoid-bake/the-physician-teeth-seat-in-its-mouth.measure.json": ["packages/openclinxr/stations/humanoid-bake-evidence/src/humanoid-bake/the-physician-teeth-seat-in-its-mouth.test.ts"],
  "tools/openclinxr/evidence/humanoid-vetting/mpfb-nurse-sternal-t-classify.json": ["packages/openclinxr/stations/humanoid-vetting-evidence/src/humanoid-vetting/the-nurse-sternal-t-is-classified-from-the-glb.test.ts"],
};
/** [fixture, row file, field, must be MISLABELLED, expected reason] */
const CASES: Array<[string, string, string, boolean, string]> = [
  ["r1-separate-bytes-binding.ts.txt", "r1-gown-shard.ts", "glbSha256", true, REASON_PIN],
  ["r2-py-reader.py", "r2-hash-reader.py", "outputSha256", true, REASON_LANGUAGE],
  ["r3-buffer-equals.ts.txt", "r3-whole-bytes.ts", "outputBytes", true, REASON_BYTES],
  ["r4-sidecar-alias.ts.txt", "r4-sidecar-alias.ts", "outputSha256", true, REASON_SIDECAR],
  ["r5-frozen-plus-live.ts.txt", "r5-frozen-plus-live.ts", "glbSha256", true, REASON_PIN],
  ["r6-first-actor-substring.ts.txt", "r6-first-actor.ts", "glbSha256", true, REASON_PIN],
  ["r7-split-statements.ts.txt", "r7-split-statements.ts", "outputSha256", true, REASON_PIN],
  ["r8-cross-module-helper.ts.txt", "r8-cross-module.ts", "glbSha256", true, REASON_PIN],
  ["r9-same-file-helper.ts.txt", "r9-same-file-helper.ts", "glbSha256", true, REASON_PIN],
  ["r10-imported-helper.ts.txt", "r10-imported-helper.ts", "glbSha256", true, REASON_PIN],
  ["r11-aliased-apis.ts.txt", "r11-aliased-apis.ts", "glbSha256", true, REASON_PIN],
  ["r12-named-hash-helper.ts.txt", "r12-named-hash-helper.ts", "glbSha256", true, REASON_PIN],
  ["r13-container-paths.ts.txt", "r13-container-paths.ts", "glbSha256", true, REASON_PIN],
  ["r14-imported-check.ts.txt", "r14-imported-check.ts", "glbSha256", true, REASON_PIN],
  ["r15-mjs-reader.mjs.txt", "r15-mjs-reader.mjs", "outputSha256", true, REASON_LANGUAGE],
  ["g2-r1-resolve-tmp-abs.ts.txt", "g2-r1.ts", "glbSha256", true, REASON_PIN],
  ["g2-r2-unrelated-write.ts.txt", "g2-r2.ts", "glbSha256", true, REASON_PIN],
  ["g2-r3-gitshow-elsewhere.ts.txt", "g2-r3.ts", "glbSha256", true, REASON_PIN],
  ["g2-r7-uint8-view.ts.txt", "g2-r7.ts", "glbSha256", true, REASON_PIN],
  ["g2-c1-header-byte.ts.txt", "g2-c1.ts", "glbSha256", false, "clean"],
  ["g2-c2-uncalled-update.ts.txt", "g2-c2.ts", "glbSha256", false, "clean"],
  ["g2-c3-tmp-self-read.ts.txt", "g2-c3.ts", "glbSha256", false, "clean"],
  ["a1-f6-basename-diff.ts.txt", "a1.ts", "glbSha256", true, REASON_PIN],
  ["a2-f6-cross-test-write.ts.txt", "a2.ts", "glbSha256", true, REASON_PIN],
  ["a3-f9-shadowed-call.ts.txt", "a3.ts", "glbSha256", true, REASON_PIN],
  ["a4-f7-self-assign.ts.txt", "a4.ts", "glbSha256", false, "clean"],
  ["b1-f7-shadowed-assign.ts.txt", "proof/b1-sidecar.json", "outputSha256", true, REASON_PIN],
  ["b2-f7-record-literal.ts.txt", "proof/receipt.json", "outputSha256", true, REASON_PIN],
  ["b3-f9-dead-branch.ts.txt", "b3.ts", "glbSha256", false, "clean"],
  ["c1-log-only.ts.txt", "c1-log-only.ts", "sha256", false, "clean"],
  ["c2-accessor-slices.ts.txt", "c2-accessor-slices.ts", "geometrySha256", false, "clean"],
  ["c3-tmp-copy.ts.txt", "c3-tmp-copy.ts", "glbSha256", false, "clean"],
  ["c4-frozen-history.ts.txt", "c4-frozen-history.ts", "sha256", false, "clean"],
  ["c6-mid-read-consistency.ts.txt", "c6-mid-read-consistency.ts", "glbSha256", false, "clean"],
];
describe("post-export-stage accessor-digest reader guard", () => {
  it("decides every planted RED and counterweight fixture", () => {
    for (const [fixture, row, field, want, reason] of CASES) {
      const path = fixture === "r2-py-reader.py" ? join(FIX, "r2-py-reader.py") : join(FIX, fixture);
      const verdict = assessReader(row, field, path, fs);
      expect(verdict.parsed, `${fixture} did not parse`).toBe(true);
      expect(verdict.mislabelled, `${fixture} :: ${verdict.detail}`).toBe(want);
      expect(verdict.reason, `${fixture} reason :: ${verdict.detail}`).toBe(reason);
    }
  });
  it("H1 leaves an unrelated pin compare off the row (a comment mention is not a binding)", () => {
    const v = assessReader("receipt.json", "geometrySha256", join(FIX, "h1-comment-mention-unrelated-pin.ts.txt"), fs);
    expect(v.parsed).toBe(true);
    expect(v.mislabelled, `H1 :: ${v.detail}`).toBe(false);
  });
  it("H6 flags a pin compare on a caller-tainted parameter", () => {
    const v = assessReader("h6-param-passthrough.ts", "glbSha256", join(FIX, "h6-param-passthrough.ts.txt"), fs);
    expect(v.parsed).toBe(true);
    expect(v.mislabelled, "H6").toBe(true);
    expect(v.reason, "H6").toBe(REASON_PIN);
  });
  it("H4 flags a whole-GLB hash read through a local read alias", () => {
    const v = assessReader("h4a-local-alias.ts", "glbSha256", join(FIX, "h4a-local-alias.ts.txt"), fs);
    expect(v.parsed).toBe(true);
    expect(v.mislabelled, "H4a").toBe(true);
    expect(v.reason, "H4a").toBe(REASON_PIN);
  });
  it("H4 flags a whole-GLB hash read through fs.promises.readFile", () => {
    const v = assessReader("h4b-promises-prop.ts", "glbSha256", join(FIX, "h4b-promises-prop.ts.txt"), fs);
    expect(v.parsed).toBe(true);
    expect(v.mislabelled, "H4b").toBe(true);
    expect(v.reason, "H4b").toBe(REASON_PIN);
  });
  it("H3 flags a whole-GLB hash helper behind a named re-export barrel", () => {
    const v = assessReader("h3a-reader.ts", "glbSha256", join(FIX, "h3a-reader.ts.txt"), fs);
    expect(v.parsed).toBe(true);
    expect(v.mislabelled, "H3a").toBe(true);
    expect(v.reason, "H3a").toBe(REASON_PIN);
  });
  it("H3 flags a whole-GLB hash helper behind an export-star barrel", () => {
    const v = assessReader("h3b-reader.ts", "glbSha256", join(FIX, "h3b-reader.ts.txt"), fs);
    expect(v.parsed).toBe(true);
    expect(v.mislabelled, "H3b").toBe(true);
    expect(v.reason, "H3b").toBe(REASON_PIN);
  });
  it("H2 returns a verdict instead of throwing on a cyclic path container", () => {
    const v = assessReader("h2-cycle-a.ts", "glbSha256", join(FIX, "h2-cycle-a.ts.txt"), fs);
    expect(v.parsed).toBe(true);
  });
  it("F1 flags a sidecar pin read through a property access sharing its receiver start", () => {
    const v = assessReader("proof/receipt.json", "sha256", join(FIX, "f1-sidecar-prop-receiver.ts.txt"), fs);
    expect(v.parsed).toBe(true);
    expect(v.mislabelled, `F1 :: ${v.detail}`).toBe(true);
    expect(v.reason, `F1 :: ${v.detail}`).toBe(REASON_SIDECAR);
  });
  it("F2 does not bind a same-basename read from another directory to the row", () => {
    const v = assessReader("proof/receipt.json", "sha256", join(FIX, "f2-basename-other-dir.ts.txt"), fs);
    expect(v.parsed).toBe(true);
    expect(v.mislabelled, `F2 :: ${v.detail}`).toBe(false);
  });
  it("F3 returns a verdict instead of throwing on a direct cyclic property compare", () => {
    const v = assessReader("f3-cyclic-prop.ts", "glbSha256", join(FIX, "f3-cyclic-prop-compare.ts.txt"), fs);
    expect(v.parsed).toBe(true);
  });
  it("F4 flags a live-GLB read through a twice-reached shared initializer", () => {
    const v = assessReader("f4-shared-init.ts", "glbSha256", join(FIX, "f4-shared-init-diamond.ts.txt"), fs);
    expect(v.parsed).toBe(true);
    expect(v.mislabelled, `F4 :: ${v.detail}`).toBe(true);
    expect(v.reason, `F4 :: ${v.detail}`).toBe(REASON_PIN);
  });
  it("G2-R4 flags an assignment-destructured sidecar pin", () => {
    const v = assessReader("proof/g2-r4-sidecar.json", "outputSha256", join(FIX, "g2-r4-assign-destructure.ts.txt"), fs);
    expect(v.parsed).toBe(true);
    expect(v.mislabelled, `G2-R4 :: ${v.detail}`).toBe(true);
    expect(v.reason, `G2-R4 :: ${v.detail}`).toBe(REASON_SIDECAR);
  });
  it("G2-R5 flags a nested parsed sidecar field", () => {
    const v = assessReader("proof/g2-r5-sidecar.json", "outputSha256", join(FIX, "g2-r5-nested-subject.ts.txt"), fs);
    expect(v.parsed).toBe(true);
    expect(v.mislabelled, `G2-R5 :: ${v.detail}`).toBe(true);
    expect(v.reason, `G2-R5 :: ${v.detail}`).toBe(REASON_SIDECAR);
  });
  it("G2-R6 flags a sidecar pin returned from a relatively imported helper", () => {
    const v = assessReader("proof/g2-r6-sidecar.json", "outputSha256", join(FIX, "g2-r6-helper-return.ts.txt"), fs);
    expect(v.parsed).toBe(true);
    expect(v.mislabelled, `G2-R6 :: ${v.detail}`).toBe(true);
    expect(v.reason, `G2-R6 :: ${v.detail}`).toBe(REASON_PIN);
  });
  it("M11 R11 flags every aliased compare", () => {
    const cs = assessReaderCompares("r11-aliased-apis.ts", "glbSha256", join(FIX, "r11-aliased-apis.ts.txt"), fs);
    expect(cs.length).toBe(2);
    expect(cs[0]?.line).toBe(8);
    expect(cs[1]?.line).toBe(10);
    for (const c of cs) expect(c.reason, `R11 line ${c.line}`).toBe(REASON_PIN);
  });
  it("M11 R13 flags every container-path compare", () => {
    const cs = assessReaderCompares("r13-container-paths.ts", "glbSha256", join(FIX, "r13-container-paths.ts.txt"), fs);
    expect(cs.map((c) => c.line)).toEqual([9, 11, 13]);
    for (const c of cs) expect(c.reason, `R13 line ${c.line}`).toBe(REASON_PIN);
  });
  it("rejects a DATA_READERS entry whose reader does not name the data file", () => {
    const reader = join(FIX, "c5-map-entry.ts.txt");
    expect(mapProblem("docs/provenance/stale-data.json", reader, readFileSync(reader, "utf8"))).toContain("stale-data.json");
    const v = assessReader("docs/provenance/stale-data.json", "sha256", reader, fs);
    expect(v.parsed).toBe(true);
    expect(v.mislabelled, `C5 :: ${v.detail}`).toBe(false);
    expect(v.reason, `C5 :: ${v.detail}`).toBe("clean");
  });
  it("fails a data row mapped to no readers", () => {
    const verdict = assessDataRow("docs/provenance/empty.json", "sha256", []);
    expect(verdict.mislabelled).toBe(true);
    expect(verdict.reason).toBe(REASON_EMPTY_MAP);
  });
  it("leaves the header-byte element compare to G2 (verdict recorded, no assertion)", () => {
    const path = join(FIX, "c7-header-byte-element.ts.txt");
    const verdict = assessReader("c7-header-byte-element.ts", "glbSha256", path, fs);
    expect(verdict.parsed).toBe(true);
    expect(verdict.mislabelled, `C7 :: ${verdict.detail}`).toBe(false);
    expect(verdict.reason, `C7 :: ${verdict.detail}`).toBe("clean");
    expect(readText(path)).toContain("readFileSync");
  });
  it("no accessor-digest row reader compares a whole GLB sha", () => {
    const doc = JSON.parse(readFileSync(join(REPO, COMPACT), "utf8")) as { rows?: Array<{ file?: string; field?: string; proposed_pin?: string }> };
    const rows = (doc.rows ?? []).filter((r) => r.proposed_pin === "accessor-digest").map((r) => ({ file: r.file ?? "", field: r.field ?? "" }));
    expect(rows.length, "accessor-digest row count moved").toBeGreaterThan(0);
    const bad: string[] = [];
    for (const row of rows) {
      const mapped = row.file.endsWith(".json") ? DATA_READERS[row.file] : [row.file];
      const verdict = assessDataRow(row.file, row.field, mapped);
      if (verdict.mislabelled) {
        bad.push(verdict.detail);
        continue;
      }
      for (const r of mapped ?? []) {
        const rp = join(REPO, r);
        if (readText(rp) === undefined) {
          bad.push(`UNREADABLE reader: ${r}`);
          continue;
        }
        const readerText = readText(rp) as string;
        if (row.file.endsWith(".json")) {
          const mp = mapProblem(row.file, rp, readerText);
          if (mp !== undefined) {
            bad.push(mp);
            continue;
          }
        }
        const v = assessReader(row.file, row.field, rp, fs);
        if (v.mislabelled) bad.push(v.detail);
      }
    }
    expect(bad, "accessor-digest rows whose reader still compares a whole GLB sha").toEqual([]);
  });
});
