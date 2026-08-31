import type { AdminControlPlaneClientOptions } from "./api-client-types.js";

/**
 * Faculty world-compile request: POSTs the featured scenario to
 * /internal/world-compile. Request-only surface; the API route's
 * compileEncounterMaterialization invoke and baker split are later lanes.
 *
 * Lives in its own module (re-exported from api-client.js) to keep api-client.ts
 * within its 600-line zone budget.
 */
export async function compileEncounterWorld(
  input: {
    scenarioId: string;
    compileNodes?: unknown[];
    facultyLocks?: unknown[];
    infinigenPrompt?: string;
    removedNodeIds?: string[];
  },
  options: Pick<AdminControlPlaneClientOptions, "baseUrl" | "fetch" | "accessToken" | "getAccessToken"> = {},
): Promise<Record<string, unknown>> {
  const baseUrl = (options.baseUrl ?? import.meta.env["VITE_OPENCLINXR_API_BASE_URL"] ?? "").replace(/\/$/, "");
  const fetcher = options.fetch ?? fetch;
  const token = options.getAccessToken ? await options.getAccessToken() : options.accessToken;
  const authHeaders =
    typeof token === "string" && token.trim().length > 0
      ? { authorization: `Bearer ${token.trim()}` }
      : {};
  const url = `${baseUrl}/internal/world-compile`;
  const response = await fetcher(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders },
    body: JSON.stringify({
      scenarioId: input.scenarioId,
      ...(input.compileNodes ? { compileNodes: input.compileNodes } : {}),
      ...(input.facultyLocks ? { facultyLocks: input.facultyLocks } : {}),
      ...(input.infinigenPrompt ? { infinigenPrompt: input.infinigenPrompt } : {}),
      ...(input.removedNodeIds ? { removedNodeIds: input.removedNodeIds } : {}),
    }),
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const errorCode = typeof errorBody["error"] === "string" ? errorBody["error"] : "unknown_error";
    throw new Error(`OpenClinXR admin API request failed: POST ${url} ${response.status} ${errorCode}`);
  }

  return response.json() as Promise<Record<string, unknown>>;
}
