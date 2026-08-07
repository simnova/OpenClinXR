/**
 * #149 — generic metadata-labelled cue prop removal inspector.
 *
 * Enumerates stations from SHIPPED scene manifests under
 * apps/ui-xr/public/xr-assets/generated/, reads declared roomProps, and measures
 * which propIds have a rendered .body mesh in the LIVE scene.
 *
 * claimScope: whether authoring-metadata labels (scoring objective, raw trace tag,
 * faculty review cue, scenario title as prop label) reach learner-visible geometry.
 * notEvidenceFor: prop activation, equipment (#140), clinical room content (#133),
 * Quest readiness, scoring validity.
 *
 * THE FIX IS TO STOP EMITTING THEM AT THE FACTORY (generic preset quartet), not to
 * activate them. Activating would resurrect #127 exam-security leakage as room labels.
 */

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { spawnPortlessDevServer, type PortlessDevServer } from "./lib/portless-server.js";
import {
  tryReadStampedArtifact,
  withTreeStamp,
  type MeasurementTreeStamp,
} from "./lib/measurement-tree-stamp.js";
import {
  ROOM_CAPTURE_MODE,
  buildRoomCaptureUrl,
  waitForStationShell,
} from "./ui-xr-environment-room-capture.js";

export const GENERIC_CUE_EVIDENCE_DIR = ".openclinxr/evidence/issue-149";
export const PRE_FIX_NAME = "pre-fix.json";

export type MetadataLabelledProp = {
  propId: string;
  label: string;
  reason: string;
};

export type StationProps = {
  scenarioId: string;
  /** propIds in the SHIPPED scene manifest. */
  declaredPropIds: string[];
  /** propIds with a rendered body mesh in the LIVE scene. */
  renderedPropIds: string[];
  /** Rendered props whose label is a clinical objective, a raw trace tag, or faculty-facing text. */
  metadataLabelledRenderedProps: MetadataLabelledProp[];
};

export type GenericCuePropRemovalReport = {
  stations: StationProps[];
};

type DeclaredProp = {
  propId: string;
  label: string;
  semanticRole?: string;
  evidenceCue?: string;
};

type ArtifactPayload = {
  schemaVersion: "openclinxr.generic-cue-prop-removal.v1";
  kind: "generic_cue_prop_removal_live";
  label: string;
  generatedAt: string;
  treeStamp: MeasurementTreeStamp;
  claimScope: string[];
  notEvidenceFor: string[];
  report: GenericCuePropRemovalReport;
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const generatedRoot = path.join(repoRoot, "apps/ui-xr/public/xr-assets/generated");

let cachedReport: GenericCuePropRemovalReport | null = null;
let measureInFlight: Promise<GenericCuePropRemovalReport> | null = null;

function preFixPath(): string {
  return path.join(GENERIC_CUE_EVIDENCE_DIR, PRE_FIX_NAME);
}

/** Stations = every shipped scene-manifest directory (never a hardcoded list). */
export async function listShippedScenarioManifestIds(): Promise<string[]> {
  if (!existsSync(generatedRoot)) return [];
  const entries = await readdir(generatedRoot, { withFileTypes: true });
  const ids: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(generatedRoot, entry.name, "scene-manifest.v1.json");
    if (existsSync(manifestPath)) ids.push(entry.name);
  }
  return ids.sort();
}

export async function readDeclaredRoomProps(scenarioId: string): Promise<DeclaredProp[]> {
  const manifestPath = path.join(generatedRoot, scenarioId, "scene-manifest.v1.json");
  if (!existsSync(manifestPath)) return [];
  const raw = JSON.parse(await readFile(manifestPath, "utf8")) as {
    roomProps?: Array<{
      propId?: string;
      label?: string;
      semanticRole?: string;
      evidenceCue?: string;
    }>;
  };
  const roomProps = Array.isArray(raw.roomProps) ? raw.roomProps : [];
  return roomProps
    .filter((p): p is { propId: string; label: string; semanticRole?: string; evidenceCue?: string } =>
      typeof p.propId === "string" && p.propId.length > 0)
    .map((p) => ({
      propId: p.propId,
      label: typeof p.label === "string" ? p.label : p.propId,
      ...(typeof p.semanticRole === "string" ? { semanticRole: p.semanticRole } : {}),
      ...(typeof p.evidenceCue === "string" ? { evidenceCue: p.evidenceCue } : {}),
    }));
}

/**
 * Classify a declared/live prop as authoring-metadata leakage (#149).
 * Reasons are stable strings for pre-fix and contracts.
 */
export function classifyMetadataLabel(input: {
  propId: string;
  label: string;
  semanticRole?: string;
}): { isMetadata: boolean; reason: string } {
  const propId = input.propId;
  const label = input.label.trim();
  const role = input.semanticRole ?? "";

  // Generic quartet suffixes from factory generic preset.
  if (/-objective-cue$/u.test(propId) || role === "objective_cue") {
    // Hand-authored ED/telehealth may use objective_cue with clinical object names — only flag
    // when the propId is the factory slug pattern OR the label is clearly an exam objective.
    if (/-objective-cue$/u.test(propId)) {
      return { isMetadata: true, reason: "clinical_objective_as_prop_label" };
    }
  }
  if (/-communication-cue$/u.test(propId)) {
    return { isMetadata: true, reason: "raw_trace_tag_as_prop_label" };
  }
  if (/-review-cue$/u.test(propId) || label === "Faculty review evidence cue") {
    return { isMetadata: true, reason: "faculty_review_text_as_prop_label" };
  }
  if (/-primary-context$/u.test(propId)) {
    return { isMetadata: true, reason: "scenario_title_as_prop_label" };
  }

  // Label-shape heuristics for residual / renamed leak paths.
  if (label === "Faculty review evidence cue") {
    return { isMetadata: true, reason: "faculty_review_text_as_prop_label" };
  }
  // Raw trace tags are snake_case tokens with no spaces (e.g. history_opqrst).
  if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/u.test(label) && label.length >= 8) {
    return { isMetadata: true, reason: "raw_trace_tag_as_prop_label" };
  }

  return { isMetadata: false, reason: "" };
}

/**
 * Signature consumed by generic-cue-prop-removal.test.ts planted contracts.
 * Measures once across the full shipped manifest bank (shared across vitest cases).
 */
export async function inspectGenericCuePropRemoval(input?: {
  baseUrl?: string;
  force?: boolean;
  label?: string;
  scenarioIds?: string[];
  /** When true, write/overwrite pre-fix.json (must be done BEFORE product edits). */
  writePreFix?: boolean;
}): Promise<GenericCuePropRemovalReport> {
  if (!input?.force && !input?.writePreFix && cachedReport) return cachedReport;
  if (!input?.force && !input?.writePreFix && measureInFlight) return measureInFlight;

  measureInFlight = (async () => {
    if (!input?.force && !input?.writePreFix && !input?.scenarioIds) {
      if (process.env.OPENCLINXR_GENERIC_CUE_USE_DISK === "1") {
        const fromDisk = await tryReadArtifact(preFixPath());
        if (fromDisk) {
          cachedReport = fromDisk;
          return fromDisk;
        }
      }
    }

    const report = await measureLiveRoomProps({
      baseUrl: input?.baseUrl,
      scenarioIds: input?.scenarioIds,
    });

    if (input?.writePreFix) {
      await writeGenericCueDump(report, {
        outputPath: preFixPath(),
        label: input?.label ?? "pre-fix",
      });
    }

    if (!input?.scenarioIds) {
      cachedReport = report;
    }
    return report;
  })();

  try {
    return await measureInFlight;
  } finally {
    measureInFlight = null;
  }
}

async function tryReadArtifact(filePath: string): Promise<GenericCuePropRemovalReport | null> {
  return tryReadStampedArtifact(filePath, (parsed) => {
    const report = parsed.report as GenericCuePropRemovalReport | undefined;
    if (
      report?.stations
      && Array.isArray(report.stations)
      && report.stations.length > 0
    ) {
      return report;
    }
    return null;
  });
}

export async function writeGenericCueDump(
  report: GenericCuePropRemovalReport,
  input?: { outputPath?: string; label?: string },
): Promise<string> {
  const outputPath = input?.outputPath ?? preFixPath();
  await mkdir(path.dirname(outputPath), { recursive: true });
  const payload = withTreeStamp({
    schemaVersion: "openclinxr.generic-cue-prop-removal.v1" as const,
    kind: "generic_cue_prop_removal_live" as const,
    label: input?.label ?? "measurement",
    generatedAt: new Date().toISOString(),
    claimScope: [
      "shipped_scene_manifest_roomProps",
      "live_scene_room_prop_body_meshes",
      "metadata_label_classification_objective_trace_tag_faculty_review",
    ],
    notEvidenceFor: [
      "prop_activation_path",
      "equipment_mounting",
      "clinical_room_content_authoring",
      "quest_readiness",
      "scoring_validity",
    ],
    report,
  }) satisfies ArtifactPayload;
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`generic-cue-prop-removal: wrote ${outputPath}\n`);
  return outputPath;
}

async function measureLiveRoomProps(input: {
  baseUrl?: string;
  scenarioIds?: string[];
}): Promise<GenericCuePropRemovalReport> {
  const scenarios =
    input.scenarioIds && input.scenarioIds.length > 0
      ? input.scenarioIds
      : await listShippedScenarioManifestIds();

  if (scenarios.length === 0) {
    throw new Error("inspectGenericCuePropRemoval: listShippedScenarioManifestIds returned empty");
  }

  let server: PortlessDevServer | undefined;
  let ownedServer = false;
  try {
    const baseUrl =
      input.baseUrl
      ?? (await (async () => {
        ownedServer = true;
        server = await spawnPortlessDevServer({
          filter: "@openclinxr/ui-xr",
          readyTimeoutMs: 180_000,
        });
        return server.url;
      })());

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      try {
        const stations: StationProps[] = [];
        for (const scenarioId of scenarios) {
          process.stdout.write(`generic-cue-prop-removal: goto ${scenarioId}\n`);
          const declared = await readDeclaredRoomProps(scenarioId);
          const declaredPropIds = declared.map((p) => p.propId).sort();
          const labelById = new Map(declared.map((p) => [p.propId, p]));

          const url = buildRoomCaptureUrl(baseUrl, scenarioId, ROOM_CAPTURE_MODE);
          await page.goto(url, { waitUntil: "load", timeout: 180_000 });
          await waitForStationShell(page, 180_000);
          await waitForRoomPropFrames(page, 120_000);
          await page.waitForTimeout(800);

          const live = await readLiveRoomPropsFromPage(page);
          const sid = live.scenarioId || scenarioId;
          const renderedPropIds = [...live.renderedPropIds].sort();

          const metadataLabelledRenderedProps: MetadataLabelledProp[] = [];
          for (const propId of renderedPropIds) {
            const declaredRow = labelById.get(propId);
            // Prefer live label when present; fall back to declared.
            const liveLabel = live.labelByPropId[propId];
            const label = (liveLabel && liveLabel.length > 0)
              ? liveLabel
              : (declaredRow?.label ?? propId);
            const classification = classifyMetadataLabel({
              propId,
              label,
              semanticRole: declaredRow?.semanticRole,
            });
            if (classification.isMetadata) {
              metadataLabelledRenderedProps.push({
                propId,
                label,
                reason: classification.reason,
              });
            }
          }

          stations.push({
            scenarioId: sid,
            declaredPropIds,
            renderedPropIds,
            metadataLabelledRenderedProps,
          });

          process.stdout.write(
            `  ${sid} declared=${declaredPropIds.length} rendered=${renderedPropIds.length} `
            + `metadata=${metadataLabelledRenderedProps.length}`
            + (metadataLabelledRenderedProps.length > 0
              ? ` [${metadataLabelledRenderedProps.map((m) => m.propId).join(",")}]`
              : "")
            + "\n",
          );
        }
        return { stations };
      } finally {
        await page.close().catch(() => undefined);
      }
    } finally {
      await browser.close().catch(() => undefined);
    }
  } finally {
    if (ownedServer && server) {
      try {
        server.proc.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
  }
}

async function waitForRoomPropFrames(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    () => {
      const win = window as unknown as {
        __openClinXrFrameStats?: { framesObserved?: number };
        __openClinXrDebugScene?: { traverse?: (cb: (o: unknown) => void) => void };
        __openClinXrRuntimeSceneManifestEvidence?: { propIds?: unknown };
      };
      const frames = win.__openClinXrFrameStats?.framesObserved ?? 0;
      if (frames < 6) return false;
      if (win.__openClinXrRuntimeSceneManifestEvidence?.propIds) return true;
      const scene = win.__openClinXrDebugScene;
      return Boolean(scene?.traverse);
    },
    undefined,
    { timeout: timeoutMs },
  );
}

/**
 * String IIFE so tsx/esbuild cannot inject `__name` into the browser.
 * Room prop groups are named `openclinxr.<scenario>.room-prop.<propId>` with child `.body`.
 */
export async function readLiveRoomPropsFromPage(page: Page): Promise<{
  scenarioId: string;
  renderedPropIds: string[];
  labelByPropId: Record<string, string>;
}> {
  return page.evaluate(`(() => {
    const win = window;
    const scene = win.__openClinXrDebugScene;
    const params = new URLSearchParams(window.location.search);
    let scenarioId = params.get("openclinxrScenarioId") || params.get("scenarioId") || "";
    if (scene && scene.userData && scene.userData.openClinXrStationEnvironment &&
        typeof scene.userData.openClinXrStationEnvironment.scenarioId === "string") {
      scenarioId = scene.userData.openClinXrStationEnvironment.scenarioId || scenarioId;
    }

    const rendered = new Set();
    const labelByPropId = {};

    // ONLY count props that have a rendered body mesh (main.ts:6099-6102).
    // Evidence propIds alone are declarations, not geometry.
    if (scene && typeof scene.traverse === "function") {
      scene.traverse(function (object) {
        if (!object || typeof object.name !== "string") return;
        const name = object.name;
        // Body mesh: openclinxr.<scenario>.room-prop.<propId>.body
        if (name.indexOf(".room-prop.") < 0 || !name.endsWith(".body")) return;
        // Require an actual Mesh body, not a named empty.
        if (!object.isMesh && object.type !== "Mesh") return;
        const marker = ".room-prop.";
        const idx = name.lastIndexOf(marker);
        if (idx < 0) return;
        const after = name.slice(idx + marker.length);
        const propId = after.endsWith(".body") ? after.slice(0, -".body".length) : after;
        if (propId.length === 0) return;
        rendered.add(propId);
      });
    }

    return {
      scenarioId: scenarioId,
      renderedPropIds: Array.from(rendered),
      labelByPropId: labelByPropId,
    };
  })()`) as Promise<{
    scenarioId: string;
    renderedPropIds: string[];
    labelByPropId: Record<string, string>;
  }>;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let writePreFix = false;
  let force = false;
  const scenarioIds: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === "--write-pre-fix") writePreFix = true;
    else if (arg === "--force") force = true;
    else if (arg === "--scenario" && args[i + 1]) scenarioIds.push(args[++i]!);
  }

  const report = await inspectGenericCuePropRemoval({
    force,
    writePreFix,
    scenarioIds: scenarioIds.length > 0 ? scenarioIds : undefined,
    label: writePreFix ? "pre-fix" : "measure",
  });

  if (!writePreFix) {
    // Never clobber pre-fix.json — that artifact is the before-edit proof.
    await writeGenericCueDump(report, {
      outputPath: path.join(GENERIC_CUE_EVIDENCE_DIR, "measure.json"),
      label: "measure",
    });
  }

  const metadataCount = report.stations.reduce(
    (n, s) => n + s.metadataLabelledRenderedProps.length,
    0,
  );
  process.stdout.write(
    `generic-cue-prop-removal: stations=${report.stations.length} metadataLabelled=${metadataCount}\n`,
  );
}

const isDirectRun =
  typeof process.argv[1] === "string"
  && (process.argv[1].endsWith("generic-cue-prop-removal.ts")
    || process.argv[1].endsWith("generic-cue-prop-removal.js"));

if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
