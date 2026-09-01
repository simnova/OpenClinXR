import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function repoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error("workspace root (pnpm-workspace.yaml) not found");
}
