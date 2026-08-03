/**
 * delegate:score — coded (non-agentic) delegation scorer.
 *
 * Computes EXACT USD from real input/output tokens via estimateUsdFromSplit and
 * appends a row to .openclinxr/delegation/delegation-ledger.jsonl. No model call:
 * cost + bookkeeping are deterministic (see DELEGATION-OPTIMIZATION-PLAN §2.5).
 *
 * Usage:
 *   tsx tools/openclinxr/delegation/score.ts \
 *     --ledgerId S1-verify-chain --class mechanical-wiring --model deepseek-v4-pro \
 *     --in 43559 --out 819 --quality 1.0 --gatePass true \
 *     --verdict "read-only propose; applied; agent:verify includes 3 gates" \
 *     --mode read-only-propose
 */
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { estimateUsdFromSplit } from "../../../packages/openclinxr/agent-loop/src/model-pricing.js";

const LEDGER = ".openclinxr/delegation/delegation-ledger.jsonl";

function arg(name: string, dflt = ""): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : dflt;
}

async function main(): Promise<void> {
  const model = arg("model", "unknown");
  const inTok = Number(arg("in", "0"));
  const outTok = Number(arg("out", "0"));
  const cachedIn = Number(arg("cachedIn", "0"));
  const quality = Number(arg("quality", "0"));
  const cost = estimateUsdFromSplit(inTok, outTok, model, cachedIn);
  const latencyS = Number(arg("latencyS", "0"));
  // value = quality / (cost + latency_penalty + eps); floor at class bar handled by caller.
  const latencyPenalty = latencyS * (Number(arg("mgrHourlyUsd", "50")) / 3600);
  const value = quality / (cost.usd + latencyPenalty + 1e-4);
  const row = {
    ts: arg("ts", new Date().toISOString().slice(0, 10)),
    ledgerId: arg("ledgerId", "unlabeled"),
    class: arg("class", "unknown"),
    model,
    provider: model.startsWith("deepseek") ? "deepseek" : model.startsWith("grok") ? "grok" : "anthropic",
    mode: arg("mode", "dispatch"),
    inTok,
    outTok,
    usd: Number(cost.usd.toFixed(5)),
    priceRow: cost.priceRowId,
    latencyS,
    quality,
    value: Number(value.toFixed(2)),
    gate: { pass: arg("gatePass", "true") === "true" },
    verdict: arg("verdict", ""),
    ...(arg("assumptionKilled") ? { assumption_killed: arg("assumptionKilled") } : {}),
  };
  await mkdir(path.dirname(LEDGER), { recursive: true });
  await appendFile(LEDGER, `${JSON.stringify(row)}\n`);
  console.log(`scored ${row.ledgerId}: ${model} $${row.usd} q=${quality} value=${row.value} — ${row.verdict}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
