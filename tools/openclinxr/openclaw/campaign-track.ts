/**
 * campaign-track — emit `.openclinxr/openclaw/campaign-<n>.json`, the artifact the superagent
 * greps before it will rule on a campaign lane.
 *
 * WHY THIS EXISTS. Asked for verbatim on 2026-08-20: "name the tracking artifact YOU need to prove
 * this campaign is on track, in a form you can check yourself... Do not describe a dashboard;
 * specify something a grep can verify." Its enforcement: `jq '.head'` against `git rev-parse HEAD`,
 * and it REFUSES TO RULE if they differ. So this must be rewritten after every integrate and before
 * every consult.
 *
 * `railTally` and `annyRemaining` are ENUMERATED LIVE from `resolveScenarioActorCast`, never typed.
 * Four hand-typed populations produced confident wrong measurements earlier in this campaign; the
 * `enumeratedBy` field records the command so a reader can re-run it rather than trust the number.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gitEnvWithoutInheritedRepoVars } from "./worktree-base-freshness.js";

const REPO_ROOT = join(dirname(new URL(import.meta.url).pathname), "../../..");
const ENUMERATED_BY =
  "resolveScenarioActorCast() over listShippedCastScenarioIds() — packages/openclinxr/asset-registry/src/actor-casting.ts";

/** Anny-rail and library-rail basenames. MPFB is anything matching `mpfb-`. */
const ANNY = [
  "ed_chest_pain_adult_cast", "ed_chest_pain_nurse_adult", "ed_chest_pain_spouse_adult",
  "peds_anxious_parent", "peds_nurse_kevin.glb", "peds_patient_child.glb", "adult_male_street_casual",
];

type Lane = {
  id: string; status: "landed" | "blocked" | "struck" | "in_flight" | "idle";
  issue: number | null; sha: string | null; proofsOk: boolean | null; blockedOn: string | null;
  note?: string;
};

function rail(p: string): "anny" | "library" | "mpfb" | "other" {
  if (ANNY.some((a) => p.includes(a))) return "anny";
  if (p.includes("body-param-")) return "library";
  if (p.includes("mpfb")) return "mpfb";
  return "other";
}

function lastDispatchFor(slice: string): Record<string, unknown> | null {
  const p = join(REPO_ROOT, ".openclinxr/openclaw/worker-sessions.jsonl");
  let rows: Record<string, unknown>[] = [];
  try {
    rows = readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
  } catch { return null; }
  const mine = rows.filter((r) => r.slice === slice && r.phase === "completed");
  const last = mine.at(-1);
  if (!last) return null;
  return {
    slice, sessionId: last.sessionId ?? null, proofsOk: last.proofsOk ?? null,
    role: last.role ?? null, model: last.model ?? null, turns: last.turns ?? null,
    // A ZERO here on a long slice is the signal that the third tier went unused — but ONLY if it was
    // actually measured. The first version hardcoded 0, which the lead correctly called a lie: a zero
    // you cannot distinguish from "not measured" is worse than an absent field. Counted from the
    // session transcript; null when the transcript cannot be found.
    subagentCount: countSubagentSpawns(String(last.sessionId ?? "")),
  };
}

/**
 * Spawns the worker made, counted from its own transcript. Returns null — never 0 — when the
 * transcript is missing, so "unused" and "unmeasured" stay distinguishable.
 */
function countSubagentSpawns(sessionId: string): number | null {
  if (!sessionId) return null;
  let dirs: string[] = [];
  try {
    dirs = execFileSync("find", [join(process.env.HOME ?? "", ".grok/sessions"), "-type", "d",
      "-name", sessionId, "-maxdepth", "2"], { encoding: "utf8" }).split("\n").filter(Boolean);
  } catch { return null; }
  const dir = dirs[0];
  if (!dir) return null;
  try {
    const log = readFileSync(join(dir, "updates.jsonl"), "utf8");
    // Match the tool NAME FIELD, never a bare string. The injected role charter names
    // `spawn_subagent` in prose, so a substring count returns 1 for a worker that spawned nothing —
    // measured on issue-479: 1 string hit, 0 real invocations. That is a measured lie, which is
    // worse than the hardcoded 0 it replaced because it looks like evidence.
    const compact = log.replace(/\s+/g, "");
    return (compact.match(/"(?:name|tool|tool_name)":"spawn_subagent"/g) ?? []).length;
  } catch { return null; }
}

export async function buildCampaignTrack(campaignIssue: number, lanes: Lane[], lastSlice: string) {
  const casting = await import(join(REPO_ROOT, "packages/openclinxr/asset-registry/src/actor-casting.ts"));
  const tally: Record<string, number> = { mpfb: 0, anny: 0, library: 0, other: 0 };
  const annyRemaining: Record<string, string>[] = [];
  for (const scenarioId of casting.listShippedCastScenarioIds() as string[]) {
    for (const c of casting.resolveScenarioActorCast(scenarioId) as Record<string, string>[]) {
      const glb = String(c.assetPath ?? "").split("/").pop() ?? "";
      const r = rail(glb);
      tally[r] = (tally[r] ?? 0) + 1;
      if (r !== "mpfb") annyRemaining.push({ scenarioId, role: String(c.role ?? ""), actorId: String(c.actorId ?? ""), glb });
    }
  }
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: gitEnvWithoutInheritedRepoVars(),
  }).trim();
  const out = {
    schemaVersion: "openclinxr.campaign-track.v1",
    campaignIssue,
    updatedAt: new Date().toISOString(),
    head,
    lanes,
    railTally: { ...tally, enumeratedBy: ENUMERATED_BY },
    annyRemaining,
    lastDispatch: lastDispatchFor(lastSlice),
  };
  const dest = join(REPO_ROOT, `.openclinxr/openclaw/campaign-${campaignIssue}.json`);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, `${JSON.stringify(out, null, 2)}\n`, "utf8");
  return { dest, out };
}
