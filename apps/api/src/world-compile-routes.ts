import { mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Hono } from "hono";
import { hasFacultyAccess } from "@openclinxr/auth";
import type { ApiAppContext } from "./api-app-context.js";
import type { ApiAppVariables } from "./api-types.js";
import { repoRoot } from "./scenario-promotion-io.js";

/**
 * Faculty world-compile route (WCG faculty button -> API).
 *
 * The admin UI compileEncounterWorld POSTs /internal/world-compile with a
 * scenarioId; this route invokes compileEncounterMaterialization (the World
 * Compile Graph compile runner in tools/openclinxr/factory) against the newest
 * dated encounter-materialization-evidence JSON for the scenario under
 * docs/openclinxr/ and writes the compiled report under the gitignored
 * .openclinxr/evidence/world-compile/ dir. The compile plans wardrobe bakes
 * (compileNodes with wouldInvoke/skippedBakers) and honours the faculty
 * compile-locks the API itself persists — it never spawns Blender and never
 * promotes or publishes a packet.
 *
 * The runner is loaded through a non-static import specifier (same pattern as
 * the Mongo boot in bun-server.ts/server.ts) so apps/api never statically
 * depends on tools/openclinxr source.
 */
export function registerWorldCompileRoutes(app: Hono<{ Variables: ApiAppVariables }>, _ctx: ApiAppContext): void {
  app.post("/internal/world-compile", async (context) => {
    if (!hasFacultyAccess(context.get("identity"))) {
      return context.json({ error: "forbidden", reason: "faculty_role_required" }, 403);
    }

    const body = (await context.req.json().catch(() => ({}))) as { scenarioId?: unknown };
    const scenarioId =
      typeof body.scenarioId === "string" && body.scenarioId.trim().length > 0 ? body.scenarioId.trim() : undefined;
    if (!scenarioId || !SCENARIO_ID_PATTERN.test(scenarioId)) {
      return context.json({ error: "invalid_body", reason: "scenarioId_required" }, 400);
    }

    const priorPath = await resolvePriorEvidencePathForScenario(scenarioId);
    if (!priorPath) {
      return context.json(
        {
          error: "no_prior_evidence",
          reason: `no dated encounter-materialization evidence JSON for ${scenarioId} under docs/openclinxr/; compileEncounterMaterialization requires a prior report or a bundle report`,
        },
        409,
      );
    }

    // Load the compile runner through a non-static specifier so the default
    // build graph stays tools-free and the typecheck never resolves it.
    const compileSpecifier = "../../../tools/openclinxr/factory/encounter-materialization-compile.js";
    const compileModule = (await import(compileSpecifier)) as WorldCompileModule;

    const outPath = join(COMPILE_OUT_DIR, `${scenarioId}-${new Date().toISOString().slice(0, 10)}.json`);
    await mkdir(dirname(outPath), { recursive: true });

    try {
      const result = await compileModule.compileEncounterMaterialization({ priorPath, outPath });
      const nodes = (result.report.compileNodes ?? []) as Array<{ wouldInvoke?: string | null }>;
      return context.json({
        schemaVersion: "openclinxr.world-compile.api.v1",
        scenarioId,
        claimBoundary: "faculty_world_compile_plan_only",
        notEvidenceFor: ["live_blender_bake", "review_packet_promotion", "quest_readiness"],
        compileVersion: result.compileVersion,
        nodeCount: nodes.length,
        wouldInvokeBlenderCount: nodes.filter((node) => node.wouldInvoke === "blender").length,
        skippedBakers: result.skippedBakers,
        priorPath: pathRelativeToRepo(priorPath),
        outPath: pathRelativeToRepo(outPath),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown_world_compile_error";
      return context.json({ error: "world_compile_failed", reason }, 500);
    }
  });
}

/** Scenario ids are slug-like; refuse anything that could escape a directory. */
const SCENARIO_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

/** Directory that ships dated encounter-materialization evidence JSONs (WCG prior reports). */
const PRIOR_EVIDENCE_DIR = join(repoRoot(), "docs", "openclinxr");

/** Gitignored compile-output directory for world-compile runs. */
const COMPILE_OUT_DIR = join(repoRoot(), ".openclinxr", "evidence", "world-compile");

/**
 * Resolve the newest dated encounter-materialization evidence JSON for a case
 * (e.g. peds_asthma_parent_anxiety_v1 ->
 * encounter-materialization-evidence-peds-asthma-parent-anxiety-2026-05-28.json).
 * The dated file name drops the `_vN` suffix and hyphenates; the compile's own
 * datedSiblingPath keeps the raw scenarioId, so both spellings are accepted.
 * Returns null when no dated JSON validates for the case — compile requires a
 * prior report or a bundle report.
 */
export async function resolvePriorEvidencePathForScenario(scenarioId: string): Promise<string | null> {
  const accepted = new Set([scenarioId, scenarioId.replace(/_(?:v\d+|\d+)$/, "")]);
  let entries: string[] = [];
  try {
    entries = await readdir(PRIOR_EVIDENCE_DIR);
  } catch {
    return null;
  }
  let best: { path: string; date: string } | null = null;
  for (const entry of entries) {
    const match = /^encounter-materialization-evidence-(.+)-(\d{4}-\d{2}-\d{2})\.json$/.exec(entry);
    if (!match) continue;
    if (!accepted.has(match[1]!.replace(/-/g, "_"))) continue;
    if (!best || match[2]! > best.date) {
      best = { path: join(PRIOR_EVIDENCE_DIR, entry), date: match[2]! };
    }
  }
  if (!best) return null;
  // The file must actually be evidence.v1 for THIS case before a compile runs against it.
  try {
    const raw = JSON.parse(await readFile(best.path, "utf8")) as { schemaVersion?: unknown; scenarioId?: unknown };
    if (raw.schemaVersion !== "openclinxr.encounter-materialization-evidence.v1" || raw.scenarioId !== scenarioId) {
      return null;
    }
  } catch {
    return null;
  }
  return best.path;
}

/** Structural view of the factory compile runner (loaded non-statically). */
type WorldCompileModule = {
  compileEncounterMaterialization: (opts: {
    priorPath: string;
    outPath?: string;
  }) => Promise<{
    compileVersion: number;
    skippedBakers: string[];
    report: { scenarioId?: string | null; compileNodes?: unknown[] };
  }>;
};

function pathRelativeToRepo(absolutePath: string): string {
  const root = repoRoot();
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return absolutePath.startsWith(prefix) ? absolutePath.slice(prefix.length) : absolutePath;
}
