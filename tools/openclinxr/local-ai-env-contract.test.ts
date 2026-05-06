import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const requiredKeys = [
  "OPENCLINXR_LOCAL_MODEL_RUNTIME",
  "OPENCLINXR_LOCAL_MODEL_ID",
  "OPENCLINXR_LOCAL_VOICE_RUNTIME",
  "OPENCLINXR_LOCAL_VOICE_ID",
  "OPENCLINXR_PYTHON_VOICE_BACKEND_WS_URL",
  "OPENCLINXR_PYTHON_VOICE_PROXY_EVIDENCE_FILE",
];

describe("local AI environment contract", () => {
  it("documents the local-only model and voice benchmark variables", async () => {
    const example = await readFile(".env.openclinxr.local.example", "utf8");
    const handoff = await readFile("docs/openclinxr/development-handoff.md", "utf8");

    for (const key of requiredKeys) {
      expect(example).toContain(`${key}=`);
      expect(handoff).toContain(key);
    }

    expect(example).toContain("# No cloud calls, model downloads, or runtime execution are performed by pnpm local:provider:benchmark.");
    expect(handoff).toContain("`.env.openclinxr.local.example`");
  });
});
