/**
 * humanoid-vision-score.ts — headless generation-quality vision scoring for
 * Humanoid Generation Studio candidates.
 *
 * Spawns portless UI-XR, screenshots each MANIFEST humanoid in the isolated
 * lab, scores via Grok 4.5 vision (`--prompt-json` + image block), writes
 * studio scores.json + a ranked docs report. Aesthetic-only; not clinical.
 *
 * Run from repo root:
 *   tsx tools/openclinxr/evidence/humanoid-vision-score.ts
 */

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { estimateUsdFromSplit } from "../../../packages/openclinxr/agent-loop/src/model-pricing.js";

/** Identical to apps/ui-xr/public/_humanoid-studio/index.html MANIFEST (ids + glb). */
const MANIFEST = Object.freeze([
  {
    id: "peds_patient_child",
    glb: "/generated-humanoids/peds_patient_child.glb",
  },
  {
    id: "peds_anxious_parent",
    glb: "/generated-humanoids/peds_anxious_parent.glb",
  },
  {
    id: "peds_nurse_kevin",
    glb: "/generated-humanoids/peds_nurse_kevin.glb",
  },
  {
    id: "ed_chest_pain_patient_real_garment",
    glb: "/cagematch/anny-real-garment/current/ed_chest_pain_patient_real_garment.glb",
  },
  {
    id: "ed_chest_pain_patient_adult_bod_cmu_bvh_full",
    glb: "/cagematch/seated-adult-bod-preview-2026-08-02/ed_chest_pain_patient_adult_bod.cmu-bvh-full.glb",
  },
] as const);

const PORT = 5251;
const MODEL = "grok-4.5";
const SERVER_READY_TIMEOUT_MS = 120_000;
const ISO_READY_TIMEOUT_MS = 45_000;
const SETTLE_MS = 1_500;
const NOT_EVIDENCE_FOR = ["aesthetic_only_not_clinical_validity"] as const;

const STUDIO_SCORES_PATH = "apps/ui-xr/public/_humanoid-studio/scores.json";
const GROK_BIN = path.join(homedir(), ".grok", "bin", "grok");

type ManifestEntry = (typeof MANIFEST)[number];

type ScoreRow = {
  realism_0to1: number;
  clothing_0to1: number;
  reason: string;
};

type ScoresDoc = {
  generatedAt: string;
  notEvidenceFor: string[];
  scores: Record<string, ScoreRow>;
};

type RankedDoc = ScoresDoc & {
  ranked: Array<ScoreRow & { id: string }>;
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

async function waitForServer(port: number, server: ChildProcessWithoutNullStreams): Promise<void> {
  const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) return;
    } catch {
      // retry
    }
    if (server.exitCode !== null) {
      throw new Error(`UI-XR dev server exited before ready (code ${server.exitCode})`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`UI-XR not ready on port ${port} within ${SERVER_READY_TIMEOUT_MS}ms`);
}

function extractJsonObject(text: string): unknown {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("empty model text");
  // Prefer fenced ```json ... ``` if present
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1]!.trim() : raw;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error(`could not parse score JSON from model text: ${raw.slice(0, 200)}`);
  }
}

function normalizeScore(obj: unknown): ScoreRow {
  if (!obj || typeof obj !== "object") throw new Error("score not an object");
  const o = obj as Record<string, unknown>;
  const realism = clamp01(Number(o.realism_0to1));
  const clothing = clamp01(Number(o.clothing_0to1));
  const reason = String(o.reason ?? "").trim().slice(0, 240) || "no reason";
  return { realism_0to1: realism, clothing_0to1: clothing, reason };
}

function runGrokPromptJson(promptJsonPath: string): Promise<{
  text: string;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number };
  raw: unknown;
}> {
  return new Promise((resolve, reject) => {
    // Exact invocation shape: --prompt-json "$(cat <file>)" ...
    const child = spawn(
      "bash",
      [
        "-c",
        `"$GROK_BIN" --prompt-json "$(cat "$PROMPT_JSON")" --model "$MODEL" --output-format json --max-turns 1`,
      ],
      {
        env: {
          ...process.env,
          GROK_BIN,
          PROMPT_JSON: promptJsonPath,
          MODEL,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => {
      stdout += String(c);
    });
    child.stderr.on("data", (c) => {
      stderr += String(c);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0 && !stdout.trim()) {
        return reject(new Error(`grok exited ${code}: ${stderr.slice(0, 800)}`));
      }
      let parsed: any;
      try {
        parsed = JSON.parse(stdout.trim());
      } catch {
        return reject(
          new Error(
            `grok stdout not JSON (code=${code}): ${stdout.slice(0, 400)} | stderr=${stderr.slice(0, 400)}`,
          ),
        );
      }
      if (parsed?.type === "error") {
        return reject(new Error(`grok error: ${parsed.message || JSON.stringify(parsed)}`));
      }
      const text = String(parsed?.text ?? parsed?.result ?? "");
      const usage = parsed?.usage ?? {};
      resolve({
        text,
        usage: {
          input_tokens: Number(usage.input_tokens ?? 0) || 0,
          output_tokens: Number(usage.output_tokens ?? 0) || 0,
          cache_read_input_tokens: Number(usage.cache_read_input_tokens ?? 0) || 0,
        },
        raw: parsed,
      });
    });
  });
}

async function scoreScreenshot(
  png: Buffer,
  entry: ManifestEntry,
  workDir: string,
): Promise<{ score: ScoreRow; usd: number; usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number } }> {
  const b64 = png.toString("base64");
  const promptBlocks = [
    {
      type: "image",
      mimeType: "image/png",
      data: b64,
    },
    {
      type: "text",
      text:
        `You are scoring a generated clinical-training humanoid screenshot (id=${entry.id}). ` +
        `This is aesthetic / generation-quality only — not clinical validity. ` +
        `Reply with ONLY compact JSON (no markdown, no prose): ` +
        `{"realism_0to1":0.0,"clothing_0to1":0.0,"reason":"one short concrete line"}. ` +
        `realism_0to1 = overall humanoid visual realism 0..1; clothing_0to1 = clothing presence/fit/quality 0..1.`,
    },
  ];
  const promptPath = path.join(workDir, `${entry.id}.prompt.json`);
  await writeFile(promptPath, JSON.stringify(promptBlocks), "utf8");

  const result = await runGrokPromptJson(promptPath);
  const score = normalizeScore(extractJsonObject(result.text));
  const cost = estimateUsdFromSplit(
    result.usage.input_tokens + result.usage.cache_read_input_tokens,
    result.usage.output_tokens,
    MODEL,
    result.usage.cache_read_input_tokens,
  );
  return { score, usd: cost.usd, usage: result.usage };
}

async function main(): Promise<void> {
  const generatedAt = new Date().toISOString();
  const day = generatedAt.slice(0, 10);
  const docsPath = `docs/openclinxr/humanoid-vision-score-${day}.json`;
  const workDir = await mkdtemp(path.join(tmpdir(), "humanoid-vision-score-"));

  console.log(`[humanoid-vision-score] workDir=${workDir}`);
  console.log(`[humanoid-vision-score] spawning UI-XR dev:portless on PORT=${PORT}`);

  const server = spawn("pnpm", ["--filter", "@openclinxr/ui-xr", "dev:portless"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdio: "pipe",
  }) as ChildProcessWithoutNullStreams;

  let totalUsd = 0;
  const scores: Record<string, ScoreRow> = {};

  try {
    await waitForServer(PORT, server);
    console.log(`[humanoid-vision-score] UI-XR ready on http://127.0.0.1:${PORT}/`);

    const browser = await chromium.launch({ headless: true });
    try {
      for (const entry of MANIFEST) {
        console.log(`[humanoid-vision-score] capture ${entry.id}`);
        const page = await browser.newPage({ viewport: { width: 720, height: 900 } });
        try {
          const url =
            `http://127.0.0.1:${PORT}/_isolated-humanoid-lab/index.html` +
            `?glb=${entry.glb}&physics=0&skeleton=0&skinOpacity=1&_ts=${Date.now()}`;
          await page.goto(url, { waitUntil: "load", timeout: 60_000 });
          await page.waitForFunction(
            () => (window as any).__isoReady === true || (window as any).__isoError,
            { timeout: ISO_READY_TIMEOUT_MS },
          );
          const isoErr = await page.evaluate(() => (window as any).__isoError ?? null);
          if (isoErr) {
            console.warn(`[humanoid-vision-score] ${entry.id} isoError=${isoErr} — scoring anyway if render present`);
          }
          await page.waitForTimeout(SETTLE_MS);
          const png = (await page.screenshot({ type: "png", fullPage: false })) as Buffer;
          await writeFile(path.join(workDir, `${entry.id}.png`), png);

          console.log(`[humanoid-vision-score] score ${entry.id} via ${MODEL} (${png.length} bytes png)`);
          const { score, usd, usage } = await scoreScreenshot(png, entry, workDir);
          scores[entry.id] = score;
          totalUsd += usd;
          console.log(
            `[humanoid-vision-score] ${entry.id}: realism=${score.realism_0to1.toFixed(2)} ` +
              `clothing=${score.clothing_0to1.toFixed(2)} usd=$${usd.toFixed(4)} ` +
              `tok_in=${usage.input_tokens}+cache=${usage.cache_read_input_tokens} out=${usage.output_tokens}`,
          );
          console.log(`[humanoid-vision-score]   reason: ${score.reason}`);
        } catch (err) {
          console.error(`[humanoid-vision-score] FAILED ${entry.id}: ${String(err)}`);
        } finally {
          await page.close();
        }
      }
    } finally {
      await browser.close();
    }
  } finally {
    if (server.exitCode === null) server.kill("SIGTERM");
  }

  const scoredCount = Object.keys(scores).length;
  if (scoredCount < 1) {
    throw new Error("no humanoids scored — aborting write");
  }

  const studioDoc: ScoresDoc = {
    generatedAt,
    notEvidenceFor: [...NOT_EVIDENCE_FOR],
    scores,
  };

  const ranked = Object.entries(scores)
    .map(([id, s]) => ({ id, ...s }))
    .sort((a, b) => b.realism_0to1 - a.realism_0to1);

  const rankedDoc: RankedDoc = {
    ...studioDoc,
    ranked,
  };

  await mkdir(path.dirname(STUDIO_SCORES_PATH), { recursive: true });
  await mkdir(path.dirname(docsPath), { recursive: true });
  await writeFile(STUDIO_SCORES_PATH, `${JSON.stringify(studioDoc, null, 2)}\n`, "utf8");
  await writeFile(docsPath, `${JSON.stringify(rankedDoc, null, 2)}\n`, "utf8");

  console.log(`[humanoid-vision-score] wrote ${STUDIO_SCORES_PATH} (${scoredCount} scores)`);
  console.log(`[humanoid-vision-score] wrote ${docsPath}`);
  console.log(`[humanoid-vision-score] ranked realism:`);
  for (const r of ranked) {
    console.log(`  ${r.realism_0to1.toFixed(2)}  ${r.id}  — ${r.reason}`);
  }
  console.log(`[humanoid-vision-score] total USD (estimateUsdFromSplit): $${totalUsd.toFixed(4)}`);

  // Best-effort cleanup of temp prompt/png workspace (scores already on disk).
  try {
    await rm(workDir, { recursive: true, force: true });
  } catch {
    // ignore
  }

  if (scoredCount < 3) {
    console.warn(
      `[humanoid-vision-score] WARNING: only ${scoredCount} scores (quality bar wants >=3)`,
    );
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
