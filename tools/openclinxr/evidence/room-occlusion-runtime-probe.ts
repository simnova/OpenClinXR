/**
 * #523 R1 — runtime probe: does GLTFLoader→three.js surface baked occlusion on a shipped room?
 *
 * Reuses isolated-subject-lab (`subjectKind: "glb"`) + spawnPortlessDevServer. Does not tune
 * aoMapIntensity and does not touch room GLBs.
 */
import { writeFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, type Page } from "playwright";
import {
  spawnPortlessDevServer,
  stopPortlessDevServer,
  type PortlessDevServer,
} from "./lib/portless-server.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = pathResolve(HERE, "../../..");
export const ROOM_OCCLUSION_RUNTIME_REPORT = join(
  REPO,
  "tools/openclinxr/evidence/room-occlusion-runtime-report.json",
);

/** Default: parametric shell — known 15/15 AO carrier with the densest material set. */
export const DEFAULT_ROOM_GLB = "xr-assets/environment/ed-exam-bay-shell.glb";

/**
 * Bank sample for R1 close: shell (control) + one ACCEPT-graded Infinigen + the 2-of-3 AO outlier.
 * Same loader path; different bake/material populations.
 */
export const DEFAULT_ROOM_GLBS: readonly string[] = [
  DEFAULT_ROOM_GLB,
  "xr-assets/environment/infinigen-primary-care-clinic.glb",
  "xr-assets/environment/infinigen-stepdown.glb",
];

export type RoomOcclusionRow = {
  room: string;
  materials: number;
  withAoMap: number;
  aoMapIntensities: number[];
  aoMapUvSet: number | null;
};

export type RoomOcclusionRuntimeReport = {
  schemaVersion: "openclinxr.room-occlusion-runtime.v1";
  generatedAt: string;
  probedBy: string;
  forcedIntensity: false;
  rooms: RoomOcclusionRow[];
  claimScope: string;
  notEvidenceFor: string[];
};

function subjectUrl(baseUrl: string, bodyGlb: string): string {
  const spec = {
    subjectId: "room_occlusion_r1",
    subjectKind: "glb",
    bodyGlb,
    label: "room AO runtime probe (#523)",
  };
  const params = new URLSearchParams();
  params.set("subject", JSON.stringify(spec));
  return `${baseUrl.replace(/\/?$/, "/")}isolated-subject.html?${params.toString()}`;
}

/**
 * String IIFE so tsx/esbuild cannot inject `__name` into the browser (idle-arm-hang pattern).
 * Reads live MeshStandard/Physical materials after GLTFLoader has mapped occlusionTexture → aoMap.
 */
async function readAoFromIsolatedScene(page: Page): Promise<{
  materials: number;
  withAoMap: number;
  aoMapIntensities: number[];
  aoMapUvSet: number | null;
  meshCount: number;
}> {
  return page.evaluate(`(() => {
    const root = window.__openClinXrIsolatedSceneRoot;
    if (!root || typeof root.traverse !== "function") {
      return { materials: 0, withAoMap: 0, aoMapIntensities: [], aoMapUvSet: null, meshCount: 0 };
    }
    const seen = new Set();
    const intensities = [];
    const uvSets = [];
    let withAo = 0;
    let meshCount = 0;

    function consider(mat, geom) {
      if (!mat || typeof mat !== "object") return;
      if (seen.has(mat)) return;
      seen.add(mat);
      const ao = mat.aoMap;
      if (ao == null) return;
      withAo += 1;
      const intensity = typeof mat.aoMapIntensity === "number" ? mat.aoMapIntensity : null;
      if (typeof intensity === "number") intensities.push(intensity);
      let uvSet = null;
      if (ao && typeof ao.channel === "number") {
        uvSet = ao.channel;
      } else if (geom && geom.attributes && geom.attributes.uv2) {
        uvSet = 1;
      } else if (geom && geom.attributes && geom.attributes.uv) {
        uvSet = 0;
      }
      if (typeof uvSet === "number") uvSets.push(uvSet);
    }

    root.traverse(function (o) {
      if (!o.isMesh && !o.isSkinnedMesh) return;
      meshCount += 1;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (let i = 0; i < mats.length; i++) consider(mats[i], o.geometry);
    });

    let aoMapUvSet = null;
    if (uvSets.length > 0) {
      const counts = new Map();
      for (const u of uvSets) counts.set(u, (counts.get(u) || 0) + 1);
      let best = uvSets[0];
      let bestN = 0;
      for (const [u, n] of counts) {
        if (n > bestN) { best = u; bestN = n; }
      }
      aoMapUvSet = best;
    }

    return {
      materials: seen.size,
      withAoMap: withAo,
      aoMapIntensities: intensities,
      aoMapUvSet: aoMapUvSet,
      meshCount: meshCount,
    };
  })()`) as Promise<{
    materials: number;
    withAoMap: number;
    aoMapIntensities: number[];
    aoMapUvSet: number | null;
    meshCount: number;
  }>;
}

export async function probeRoomOcclusionRuntime(input?: {
  /** Single room (legacy). Prefer bodyGlbs for bank coverage. */
  bodyGlb?: string;
  bodyGlbs?: readonly string[];
  baseUrl?: string;
}): Promise<RoomOcclusionRuntimeReport> {
  const bodyGlbs =
    input?.bodyGlbs
    ?? (input?.bodyGlb ? [input.bodyGlb] : [...DEFAULT_ROOM_GLBS]);

  let server: PortlessDevServer | undefined;
  let ownedServer = false;
  try {
    const baseUrl =
      input?.baseUrl
      ?? (await (async () => {
        ownedServer = true;
        server = await spawnPortlessDevServer({
          filter: "@openclinxr/ui-xr",
          cwd: REPO,
          readyTimeoutMs: 180_000,
        });
        return server.url;
      })());

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      const rooms: RoomOcclusionRow[] = [];

      for (const bodyGlb of bodyGlbs) {
        const roomBase = bodyGlb.split("/").pop() ?? bodyGlb;
        const url = subjectUrl(baseUrl, bodyGlb);
        process.stdout.write(`room-occlusion-runtime: goto ${url}\n`);
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 180_000 });
        await page.waitForFunction(
          () => {
            const evidence = (
              window as unknown as {
                __openClinXrIsolatedSubjectEvidence?: { meshCount?: number };
              }
            ).__openClinXrIsolatedSubjectEvidence;
            return evidence && typeof evidence.meshCount === "number" && evidence.meshCount > 0;
          },
          null,
          { timeout: 180_000 },
        );
        // One paint settle so materials are fully bound.
        await page.waitForTimeout(400);
        const live = await readAoFromIsolatedScene(page);
        process.stdout.write(
          `room-occlusion-runtime: ${roomBase} meshes=${live.meshCount} materials=${live.materials} `
            + `withAoMap=${live.withAoMap} intensities=[${live.aoMapIntensities.join(",")}] `
            + `uvSet=${live.aoMapUvSet}\n`,
        );
        rooms.push({
          room: roomBase,
          materials: live.materials,
          withAoMap: live.withAoMap,
          aoMapIntensities: live.aoMapIntensities,
          aoMapUvSet: live.aoMapUvSet,
        });
      }

      return {
        schemaVersion: "openclinxr.room-occlusion-runtime.v1",
        generatedAt: new Date().toISOString(),
        probedBy:
          "playwright page.evaluate on window.__openClinXrIsolatedSceneRoot after "
          + "isolated-subject-lab subjectKind=glb load via three.js GLTFLoader "
          + `(apps/ui-xr/src/isolated-subject-lab.ts); bodyGlbs=${bodyGlbs.join(",")}`,
        forcedIntensity: false,
        rooms,
        claimScope:
          "runtime aoMap / aoMapIntensity / UV-channel observation for shipped room GLBs via isolated-subject-lab "
          + "(parametric shell + Infinigen hull sample)",
        notEvidenceFor: [
          "whether rooms LOOK better (pixel grade is the orchestrator's)",
          "occlusion colour space",
          "humanoid or clothing materials",
          "aoMapIntensity tuning (measurement only; no forcedIntensity)",
          "clinical validity",
          "quest readiness",
        ],
      };
    } finally {
      await browser.close().catch(() => undefined);
    }
  } finally {
    if (ownedServer && server) {
      try {
        await stopPortlessDevServer(server.proc);
      } catch {
        // ignore
      }
    }
  }
}

export async function writeRoomOcclusionRuntimeReport(
  input?: { bodyGlb?: string; bodyGlbs?: readonly string[]; outPath?: string },
): Promise<{ reportPath: string; report: RoomOcclusionRuntimeReport }> {
  const report = await probeRoomOcclusionRuntime({
    bodyGlb: input?.bodyGlb,
    bodyGlbs: input?.bodyGlbs,
  });
  const outPath = input?.outPath ?? ROOM_OCCLUSION_RUNTIME_REPORT;
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`room-occlusion-runtime: wrote ${outPath}\n`);
  return { reportPath: outPath, report };
}

const isMain =
  typeof process.argv[1] === "string"
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  writeRoomOcclusionRuntimeReport()
    .then(() => {
      process.exitCode = 0;
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exitCode = 1;
    });
}
