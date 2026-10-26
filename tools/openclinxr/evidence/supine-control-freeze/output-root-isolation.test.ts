/**
 * Supine freeze producer output-root isolation (ph634 output isolation).
 *
 * Exercises the REAL default producer produceSupineControlFreeze({ repoRootPath: sourceRoot })
 * against a disposable temp sourceRoot holding all 8 control assets; the resulting freeze
 * record is written only under the disposable publicationRoot. Negative path: a missing
 * control asset refuses production. Canonical record byte immutability asserted.
 * claimScope: freeze producer source/publication separation.
 * notEvidenceFor: geometry fidelity, clinical validity, Quest readiness.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeSupineControlFreeze,
  FREEZE_RECORD_REL,
  produceSupineControlFreeze,
  requireSupineControlFreeze,
} from "./supine-control-freeze.js";

const CONTROL_ASSETS: Array<[string, string]> = [
  ["apps/ui-xr/public/xr-assets/environment/infinigen-inpatient-ward.glb", "glTF-control-ward"],
  ["apps/ui-xr/public/xr-assets/environment/infinigen-stepdown.glb", "glTF-control-stepdown"],
  ["apps/ui-xr/public/xr-assets/environment/infinigen-surgical-ward.glb", "glTF-control-surgical"],
  ["apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb", "patient"],
  ["apps/ui-xr/public/generated-humanoids/mpfb-family-partner-adult.glb", "partner"],
  ["apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb", "nurse"],
  ["apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb", "physician"],
  ["apps/ui-xr/public/generated-humanoids/mpfb-peds-nurse-kevin.glb", "peds"],
];

const digest = (file: string): string => createHash("sha256").update(readFileSync(file)).digest("hex");

function buildSource(): { base: string; sourceRoot: string } {
  const base = mkdtempSync(path.join(tmpdir(), "freeze-src-"));
  const sourceRoot = path.join(base, "src");
  for (const [rel, body] of CONTROL_ASSETS) {
    const p = path.join(sourceRoot, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, Buffer.from(body));
  }
  return { base, sourceRoot };
}

describe("supine freeze producer output-root isolation (default flow)", () => {
  it("positive: default produce+write lands only under publicationRoot, canonical record unchanged", () => {
    const fx = buildSource();
    const pub = mkdtempSync(path.join(tmpdir(), "freeze-pub-"));
    const repoRecord = path.resolve(import.meta.dirname, "supine-control-freeze.record.json");
    const canonicalBefore = digest(repoRecord);
    try {
      const produced = produceSupineControlFreeze({
        observedBy: "output-root-isolation.test",
        observedAtIso: new Date().toISOString(),
        reason: "ph634 isolation proof against temp fixture",
        repoRootPath: fx.sourceRoot,
      });
      expect(produced.produced).toBe(true);
      if (!produced.produced) throw new Error("refused");
      const freezePath = path.join(pub, "freeze-record.json");
      writeFileSync(freezePath, JSON.stringify(produced.freeze, null, 2) + "\n");
      expect(existsSync(freezePath)).toBe(true);
      const current = computeSupineControlFreeze(fx.sourceRoot);
      expect(produced.freeze.assetSha256ByPath).toEqual(current.assetSha256ByPath);
      expect(produced.freeze.assetSha256ByPath["apps/ui-xr/public/xr-assets/environment/infinigen-inpatient-ward.glb"])
        .toBe(createHash("sha256").update(Buffer.from("glTF-control-ward")).digest("hex"));
      expect(requireSupineControlFreeze(path.join(pub, "does-not-exist-marker")).status).toBe("absent");
      expect(digest(repoRecord)).toBe(canonicalBefore);
      expect(existsSync(path.join(fx.sourceRoot, FREEZE_RECORD_REL))).toBe(false);
    } finally {
      rmSync(fx.base, { recursive: true, force: true });
      rmSync(pub, { recursive: true, force: true });
    }
  });

  it("negative: missing asset refuses production; corrupt record is refused", () => {
    const fx = buildSource();
    const pub = mkdtempSync(path.join(tmpdir(), "freeze-neg-"));
    try {
      rmSync(path.join(fx.sourceRoot, "apps/ui-xr/public/generated-humanoids/mpfb-peds-nurse-kevin.glb"));
      const refused = produceSupineControlFreeze({
        observedBy: "output-root-isolation.test",
        observedAtIso: new Date().toISOString(),
        reason: "missing asset case",
        repoRootPath: fx.sourceRoot,
      });
      expect(refused.produced).toBe(false);
      const bad = path.join(pub, "bad.json");
      writeFileSync(bad, "{not json");
      expect(requireSupineControlFreeze(bad).status).toBe("malformed");
      expect(existsSync(path.join(pub, "supine-control-freeze.record.json"))).toBe(false);
    } finally {
      rmSync(fx.base, { recursive: true, force: true });
      rmSync(pub, { recursive: true, force: true });
    }
  });
});
