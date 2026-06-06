import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

function findPackageTsconfigs(root: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(root)) {
    const childPath = join(root, entry);
    if (entry === "node_modules" || entry === "dist" || entry === ".turbo") {
      continue;
    }
    const stats = statSync(childPath);
    if (stats.isDirectory()) {
      findPackageTsconfigs(childPath, acc);
      continue;
    }
    if (entry === "tsconfig.json") {
      acc.push(childPath);
    }
  }
  return acc;
}

const packageTsconfigs = [
  ...findPackageTsconfigs("apps"),
  ...findPackageTsconfigs("packages"),
].sort();

for (const filePath of packageTsconfigs) {
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as {
    compilerOptions?: Record<string, unknown>;
  };
  parsed.compilerOptions = {
    ...parsed.compilerOptions,
    composite: true,
  };
  writeFileSync(filePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

const ideConfig = {
  files: [],
  references: packageTsconfigs.map((filePath) => ({
    path: `./${relative(".", filePath).replace(/\/tsconfig\.json$/, "")}`,
  })),
};

writeFileSync("tsconfig.ide.json", `${JSON.stringify(ideConfig, null, 2)}\n`, "utf8");
console.log(`Synced ${packageTsconfigs.length} package tsconfig composite flags and tsconfig.ide.json references.`);