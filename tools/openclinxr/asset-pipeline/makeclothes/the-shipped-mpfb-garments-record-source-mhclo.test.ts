import { readdirSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * After the 2026-09-20 fleet stamp, every shipped MPFB garment mesh that the
 * stamp table covers must carry sourceMhclo extras. Does not require gown class.
 *
 * claimScope: extras on apps/ui-xr/public/generated-humanoids/mpfb-*.glb
 * notEvidenceFor: gown-class swap; how garments look.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = pathResolve(HERE, "../../../..");
const DIR = join(REPO, "apps/ui-xr/public/generated-humanoids");
const SKIP = /eyes|hair|eyelash|eyebrow|teeth|tongue/i;
const GARMENT = /real_garment|makeclothes_library/i;

describe("the shipped MPFB garments record sourceMhclo", () => {
  it("(1) every stamp-table garment mesh on mpfb-*.glb has a sourceMhclo extra", async () => {
    const glbs = readdirSync(DIR).filter((n) => n.startsWith("mpfb-") && n.endsWith(".glb"));
    expect(glbs.length, "shipped MPFB fleet").toBeGreaterThan(5);
    const missing: string[] = [];
    for (const f of glbs) {
      const doc = await new NodeIO().read(join(DIR, f));
      for (const mesh of doc.getRoot().listMeshes()) {
        const name = mesh.getName();
        if (!GARMENT.test(name) || SKIP.test(name)) continue;
        const src = (mesh.getExtras() as { sourceMhclo?: string } | null)?.sourceMhclo;
        if (typeof src !== "string" || src.length === 0) missing.push(`${f}:${name}`);
      }
    }
    expect(missing, `garments missing sourceMhclo: ${missing.join(", ")}`).toEqual([]);
  });
});
