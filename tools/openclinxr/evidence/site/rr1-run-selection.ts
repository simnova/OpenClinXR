import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

const DEFAULT_RR1_STORE_ROOT = "/Volumes/files/openclinxr-assets/store/site-reimagine/rr1";
const PUBLISHED_RUN_SOURCE = "docs/site/data/media.json";

export type Rr1RunSelection =
  | { kind: "run"; run: string; storeRoot: string }
  | { kind: "skip"; reason: string; storeRoot: string };

type ResolveOptions = {
  selectedRun?: string | undefined;
  storeRoot: string;
  publishedRunSource?: string;
};

export function publishedRr1Run(source = PUBLISHED_RUN_SOURCE): string {
  const sourcePath = resolve(source);
  const media = JSON.parse(readFileSync(sourcePath, "utf8")) as { referenceRun?: unknown };
  if (typeof media.referenceRun !== "string" || !/^run-\d+$/u.test(media.referenceRun)) {
    throw new Error(`published RR1 run is missing: ${sourcePath} referenceRun must name run-N`);
  }
  return media.referenceRun;
}

export function resolveRr1RunSelection({
  selectedRun,
  storeRoot: unresolvedStoreRoot,
  publishedRunSource = PUBLISHED_RUN_SOURCE,
}: ResolveOptions): Rr1RunSelection {
  const storeRoot = resolve(unresolvedStoreRoot);
  if (!existsSync(storeRoot)) {
    return { kind: "skip", reason: `RR1 store root is absent: ${storeRoot}`, storeRoot };
  }

  const selected = selectedRun === undefined || selectedRun.length === 0
    ? publishedRr1Run(publishedRunSource)
    : selectedRun;

  const run = isAbsolute(selected) ? resolve(selected) : join(storeRoot, selected);
  if (!existsSync(run)) throw new Error(`selected RR1 run directory is missing: ${run}`);
  const video = join(run, "rr1-min.webm");
  if (!existsSync(video)) throw new Error(`selected RR1 run is missing rr1-min.webm: ${video}`);
  const capturePath = join(run, "capture.json");
  if (!existsSync(capturePath)) throw new Error(`selected RR1 run is missing capture.json: ${capturePath}`);
  const capture = JSON.parse(readFileSync(capturePath, "utf8")) as { recordingClocks?: unknown };
  if (capture.recordingClocks === undefined) throw new Error(`capture.json missing recordingClocks: ${capturePath}`);

  return { kind: "run", run, storeRoot };
}

export function currentRr1RunSelection(): Rr1RunSelection {
  const selected = process.env["RR1_RUN_UNDER_TEST"];
  const storeRoot = process.env["RR1_STORE_ROOT"]
    ?? (selected !== undefined && isAbsolute(selected) ? dirname(selected) : DEFAULT_RR1_STORE_ROOT);
  return resolveRr1RunSelection({ selectedRun: selected, storeRoot });
}

export function rr1RunUnderTest(selection: Rr1RunSelection): string {
  if (selection.kind === "skip") throw new Error(selection.reason);
  return selection.run;
}

export function requireRunArtifact(run: string, relativePath: string): string {
  if (!existsSync(run)) throw new Error(`selected RR1 run directory is missing: ${run}`);
  const artifact = join(run, relativePath);
  if (!existsSync(artifact)) throw new Error(`selected RR1 run is missing ${relativePath}: ${artifact}`);
  return artifact;
}
