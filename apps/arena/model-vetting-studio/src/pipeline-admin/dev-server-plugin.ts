/**
 * dev-server-plugin.ts — DEV-ONLY Vite middleware for Pipeline Administration
 * one-click promote / regenerate-index / batch-score actions.
 *
 * IMPORTANT:
 * - Wired only via `configureServer` (Vite serve mode). Never runs in `vite build`
 *   or production static hosting. This is NOT a production API.
 * - Spawns repo tools with `execFile` + arg arrays (no shell string / injection).
 * - Aesthetic asset staging only: not production, clinical, scoring, or learner readiness.
 * - batch-score joins an existing humanoid-vision-score report (no external network
 *   score call from this middleware); writes only the studio public index JSON.
 */

import { execFile } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

/** Minimal index shape for path loading (avoids static @openclinxr/model-vetting import in vite.config). */
type PipelineCandidateIndex = {
  schemaVersion: string;
  sourceVisionScoreReportPath: string | null;
  scoredCandidateCount: number;
  claimScope: string;
  notEvidenceFor: string[];
  candidates: unknown[];
  [key: string]: unknown;
};

const execFileAsync = promisify(execFile);

/** Resolve monorepo root from the studio package directory (apps/arena/model-vetting-studio). */
function resolveRepoRoot(): string {
  // vite.config.ts lives in apps/arena/model-vetting-studio → walk up 3 levels.
  return path.resolve(process.cwd(), "../../..");
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function loadCandidateIds(repoRoot: string): Promise<Set<string>> {
  const candidates = new Set<string>();
  const paths = [
    path.join(repoRoot, ".openclinxr", "asset-production", "pipeline-candidate-index.json"),
    path.join(repoRoot, "apps", "arena", "model-vetting-studio", "public", "pipeline-candidate-index.json"),
    path.join(repoRoot, "apps", "arena", "model-vetting-studio", "public", "sample-pipeline-candidate-index.json"),
  ];
  for (const indexPath of paths) {
    try {
      const raw = JSON.parse(await readFile(indexPath, "utf8")) as {
        candidates?: Array<{ candidateId?: string }>;
      };
      for (const c of raw.candidates ?? []) {
        if (typeof c.candidateId === "string" && c.candidateId) candidates.add(c.candidateId);
      }
      if (candidates.size > 0) return candidates;
    } catch {
      // try next
    }
  }
  return candidates;
}

async function loadPipelineIndexJson(repoRoot: string): Promise<{
  index: PipelineCandidateIndex;
  indexPath: string;
} | null> {
  // Dynamic import keeps vite.config load free of package TS resolution (Node ESM .js).
  const { validatePipelineCandidateIndex } = await import("@openclinxr/model-vetting");
  const paths = [
    path.join(repoRoot, "apps", "arena", "model-vetting-studio", "public", "pipeline-candidate-index.json"),
    path.join(repoRoot, ".openclinxr", "asset-production", "pipeline-candidate-index.json"),
    path.join(repoRoot, "apps", "arena", "model-vetting-studio", "public", "sample-pipeline-candidate-index.json"),
  ];
  for (const indexPath of paths) {
    try {
      const raw = JSON.parse(await readFile(indexPath, "utf8")) as unknown;
      const validation = validatePipelineCandidateIndex(raw);
      if (!validation.ok) continue;
      return { index: raw as PipelineCandidateIndex, indexPath };
    } catch {
      // try next
    }
  }
  return null;
}

/** Newest humanoid-vision-score-*.json under docs/openclinxr (lexicographic date suffix). */
async function resolveLatestVisionScoreReport(
  repoRoot: string,
): Promise<{ path: string; doc: unknown } | null> {
  const docsDir = path.join(repoRoot, "docs", "openclinxr");
  try {
    const names = (await readdir(docsDir))
      .filter((name) => /^humanoid-vision-score-.*\.json$/u.test(name))
      .sort();
    const newest = names.at(-1);
    if (!newest) return null;
    const abs = path.join(docsDir, newest);
    const doc = JSON.parse(await readFile(abs, "utf8")) as unknown;
    return { path: path.posix.join("docs", "openclinxr", newest), doc };
  } catch {
    return null;
  }
}

/**
 * Vite plugin: registers POST /__promote, /__regenerate-index, /__batch-score in dev only.
 * configureServer runs exclusively for `vite` / `vite dev` (serve), not production build.
 */
export function modelVettingDevServerPlugin(): Plugin {
  return {
    name: "openclinxr-model-vetting-dev-admin",
    apply: "serve", // hard guard: never in build
    configureServer(server) {
      // Secondary guard: only attach in serve/dev middleware.
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || req.method !== "POST") {
          next();
          return;
        }

        const url = req.url.split("?")[0] ?? "";
        if (url !== "/__promote" && url !== "/__regenerate-index" && url !== "/__batch-score") {
          next();
          return;
        }

        const repoRoot = resolveRepoRoot();
        const tsxBin = path.join(repoRoot, "node_modules", ".bin", "tsx");

        try {
          if (url === "/__batch-score") {
            // Join existing humanoid-vision-score report onto the candidate index.
            // No external network scoring from this endpoint (aesthetic inventory only).
            const body = (await readJsonBody(req)) as {
              scoresDoc?: unknown;
              sourceReportPath?: string | null;
            };
            const loaded = await loadPipelineIndexJson(repoRoot);
            if (!loaded) {
              sendJson(res, 500, { ok: false, error: "pipeline candidate index not found" });
              return;
            }

            let scoresDoc: unknown = body.scoresDoc;
            let sourceReportPath: string | null =
              typeof body.sourceReportPath === "string" ? body.sourceReportPath : null;

            if (scoresDoc === undefined) {
              if (sourceReportPath) {
                try {
                  const abs = path.isAbsolute(sourceReportPath)
                    ? sourceReportPath
                    : path.join(repoRoot, sourceReportPath);
                  // Guard: only allow reading under repo root docs/ or .openclinxr.
                  const rel = path.relative(repoRoot, abs);
                  if (rel.startsWith("..") || path.isAbsolute(rel)) {
                    sendJson(res, 400, { ok: false, error: "sourceReportPath escapes repo root" });
                    return;
                  }
                  scoresDoc = JSON.parse(await readFile(abs, "utf8")) as unknown;
                } catch (error) {
                  sendJson(res, 400, {
                    ok: false,
                    error: `unable to read sourceReportPath: ${
                      error instanceof Error ? error.message : String(error)
                    }`,
                  });
                  return;
                }
              } else if (loaded.index.sourceVisionScoreReportPath) {
                try {
                  const abs = path.join(repoRoot, loaded.index.sourceVisionScoreReportPath);
                  scoresDoc = JSON.parse(await readFile(abs, "utf8")) as unknown;
                  sourceReportPath = loaded.index.sourceVisionScoreReportPath;
                } catch {
                  // fall through to latest docs report
                }
              }
              if (scoresDoc === undefined) {
                const latest = await resolveLatestVisionScoreReport(repoRoot);
                if (!latest) {
                  sendJson(res, 400, {
                    ok: false,
                    error: "no humanoid-vision-score report found under docs/openclinxr",
                  });
                  return;
                }
                scoresDoc = latest.doc;
                sourceReportPath = latest.path;
              }
            } else if (!sourceReportPath) {
              sourceReportPath =
                loaded.index.sourceVisionScoreReportPath ??
                "inline-humanoid-vision-score-batch";
            }

            const { batchScorePipelineIndex } = await import("@openclinxr/model-vetting");
            const scored = batchScorePipelineIndex(loaded.index as never, scoresDoc, {
              sourceReportPath,
              generatedAt: new Date().toISOString(),
            });

            // Write only the studio public index (no external/docs/ui-xr writes).
            const studioIndexPath = path.join(
              repoRoot,
              "apps",
              "arena",
              "model-vetting-studio",
              "public",
              "pipeline-candidate-index.json",
            );
            await writeFile(studioIndexPath, `${JSON.stringify(scored, null, 2)}\n`, "utf8");

            sendJson(res, 200, {
              ok: true,
              index: scored,
              scoredCandidateCount: scored.scoredCandidateCount,
              sourceReportPath,
              claimScope: scored.claimScope,
              notEvidenceFor: scored.notEvidenceFor,
            });
            return;
          }

          if (url === "/__regenerate-index") {
            const script = path.join(repoRoot, "tools", "openclinxr", "evidence", "pipeline-candidate-index.ts");
            const { stdout, stderr } = await execFileAsync(tsxBin, [script], {
              cwd: repoRoot,
              maxBuffer: 8 * 1024 * 1024,
              env: { ...process.env },
            });
            let index: unknown = null;
            try {
              const indexPath = path.join(
                repoRoot,
                "apps",
                "arena",
                "model-vetting-studio",
                "public",
                "pipeline-candidate-index.json",
              );
              index = JSON.parse(await readFile(indexPath, "utf8"));
            } catch {
              try {
                const indexPath = path.join(
                  repoRoot,
                  ".openclinxr",
                  "asset-production",
                  "pipeline-candidate-index.json",
                );
                index = JSON.parse(await readFile(indexPath, "utf8"));
              } catch {
                index = null;
              }
            }
            sendJson(res, 200, {
              ok: true,
              index,
              stdout: stdout || "",
              stderr: stderr || "",
            });
            return;
          }

          // POST /__promote
          const body = (await readJsonBody(req)) as {
            candidateId?: string;
            reason?: string;
            promotedBy?: string;
          };
          const candidateId = typeof body.candidateId === "string" ? body.candidateId.trim() : "";
          const reason = typeof body.reason === "string" ? body.reason.trim() : "no reason provided";
          const promotedBy =
            typeof body.promotedBy === "string" && body.promotedBy.trim()
              ? body.promotedBy.trim()
              : "faculty_reviewer";

          if (!candidateId || candidateId.length > 256 || /[\0\n\r]/.test(candidateId)) {
            sendJson(res, 400, { ok: false, error: "invalid candidateId" });
            return;
          }

          const knownIds = await loadCandidateIds(repoRoot);
          if (knownIds.size > 0 && !knownIds.has(candidateId)) {
            sendJson(res, 400, {
              ok: false,
              error: `candidateId not found in index: ${candidateId}`,
            });
            return;
          }

          const script = path.join(repoRoot, "tools", "openclinxr", "evidence", "promote-candidate.ts");
          // execFile with arg array — never a shell string (no injection surface).
          const { stdout, stderr } = await execFileAsync(
            tsxBin,
            [
              script,
              "--candidate-id",
              candidateId,
              "--reason",
              reason || "no reason provided",
              "--promoted-by",
              promotedBy,
              "--apply-copy",
            ],
            {
              cwd: repoRoot,
              maxBuffer: 8 * 1024 * 1024,
              env: { ...process.env },
            },
          );

          // Best-effort: read newest matching promotion record for response.
          let record: unknown = null;
          let deployTargets: string[] = [];
          try {
            const promoDir = path.join(repoRoot, ".openclinxr", "asset-production", "promotions");
            const indexRaw = JSON.parse(
              await readFile(path.join(promoDir, "index.json"), "utf8"),
            ) as { promotions?: Array<{ candidateId?: string; recordPath?: string }> };
            const match = (indexRaw.promotions ?? []).find((p) => p.candidateId === candidateId);
            if (match?.recordPath) {
              const recordAbs = path.resolve(repoRoot, match.recordPath);
              record = JSON.parse(await readFile(recordAbs, "utf8"));
              if (
                record &&
                typeof record === "object" &&
                Array.isArray((record as { deployTargets?: unknown }).deployTargets)
              ) {
                deployTargets = (record as { deployTargets: string[] }).deployTargets;
              }
            }
          } catch {
            // leave record null
          }

          sendJson(res, 200, {
            ok: true,
            record,
            deployTargets,
            stdout: stdout || "",
            stderr: stderr || "",
          });
        } catch (error) {
          const err = error as { stderr?: string; stdout?: string; message?: string };
          sendJson(res, 500, {
            ok: false,
            error: err.message ?? String(error),
            stderr: err.stderr ?? "",
            stdout: err.stdout ?? "",
          });
        }
      });
    },
  };
}
