/**
 * Cornice flush promotion publication isolation (ph634 output isolation).
 *
 * Calls the REAL promoteCorniceFlush() default module flow with injected runPromote/
 * runBudget/copyPoses deps so no pnpm/network/GLB work runs, against a disposable
 * sourceRoot (control GLBs + measurements + build-manifest) and publicationRoot.
 * Positive: every write lands under publicationRoot; sourceRoot bytes unchanged.
 * Negative: measurement/manifest mismatch throws before provenance mutation.
 * claimScope: cornice output routing through actual writer chain.
 * notEvidenceFor: geometry fidelity, clinical validity, Quest readiness.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { promoteCorniceFlush } from "./cornice-flush-promote.js";

const digest = (file: string): string => createHash("sha256").update(readFileSync(file)).digest("hex");

function buildFixture(): { base: string; sourceRoot: string; publicationRoot: string; glbSha: Record<string, string> } {
  const base = mkdtempSync(path.join(tmpdir(), "cornice-"));
  const sourceRoot = path.join(base, "src");
  const publicationRoot = path.join(base, "pub");
  const glbSha: Record<string, string> = {};
  for (const [rel, body] of [
    ["apps/ui-xr/public/xr-assets/environment/infinigen-stepdown.glb", "stepdown-bytes"],
    ["apps/ui-xr/public/xr-assets/environment/infinigen-inpatient-ward.glb", "ward-bytes"],
  ] as Array<[string, string]>) {
    const p = path.join(sourceRoot, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, Buffer.from(body));
    glbSha[rel] = createHash("sha256").update(Buffer.from(body)).digest("hex");
  }
  const ev = path.join(publicationRoot, "docs/openclinxr/room-realism/cornice-flush");
  mkdirSync(ev, { recursive: true });
  writeFileSync(path.join(ev, "measurements.json"), JSON.stringify({ selection: { chosen: "v4-flush-tile" } }));  writeFileSync(path.join(ev, "build-manifest.json"), JSON.stringify({
    results: {
      "stepdown_room_v1/v4-flush-tile": { glbSha256: glbSha["apps/ui-xr/public/xr-assets/environment/infinigen-stepdown.glb"] },
      "inpatient_ward_room_v1/v4-flush-tile": { glbSha256: glbSha["apps/ui-xr/public/xr-assets/environment/infinigen-inpatient-ward.glb"] },
    },
  }));
  const provDir = path.join(publicationRoot, "apps/ui-xr/public/xr-assets/environment");
  mkdirSync(provDir, { recursive: true });
  writeFileSync(path.join(provDir, "PROVENANCE.md"),
    "- `infinigen-stepdown.glb`\n  - SHA-256: old\n  - Finish: old\n  - Evidence: old\n  - Reproduce: old\n- `infinigen-tail-sentinel`\n- `infinigen-inpatient-ward.glb`\n  - SHA-256: old\n  - Finish: old\n  - Evidence: old\n  - Reproduce: old\n- `infinigen-tail-sentinel`\n");
  return { base, sourceRoot, publicationRoot, glbSha };
}

const snapshot = (root: string): Map<string, string> => {
  const out = new Map<string, string>();
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.set(path.relative(root, p), digest(p));
    }
  };
  walk(root);
  return out;
};

const fakeBudget = (bytes: Buffer) => JSON.stringify({
  bytes: bytes.length, triangles: 9, primitiveCount: 3, decodedMiBWithMips: 1.1, images: [],
});

const deps = (pub: string) => ({
  runPromote: (env: string, outDir: string) => { mkdirSync(outDir, { recursive: true }); },
  runBudget: (glb: string) => fakeBudget(readFileSync(glb)),
  copyPoses: (outDir: string, dest: string) => { writeFileSync(dest, JSON.stringify({ poses: 6 })); },
});

describe("cornice-flush-promote publication isolation (default flow)", () => {
  it("positive: writes land under publicationRoot, sourceRoot unchanged", () => {
    const fx = buildFixture();
    try {
      const beforeSrc = snapshot(fx.sourceRoot);
      promoteCorniceFlush({ publicationRoot: fx.publicationRoot, sourceRoot: fx.sourceRoot, deps: deps(fx.publicationRoot) });
      const afterSrc = snapshot(fx.sourceRoot);
      expect([...afterSrc.entries()]).toEqual([...beforeSrc.entries()]);
      for (const room of ["stepdown", "ward"]) {
        expect(existsSync(path.join(fx.publicationRoot, "docs/openclinxr/room-realism/cornice-flush", room, "shipped-budget.json"))).toBe(true);
        expect(existsSync(path.join(fx.publicationRoot, "docs/openclinxr/room-realism/cornice-flush", room, "promoted-poses.json"))).toBe(true);
      }
      const prov = readFileSync(path.join(fx.publicationRoot, "apps/ui-xr/public/xr-assets/environment/PROVENANCE.md"), "utf8");
      expect(prov).toContain(fx.glbSha["apps/ui-xr/public/xr-assets/environment/infinigen-inpatient-ward.glb"]);
      expect(prov).not.toContain("SHA-256: old");
    } finally {
      rmSync(fx.base, { recursive: true, force: true });
    }
  });

  it("negative: manifest mismatch throws, provenance untouched", () => {
    const fx = buildFixture();
    try {
      const ev = path.join(fx.publicationRoot, "docs/openclinxr/room-realism/cornice-flush");
      writeFileSync(path.join(ev, "build-manifest.json"), JSON.stringify({
        results: {
          "stepdown_room_v1/v4-flush-tile": { glbSha256: "0".repeat(64) },
          "inpatient_ward_room_v1/v4-flush-tile": { glbSha256: "0".repeat(64) },
        },
      }));
      const provPath = path.join(fx.publicationRoot, "apps/ui-xr/public/xr-assets/environment/PROVENANCE.md");
      const provBefore = readFileSync(provPath, "utf8");
      const beforeSrc = snapshot(fx.sourceRoot);
      expect(() => promoteCorniceFlush({ publicationRoot: fx.publicationRoot, sourceRoot: fx.sourceRoot, deps: deps(fx.publicationRoot) }))
        .toThrow(/Promotion differs from measured candidate/);
      expect(readFileSync(provPath, "utf8")).toBe(provBefore);
      expect([...snapshot(fx.sourceRoot).entries()]).toEqual([...beforeSrc.entries()]);
    } finally {
      rmSync(fx.base, { recursive: true, force: true });
    }
  });
});
