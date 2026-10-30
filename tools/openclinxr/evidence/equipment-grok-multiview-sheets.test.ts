import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * PLANTED CONTRACTS (#232). Grok-image multi-view equipment reference packs for TRELLIS inputs.
 *
 * Does NOT require TRELLIS backend. Produces image packs + manifest only.
 * Header IMMUTABLE — append ## FIXED (#232).
 *
 * ## FIXED (#232)
 * - `inspectEquipmentGrokMultiviewSheets` lands in equipment-grok-multiview-sheets.ts.
 * - Packs on disk: ecg-cart | wall-clock | bedside-monitor (4 views each: front,
 *   three_quarter_left, three_quarter_right, side) under .openclinxr/evidence/issue-232/.
 * - Images from harness image_gen (Grok Imagine); JPG→PNG; manifest lists paths/prompts.
 * - claimScope / notEvidenceFor exclude clinical accuracy, TRELLIS success, Quest readiness.
 *
 * ## ADAPTED (ci-w7, 2026-10-30)
 *
 * The #232 Imagine PNGs were worktree-local and never tracked — the manifest in HEAD names
 * subjects with zero views, so the counterweight reds everywhere. The pack manifest itself
 * declares the succession: #256's batched packs "Replace the Grok Imagine pack step — no quota,
 * no LLM (D9)". Newer work: producer `tools/openclinxr/evidence/equipment-pack-batch-cli.ts`
 * (+ `isolated-subject-harness.ts`), feat 37be0f285 (2026-08-10), packs tracked b5b5fa038.
 * Current output: `.openclinxr/evidence/issue-256/pack-manifest.json` + 35 tracked 5-view packs
 * (front/side/three_quarter_left/three_quarter_right/back + contact-sheet + parametric source).
 * The guard is unchanged: multi-view packs exist with a valid manifest, views are distinct
 * non-trivial files. Subject floor stays ≥3 (never the fleet count — that is the producer's).
 */

const ROOT = ".openclinxr/evidence/issue-256";
const MANIFEST = join(ROOT, "pack-manifest.json");
/** The five posed views every pack must carry. Contact sheets and sources are extra, not views. */
const VIEWS = ["front", "side", "three_quarter_left", "three_quarter_right", "back"] as const;

type PackManifest = {
  schemaVersion?: string;
  issue?: number | string;
  factoryStep?: string;
  packs?: unknown;
  claimScope?: string[];
  notEvidenceFor?: string[];
};

function manifest(): PackManifest {
  if (!existsSync(MANIFEST)) throw new Error("missing artifact");
  return JSON.parse(readFileSync(MANIFEST, "utf8")) as PackManifest;
}

function packDirs(): string[] {
  const packs = join(ROOT, "packs");
  if (!existsSync(packs)) throw new Error(`missing artifact: ${packs}`);
  return readdirSync(packs).sort();
}

function viewBytes(dir: string): { view: string; bytes: number }[] {
  const out: { view: string; bytes: number }[] = [];
  for (const v of VIEWS) {
    const p = join(ROOT, "packs", dir, `${v}.png`);
    if (existsSync(p)) out.push({ view: v, bytes: statSync(p).size });
  }
  return out;
}

describe("Grok multi-view equipment reference sheets (#232)", () => {
  it("three equipment multi-view packs exist with a valid manifest", () => {
    const m = manifest();
    expect(m.schemaVersion, "pack manifest schema moved — re-point, do not relax")
      .toBe("openclinxr.equipment-reference-pack-batch.v1");
    expect(String(m.issue), "this guard now follows the #256 successor packs").toBe("256");
    expect(m.factoryStep, "packs must come from the equipment_generate factory step").toBe("equipment_generate");
    const dirs = packDirs();
    expect(dirs.length, "fewer than three reference packs survive").toBeGreaterThanOrEqual(3);
    expect(m.notEvidenceFor?.join(" ") ?? "").toMatch(/trellis|quest|clinical/i);
  });

  it("views are distinct files with non-trivial bytes (COUNTERWEIGHT)", () => {
    const dirs = packDirs();
    expect(dirs.length, "no packs to inspect").toBeGreaterThanOrEqual(3);
    for (const dir of dirs) {
      const views = viewBytes(dir);
      expect(views.length, `${dir}: pack lost posed views`).toBeGreaterThanOrEqual(4);
      for (const v of views) {
        expect(v.bytes, `${dir}/${v.view}.png is stub-sized`).toBeGreaterThan(5000);
      }
      const names = views.map((v) => v.view);
      expect(new Set(names).size, `${dir}: views are not distinct files`).toBe(names.length);
    }
  });
});
