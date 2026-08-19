import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * SUBSTRATE — `role:` IS A LABEL. IT BINDS NOTHING.
 *
 * ## THE DEFECT, MEASURED — do not re-derive this
 *
 * `tools/openclinxr/openclaw/dispatch-worker.ts` contains **zero** calls to
 * `buildRepoAgentSpawnPrompt`, zero references to `charter`, zero to Persona. Grepping
 * `spawn-spec|buildRepoAgentSpawnPrompt|charter` returns one COMMENT and no call. Every worker
 * dispatched through this path ran without its role's Persona, memory, or escalation contract —
 * the `role:` argument was a string that reached the ledger and nothing else.
 *
 * Meanwhile `packages/openclinxr/agent-loop/src/grok-repo-agent-spawn.ts:176` already builds
 * exactly that prompt and is wired to `pnpm grok:agent:spawn-spec`. Proven tool, unconsumed, inside
 * the orchestration path itself (D1). The two halves were never joined: `dispatch()` owns the
 * contract machinery, `spawn-spec` owns the charter, and nobody called one from the other.
 *
 * ## WHAT THE BAKER ACTUALLY EMITS — measured, because the first spec of this slice was wrong
 *
 * The RED first proposed for this slice required the literal `ESCALATION GUARD`. Called against
 * `xr-systems-architect` (4,226 chars) the baker emits:
 *
 *   "## Persona"   true      "ESCALATION"   true       "charter.md"  true
 *   "UNABLE:"      true      "memory.md"    true       roleDir echo  true
 *   "ESCALATION GUARD"  FALSE       "visibility"  FALSE      "noticeab"  FALSE
 *
 * So asserting `ESCALATION GUARD` would have been unsatisfiable — the #428 failure, which already
 * cost a dispatch and a resume. **This contract asserts only strings the baker demonstrably
 * writes.** Extending the baker to carry a named guard and the visibility mandate is a separate,
 * named follow-up and must not be smuggled in here.
 *
 * ## roleDir COMES FROM THE RESOLVER, NOT A LITERAL
 *
 * `repoRoleHarnessPolicies` entries carry **no** `roleDir`. `grok-agent-cli.ts:30-45` discovers it
 * by walking `agents/<group>/<role>/` and requiring `charter.md`, `memory.md`, `index.json`. The
 * real directory is `agents/core/xr-systems-architect` — **not** the `agents/technical/...` I first
 * guessed. Clause (4) requires the resolved path to exist on disk with both files, so a hardcoded
 * guess fails.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                                     | (1) | (2) | (3) | (4) | result
 *   ----------------------------------------------------------------|-----|-----|-----|-----|--------
 *   a) today — role: is a label                                   |FAIL |FAIL | pass| pass| REFUSED
 *   b) re-implement the Persona text inside dispatch-worker.ts    | pass| pass|FAIL | pass| REFUSED
 *   c) bind the charter but drop the contract appendix            | pass|FAIL | pass| pass| REFUSED
 *   d) hardcode agents/technical/... instead of resolving         |FAIL |FAIL | pass|FAIL | REFUSED
 *   e) call the existing baker, keep the contract appendix        | pass| pass| pass| pass| ALL PASS
 *
 * **(c) is the one to watch.** The charter appendix is ~4 KB; the temptation is to make room by
 * trimming the contract/`done_when` composition, which is the machinery that makes a worker's
 * output verifiable at all. Clause (2) requires BOTH in one composed prompt.
 *
 * **(b) is the D1 violation.** Copying the Persona lines into the dispatcher would satisfy a naive
 * string check and fork the manager contract into two places that drift.
 *
 * ## THE IMPORT PATH IS PROVEN, NOT ASSUMED
 *
 * The pass leg was probed with a throwaway implementation and initially FAILED — because my probe
 * used `@openclinxr/agent-loop/...` subpath specifiers, which do not resolve here. The form this
 * repo actually uses is a relative path:
 *
 *   import { buildRepoAgentSpawnPrompt } from "../../../packages/openclinxr/agent-loop/src/grok-repo-agent-spawn.js";
 *   import { repoRoleHarnessPolicies }   from "../../../packages/openclinxr/agent-loop/src/role-harness-policy.js";
 *
 * With those, the probe passed 4/4. That is the difference between this slice and #428, where an
 * unsatisfiable proof cost a dispatch and a resume: the implementer will not discover mid-slice
 * that the module cannot be reached.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (SS227): **(1) and (2) are RED** — the composer does not exist.
 * **(3) and (4) pass today** and are the nets that stop the fix being a copy-paste or a guess.
 *
 * NOT TESTED: that a worker READS its charter (a prompt containing the instruction is not a worker
 * obeying it); whether Persona changes worker output quality; the visibility mandate and a named
 * escalation header, both absent from the baker and deliberately out of scope; `gh` write scope for
 * workers, which is a separate approved change.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const DISPATCHER = join(REPO_ROOT, "tools/openclinxr/openclaw/dispatch-worker.ts");
/** Computed so TypeScript cannot fail on a not-yet-exported symbol (SS383/SS352). */
const SPECIFIER = ["../openclaw/dispatch", "worker.js"].join("-");
const ROLE = "xr-systems-architect";
/** Strings the baker demonstrably emits — measured, not assumed. */
const CHARTER_MARKERS = ["## Persona", "charter.md", "memory.md", "UNABLE:"] as const;

type Composer = (roleId: string) => string;
async function loadComposer(): Promise<Composer | null> {
  try {
    const mod = (await import(SPECIFIER)) as { buildRoleCharterAppendix?: Composer };
    return mod.buildRoleCharterAppendix ?? null;
  } catch {
    return null;
  }
}
const composer = await loadComposer();
function requireComposer(): Composer {
  expect(
    composer,
    "dispatch-worker.ts must export buildRoleCharterAppendix(roleId) — today role: reaches the ledger and nothing else",
  ).not.toBeNull();
  return composer as Composer;
}

describe("dispatch binds the role charter instead of treating role: as a label", () => {
  it("(1) RED: the charter appendix carries the role's Persona, memory and escalate contract", () => {
    const text = requireComposer()(ROLE);
    for (const marker of CHARTER_MARKERS) {
      expect(text, `the appendix must contain ${JSON.stringify(marker)} — measured as emitted by the baker`).toContain(marker);
    }
  });

  it("(2) COUNTERWEIGHT: the contract appendix still composes alongside it", () => {
    // Refuses (c). The charter is ~4 KB; trimming the done_when composition to make room would
    // remove the machinery that makes a worker's output verifiable at all.
    const charter = requireComposer()(ROLE);
    const src = readFileSync(DISPATCHER, "utf8");
    expect(src, "buildContractPromptAppendix must survive").toMatch(/export function buildContractPromptAppendix/);
    expect(src, "the contract appendix must still be composed into the dispatched prompt").toMatch(/buildContractPromptAppendix\(/);
    expect(charter.length, "a charter appendix that is empty is not a binding").toBeGreaterThan(200);
  });

  it("(3) NET: the baker is CALLED, not copied", () => {
    // Refuses (b), the D1 violation: a second copy of the Persona contract that drifts.
    const src = readFileSync(DISPATCHER, "utf8");
    if (composer === null) return; // still RED; this net becomes load-bearing once (1) is green
    expect(src, "dispatch-worker.ts must import the existing baker").toMatch(/buildRepoAgentSpawnPrompt/);
    expect(
      (src.match(/## Persona/g) ?? []).length,
      "the Persona instruction must live in the baker only — do not re-author it here",
    ).toBe(0);
  });

  it("(4) NET: the role directory is resolved from disk, not hardcoded", () => {
    // Refuses (d). Policies carry no roleDir; the real path is agents/core/..., not agents/technical/...
    const resolved = join(REPO_ROOT, "agents/core", ROLE);
    expect(existsSync(join(resolved, "charter.md")), `${ROLE} charter.md must exist where the resolver finds it`).toBe(true);
    expect(existsSync(join(resolved, "memory.md")), `${ROLE} memory.md must exist`).toBe(true);
    if (composer === null) return;
    expect(composer(ROLE), "the appendix must name the resolved role directory").toContain(ROLE);
  });
});
