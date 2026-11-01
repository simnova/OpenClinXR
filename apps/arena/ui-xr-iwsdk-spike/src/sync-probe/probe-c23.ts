/** C23 authored topic-answer script: four turns on slot-a's first cast actor. */
import type { IntentKind } from "@openclinxr/xr-sync-client/headset";
import { createC17Evidence, observedCaptionOf, renderC17Panel, type C17CaptionView } from "./probe-c17.js";

export interface C23Evidence {
  stationId: string;
  actorId: string;
  askedTopics: Array<string | null>;
  replyIds: string[];
  captionsShown: string[];
  acks: boolean[];
}

declare global {
  interface Window {
    __syncProbeC23?: C23Evidence;
  }
}

interface C23View extends C17CaptionView {
  phase?: unknown;
  topicMenu?: unknown;
}

export async function runC23Probe(deps: {
  waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void>;
  sendIntentAndSettle(kind: IntentKind, payload: Record<string, unknown>): Promise<void>;
  getSnapshot(): unknown;
  setStatus(text: string): void;
  setPoseStreaming(enabled: boolean): void;
  intentCounts(): { acks: number };
}): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const seedTopics = params.getAll("c23SeedTopic");
  const fallbackTopic = params.get("c23FallbackTopic") ?? "";
  if (seedTopics.length !== 2 || seedTopics.some((topic) => topic === "") || fallbackTopic === "") {
    throw new Error("c23 requires two c23SeedTopic values and one c23FallbackTopic");
  }
  deps.setPoseStreaming(false);
  const view = (): C23View => deps.getSnapshot() as C23View;
  await deps.waitFor(
    () => view().phase === "encounter" && typeof view().stationId === "string" && Object.keys(view().actors ?? {}).length > 0,
    30000,
    "c23 slot-a encounter",
  );
  const snapshot = view();
  const stationId = typeof snapshot.stationId === "string" ? snapshot.stationId : "";
  const actorId = Object.keys(snapshot.actors ?? {})[0] ?? "";
  const rawMenu = snapshot.topicMenu;
  const menu = Array.isArray(rawMenu) ? rawMenu.filter((tag: unknown): tag is string => typeof tag === "string") : [];
  if (![...seedTopics, fallbackTopic].every((topic) => menu.includes(topic))) {
    throw new Error("c23 harness-selected topics are not all in the server menu");
  }
  const evidence: C23Evidence = { stationId, actorId, askedTopics: [], replyIds: [], captionsShown: [], acks: [] };
  const c17 = createC17Evidence();
  const publish = (): void => {
    window.__syncProbeC23 = evidence;
    if (window.__syncProbe !== undefined) Object.assign(window.__syncProbe, { c23: evidence });
  };
  const ask = async (topicTag: string | null): Promise<void> => {
    await deps.sendIntentAndSettle("select-actor", { actorId });
    await deps.sendIntentAndSettle("utterance-start", {});
    const before = deps.intentCounts().acks;
    await deps.sendIntentAndSettle("utterance-end", topicTag === null ? {} : { topicTag });
    const acked = deps.intentCounts().acks === before + 1;
    await deps.waitFor(() => observedCaptionOf(view(), actorId).speaking, 15000, `c23 ${topicTag ?? "opening"} speaking`);
    renderC17Panel({ c17 }, view());
    const shown = observedCaptionOf(view(), actorId);
    evidence.askedTopics.push(topicTag);
    evidence.replyIds.push(shown.replyId);
    evidence.captionsShown.push(shown.caption);
    evidence.acks.push(acked);
    publish();
    await deps.waitFor(() => !observedCaptionOf(view(), actorId).speaking, 15000, `c23 ${topicTag ?? "opening"} completed`);
  };
  publish();
  for (const topic of [null, ...seedTopics, fallbackTopic] as Array<string | null>) {
    deps.setStatus(`sync-probe c23 ${topic ?? "opening"}`);
    await ask(topic);
  }
}
