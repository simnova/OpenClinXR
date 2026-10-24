import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, realpath, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { evaluateRun, parseRunRecord, type CapacityRun } from "@openclinxr/xr-capacity";

export const MAX_INPUT_BYTES = 8 * 1024 * 1024;

/** Local JSON only, bounded before parsing; FIFOs/devices must never stall a run. */
export async function readLocalJson(path: string): Promise<unknown> {
  if (!path || /^[a-z][a-z\d+.-]*:\/\//i.test(path) || path.includes("\0")) {
    throw new Error("Input must be a local JSON file path");
  }
  const resolved = await realpath(resolve(path));
  const file = await open(resolved, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size > MAX_INPUT_BYTES) throw new Error(`Input must be a regular file no larger than ${MAX_INPUT_BYTES} bytes`);
    const bytes = Buffer.alloc(MAX_INPUT_BYTES + 1);
    let count = 0;
    while (count < bytes.length) {
      const read = await file.read(bytes, count, bytes.length - count, null);
      if (read.bytesRead === 0) break;
      count += read.bytesRead;
    }
    if (count > MAX_INPUT_BYTES) throw new Error("Input grew beyond the JSON size limit");
    return JSON.parse(bytes.subarray(0, count).toString("utf8")) as unknown;
  } finally {
    await file.close();
  }
}

export interface ArtifactBundle {
  directory: string;
  json: string;
  report: string;
  manifest: string;
  runs: { id: string; path: string; sha256: string }[];
}

/** Each invocation owns a new directory; an existing report is never overwritten. */
export async function exportArtifacts(command: string, payload: unknown, text: string, outputRoot?: string, records: CapacityRun[] = []): Promise<ArtifactBundle> {
  const root = resolve(outputRoot ?? ".openclinxr/capacity-runs");
  await mkdir(root, { recursive: true });
  const directory = join(root, `${command}-${new Date().toISOString().replaceAll(":", "-")}-${process.pid}-${randomUUID()}`);
  await mkdir(directory);
  const json = join(directory, "result.json");
  const report = join(directory, "report.txt");
  const manifest = join(directory, "manifest.json");
  const runs: ArtifactBundle["runs"] = [];
  for (const [index, input] of records.entries()) {
    const run = parseRunRecord(input);
    evaluateRun(run);
    const filename = `run-${index + 1}-${run.id.replaceAll(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80)}.json`;
    const path = join(directory, filename);
    const body = `${JSON.stringify(run, null, 2)}\n`;
    await writeFile(path, body, { flag: "wx" });
    runs.push({ id: run.id, path, sha256: createHash("sha256").update(body).digest("hex") });
  }
  await Promise.all([
    writeFile(json, `${JSON.stringify(payload, null, 2)}\n`, { flag: "wx" }),
    writeFile(report, `${text.trim()}\n${runs.length ? `\nStandalone run JSON files (relative to this report; report/compare inputs):\n${runs.map((run) => basename(run.path)).join("\n")}\n` : ""}`, { flag: "wx" }),
    writeFile(manifest, `${JSON.stringify({ schema: "quest-capacity-artifacts.v1", command, json: basename(json), report: basename(report), runs: runs.map((run) => ({ ...run, path: basename(run.path) })) }, null, 2)}\n`, { flag: "wx" }),
  ]);
  return { directory, json, report, manifest, runs };
}
