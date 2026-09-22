import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PUBLIC_API_FILENAME,
  checkReviewedPublicApi,
  type PublicApiDocument,
} from "../checks/export-surface-budgets.ts";
import { measureSurface, workspaceRoot } from "../checks/public-surface/resolve.ts";

/**
 * The reviewed surface is package-local public-api.json, sealed from the Closing-record
 * residual under docs/openclinxr/package-public-surface-reduction. A derived export outside
 * that file fails. Copying arch-index.json, or today's export list, into the file is a
 * failed treatment: the file is the residual plus a name only when a file outside the
 * package binds it.
 */
describe("packages publish a reviewed surface", () => {
  it("derived entrypoint exports are the names in public-api.json", () => {
    const root = workspaceRoot();
    const report = measureSurface(root);
    const measurements = report.packages.flatMap((pkg) =>
      pkg.entrypoints.map((entry) => ({
        pkg: pkg.packageDir,
        specifier: entry.specifier,
        exports: entry.symbols.map((symbol) => symbol.name),
      })),
    );
    const violations = checkReviewedPublicApi(measurements, (pkg) => readPublicApi(root, pkg));
    expect(violations.map((v) => v.detail), violations.map((v) => v.detail).join("\n")).toEqual([]);
  });

  it("a derived export outside public-api.json is refused", () => {
    const violations = checkReviewedPublicApi(
      [{ pkg: "packages/openclinxr/invented", specifier: ".", exports: ["NotReviewed"] }],
      () => ({ entrypoints: { ".": ["Reviewed"] } }),
    );
    expect(violations.map((v) => v.detail).join("\n")).toContain("exports NotReviewed");
    expect(violations.map((v) => v.detail).join("\n")).toContain("lists Reviewed");
  });
});

function readPublicApi(root: string, pkg: string): PublicApiDocument | null {
  const file = join(root, pkg, PUBLIC_API_FILENAME);
  if (!existsSync(file)) return null;
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { entrypoints?: Record<string, string[]> };
  return { entrypoints: parsed.entrypoints ?? {} };
}
