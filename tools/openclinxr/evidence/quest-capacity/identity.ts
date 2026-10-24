import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const MAX_FILES = 256;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
export interface BuildIdentity { revision: string; buildHash: string; status: "observed" | "unavailable"; reasons: string[] }

/** Hash loaded package output plus collector source, including dirty edits, without timestamps. */
export async function collectBuildIdentity(): Promise<BuildIdentity> {
  const revisionResult = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", timeout: 2000, maxBuffer: 4096 });
  const revision = revisionResult.status === 0 && /^[a-f\d]{40,64}$/i.test(revisionResult.stdout.trim()) ? revisionResult.stdout.trim() : "unrecorded";
  const reasons = revision === "unrecorded" ? ["Local git revision unavailable"] : [];
  try {
    const packageRoot = dirname(await realpath(createRequire(import.meta.url).resolve("@openclinxr/xr-capacity")));
    const collectorRoot = fileURLToPath(new URL(".", import.meta.url));
    const files: { absolute: string; label: string }[] = [];
    const visit = async (directory: string, base: string, prefix: string, suffix: string, depth = 0): Promise<void> => {
      if (depth > 12) throw new Error("Source depth exceeds build identity bound");
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const absolute = join(directory, entry.name);
        if (entry.isSymbolicLink()) throw new Error("Symbolic source file refused in build identity");
        if (entry.isDirectory()) await visit(absolute, base, prefix, suffix, depth + 1);
        else if (entry.isFile() && entry.name.endsWith(suffix)) {
          files.push({ absolute, label: `${prefix}/${relative(base, absolute).replaceAll("\\", "/")}` });
          if (files.length > MAX_FILES) throw new Error("Source file count exceeds build identity bound");
        }
      }
    };
    await visit(packageRoot, packageRoot, "package-dist", ".js");
    await visit(collectorRoot, collectorRoot, "collector-source", ".ts");
    if (!files.some((file) => file.label === "package-dist/index.js")) throw new Error("Resolved package output is unavailable");
    const hash = createHash("sha256");
    let total = 0;
    for (const file of files.sort((a, b) => a.label < b.label ? -1 : a.label > b.label ? 1 : 0)) {
      const metadata = await stat(file.absolute);
      if (metadata.size > MAX_FILE_BYTES || total + metadata.size > MAX_TOTAL_BYTES) throw new Error("Source bytes exceed build identity bound");
      const content = await readFile(file.absolute);
      total += content.length;
      if (content.length > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES) throw new Error("Source grew beyond build identity bound");
      hash.update(`${file.label}\0${content.length}\0`).update(content);
    }
    return { revision, buildHash: `sha256:${hash.digest("hex")}`, status: reasons.length ? "unavailable" : "observed", reasons };
  } catch (error) {
    return { revision, buildHash: "unrecorded", status: "unavailable", reasons: [...reasons, error instanceof Error ? error.message : "Build identity unavailable"] };
  }
}
