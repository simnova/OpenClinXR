import type { ApiAppContext } from "../../api-app-context.js";
import type { ScenarioProposalRecord } from "./types.js";

const stores = new WeakMap<ApiAppContext, Map<string, ScenarioProposalRecord>>();

export function proposalStoreFor(ctx: ApiAppContext): Map<string, ScenarioProposalRecord> {
  const existing = stores.get(ctx);
  if (existing) return existing;
  const created = new Map<string, ScenarioProposalRecord>();
  stores.set(ctx, created);
  return created;
}
