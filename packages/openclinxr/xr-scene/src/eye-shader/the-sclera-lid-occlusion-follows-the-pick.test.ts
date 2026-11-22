// Card tsk_4f558331cd1da0f3 SCLERA-LID-OCCLUSION.
// NONE close: pick.json 53b739d7b09225bdc90fc5837ac442cfb5d64ceaff0a505b3b0aa480e5310b38
// (cap57 2026-11-22); sweep s in {0.33, 0.67, 1.0} went 0/3 clean (gate.json); the residual is
// structural (medial bright bars, grey limbus ring, 2x catchlights), so a strength scalar cannot
// close it. main.ts installs no lid-ray occlusion; the file name predates the verdict.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function testRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("workspace root (pnpm-workspace.yaml) not found");
}

const PICK_PATH =
  "/Volumes/files/openclinxr-assets/store/aisha-parity/sclera-occ/pick.json";

const BLOCKED =
  "sclera BLOCKED at the runtime-vs-Cycles shading difference " +
  "(tsk_4f558331cd1da0f3, last sclera attempt); installing lid-ray occlusion needs a new " +
  "graded per-band sweep";

const INSTALLER_IDENTIFIERS = [
  "installEyeSpecularOcclusion",
  "eyeLidOcclusionStrength",
  "eye-lid-ray",
  "eye-specular-occlusion",
  "eyeLidDiffuseOcclusion",
];

// Floor measured on commit 3c568f5e6: exactly one morphTargetsNeutralized site
// (apps/ui-xr/src/main.ts line 2649, inside assetLoadingContext()). A deleted site reds;
// a new legitimate site does not.
const MORPH_SITES_FLOOR_ON_3C568F5E6 = 1;

const FORBIDDEN_XR_SCENE_MODULES = [
  "src/eye-shader/eye-specular-occlusion.ts",
  "src/eye-shader/eye-lid-ray-glsl.ts",
  "src/eye-shader/eye-lid-ray-proxy.ts",
  "src/eye-shader/eye-lid-aperture.ts",
];

function readMainTs(): string {
  return readFileSync(join(testRepoRoot(), "apps/ui-xr/src/main.ts"), "utf8");
}

function hitIdentifiers(haystack: string): string[] {
  return INSTALLER_IDENTIFIERS.filter((id) => haystack.includes(id));
}

// Capture each morphTargetsNeutralized arrow body: from the `=>` after the site,
// a balanced `{...}` block, otherwise the rest of the line (expression body).
function morphSiteBodies(mainTs: string): string[] {
  const bodies: string[] = [];
  const needle = "morphTargetsNeutralized";
  let from = 0;
  for (;;) {
    const at = mainTs.indexOf(needle, from);
    if (at < 0) return bodies;
    const arrow = mainTs.indexOf("=>", at);
    expect(arrow, `morphTargetsNeutralized site at index ${at} is an arrow`).toBeGreaterThanOrEqual(0);
    const rest = mainTs.slice(arrow + 2).replace(/^\s+/, "");
    if (rest.startsWith("{")) {
      let depth = 0;
      let end = -1;
      for (let i = 0; i < rest.length; i += 1) {
        if (rest[i] === "{") depth += 1;
        if (rest[i] === "}") {
          depth -= 1;
          if (depth === 0) {
            end = i + 1;
            break;
          }
        }
      }
      expect(end, `morphTargetsNeutralized site at index ${at} has a balanced body`).toBeGreaterThanOrEqual(0);
      bodies.push(rest.slice(0, end === -1 ? undefined : end));
      from = arrow + 2 + (end === -1 ? rest.length : end);
    } else {
      const newline = rest.indexOf("\n");
      bodies.push(newline === -1 ? rest : rest.slice(0, newline));
      from = arrow + 2 + (newline === -1 ? rest.length : newline + 1);
    }
  }
}

describe("the sclera lid occlusion follows the pick", () => {
  it("SYMBOL: main.ts is the production file under guard", () => {
    const mainTs = readMainTs();
    expect(
      mainTs.includes("assetLoadingContext"),
      `restore the morphTargetsNeutralized site in apps/ui-xr/src/main.ts assetLoadingContext(); ${BLOCKED} (see ${PICK_PATH})`,
    ).toBe(true);
    expect(
      mainTs.includes("morphTargetsNeutralized"),
      `restore the morphTargetsNeutralized site in apps/ui-xr/src/main.ts assetLoadingContext(); ${BLOCKED} (see ${PICK_PATH})`,
    ).toBe(true);
  });

  it("N1: main.ts installs no lid-ray occlusion", () => {
    const hits = hitIdentifiers(readMainTs());
    expect(
      hits,
      `remove the lid-ray import/call (${hits.join(", ") || "none found"}) from apps/ui-xr/src/main.ts; ` +
        `installing it needs a new graded per-band sweep. ${BLOCKED} (see ${PICK_PATH})`,
    ).toEqual([]);
  });

  it("N2: every morphTargetsNeutralized site installs no lid-ray occlusion", () => {
    const mainTs = readMainTs();
    const bodies = morphSiteBodies(mainTs);
    expect(
      bodies.length,
      `restore the morphTargetsNeutralized site in apps/ui-xr/src/main.ts assetLoadingContext() ` +
        `(floor ${MORPH_SITES_FLOOR_ON_3C568F5E6}); ${BLOCKED} (see ${PICK_PATH})`,
    ).toBeGreaterThanOrEqual(MORPH_SITES_FLOOR_ON_3C568F5E6);
    for (const body of bodies) {
      const hits = hitIdentifiers(body);
      expect(
        hits,
        `remove the lid-ray installer call (${hits.join(", ") || "none found"}) from the ` +
          `morphTargetsNeutralized body in apps/ui-xr/src/main.ts; installing it needs a new ` +
          `graded per-band sweep. ${BLOCKED} (see ${PICK_PATH})`,
      ).toEqual([]);
    }
  });

  it("N3: xr-scene ships no eye-specular-occlusion / eye-lid-ray module", () => {
    const root = testRepoRoot();
    const present = FORBIDDEN_XR_SCENE_MODULES.filter((rel) =>
      existsSync(join(root, "packages/openclinxr/xr-scene", rel)),
    );
    expect(
      present,
      `remove ${present.join(", ") || "the lid-ray module"} from packages/openclinxr/xr-scene; ` +
        `a reviewer-added module must default off and needs a new graded per-band sweep. ` +
        `${BLOCKED} (see ${PICK_PATH})`,
    ).toEqual([]);
    const pkg = JSON.parse(
      readFileSync(join(root, "packages/openclinxr/xr-scene/package.json"), "utf8"),
    ) as { exports?: Record<string, unknown> };
    const subpaths = Object.keys(pkg.exports ?? {});
    const hits = subpaths.filter((sub) => hitIdentifiers(sub).length > 0);
    expect(
      hits,
      `remove the lid-ray export subpath (${hits.join(", ") || "none found"}) from ` +
        `packages/openclinxr/xr-scene/package.json; a reviewer-added export must default off and ` +
        `needs a new graded per-band sweep. ${BLOCKED} (see ${PICK_PATH})`,
    ).toEqual([]);
  });
});
