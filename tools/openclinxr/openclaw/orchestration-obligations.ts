/**
 * Declared orchestration obligations — the gateable half of "pieces built, left unconnected".
 *
 * That class recurred six times in one day (merge-kill, contract report, DONE_WHEN vocabulary,
 * integrationEvents, planted-contract honesty, known-broken freeze). Prose in PROTO_BOARD_LOOP
 * ("what calls this?") did not stop the pattern. Every other same-day lesson became a gate; this
 * is the gate for runtime obligations that must stay wired.
 *
 * NOT a scan of exports. Measured: "export with no importer outside its file/test" flags 184/233
 * (~79%) of openclaw exports — most exist for their own unit test. A scan is permanently frozen or
 * useless. Intent is declared: a small curated registry of symbols sold as gates / SSOTs /
 * land-path steps / honesty checks, plus the callers that must invoke them.
 *
 * Seed = historical cases that are wired on the live land path today. Staged checkers that still
 * lack a production caller (plantedContractsAreHonest, staleFreezeEntries → architecture suite)
 * are NOT listed until a requiredCaller exists — declaring them early would either fail forever or
 * ban legitimate staging.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type OrchestrationObligation = {
  id: string;
  /** Exported symbol that must be invoked by each required caller. */
  symbol: string;
  /** Module that owns / exports the symbol (repo-relative). Documented; not scanned. */
  fromModule: string;
  /** Repo-relative production callers that must invoke `symbol`. At least one required. */
  requiredCallers: readonly string[];
};

/**
 * Curated registry. Keep small (<40). Every entry names who must call it.
 * Add an entry when shipping a new runtime obligation; remove only when the obligation is retired.
 */
export const ORCHESTRATION_OBLIGATIONS: readonly OrchestrationObligation[] = [
  // 1. merge-kill exited 2 into the void until integrate called it first.
  {
    id: "merge-kill-on-land",
    symbol: "runMergeKill",
    fromModule: "tools/openclinxr/openclaw/merge-kill.ts",
    requiredCallers: ["tools/openclinxr/openclaw/integrate.ts"],
  },
  // 2. integrate passed contract:null while the report existed — land path must load it.
  {
    id: "contract-loaded-on-land",
    symbol: "contractForSlice",
    fromModule: "tools/openclinxr/openclaw/integrate.ts",
    requiredCallers: ["tools/openclinxr/openclaw/integrate.ts"],
  },
  // 3. DONE_WHEN_RULE_VOCABULARY was a "single source of truth" the evaluator never read.
  {
    id: "done-when-vocabulary-ssot",
    symbol: "DONE_WHEN_RULE_VOCABULARY",
    fromModule: "packages/openclinxr/agent-loop/src/done-when-rules.ts",
    requiredCallers: ["tools/openclinxr/openclaw/dispatch-worker.ts"],
  },
  // 4. integrationEvents built to replace subject-regexing; scorecard / pause must use it.
  {
    id: "integration-events-for-landed-inference",
    symbol: "integrationEvents",
    fromModule: "tools/openclinxr/openclaw/integrate.ts",
    requiredCallers: [
      "tools/openclinxr/openclaw/delegation-scorecard.ts",
      "tools/openclinxr/openclaw/loop-pause.ts",
    ],
  },
] as const;

/** Word-boundary match so `runMergeKill` does not match `runMergeKillReport`. */
function fileInvokesSymbol(source: string, symbol: string): boolean {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`).test(source);
}

/**
 * Returns human-readable violations for declared obligations whose required callers do not
 * invoke the symbol. Empty array = every declared obligation is actually wired on the tree.
 */
export function unwiredObligations(repoRoot: string): string[] {
  const violations: string[] = [];

  for (const obligation of ORCHESTRATION_OBLIGATIONS) {
    for (const caller of obligation.requiredCallers) {
      const callerPath = join(repoRoot, caller);
      if (!existsSync(callerPath)) {
        violations.push(
          `obligation "${obligation.id}": required caller ${caller} is missing — ` +
            `${obligation.symbol} is unwired (not called)`,
        );
        continue;
      }
      const source = readFileSync(callerPath, "utf8");
      if (!fileInvokesSymbol(source, obligation.symbol)) {
        violations.push(
          `obligation "${obligation.id}": required caller ${caller} never invokes ` +
            `${obligation.symbol} (unwired)`,
        );
      }
    }
  }

  return violations;
}
