import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const ownRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const index = process.argv.indexOf("--tree");
if (index < 0 || !process.argv[index + 1]) throw new Error("inherited-source-explicit-tree-required");
const tree = resolve(process.argv[index + 1]);
if (tree !== resolve(ownRoot)) throw new Error("inherited-source-tree-root-mismatch");
const original = "1a1719fb1c3bfa5d587acc03692802eec5e41027";
const inherited = "5bf691ed80007bad28a7dea5753b3fc5079efdff";
execFileSync("git", ["merge-base", "--is-ancestor", original, "HEAD"], { cwd: tree });
execFileSync("git", ["merge-base", "--is-ancestor", inherited, "HEAD"], { cwd: tree });
for (const path of ["packages/openclinxr/xr-dialogue/src/viseme-runtime-wire.ts", "packages/openclinxr/xr-dialogue/src/viseme-baked-cues.ts"]) {
  const before = execFileSync("git", ["show", `${original}:${path}`], { cwd: tree });
  if (readFileSync(resolve(tree, path)).equals(before)) throw new Error(`inherited-source-original-obligation-not-met:${path}`);
}
console.log("original actor audio driver/cue changed obligations anchored to immutable original plant; inherited candidate ancestry intact");
