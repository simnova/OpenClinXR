/**
 * #493 — third instrument on #492. MEASURE ONLY; `reject_measured` closes successfully.
 *
 * Drives the EXISTING isolated-subject-lab (apps/ui-xr/src/isolated-subject-lab.ts,
 * `subjectKind: "runtime_posture"`) — no room, no HUD, no other actors, product
 * three.js stack — through the real `applyAndPlantSupineOnDeck` pose call, then reads
 * the world-space joint dump the lab records (`window.__openClinXrSupineJointDump`).
 *
 * Two bodies, one code path:
 *   control    generated-humanoids/ed_chest_pain_adult_cast.glb   (Anny — posed for years)
 *   treatment  generated-humanoids/mpfb-gown-adult-patient.glb    (the recast body)
 *
 * The artifact answers: for the SAME pose call on two bodies, which measured quantity
 * differs, and by how much. It does NOT diagnose a cause (two withdrawn diagnoses on
 * this defect are the reason this is a measurement slice).
 *
 * Deliverable: `supine-pose-two-subject-dump.json` (tracked — an artifact under
 * `.openclinxr/evidence/**` is gitignored and has no land path, #396).
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import {
  spawnPortlessDevServer, stopPortlessDevServer,
  type PortlessDevServer,
} from "./lib/portless-server.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DUMP_PATH = join(HERE, "supine-pose-two-subject-dump.json");

const CONTROL_GLB = "generated-humanoids/ed_chest_pain_adult_cast.glb";
const TREATMENT_GLB = "generated-humanoids/mpfb-gown-adult-patient.glb";

/** A scalar whose control/treatment delta is at least this (m) is NAMED as differing. */
const DIFF_EPSILON_M = 0.01;

type WorldPoint = { x: number; y: number; z: number };

type Subject = {
  bodyGlb: string;
  obtainedBy: string;
  worldJoints: Record<string, WorldPoint>;
  resolvedBones: Record<string, string | null>;
  posedMeshAabb: { min: WorldPoint; max: WorldPoint };
  meshCount: number;
};

type Dump = {
  schemaVersion: string;
  verdict: "difference_named" | "reject_measured" | "other";
  verdictNote: string;
  differingQuantities: { name: string; control: number; treatment: number; deltaMeters: number }[];
  subjects: Subject[];
};

type LabDump = {
  subjectKind: string;
  bodyGlb: string;
  obtainedBy: string;
  worldJoints: Record<string, WorldPoint>;
  resolvedBones: Record<string, string | null>;
  posedMeshAabb: { min: WorldPoint; max: WorldPoint };
  meshCount: number;
};

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

function subjectUrl(baseUrl: string, bodyGlb: string, subjectId: string): string {
  const params = new URLSearchParams();
  params.set(
    "subject",
    JSON.stringify({ subjectId, subjectKind: "runtime_posture", posture: "supine", bodyGlb, label: subjectId }),
  );
  return `${baseUrl.replace(/\/?$/, "/")}isolated-subject.html?${params.toString()}`;
}

async function captureSubject(page: Page, baseUrl: string, bodyGlb: string, subjectId: string): Promise<Subject> {
  const url = subjectUrl(baseUrl, bodyGlb, subjectId);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForFunction(
    () => {
      const w = window as unknown as {
        __openClinXrSupineJointDump?: LabDump;
        __openClinXrIsolatedSubjectEvidence?: { meshCount?: number };
      };
      if ((w.__openClinXrIsolatedSubjectEvidence?.meshCount ?? 0) > 0 && w.__openClinXrSupineJointDump) {
        return true;
      }
      const app = document.querySelector<HTMLDivElement>("#app");
      const text = app?.textContent ?? "";
      if (text.includes("Isolated subject lab error")) {
        throw new Error(`isolated subject lab refused the subject: ${text.slice(0, 2000)}`);
      }
      return false;
    },
    null,
    { timeout: 120_000 },
  );
  const lab = await page.evaluate(
    () => (window as unknown as { __openClinXrSupineJointDump?: LabDump }).__openClinXrSupineJointDump ?? null,
  );
  if (!lab) {
    throw new Error(`no supine joint dump recorded for ${bodyGlb}`);
  }
  return {
    bodyGlb,
    obtainedBy: lab.obtainedBy,
    worldJoints: lab.worldJoints,
    resolvedBones: lab.resolvedBones,
    posedMeshAabb: lab.posedMeshAabb,
    meshCount: lab.meshCount,
  };
}

function scalarQuantities(s: Subject): Record<string, number> {
  const aabb = s.posedMeshAabb;
  const q: Record<string, number> = {
    "aabb.heightMeters": aabb.max.y - aabb.min.y,
    "aabb.lengthMeters": aabb.max.x - aabb.min.x,
    "aabb.widthMeters": aabb.max.z - aabb.min.z,
    "aabb.minYMeters": aabb.min.y,
  };
  for (const [k, v] of Object.entries(s.worldJoints)) {
    q[`joint.${k}.x`] = v.x;
    q[`joint.${k}.y`] = v.y;
    q[`joint.${k}.z`] = v.z;
  }
  return q;
}

/**
 * Run the two-subject supine dump: one portless boot, one browser, two navigations.
 * Writes the tracked deliverable and returns the dump.
 */
export async function runSupineTwoSubjectDump(options?: {
  cwd?: string;
  force?: boolean;
}): Promise<Dump> {
  const cwd = options?.cwd ?? process.cwd();
  void options?.force;

  let server: PortlessDevServer | null = null;
  let browser: Browser | null = null;

  try {
    server = await spawnPortlessDevServer({
      filter: "@openclinxr/ui-xr",
      cwd,
      readyTimeoutMs: 180_000,
    });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 960 }, deviceScaleFactor: 1 });

    const control = await captureSubject(page, server.url, CONTROL_GLB, "supine_control");
    const treatment = await captureSubject(page, server.url, TREATMENT_GLB, "supine_treatment");

    const cQ = scalarQuantities(control);
    const tQ = scalarQuantities(treatment);
    const differingQuantities: Dump["differingQuantities"] = [];
    for (const name of Object.keys(cQ)) {
      if (!(name in tQ)) continue;
      const controlVal = cQ[name] ?? 0;
      const treatmentVal = tQ[name] ?? 0;
      const deltaMeters = treatmentVal - controlVal;
      if (Math.abs(deltaMeters) >= DIFF_EPSILON_M) {
        differingQuantities.push({
          name,
          control: round3(controlVal),
          treatment: round3(treatmentVal),
          deltaMeters: round3(deltaMeters),
        });
      }
    }

    const verdict: Dump["verdict"] = differingQuantities.length > 0 ? "difference_named" : "reject_measured";
    const env = (name: string) => {
      const h = cQ[name];
      const t = tQ[name];
      return h !== undefined && t !== undefined ? `control=${round3(h)} treatment=${round3(t)}` : "n/a";
    };
    const verdictNote = verdict === "difference_named"
      ? `Same applyAndPlantSupineOnDeck call on both bodies produced ${differingQuantities.length} `
        + `named quantities differing by >= ${DIFF_EPSILON_M} m. Envelope height ${env("aabb.heightMeters")}; `
        + `length ${env("aabb.lengthMeters")}; width ${env("aabb.widthMeters")}. `
        + `Measure only — whether any difference is rig scale vs postural is NOT diagnosed here.`
      : `No measured quantity differs by >= ${DIFF_EPSILON_M} m between the two bodies after the same pose call; `
        + `the pose reads identically and the defect is downstream (skinning/gown/capture). Measure only.`;

    const dump: Dump = {
      schemaVersion: "supine-pose-two-subject-dump.v1",
      verdict,
      verdictNote,
      differingQuantities,
      subjects: [control, treatment],
    };

    await mkdir(join(DUMP_PATH, ".."), { recursive: true });
    await writeFile(DUMP_PATH, `${JSON.stringify(dump, null, 2)}\n`, "utf8");
    return dump;
  } finally {
    if (browser) await browser.close();
    if (server) await stopPortlessDevServer(server.proc);
  }
}

// CLI — only when this file is the entrypoint (never on import).
const mainArg = process.argv[1] ?? "";
const isMain = mainArg !== ""
  && (import.meta.url === `file://${resolve(mainArg)}`
    || import.meta.url.endsWith(mainArg.replaceAll("\\", "/")));

if (isMain) {
  runSupineTwoSubjectDump({ force: true })
    .then((dump) => {
      console.log(`wrote ${DUMP_PATH}`);
      console.log(JSON.stringify({
        verdict: dump.verdict,
        verdictNote: dump.verdictNote,
        differingQuantities: dump.differingQuantities,
      }, null, 2));
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}
