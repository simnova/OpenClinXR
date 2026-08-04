/**
 * humanoid-vision-score.ts — headless generation-quality vision scoring for
 * Humanoid Generation Studio candidates.
 *
 * Spawns portless UI-XR via `spawnPortlessDevServer` (findFreePort + parse
 * Vite Local: line — collision-safe for parallel worktrees), screenshots each
 * MANIFEST humanoid in the isolated lab at TWO framings (full figure incl head,
 * face/head close-up), scores via Grok vision, writes studio scores.json + a
 * ranked docs report. Aesthetic-only; not clinical.
 *
 * Instrument guarantees (2026-08-04 fix):
 *  1. CLEAN CAPTURE — HUD hidden (?clean=1 + __hideHud); canvas-only PNG;
 *     full framing includes whole head+body; face is head close-up.
 *  2. ANCHORED PORTABLE RUBRIC — multi-dimension scores with explicit anchors.
 *  3. HONESTY GATE — refuse to emit a score row without a real PNG on disk
 *     (non-trivial size). Kills fabricated-score.json patterns.
 *  4. REPRO_N — instrument reproducibility (score same shot N times; no studio write).
 *
 * Run from repo root:
 *   tsx tools/openclinxr/evidence/humanoid-vision-score.ts
 *   PORT=5301 OUT_DIR=.openclinxr/.../scores MANIFEST_JSON=... tsx ...
 *   REPRO_N=5 ONLY_ID=peds_anxious_parent WRITE_STUDIO_SCORES=0 tsx ...
 */

import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Page } from "playwright";
import { estimateUsdFromSplit } from "../../../packages/openclinxr/agent-loop/src/model-pricing.js";
import {
  spawnPortlessDevServer,
  stopPortlessDevServer,
} from "./lib/portless-server.js";

/** Identical to apps/ui-xr/public/_humanoid-studio/index.html MANIFEST (ids + glb). */
const DEFAULT_MANIFEST = Object.freeze([
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

const FRAMINGS = ["full", "face"] as const;
type Framing = (typeof FRAMINGS)[number];

/** Optional preferred PORT; omit/unset → spawnPortlessDevServer pre-scans a free port. */
const PREFERRED_PORT = process.env.PORT || process.env.HUMANOID_VISION_PORT || "";
const MODEL = process.env.GROK_VISION_MODEL || "grok-4.5";
const SERVER_READY_TIMEOUT_MS = 120_000;
const ISO_READY_TIMEOUT_MS = 45_000;
const SETTLE_MS = 1_500;
const NOT_EVIDENCE_FOR = ["aesthetic_only_not_clinical_validity"] as const;

/** Minimum PNG size for honesty gate (non-trivial render, not 1x1 placeholder). */
const MIN_SHOT_BYTES = Number(process.env.MIN_SHOT_BYTES || 8_000);

/** Dimension weights (renormalize if face=null). */
const WEIGHTS = Object.freeze({
  proportion: 0.2,
  face: 0.25,
  skin: 0.15,
  garment: 0.25,
  artifacts: 0.15,
});

const STUDIO_SCORES_PATH =
  process.env.STUDIO_SCORES_PATH || "apps/ui-xr/public/_humanoid-studio/scores.json";
const OUT_DIR = process.env.OUT_DIR || "";
const GROK_BIN = path.join(homedir(), ".grok", "bin", "grok");

/** Anchored portable rubric — self-contained so any vision agent scores consistently. */
const ANCHORED_RUBRIC_PROMPT = `You are scoring a CLEAN rendered clinical-training humanoid (no UI, no HUD, no debug text). Aesthetic / generation-quality only — not clinical validity.

Reply with ONLY compact JSON (no markdown, no prose):
{"proportion":0.0,"face":0.0,"skin":0.0,"garment":0.0,"artifacts":0.0,"total":0.0,"reason":"one concrete line"}

SCORING ANCHORS (use these exact scales; intermediate values allowed):

proportion (anatomy / body shape):
  0.0 = melted/duplicated/broken anatomy
  0.3 = balloon-limb crude stub
  0.6 = stylized-acceptable human
  0.9 = natural realistic proportions

face (set to null if face is not in frame / fully cropped):
  0.0 = none/melted/double-head
  0.3 = bald low-poly featureless
  0.6 = coherent stylized with eyes
  0.9 = photoreal face

skin:
  0.0 = plastic/flat unshaded
  0.6 = shaded with subsurface-like soft lighting
  0.9 = photoreal pores / skin detail

garment (clothing presence and quality):
  0.0 = nude/morphsuit/unitard (no real attire)
  0.3 = painted-on color regions with seams/tears
  0.6 = recognizable simple attire
  0.9 = realistic draped clinical attire

artifacts (1.0 = clean; LOWER is worse):
  1.0 = clean render
  Penalize: torn seams, mesh cutoff, floating parts, z-fighting, DEBUG OVERLAYS/text banners, skeleton lines, HUD chrome
  0.0 = defects dominate the image

total = weighted mean with weights proportion=0.20, face=0.25, skin=0.15, garment=0.25, artifacts=0.15.
If face is null, renormalize the remaining weights to sum to 1.0.
reason = one concrete observation (what you saw), not a restatement of the score.`;

type ManifestEntry = { id: string; glb: string };

/** Structured multi-dimension score row (portable instrument). */
type ScoreRow = {
  proportion: number;
  face: number | null;
  skin: number;
  garment: number;
  artifacts: number;
  total: number;
  reason: string;
  /** Back-compat alias of total. */
  realism_0to1: number;
  /** Back-compat alias of garment. */
  clothing_0to1: number;
  framing?: Framing;
  /** Absolute or relative path to the PNG that was scored (honesty). */
  shotPath?: string;
  shotBytes?: number;
};

type PerViewScores = {
  full?: ScoreRow;
  face?: ScoreRow;
  realism_0to1: number;
  clothing_0to1: number;
  reason: string;
  views?: { full?: ScoreRow; face?: ScoreRow };
};

type ScoresDoc = {
  generatedAt: string;
  notEvidenceFor: string[];
  framings: Framing[];
  instrument: {
    cleanCapture: true;
    canvasOnly: true;
    anchoredRubric: true;
    honestyGateMinBytes: number;
    weights: typeof WEIGHTS;
  };
  scores: Record<string, PerViewScores>;
};

type RankedDoc = ScoresDoc & {
  ranked: Array<PerViewScores & { id: string }>;
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Round to 3 decimals to avoid float noise in JSON (0.464999… → 0.465). */
function round3(n: number): number {
  return Math.round(clamp01(n) * 1000) / 1000;
}

function parseNullable01(v: unknown): number | null {
  if (v === null || v === undefined || v === "null") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return clamp01(n);
}

/** Weighted total; renormalize weights when face is null. */
export function computeWeightedTotal(dims: {
  proportion: number;
  face: number | null;
  skin: number;
  garment: number;
  artifacts: number;
}): number {
  const parts: Array<[number, number]> = [
    [dims.proportion, WEIGHTS.proportion],
    [dims.skin, WEIGHTS.skin],
    [dims.garment, WEIGHTS.garment],
    [dims.artifacts, WEIGHTS.artifacts],
  ];
  if (dims.face !== null && dims.face !== undefined) {
    parts.push([dims.face, WEIGHTS.face]);
  }
  let sum = 0;
  let wSum = 0;
  for (const [v, w] of parts) {
    sum += clamp01(v) * w;
    wSum += w;
  }
  return wSum > 0 ? sum / wSum : 0;
}

async function loadManifest(): Promise<ManifestEntry[]> {
  const custom = process.env.MANIFEST_JSON;
  if (custom) {
    const raw = await readFile(custom, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as ManifestEntry[];
    if (parsed?.entries) return parsed.entries as ManifestEntry[];
    throw new Error(`MANIFEST_JSON must be array or {entries:[]}: ${custom}`);
  }
  let entries: ManifestEntry[] = [...DEFAULT_MANIFEST];
  const onlyId = process.env.ONLY_ID || process.env.HUMANOID_ID;
  if (onlyId) {
    entries = entries.filter((e) => e.id === onlyId);
    if (entries.length === 0) {
      throw new Error(`ONLY_ID=${onlyId} not in manifest`);
    }
  }
  return entries;
}

function extractJsonObject(text: string): unknown {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("empty model text");
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

/**
 * HONESTY GATE: a score is INVALID unless backed by a real rendered PNG on disk
 * with non-trivial size. Throws if missing/tiny.
 */
export async function assertShotArtifact(shotPath: string, minBytes = MIN_SHOT_BYTES): Promise<{ bytes: number }> {
  let st;
  try {
    st = await stat(shotPath);
  } catch {
    throw new Error(
      `HONESTY GATE: score refused — shot file missing (no fabricated scores): ${shotPath}`,
    );
  }
  if (!st.isFile()) {
    throw new Error(`HONESTY GATE: score refused — shot path is not a file: ${shotPath}`);
  }
  if (st.size < minBytes) {
    throw new Error(
      `HONESTY GATE: score refused — shot trivial (${st.size} < ${minBytes} bytes): ${shotPath}`,
    );
  }
  return { bytes: st.size };
}

export function normalizeScore(obj: unknown, framing: Framing): ScoreRow {
  if (!obj || typeof obj !== "object") throw new Error("score not an object");
  const o = obj as Record<string, unknown>;

  // Prefer structured dimensions; fall back to legacy realism/clothing if model ignored rubric.
  const proportion = clamp01(
    Number(o.proportion ?? o.realism_0to1 ?? 0),
  );
  const face = parseNullable01(o.face);
  const skin = clamp01(Number(o.skin ?? o.realism_0to1 ?? 0));
  const garment = clamp01(Number(o.garment ?? o.clothing_0to1 ?? 0));
  const artifacts = clamp01(
    o.artifacts !== undefined && o.artifacts !== null
      ? Number(o.artifacts)
      : 0.7, // neutral default if model omitted
  );

  const dims = { proportion, face, skin, garment, artifacts };
  const modelTotal =
    o.total !== undefined && o.total !== null && Number.isFinite(Number(o.total))
      ? clamp01(Number(o.total))
      : null;
  // Prefer recomputed weighted total for instrument consistency; allow model total if close.
  const computed = computeWeightedTotal(dims);
  const total = round3(
    modelTotal !== null && Math.abs(modelTotal - computed) < 0.15 ? modelTotal : computed,
  );

  const reason = String(o.reason ?? "").trim().slice(0, 240) || "no reason";

  return {
    proportion: round3(proportion),
    face: face === null ? null : round3(face),
    skin: round3(skin),
    garment: round3(garment),
    artifacts: round3(artifacts),
    total,
    reason,
    realism_0to1: total,
    clothing_0to1: round3(garment),
    framing,
  };
}

function runGrokPromptJson(promptJsonPath: string): Promise<{
  text: string;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number };
  raw: unknown;
}> {
  return new Promise((resolve, reject) => {
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
  framing: Framing,
  workDir: string,
  shotPath: string,
): Promise<{
  score: ScoreRow;
  usd: number;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number };
}> {
  // HONESTY GATE before any model call
  const { bytes } = await assertShotArtifact(shotPath);

  const b64 = png.toString("base64");
  const framingHint =
    framing === "face"
      ? "Framing=FACE/HEAD close-up. face dimension required (not null unless head truly absent). Weight facial/skin/hair/eye quality."
      : "Framing=FULL FIGURE (whole head+body must be visible). face may be scored if head is in frame; set null only if head is cropped out.";
  const promptBlocks = [
    {
      type: "image",
      mimeType: "image/png",
      data: b64,
    },
    {
      type: "text",
      text:
        `Humanoid id=${entry.id}, framing=${framing}. ${framingHint}\n\n` +
        ANCHORED_RUBRIC_PROMPT +
        `\n\nAlso emit back-compat aliases inside the same object if you wish, but the required keys are proportion/face/skin/garment/artifacts/total/reason.`,
    },
  ];
  const promptPath = path.join(workDir, `${entry.id}.${framing}.prompt.json`);
  await writeFile(promptPath, JSON.stringify(promptBlocks), "utf8");

  const result = await runGrokPromptJson(promptPath);
  const score = normalizeScore(extractJsonObject(result.text), framing);
  score.shotPath = shotPath;
  score.shotBytes = bytes;

  // Re-assert after scoring so we never attach a path that vanished mid-flight
  await assertShotArtifact(shotPath);

  const cost = estimateUsdFromSplit(
    result.usage.input_tokens + result.usage.cache_read_input_tokens,
    result.usage.output_tokens,
    MODEL,
    result.usage.cache_read_input_tokens,
  );
  return { score, usd: cost.usd, usage: result.usage };
}

/** Hide HUD + screenshot canvas only (no page chrome / debug text). */
async function captureCleanPng(page: Page): Promise<Buffer> {
  await page.evaluate(() => {
    const hide = (window as any).__hideHud;
    if (typeof hide === "function") hide();
    const hud = document.getElementById("hud");
    if (hud) hud.style.display = "none";
    // Force one render after HUD hide
    const cam = (window as any).__isoCamera;
    const scene = (window as any).__isoScene;
    const renderer = (document.querySelector("canvas") as any)?.__threeRenderer;
    void cam;
    void scene;
    void renderer;
  });
  // Prefer canvas element screenshot so DOM HUD cannot leak even if display failed
  const canvas = page.locator("canvas").first();
  const count = await canvas.count();
  if (count < 1) {
    throw new Error("clean capture failed: no canvas element");
  }
  const png = (await canvas.screenshot({ type: "png" })) as Buffer;
  return png;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

function dimStats(rows: ScoreRow[], key: keyof ScoreRow): { mean: number; stdev: number; n: number; values: number[] } {
  const values: number[] = [];
  for (const r of rows) {
    const v = r[key];
    if (typeof v === "number" && Number.isFinite(v)) values.push(v);
  }
  return { mean: mean(values), stdev: stdev(values), n: values.length, values };
}

async function ensureIsoReady(page: Page, entry: ManifestEntry, baseUrl: string): Promise<void> {
  // clean=1 forces HUD hide + opaque skin + no skeleton/physics by default
  const url =
    `${baseUrl}/_isolated-humanoid-lab/index.html` +
    `?glb=${encodeURIComponent(entry.glb)}` +
    `&physics=0&skeleton=0&skinOpacity=1&hideGarment=0` +
    `&clean=1&framing=full&_ts=${Date.now()}`;
  await page.goto(url, { waitUntil: "load", timeout: 60_000 });
  await page.waitForFunction(
    () => (window as any).__isoReady === true || (window as any).__isoError,
    { timeout: ISO_READY_TIMEOUT_MS },
  );
  const isoErr = await page.evaluate(() => (window as any).__isoError ?? null);
  if (isoErr) {
    console.warn(`[humanoid-vision-score] ${entry.id} isoError=${isoErr} — scoring if render present`);
  }
  await page.waitForTimeout(SETTLE_MS);
  // Ensure framing + HUD hidden
  await page.evaluate(() => {
    const fn = (window as any).__isoSetFraming;
    if (typeof fn === "function") fn("full");
    const hide = (window as any).__hideHud;
    if (typeof hide === "function") hide();
  });
  await page.waitForTimeout(200);
}

async function captureFraming(
  page: Page,
  framing: Framing,
  shotPath: string,
): Promise<Buffer> {
  if (framing === "face") {
    await page.evaluate(() => {
      const fn = (window as any).__isoSetFraming;
      if (typeof fn === "function") fn("face");
      const hide = (window as any).__hideHud;
      if (typeof hide === "function") hide();
    });
    await page.waitForTimeout(400);
  } else {
    await page.evaluate(() => {
      const fn = (window as any).__isoSetFraming;
      if (typeof fn === "function") fn("full");
      const hide = (window as any).__hideHud;
      if (typeof hide === "function") hide();
    });
    await page.waitForTimeout(200);
  }
  const png = await captureCleanPng(page);
  await writeFile(shotPath, png);
  await assertShotArtifact(shotPath);
  return png;
}

/** Score an existing clean PNG N times (no browser). Used when Playwright is blocked. */
async function runReproFromShotFile(
  entry: ManifestEntry,
  sourceShotPath: string,
  workDir: string,
  shotDir: string,
  n: number,
): Promise<void> {
  const framing: Framing = (process.env.REPRO_FRAMING as Framing) || "full";
  const { bytes } = await assertShotArtifact(sourceShotPath);
  const png = await readFile(sourceShotPath);
  const staged = path.join(shotDir, `${entry.id}.${framing}.repro.png`);
  await writeFile(staged, png);
  await assertShotArtifact(staged);
  console.log(
    `[humanoid-vision-score] REPRO from SHOT_PATH=${sourceShotPath} (${bytes} bytes) → ${staged}`,
  );

  const rows: ScoreRow[] = [];
  let totalUsd = 0;
  for (let i = 0; i < n; i++) {
    console.log(`[humanoid-vision-score] REPRO trial ${i + 1}/${n}`);
    const { score, usd, usage } = await scoreScreenshot(png, entry, framing, workDir, staged);
    rows.push(score);
    totalUsd += usd;
    console.log(
      `  trial ${i + 1}: total=${score.total.toFixed(3)} prop=${score.proportion.toFixed(2)} ` +
        `face=${score.face === null ? "null" : score.face.toFixed(2)} skin=${score.skin.toFixed(2)} ` +
        `garment=${score.garment.toFixed(2)} artifacts=${score.artifacts.toFixed(2)} ` +
        `usd=$${usd.toFixed(4)} tok_in=${usage.input_tokens} out=${usage.output_tokens}`,
    );
    console.log(`  reason: ${score.reason}`);
  }

  const dims = ["proportion", "face", "skin", "garment", "artifacts", "total"] as const;
  const table: Record<string, { mean: number; stdev: number; n: number; values: number[] }> = {};
  for (const d of dims) table[d] = dimStats(rows, d);

  const report = {
    schemaVersion: "humanoid-vision-instrument-repro.v1",
    generatedAt: new Date().toISOString(),
    claimScope: "instrument_reproducibility_measurement_not_studio_scores",
    notEvidenceFor: [
      ...NOT_EVIDENCE_FOR,
      "not_averaged_into_studio_scores",
      "not_clinical_validity",
    ],
    model: MODEL,
    humanoidId: entry.id,
    glb: entry.glb,
    framing,
    n,
    shotPath: staged,
    sourceShotPath,
    shotBytes: bytes,
    captureNote: "SHOT_PATH provided (browser capture skipped)",
    instrument: {
      cleanCapture: true,
      canvasOnly: true,
      anchoredRubric: true,
      honestyGateMinBytes: MIN_SHOT_BYTES,
      weights: WEIGHTS,
    },
    trials: rows.map((r, i) => ({ trial: i + 1, ...r })),
    stats: table,
    totalUsdEstimate: totalUsd,
    summary: {
      totalMean: table.total.mean,
      totalStdev: table.total.stdev,
      totalVariance: table.total.stdev ** 2,
      maxDimStdev: Math.max(...dims.map((d) => table[d].stdev)),
      reproducible: table.total.stdev <= 0.12,
    },
  };

  const outPath =
    process.env.REPRO_REPORT_PATH ||
    path.join(
      OUT_DIR || ".openclinxr/evidence/humanoid-vision-instrument",
      `repro-${entry.id}-${new Date().toISOString().slice(0, 10)}.json`,
    );
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const reportShot = path.join(path.dirname(outPath), path.basename(staged));
  if (path.resolve(reportShot) !== path.resolve(staged)) {
    await writeFile(reportShot, png);
  }

  console.log("\n=== INSTRUMENT REPRODUCIBILITY (do not merge into studio scores) ===");
  console.log(`humanoid=${entry.id}  framing=${framing}  N=${n}  model=${MODEL}`);
  console.log(`shot=${staged}  (${bytes} bytes)`);
  console.log(`report=${outPath}`);
  console.log("dimension          mean    stdev   n");
  for (const d of dims) {
    const s = table[d];
    console.log(`  ${d.padEnd(14)}  ${s.mean.toFixed(3)}   ${s.stdev.toFixed(3)}   ${s.n}`);
  }
  console.log(
    `total variance=${(table.total.stdev ** 2).toFixed(4)}  ` +
      `reproducible(stdev<=0.12)=${report.summary.reproducible}`,
  );
  console.log(`total USD estimate: $${totalUsd.toFixed(4)}`);
  console.log(`[humanoid-vision-score] CLEAN SHOT PATH (orchestrator verify): ${reportShot}`);
}

async function runRepro(
  page: Page,
  entry: ManifestEntry,
  workDir: string,
  shotDir: string,
  n: number,
): Promise<void> {
  const framing: Framing = "full";
  const shotPath = path.join(shotDir, `${entry.id}.${framing}.repro.png`);
  console.log(`[humanoid-vision-score] REPRO capture once: ${shotPath}`);
  const png = await captureFraming(page, framing, shotPath);
  console.log(
    `[humanoid-vision-score] REPRO shot ready (${png.length} bytes) — scoring N=${n} with ${MODEL}`,
  );

  const rows: ScoreRow[] = [];
  let totalUsd = 0;
  for (let i = 0; i < n; i++) {
    console.log(`[humanoid-vision-score] REPRO trial ${i + 1}/${n}`);
    const { score, usd, usage } = await scoreScreenshot(png, entry, framing, workDir, shotPath);
    rows.push(score);
    totalUsd += usd;
    console.log(
      `  trial ${i + 1}: total=${score.total.toFixed(3)} prop=${score.proportion.toFixed(2)} ` +
        `face=${score.face === null ? "null" : score.face.toFixed(2)} skin=${score.skin.toFixed(2)} ` +
        `garment=${score.garment.toFixed(2)} artifacts=${score.artifacts.toFixed(2)} ` +
        `usd=$${usd.toFixed(4)} tok_in=${usage.input_tokens} out=${usage.output_tokens}`,
    );
    console.log(`  reason: ${score.reason}`);
  }

  const dims = ["proportion", "face", "skin", "garment", "artifacts", "total"] as const;
  const table: Record<string, { mean: number; stdev: number; n: number; values: number[] }> = {};
  for (const d of dims) {
    table[d] = dimStats(rows, d);
  }

  const report = {
    schemaVersion: "humanoid-vision-instrument-repro.v1",
    generatedAt: new Date().toISOString(),
    claimScope: "instrument_reproducibility_measurement_not_studio_scores",
    notEvidenceFor: [
      ...NOT_EVIDENCE_FOR,
      "not_averaged_into_studio_scores",
      "not_clinical_validity",
    ],
    model: MODEL,
    humanoidId: entry.id,
    glb: entry.glb,
    framing,
    n,
    shotPath,
    shotBytes: png.length,
    instrument: {
      cleanCapture: true,
      canvasOnly: true,
      anchoredRubric: true,
      honestyGateMinBytes: MIN_SHOT_BYTES,
      weights: WEIGHTS,
    },
    trials: rows.map((r, i) => ({ trial: i + 1, ...r })),
    stats: table,
    totalUsdEstimate: totalUsd,
    summary: {
      totalMean: table.total.mean,
      totalStdev: table.total.stdev,
      totalVariance: table.total.stdev ** 2,
      maxDimStdev: Math.max(...dims.map((d) => table[d].stdev)),
      reproducible: table.total.stdev <= 0.12,
    },
  };

  const outPath =
    process.env.REPRO_REPORT_PATH ||
    path.join(
      OUT_DIR || ".openclinxr/evidence/humanoid-vision-instrument",
      `repro-${entry.id}-${new Date().toISOString().slice(0, 10)}.json`,
    );
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  // Also copy shot next to report for orchestrator viewing
  const reportShot = path.join(path.dirname(outPath), path.basename(shotPath));
  if (path.resolve(reportShot) !== path.resolve(shotPath)) {
    await writeFile(reportShot, png);
  }

  console.log("\n=== INSTRUMENT REPRODUCIBILITY (do not merge into studio scores) ===");
  console.log(`humanoid=${entry.id}  framing=${framing}  N=${n}  model=${MODEL}`);
  console.log(`shot=${shotPath}  (${png.length} bytes)`);
  console.log(`report=${outPath}`);
  console.log("dimension          mean    stdev   n");
  for (const d of dims) {
    const s = table[d];
    console.log(
      `  ${d.padEnd(14)}  ${s.mean.toFixed(3)}   ${s.stdev.toFixed(3)}   ${s.n}`,
    );
  }
  console.log(
    `total variance=${(table.total.stdev ** 2).toFixed(4)}  ` +
      `reproducible(stdev<=0.12)=${report.summary.reproducible}`,
  );
  console.log(`total USD estimate: $${totalUsd.toFixed(4)}`);
  console.log(`[humanoid-vision-score] CLEAN SHOT PATH (orchestrator verify): ${reportShot}`);
}

async function main(): Promise<void> {
  const generatedAt = new Date().toISOString();
  const day = generatedAt.slice(0, 10);
  const docsPath =
    process.env.DOCS_SCORES_PATH || `docs/openclinxr/humanoid-vision-score-${day}.json`;
  const workDir = await mkdtemp(
    path.join(tmpdir(), `humanoid-vision-score-${process.pid}-`),
  );
  const manifest = await loadManifest();
  const skipServer = process.env.SKIP_SERVER === "1" || process.env.SKIP_SERVER === "true";
  let baseUrl = (process.env.BASE_URL || "").replace(/\/$/, "");
  const reproN = Math.max(0, Number(process.env.REPRO_N || 0) || 0);

  console.log(
    `[humanoid-vision-score] workDir=${workDir} preferredPort=${PREFERRED_PORT || "dynamic"} framings=${FRAMINGS.join(",")}`,
  );
  console.log(
    `[humanoid-vision-score] manifest entries=${manifest.length} clean=1 canvas-only honestyMin=${MIN_SHOT_BYTES}` +
      (reproN > 0 ? ` REPRO_N=${reproN}` : ""),
  );

  let server: ChildProcessWithoutNullStreams | null = null;
  let totalUsd = 0;
  const scores: Record<string, PerViewScores> = {};
  const shotDir = OUT_DIR || path.join(workDir, "shots");
  await mkdir(shotDir, { recursive: true });

  // --- Instrument reproducibility on a pre-existing clean shot (no browser/server) ---
  // REPRO_N=5 SHOT_PATH=path/to/clean.png ONLY_ID=... WRITE_STUDIO_SCORES=0
  const existingShot = process.env.SHOT_PATH || process.env.REPRO_SHOT_PATH || "";
  if (reproN > 0 && existingShot) {
    const entry = manifest[0]!;
    await runReproFromShotFile(entry, existingShot, workDir, shotDir, reproN);
    return;
  }

  try {
    if (!skipServer) {
      console.log(
        `[humanoid-vision-score] spawning UI-XR dev:portless via spawnPortlessDevServer (PORT=${PREFERRED_PORT || "0"})`,
      );
      const handle = await spawnPortlessDevServer({
        filter: "@openclinxr/ui-xr",
        env: PREFERRED_PORT ? { PORT: String(PREFERRED_PORT) } : undefined,
        readyTimeoutMs: SERVER_READY_TIMEOUT_MS,
      });
      server = handle.proc;
      baseUrl = handle.url.replace(/\/$/, "");
      console.log(`[humanoid-vision-score] UI-XR ready on ${baseUrl}/ (bound port=${handle.port})`);
    } else {
      if (!baseUrl) {
        throw new Error("SKIP_SERVER requires BASE_URL=http://127.0.0.1:<port>");
      }
      console.log(`[humanoid-vision-score] SKIP_SERVER using BASE_URL=${baseUrl}`);
    }

    // Prefer channel=chrome when available — headless_shell can SEGV on some macOS hosts.
    const browser = await chromium.launch({
      headless: true,
      channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
      args: ["--disable-dev-shm-usage", "--use-angle=swiftshader"],
    }).catch(async (err) => {
      console.warn(
        `[humanoid-vision-score] channel=chrome launch failed (${String(err).slice(0, 120)}); falling back to bundled chromium`,
      );
      return chromium.launch({
        headless: true,
        args: ["--disable-dev-shm-usage", "--use-angle=swiftshader"],
      });
    });
    try {
      // --- Instrument reproducibility path (one humanoid, one full shot, N scores) ---
      if (reproN > 0) {
        const entry = manifest[0]!;
        const page = await browser.newPage({ viewport: { width: 720, height: 900 } });
        try {
          await ensureIsoReady(page, entry, baseUrl);
          await runRepro(page, entry, workDir, shotDir, reproN);
        } finally {
          await page.close();
        }
        return; // do NOT write studio scores in repro mode
      }

      for (const entry of manifest) {
        console.log(`[humanoid-vision-score] capture ${entry.id}`);
        const page = await browser.newPage({ viewport: { width: 720, height: 900 } });
        const viewScores: { full?: ScoreRow; face?: ScoreRow } = {};
        try {
          await ensureIsoReady(page, entry, baseUrl);

          for (const framing of FRAMINGS) {
            const shotPath = path.join(shotDir, `${entry.id}.${framing}.png`);
            const png = await captureFraming(page, framing, shotPath);

            console.log(
              `[humanoid-vision-score] score ${entry.id}/${framing} via ${MODEL} ` +
                `(${png.length} bytes png @ ${shotPath})`,
            );
            const { score, usd, usage } = await scoreScreenshot(
              png,
              entry,
              framing,
              workDir,
              shotPath,
            );
            viewScores[framing] = score;
            totalUsd += usd;
            console.log(
              `[humanoid-vision-score] ${entry.id}/${framing}: total=${score.total.toFixed(2)} ` +
                `prop=${score.proportion.toFixed(2)} face=${score.face === null ? "null" : score.face.toFixed(2)} ` +
                `skin=${score.skin.toFixed(2)} garment=${score.garment.toFixed(2)} art=${score.artifacts.toFixed(2)} ` +
                `(realism=${score.realism_0to1.toFixed(2)} clothing=${score.clothing_0to1.toFixed(2)}) ` +
                `usd=$${usd.toFixed(4)} tok_in=${usage.input_tokens}+cache=${usage.cache_read_input_tokens} out=${usage.output_tokens}`,
            );
            console.log(`[humanoid-vision-score]   reason: ${score.reason}`);
            console.log(`[humanoid-vision-score]   shot: ${shotPath}`);
          }

          const full = viewScores.full;
          const face = viewScores.face;
          // Final honesty: every score row must still have its shot on disk
          for (const row of [full, face]) {
            if (row?.shotPath) await assertShotArtifact(row.shotPath);
          }

          // Aggregate: mean total/realism; clothing/garment from full-frame primarily.
          const realism =
            full && face
              ? (full.realism_0to1 + face.realism_0to1) / 2
              : full?.realism_0to1 ?? face?.realism_0to1 ?? 0;
          const clothing = full?.clothing_0to1 ?? face?.clothing_0to1 ?? 0;
          const reason = [
            full ? `full:${full.reason}` : null,
            face ? `face:${face.reason}` : null,
          ]
            .filter(Boolean)
            .join(" | ")
            .slice(0, 240);
          scores[entry.id] = {
            full,
            face,
            views: { full, face },
            realism_0to1: realism,
            clothing_0to1: clothing,
            reason,
          };
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
    stopPortlessDevServer(server);
  }

  // Repro mode already returned
  if (reproN > 0) return;

  const scoredCount = Object.keys(scores).length;
  if (scoredCount < 1) {
    throw new Error("no humanoids scored — aborting write");
  }

  // Final honesty sweep: refuse to write any doc if any row lacks shot artifact
  for (const [id, pv] of Object.entries(scores)) {
    for (const fr of FRAMINGS) {
      const row = pv[fr];
      if (!row) continue;
      if (!row.shotPath) {
        throw new Error(`HONESTY GATE: ${id}/${fr} score missing shotPath — refusing write`);
      }
      await assertShotArtifact(row.shotPath);
    }
  }

  const studioDoc: ScoresDoc = {
    generatedAt,
    notEvidenceFor: [...NOT_EVIDENCE_FOR],
    framings: [...FRAMINGS],
    instrument: {
      cleanCapture: true,
      canvasOnly: true,
      anchoredRubric: true,
      honestyGateMinBytes: MIN_SHOT_BYTES,
      weights: WEIGHTS,
    },
    scores,
  };

  const ranked = Object.entries(scores)
    .map(([id, s]) => ({ id, ...s }))
    .sort((a, b) => b.realism_0to1 - a.realism_0to1);

  const rankedDoc: RankedDoc = {
    ...studioDoc,
    ranked,
  };

  const writeStudio = process.env.WRITE_STUDIO_SCORES !== "0";
  if (writeStudio) {
    await mkdir(path.dirname(STUDIO_SCORES_PATH), { recursive: true });
    await writeFile(STUDIO_SCORES_PATH, `${JSON.stringify(studioDoc, null, 2)}\n`, "utf8");
    console.log(`[humanoid-vision-score] wrote ${STUDIO_SCORES_PATH} (${scoredCount} scores)`);
  }

  // Prefer OUT_DIR for defect-fix evidence; skip docs/ when OUT_DIR set unless forced.
  if (OUT_DIR) {
    const outScores = path.join(OUT_DIR, "scores.json");
    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(outScores, `${JSON.stringify(rankedDoc, null, 2)}\n`, "utf8");
    console.log(`[humanoid-vision-score] wrote ${outScores}`);
  } else if (process.env.WRITE_DOCS_SCORES === "1") {
    await mkdir(path.dirname(docsPath), { recursive: true });
    await writeFile(docsPath, `${JSON.stringify(rankedDoc, null, 2)}\n`, "utf8");
    console.log(`[humanoid-vision-score] wrote ${docsPath}`);
  }

  console.log(`[humanoid-vision-score] ranked realism (total):`);
  for (const r of ranked) {
    const f = r.full?.total?.toFixed(2) ?? "-";
    const face = r.face?.total?.toFixed(2) ?? "-";
    console.log(`  ${r.realism_0to1.toFixed(2)}  full=${f} face=${face}  ${r.id}  — ${r.reason}`);
  }
  console.log(`[humanoid-vision-score] total USD (estimateUsdFromSplit): $${totalUsd.toFixed(4)}`);

  try {
    await rm(workDir, { recursive: true, force: true });
  } catch {
    // ignore
  }

  if (scoredCount < 1) {
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
