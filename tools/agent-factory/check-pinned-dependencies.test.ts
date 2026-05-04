import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { checkPinnedDependencySpecifiers, isPinnedDependencySpecifier } from "./check-pinned-dependencies.js";

describe("pinned dependency checker", () => {
  it("accepts exact, workspace, file, link, portal, and npm alias exact specifiers", () => {
    expect(isPinnedDependencySpecifier("1.2.3")).toBe(true);
    expect(isPinnedDependencySpecifier("1.2.3-beta.1")).toBe(true);
    expect(isPinnedDependencySpecifier("workspace:*")).toBe(true);
    expect(isPinnedDependencySpecifier("file:../local-package.tgz")).toBe(true);
    expect(isPinnedDependencySpecifier("link:../local-package")).toBe(true);
    expect(isPinnedDependencySpecifier("portal:../local-package")).toBe(true);
    expect(isPinnedDependencySpecifier("npm:@scope/real-package@1.2.3")).toBe(true);
  });

  it("reports unpinned dependency specifiers with file, field, dependency, and specifier", async () => {
    await withPackageJson({
      dependencies: {
        hono: "^4.10.0",
        three: "0.184.0",
      },
      devDependencies: {
        vite: "~8.0.10",
      },
      peerDependencies: {
        react: ">=19.0.0",
      },
    }, async (file) => {
      await expect(checkPinnedDependencySpecifiers({ files: [file] })).resolves.toEqual({
        checkedCount: 1,
        findings: [
          { file, field: "dependencies", dependency: "hono", specifier: "^4.10.0" },
          { file, field: "devDependencies", dependency: "vite", specifier: "~8.0.10" },
          { file, field: "peerDependencies", dependency: "react", specifier: ">=19.0.0" },
        ],
      });
    });
  });
});

async function withPackageJson(packageJson: Record<string, unknown>, callback: (file: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "openclinxr-pinned-deps-"));
  const file = join(root, "package.json");

  try {
    await writeFile(file, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
    await callback(file);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
