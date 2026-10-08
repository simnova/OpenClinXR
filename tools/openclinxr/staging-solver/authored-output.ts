import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { CameraSearchResult } from "./camera-search.js";

type AuthoredStagingSolution = { camera: { eye: [number, number, number]; look: [number, number, number]; fov: 70 | 80 | 90 }; placements: Record<string, unknown> };

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

function stableSolution(result: CameraSearchResult): AuthoredStagingSolution {
  return {
    camera: {
      eye: result.camera.eye.map(rounded) as [number, number, number],
      look: result.camera.look.map(rounded) as [number, number, number],
      fov: result.camera.fov as 70 | 80 | 90,
    },
    placements: Object.fromEntries([...result.layout].sort((a, b) => a.actorId.localeCompare(b.actorId)).map((row) => [
      row.actorId,
      {
        supportSurface: row.placement.supportSurface,
        plantOffsetMeters: {
          x: rounded(row.placement.plantOffsetMeters.x),
          y: rounded(row.placement.plantOffsetMeters.y),
          z: rounded(row.placement.plantOffsetMeters.z),
        },
        headingRadians: rounded(row.headingRadians),
      },
    ])),
  };
}

export async function writeAuthoredSolutions(
  repoRoot: string,
  additions: ReadonlyMap<string, CameraSearchResult>,
): Promise<void> {
  const merged: Record<string, AuthoredStagingSolution> = {};
  for (const [scenarioId, result] of additions) merged[scenarioId] = stableSolution(result);
  const ordered = Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
  const source = `import type { Scenario } from "@openclinxr/shared-schemas";\n\n`
    + `export type AuthoredStagingCamera = {\n  eye: [number, number, number];\n  look: [number, number, number];\n  fov: 70 | 80 | 90;\n};\n\n`
    + `type Placement = NonNullable<Scenario["actors"][number]["placement"]>;\n`
    + `export type AuthoredStagingSolution = { camera: AuthoredStagingCamera; placements: Record<string, Placement> };\n\n`
    + `// staging-solver v1 — generated deterministically by \`pnpm staging:solve\`.\n`
    + `export const AUTHORED_STAGING_SOLUTIONS: Readonly<Record<string, AuthoredStagingSolution>> = ${JSON.stringify(ordered, null, 2)};\n\n`
    + `export function authoredStagingCameraForScenario(scenarioId: string): AuthoredStagingCamera | undefined {\n`
    + `  return AUTHORED_STAGING_SOLUTIONS[scenarioId]?.camera;\n}\n\n`
    + `export function applyAuthoredStagingSolution(scenario: Scenario): Scenario {\n`
    + `  const solution = AUTHORED_STAGING_SOLUTIONS[scenario.scenarioId];\n  if (!solution) return scenario;\n`
    + `  return { ...scenario, actors: scenario.actors.map((actor) => ({\n`
    + `    ...actor, ...(solution.placements[actor.actorId] ? { placement: solution.placements[actor.actorId] }\n`
    + `      : actor.placement ? { placement: actor.placement } : {}),\n  })) };\n}\n`;
  await writeFile(path.join(repoRoot, "packages/openclinxr/scenario-fixtures/src/staging-solver-authored.ts"), source, "utf8");
}
