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
}

/** Parse the probe query string. Throws on missing/invalid ?sync=. */
export function parseProbeQuery(search: string): ProbeQuery {
  const params = new URLSearchParams(search);
  const syncUrl = params.get("sync") ?? "";
  if (!/^ws:\/\/127\.0\.0\.1:\d+$/.test(syncUrl) && !/^ws:\/\/localhost:\d+$/.test(syncUrl)) {
    throw new Error(`invalid or missing ?sync= ws url: ${syncUrl.slice(0, 80)}`);
  }
  return {
    syncUrl,
    useIwer: params.get("iwer") === "1",
    autostart: params.get("autostart") === "1",
    forceIwer: params.get("forceIwer") === "1",
  };
}
