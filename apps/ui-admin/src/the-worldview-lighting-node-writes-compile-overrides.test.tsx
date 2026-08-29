import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: EncounterEnvironmentPanel lists descriptor wallColor and lighting
 * as read-only facts. Faculty cannot write them onto a Lighting compile node.
 *
 * MEASURED 2026-08-29. EncounterEnvironmentPanel.tsx:4-7 "Not a 3D preview —
 * displayName, dimensions, floor/wall colour, shell lighting". No Form.Item
 * name wallColor / keyLightIntensity.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED.
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const ENV = readFileSync(join(SRC, "EncounterEnvironmentPanel.tsx"), "utf8");

describe("the worldview lighting node writes compile overrides", () => {
  it.fails("(1) environment panel has a Form.Item for wallColor or keyLightIntensity", () => {
    expect(ENV).toMatch(/name=.*wallColor|name=.*keyLightIntensity/);
  });

  it("(2) COUNTERWEIGHT: descriptor facts still display wallColor and lighting", () => {
    expect(ENV).toMatch(/wallColor/);
    expect(ENV).toMatch(/keyLightIntensity/);
  });
});

// NOT TESTED: live EEVEE grade; Quest lighting; #167.
