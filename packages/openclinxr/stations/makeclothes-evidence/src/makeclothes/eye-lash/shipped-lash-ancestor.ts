import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertLineageContinuity, lineageLevels } from "@openclinxr/factory-station-core/runner";
import { BASELINE_REF, GLB_DIR, ROOT } from "./shipped-lash-follow-types.js";

type LashChainSidecar = Record<string, unknown> & {
  outputSha256?: unknown;
  teethSwapB1?: { input?: { sha256?: unknown }; output?: { sha256?: unknown } };
  actorHairColourPostExport?: { inputGlbSha256?: unknown; outputGlbSha256?: unknown };
};

const HEX64 = /^[0-9a-f]{64}$/;

function gitGlbSha256(rev: string, actorFile: string): string | null {
  try {
    const bytes = execFileSync("git", ["show", `${rev}:apps/ui-xr/public/generated-humanoids/${actorFile}`], {
      cwd: ROOT,
      maxBuffer: 256 * 1024 * 1024,
    });
    return createHash("sha256").update(bytes).digest("hex");
  } catch {
    return null;
  }
}

export type LashGitHistory = {
  isShallow(): boolean;
  glbStates(actorFile: string): Array<{ rev: string; subject: string; sha256: string }>;
};

const lashHistoryCache = new Map<string, Array<{ rev: string; subject: string; sha256: string }>>();

/** Real git-backed history (default). Read-only git ops; results cached per actor file. */
export function realLashGitHistory(): LashGitHistory {
  return {
    isShallow() {
      return (
        execFileSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: ROOT })
          .toString("utf8")
          .trim() === "true"
      );
    },
    glbStates(actorFile) {
      const cached = lashHistoryCache.get(actorFile);
      if (cached !== undefined) return cached;
      const log = execFileSync("git", ["log", "--format=%H%x00%s", "HEAD", "--", `apps/ui-xr/public/generated-humanoids/${actorFile}`], {
        cwd: ROOT,
        maxBuffer: 16 * 1024 * 1024,
      })
        .toString("utf8")
        .split("\n")
        .filter((line) => line.length > 0);
      const states: Array<{ rev: string; subject: string; sha256: string }> = [];
      for (const line of log) {
        const tab = line.indexOf("\0");
        const rev = tab < 0 ? line : line.slice(0, tab);
        const subject = tab < 0 ? "" : line.slice(tab + 1);
        const sha = gitGlbSha256(rev, actorFile);
        if (sha === null) continue;
        states.push({ rev, subject, sha256: sha });
      }
      lashHistoryCache.set(actorFile, states);
      return states;
    },
  };
}

/**
 * R3(b) lineage-aware CW allowance (kevin-collar s10h5 L2, s10h6 L1 content bridge).
 * The strict CW1/CW2
 * compares pin the producer-emitted lash-stage input bytes; recorded post-lash
 * byte stages (teeth swap, kevin-colour, S9 chest split) legitimately move those
 * bytes, so strict equality REDs on an attributed drift. This walk proves the
 * emitted input is an ANCESTOR of the live GLB through the recorded lineage
 * instead of re-pinning: sidecar top pins live, assertLineageContinuity holds
 * over every level (broken-link throws), then newest-to-oldest steps are each a
 * recorded derivation — the lineage levels in order (the newest level's own
 * output is the top pin; each older level's output is the next-newer level's
 * recordedBefore pin), sidecar input/output blocks (teethSwapB1,
 * actorHairColourPostExport, taking precedence over a level step at the same
 * sha and closing level traversal once taken), and at most ONE
 * content-addressed git hop: the commit X whose blob hashes to the sidecar
 * floor `cur` is accepted only when the previous GLB-touching commit's
 * blob (X^ state) hashes to the emitted input. The commit subject is printed in
 * the proof line but never matched — a lash-named subject is not evidence.
 * A second bridge attempt, a shallow clone, or a history with no commit
 * recording `cur` all throw, so the caller fails closed and stays RED.
 * Chosen h2-B1 verification: a recorded intermediate level is followed only
 * when its preImageRevision resolves in git to its preImageSha256.
 *
 * Returns the walked sha path newest-first for the proof print.
 */
function verifyRecordedLevelPreImage(actorFile: string, name: string, input: string, preImageRevision: unknown): void {
  if (typeof preImageRevision !== "string" || preImageRevision.trim() === "") {
    throw new Error(`${actorFile}: lash-ancestor refused: recorded step ${name} names no git pre-image revision, so its claim to derive from ${input} is unverified`);
  }
  let digest: string;
  try {
    const bytes = execFileSync("git", ["show", preImageRevision], { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 });
    digest = createHash("sha256").update(bytes).digest("hex");
  } catch {
    throw new Error(`${actorFile}: lash-ancestor refused: recorded step ${name} pre-image ${preImageRevision} does not resolve in git`);
  }
  if (digest !== input) {
    throw new Error(`${actorFile}: lash-ancestor refused: recorded step ${name} claims pre-image ${input} but git revision ${preImageRevision} hashes to ${digest}`);
  }
}

export function validateLashAncestorChain(
  actorFile: string,
  liveSha256: string,
  sidecar: Record<string, unknown>,
  emittedInputSha256: string,
  history?: LashGitHistory,
): string[] {
  const chain = sidecar as LashChainSidecar;
  if (chain.outputSha256 !== liveSha256) {
    throw new Error(
      `${actorFile}: lash-ancestor no-path: sidecar top ${chain.outputSha256} does not pin live ${liveSha256}`,
    );
  }
  const levels = lineageLevels(sidecar);
  if (levels.length === 0) {
    throw new Error(`${actorFile}: lash-ancestor no-path: sidecar records no byteLineage chain to walk`);
  }
  assertLineageContinuity(actorFile, levels);
  const newest = levels[0];
  const newestPre = newest?.preImageSha256;
  if (typeof newestPre !== "string" || !HEX64.test(newestPre)) {
    throw new Error(`${actorFile}: lash-ancestor no-path: newest byteLineage level names no preImageSha256`);
  }
  const blockSteps: Array<{ out: string; input: string; name: string }> = [];
  if (typeof chain.teethSwapB1?.input?.sha256 === "string" && typeof chain.teethSwapB1?.output?.sha256 === "string") {
    blockSteps.push({ out: chain.teethSwapB1.output.sha256, input: chain.teethSwapB1.input.sha256, name: "teethSwapB1" });
  }
  if (
    typeof chain.actorHairColourPostExport?.inputGlbSha256 === "string" &&
    typeof chain.actorHairColourPostExport?.outputGlbSha256 === "string"
  ) {
    blockSteps.push({
      out: chain.actorHairColourPostExport.outputGlbSha256,
      input: chain.actorHairColourPostExport.inputGlbSha256,
      name: "actorHairColourPostExport",
    });
  }
  // The newest level's own output is the top pin (verified above): the S9-style newest step.
  const path = [liveSha256, newestPre];
  const seen = new Set(path);
  let cur = newestPre;
  let gitBridged = false;
  // Recorded intermediate derivations (route-A second post-lash level): every
  // non-newest level L(i) re-derived out(i) = L(i-1).recordedBefore.outputSha256
  // from pre(i) = L(i).preImageSha256, continuity-verified above. The walk
  // follows one newest-to-oldest ONLY when it is VERIFIED: its preImageRevision
  // resolves in git to bytes hashing to pre(i). A recorded level that names
  // the emitted input but whose git pre-image hashes elsewhere (Codex forgery:
  // intermediate claims emitted as input and repeats it in recordedBefore) is
  // refused here instead of walked. Block steps (teethSwapB1, colour) take
  // precedence over a level step at the same cur (they divert into the
  // pre-sidecar bridge); once a block step is taken the walk stays out of
  // recorded levels so it cannot descend past the bridge point, and the walk
  // still ends in exactly one content-addressed git hop, fail-closed.
  const levelSteps: Array<{ out: string; input: string; name: string; preImageRevision: unknown }> = [];
  levels.forEach((level, index) => {
    const out = index === 0 ? liveSha256 : levels[index - 1]?.recordedBefore?.outputSha256;
    const input = level.preImageSha256;
    if (typeof out === "string" && HEX64.test(out) && typeof input === "string" && HEX64.test(input)) {
      levelSteps.push({ out, input, name: `byteLineage L${index}`, preImageRevision: level.preImageRevision });
    }
  });
  let blockTaken = false;
  for (let iter = 0; iter < 64; iter++) {
    if (cur === emittedInputSha256) return path;
    const step = blockSteps.find((s) => s.out === cur);
    if (step !== undefined) {
      if (seen.has(step.input)) {
        throw new Error(`${actorFile}: lash-ancestor no-path: recorded step ${step.name} cycles at ${step.input}`);
      }
      cur = step.input;
      path.push(cur);
      seen.add(cur);
      blockTaken = true;
      continue;
    }
    if (!blockTaken) {
      const level = levelSteps.find((s) => s.out === cur);
      if (level !== undefined) {
        verifyRecordedLevelPreImage(actorFile, level.name, level.input, level.preImageRevision);
        if (seen.has(level.input)) {
          throw new Error(`${actorFile}: lash-ancestor no-path: recorded step ${level.name} cycles at ${level.input}`);
        }
        cur = level.input;
        path.push(cur);
        seen.add(cur);
        continue;
      }
    }
    // No sidecar block records the derivation that outputs cur, and no
    // (pre-block) recorded level does either: exactly ONE content-addressed
    // git hop is allowed. The bridge commit X is identified
    // by CONTENT — sha256(blob at X) == cur — and accepted only when the
    // previous GLB-touching commit's blob (X^ state) hashes to the emitted
    // input. The subject is printed, never matched.
    if (gitBridged) {
      throw new Error(`${actorFile}: lash-ancestor no-path: git bridge already taken and ${cur} is still not the emitted input ${emittedInputSha256}; the bridge is one hop, refusing a second`);
    }
    const gitHistory = history ?? realLashGitHistory();
    if (gitHistory.isShallow()) {
      throw new Error(`${actorFile}: lash-ancestor history unavailable: CI checkout needs fetch-depth: 0 to prove the recorded ancestor of ${cur}`);
    }
    const states = gitHistory.glbStates(actorFile);
    const at = states.findIndex((s) => s.sha256 === cur);
    if (at < 0) {
      throw new Error(`${actorFile}: lash-ancestor history unavailable: CI checkout needs fetch-depth: 0 (no commit records byte state ${cur}; full history is required to prove the recorded ancestor)`);
    }
    const bridge = states[at];
    const parentState = bridge === undefined ? undefined : states[at + 1];
    if (bridge === undefined || parentState === undefined) {
      throw new Error(`${actorFile}: lash-ancestor no-path: bridge commit reaches history root without emitting ${emittedInputSha256}`);
    }
    if (parentState.sha256 !== emittedInputSha256) {
      throw new Error(`${actorFile}: lash-ancestor no-path: byte step ${cur} resolves to commit ${bridge.rev} whose previous state ${parentState.sha256} is not the emitted input ${emittedInputSha256}; refusing the bridge`);
    }
    if (seen.has(parentState.sha256)) {
      throw new Error(`${actorFile}: lash-ancestor no-path: git bridge ${bridge.rev} cycles at ${parentState.sha256}`);
    }
    console.log(`lash-ancestor git bridge ${bridge.rev} (${bridge.subject}): ${cur.slice(0, 12)} -> ${parentState.sha256.slice(0, 12)}`);
    cur = parentState.sha256;
    path.push(cur);
    seen.add(cur);
    gitBridged = true;
  }
  throw new Error(`${actorFile}: lash-ancestor no-path: walk exceeded 64 steps without reaching emitted ${emittedInputSha256}`);
}

/**
 * CW1 emission locator (kevin-collar s10h7 split): the counterweight reference
 * is the lash stage's OWN INPUT as the producer emitted it, and this resolves
 * plus authenticates that endpoint (history bytes + sidecar emission) before
 * the ancestor walk. Fails closed on any unattributed baseline.
 */
export function resolveEmittedLashInput(file: string): {
  sidecar: Record<string, unknown>;
  emitted: string;
  baseBytes: Buffer;
} {
  const baseBytes = execFileSync("git", ["show", `${BASELINE_REF}:apps/ui-xr/public/generated-humanoids/${file}`], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  // R3(a): the counterweight reference is the lash stage's OWN INPUT as the producer
  // emitted it (sidecar lashFollowR8.inputSha256, written by repack_lash_follow.py at
  // bake time). The history bytes above are accepted only when they hash to exactly
  // that emission; a locator that resolves anywhere else fails closed. No hand-picked
  // reference sha lives here.
  const sidecar = JSON.parse(readFileSync(join(GLB_DIR, file.replace(/\.glb$/, ".provenance.json")), "utf8")) as Record<
    string,
    unknown
  > & {
    lashFollowR8?: { inputSha256?: unknown };
  };
  const emitted = sidecar.lashFollowR8?.inputSha256;
  if (typeof emitted !== "string" || !/^[0-9a-f]{64}$/.test(emitted)) {
    throw new Error(`${file}: CW1 lash-stage input sha missing from the sidecar (lashFollowR8.inputSha256); refusing to compare against an unattributed baseline`);
  }
  const resolved = createHash("sha256").update(baseBytes).digest("hex");
  if (resolved !== emitted) {
    throw new Error(`${file}: CW1 history locator no longer resolves to the producer-emitted lash input (want ${emitted}, got ${resolved}); refusing a stale baseline`);
  }
  return { sidecar, emitted, baseBytes };
}
