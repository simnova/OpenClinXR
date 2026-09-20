import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * The bake knows the .mhclo at fit time and discards it. This station stamps
 * sourceMhclo/licence/garmentClass onto a COPY. It must not rewrite shipped bytes
 * on --dry, and it must not call a t-shirt a gown.
 *
 * claimScope: extras on a temp copy of the gown-patient GLB.
 * notEvidenceFor: how the garment looks; swapping the peds upper shell for a gown.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");
const STATION = join(REPO_ROOT, "tools/openclinxr/asset-pipeline/makeclothes/garment-provenance-stamp.ts");
const SHIPPED = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb");

describe("garment-provenance-stamp writes extras on a copy", () => {
  it("(1) --dry on the shipped gown patient writes nothing", () => {
    if (!existsSync(SHIPPED)) return;
    const before = readFileSync(SHIPPED);
    const out = execFileSync("pnpm", ["exec", "tsx", STATION, SHIPPED, "--dry"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 120_000,
    });
    const report = JSON.parse(out) as { action: string; meshes: unknown[] };
    expect(report.action).toMatch(/no write/);
    expect(report.meshes.length).toBeGreaterThan(0);
    expect(readFileSync(SHIPPED).equals(before), "shipped GLB bytes unchanged").toBe(true);
  });

  it("(2) a temp copy receives sourceMhclo extras and the t-shirt is not classed gown", async () => {
    if (!existsSync(SHIPPED)) return;
    const dir = mkdtempSync(join(tmpdir(), "ocxr-garment-stamp-"));
    const copy = join(dir, "gown-copy.glb");
    copyFileSync(SHIPPED, copy);
    execFileSync("pnpm", ["exec", "tsx", STATION, copy], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 120_000,
    });
    expect(readFileSync(SHIPPED).equals(readFileSync(copy)) === false, "copy changed").toBe(true);
    const doc = await new NodeIO().read(copy);
    const tshirt = doc.getRoot().listMeshes().find((m) => /toigo_t_shirt/i.test(m.getName()));
    expect(tshirt, "t-shirt mesh").toBeTruthy();
    const extras = (tshirt?.getExtras() ?? {}) as {
      sourceMhclo?: string;
      licence?: string;
      garmentClass?: string;
    };
    expect(extras.sourceMhclo).toMatch(/toigo_t_shirt/);
    expect(extras.licence).toBe("CC0");
    expect(extras.garmentClass).toBe("tshirt");
    expect(extras.garmentClass).not.toBe("gown");
  });
});
