/**
 * Validator-only probe query module: parsing ?sync=/flags, nothing else.
 * (Architecture gate: apps/ modules must not mix a parse…/validate…/assert…/is…
 * function with other exports.)
 */

export interface ProbeQuery {
  syncUrl: string;
  useIwer: boolean;
  autostart: boolean;
  /** Quest mode: install the IWER runtime even when a native runtime is present. */
  forceIwer: boolean;
  /** Probe script: "c2" (sweep + select each actor), "c3" (server-driven actor turn), "c6" (phase-gated C3 inside the encounter window), "c7" (C3 script once per station with server rotation), "c8" (c7 loop with pose streaming on + observer badge), "c10" (faculty replay of one recorded station), "c11" (C3 script once + patient-note submits in the note phase), or "c12" (review lobby: trigger station-2, watch its replay). */
  script: "c2" | "c3" | "c6" | "c7" | "c8" | "c10" | "c11" | "c12";
  /** C10 faculty replay: the recorded station id to replay (from ?replayStationId=; "" otherwise). */
  replayStationId: string;
}

/** Parse the probe query string. Throws on missing/invalid ?sync=. */
export function parseProbeQuery(search: string): ProbeQuery {
  const params = new URLSearchParams(search);
  const syncUrl = params.get("sync") ?? "";
  if (!/^ws:\/\/127\.0\.0\.1:\d+$/.test(syncUrl) && !/^ws:\/\/localhost:\d+$/.test(syncUrl)) {
    throw new Error(`invalid or missing ?sync= ws url: ${syncUrl.slice(0, 80)}`);
  }
  const scriptParam = params.get("script") ?? "c2";
  if (scriptParam !== "c2" && scriptParam !== "c3" && scriptParam !== "c6" && scriptParam !== "c7" && scriptParam !== "c8" && scriptParam !== "c10" && scriptParam !== "c11" && scriptParam !== "c12") {
    throw new Error(`invalid ?script= value: ${scriptParam.slice(0, 20)}`);
  }
  const replayStationId = params.get("replayStationId") ?? "";
  if (scriptParam === "c10" && replayStationId === "") {
    throw new Error("?script=c10 requires ?replayStationId=<recorded station id>");
  }
  return {
    syncUrl,
    useIwer: params.get("iwer") === "1",
    autostart: params.get("autostart") === "1",
    forceIwer: params.get("forceIwer") === "1",
    script: scriptParam,
    replayStationId,
  };
}

/** ?noteMaxChars= page parameter (the C11 harness mirrors its server config). */
export function parseC11NoteMaxChars(search: string): number {
  const raw = new URLSearchParams(search).get("noteMaxChars") ?? "";
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`invalid ?noteMaxChars= value: ${raw.slice(0, 20)}`);
  }
  return parsed;
}
