/** C24 authored affect script: each asked actor's emotion and tint after its topic answer, SERVER values only. */
import type { IntentKind } from "@openclinxr/xr-sync-client/headset";
import { createC17Evidence, observedCaptionOf, renderC17Panel, type C17CaptionView } from "./probe-c17.js";
import { resolveActorTint } from "./probe-state.js";

export interface C24Evidence {
  stationId: string;
  asks: Array<{ actorId: string; topic: string | null; emotion: string; tint: number; replyId: string; ack: boolean }>;
  panelTexts: string[];
}

declare global {
  interface Window {
    __syncProbeC24?: C24Evidence;
  }
}

interface C24View extends C17CaptionView {
  phase?: unknown;
}

/** One ?c24Ask= value is `<actorId>|<topicTag>`; an empty topic is the opening turn. */
function parseAsk(raw: string): { actorId: string; topic: string | null } {
  const [actorId = "", topic = ""] = raw.split("|");
  return { actorId, topic: topic === "" ? null : topic };
}

export async function runC24Probe(deps: {
  waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void>;
  sendIntentAndSettle(kind: IntentKind, payload: Record<string, unknown>): Promise<void>;
  getSnapshot(): unknown;
  setStatus(text: string): void;
  setPoseStreaming(enabled: boolean): void;
  intentCounts(): { acks: number };
}): Promise<void> {
  const asks = new URLSearchParams(window.location.search).getAll("c24Ask").map(parseAsk);
  if (asks.length === 0 || asks.some((ask) => ask.actorId === "")) {
    throw new Error("c24 requires c24Ask=<actorId>|<topicTag> values");
  }
  deps.setPoseStreaming(false);
  const view = (): C24View => deps.getSnapshot() as C24View;
  await deps.waitFor(
    () => view().phase === "encounter" && typeof view().stationId === "string" && Object.keys(view().actors ?? {}).length > 0,
    30000,
    "c24 slot-a encounter",
  );
  const evidence: C24Evidence = { stationId: String(view().stationId ?? ""), asks: [], panelTexts: [] };
  const c17 = createC17Evidence();
  const publish = (): void => {
    window.__syncProbeC24 = evidence;
    if (window.__syncProbe !== undefined) Object.assign(window.__syncProbe, { c24: evidence });
  };
  publish();
  for (const { actorId, topic } of asks) {
    deps.setStatus(`sync-probe c24 ${actorId} ${topic ?? "opening"}`);
    await deps.sendIntentAndSettle("select-actor", { actorId });
    await deps.sendIntentAndSettle("utterance-start", {});
    const before = deps.intentCounts().acks;
    await deps.sendIntentAndSettle("utterance-end", topic === null ? {} : { topicTag: topic });
    const ack = deps.intentCounts().acks === before + 1;
    await deps.waitFor(() => observedCaptionOf(view(), actorId).speaking, 15000, `c24 ${actorId} speaking`);
    renderC17Panel({ c17 }, view());
    const emotion = String(view().actors?.[actorId]?.emotion ?? "");
    const tint = resolveActorTint(emotion);
    const badge = document.querySelector("#sync-probe-station");
    const text = `${actorId} ${emotion}: ${observedCaptionOf(view(), actorId).caption}`;
    if (badge) badge.textContent = text;
    evidence.panelTexts.push(text);
    evidence.asks.push({ actorId, topic, emotion, tint, replyId: observedCaptionOf(view(), actorId).replyId, ack });
    publish();
    await deps.waitFor(() => !observedCaptionOf(view(), actorId).speaking, 15000, `c24 ${actorId} completed`);
  }
}
