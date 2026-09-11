import type { ApiAppContext } from "../../api-app-context.js";
import type { ScenarioProposalRecord } from "./types.js";

/**
 * In-process proposal map keyed by ctx. Measured: ApiPersistenceSink has no generic
 * document bag or proposal method; runtime-durable-store only wraps exam-run/packet
 * adapters already on the sink; a new sink/context field would be a name apps/api
 * must construct. Keep WeakMap.
 */
const stores = new WeakMap<ApiAppContext, Map<string, ScenarioProposalRecord>>();

export function proposalStoreFor(ctx: ApiAppContext): Map<string, ScenarioProposalRecord> {
  const existing = stores.get(ctx);
  if (existing) return existing;
  const created = new Map<string, ScenarioProposalRecord>();
  stores.set(ctx, created);
  return created;
}
