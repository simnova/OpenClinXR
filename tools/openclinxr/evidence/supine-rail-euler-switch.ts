/**
 * #496 — measure the supine euler switch across BOTH rails through the runtime pose call.
 *
 * Drives the EXISTING isolated-subject-lab (apps/ui-xr/src/isolated-subject-lab.ts,
 * `subjectKind: "runtime_posture"`) — no room, no HUD, no other actors, product
 * three.js stack — through the real `applyAndPlantSupineOnDeck` → `applySupinePose`
 * call with DEFAULT options, then reads the supine joint dump the lab records.
 *
 * Two bodies, one code path, no ablation flags:
 *   anny    generated-humanoids/ed_chest_pain_adult_cast.glb   (23 joints — keeps the eulers)
 *   mpfb    generated-humanoids/mpfb-gown-adult-patient.glb    (137 joints — skips them, #496)
 *
 * The artifact records, per rail: bodyGlb, rail, jointCount (collectJointNames size),
 * and appliedJointEulers (openClinXrSupinePoseBones length after the pose call). It
 * asserts the SWITCH, not appearance — root_only and full share AABB metrics to three
 * decimals, so the person-vs-wad verdict is the orchestrator's pixel grade, never this.
 *
 * Deliverable: `supine-rail-euler-switch.json` (tracked — `.openclinxr/evidence/**`
 * is gitignored and has no land path, #396).
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
const REPORT_PATH = join(HERE, "supine-rail-euler-switch.json");

const ANNY_GLB = "generated-humanoids/ed_chest_pain_adult_cast.glb";
const MPFB_GLB = "generated-humanoids/mpfb-gown-adult-patient.glb";

type Rail = {
  bodyGlb: string;
  rail: "mpfb" | "anny";
  jointCount: number;
  appliedJointEulers: boolean;
};

type Report = {
  schemaVersion: string;
  obtainedBy: string;
  rails: Rail[];
};

type LabDump = {
  bodyGlb: string;
  jointCount: number;
  appliedJointEulers: boolean;
};

const OBTAINED_BY =
  "isolated-subject-lab runtime_posture path: applyAndPlantSupineOnDeck → applySupinePose "
  + "with default options on a loaded three.js graph; jointCount from collectJointNames over live "
  + "Bone + skeleton.bones; appliedJointEulers from openClinXrSupinePoseBones after the product pose call";

function subjectUrl(baseUrl: string, bodyGlb: string, subjectId: string): string {
  const params = new URLSearchParams();
  params.set(
    "subject",
    JSON.stringify({ subjectId, subjectKind: "runtime_posture", posture: "supine", bodyGlb, label: subjectId }),
  );
  return `${baseUrl.replace(/\/?$/, "/")}isolated-subject.html?${params.toString()}`;
}

async function captureRail(page: Page, baseUrl: string, bodyGlb: string, subjectId: string): Promise<LabDump> {
  const url = subjectUrl(baseUrl, bodyGlb, subjectId);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForFunction(
    () => {
      const w = browserPageWindow as unknown as {
        __openClinXrSupineJointDump?: LabDump;
        __openClinXrIsolatedSubjectEvidence?: { meshCount?: number };
      };
      if ((w.__openClinXrIsolatedSubjectEvidence?.meshCount ?? 0) > 0 && w.__openClinXrSupineJointDump) {
        return true;
      }
      const app = browserPageDocument.querySelector("#app");
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
    () => (browserPageWindow as unknown as { __openClinXrSupineJointDump?: LabDump }).__openClinXrSupineJointDump ?? null,
  );
  if (!lab) {
    throw new Error(`no supine joint dump recorded for ${bodyGlb}`);
  }
  return lab;
}

/**
 * Measure both rails through the runtime pose call and write the tracked deliverable.
 */
export async function runSupineRailEulerSwitch(options?: {
  cwd?: string;
  force?: boolean;
}): Promise<Report> {
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

    const anny = await captureRail(page, server.url, ANNY_GLB, "supine_rail_anny");
    const mpfb = await captureRail(page, server.url, MPFB_GLB, "supine_rail_mpfb");

    const railOf = (lab: LabDump, rail: "mpfb" | "anny"): Rail => ({
      bodyGlb: lab.bodyGlb,
      rail,
      jointCount: lab.jointCount,
      appliedJointEulers: lab.appliedJointEulers,
    });

    const report: Report = {
      schemaVersion: "supine-rail-euler-switch.v1",
      obtainedBy: OBTAINED_BY,
      rails: [railOf(anny, "anny"), railOf(mpfb, "mpfb")],
    };

    await mkdir(dirname(REPORT_PATH), { recursive: true });
    await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return report;
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
  runSupineRailEulerSwitch({ force: true })
    .then((report) => {
      console.log(`wrote ${REPORT_PATH}`);
      console.log(JSON.stringify(report, null, 2));
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}
