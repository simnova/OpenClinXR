import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkTsconfigConventions } from "./tsconfig-conventions.js";

function violations(path: string, compilerOptions: Record<string, unknown>, include = ["src/**/*.ts", "vite.config.ts"], extendsField = "@cellix/config-typescript/base") {
  const root = mkdtempSync(join(tmpdir(), `tsconfig-conventions-${process.pid}-`));
  function write(file: string, value: unknown) {
    const destination = join(root, file);
    mkdirSync(join(destination, ".."), { recursive: true });
    writeFileSync(destination, JSON.stringify(value));
  }
  try {
    write("packages/cellix/config-typescript/tsconfig.base.json", { compilerOptions: { noEmit: true } });
    write("packages/cellix/config-typescript/tsconfig.node.json", { extends: "./tsconfig.base.json", compilerOptions: { noEmit: false } });
    write(`${path}/tsconfig.json`, { extends: extendsField, compilerOptions, include });
    return checkTsconfigConventions({ workspaceRoot: root, exemptions: {} });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("Vite app rootDir convention", () => {
  it("accepts rootDir dot for a Vite app inheriting noEmit", () => {
    expect(violations("apps/ui-example", { rootDir: "." })).toEqual([]);
  });
  it("rejects an emitting app overriding inherited noEmit", () => {
    expect(violations("apps/ui-example", { rootDir: ".", noEmit: false })).toEqual([
      expect.stringContaining("compilerOptions.rootDir"),
    ]);
  });
  it("rejects an app inheriting emitting Node compiler settings", () => {
    expect(violations("apps/ui-example", { rootDir: "." }, undefined, "@cellix/config-typescript/node")).toEqual([
      expect.stringContaining("compilerOptions.rootDir"),
    ]);
  });
  it("rejects package rootDir dot even when noEmit", () => {
    expect(violations("packages/example", { rootDir: ".", noEmit: true })).toEqual([
      expect.stringContaining("compilerOptions.rootDir"),
    ]);
  });
  it("requires a root Vite config include for the app exception", () => {
    expect(violations("apps/ui-example", { rootDir: "." }, ["src/**/*.ts"])).toEqual([
      expect.stringContaining("compilerOptions.rootDir"),
    ]);
  });
  it("preserves emitting packages with their src root", () => {
    expect(violations("packages/example", { rootDir: "src", noEmit: false })).toEqual([]);
  });
});
