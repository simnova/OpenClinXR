/** Explicit app-to-package composition contract; dependency transforms need no free compile-time identifier. */
export function readBrowserBuildIdentity(doc: Pick<Document, "getElementById"> | null = typeof document === "undefined" || typeof document.getElementById !== "function" ? null : document): { gitCommit: string; capacitySourceHash: string } | null {
  const json = doc?.getElementById("capacity-app-metadata")?.textContent;
  if (!json || json.length > 2048) return null;
  try {
    const value = JSON.parse(json) as { gitCommit?: unknown; capacitySourceHash?: unknown };
    if (!value || typeof value.gitCommit !== "string" || !value.gitCommit.trim() || value.gitCommit.length > 128 || /[\u0000-\u001f]/.test(value.gitCommit) || typeof value.capacitySourceHash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.capacitySourceHash)) return null;
    return { gitCommit: value.gitCommit, capacitySourceHash: value.capacitySourceHash };
  } catch { return null; }
}
