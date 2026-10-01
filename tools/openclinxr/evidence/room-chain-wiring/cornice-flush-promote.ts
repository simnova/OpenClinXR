/** Promote the measured winner and publish new pins without rewriting historical evidence. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { ROOM_CHAIN_RECIPES } from "@openclinxr/factory-stations/room-chain";

const evidence = "docs/openclinxr/room-realism/cornice-flush";
const selection = JSON.parse(readFileSync(`${evidence}/measurements.json`, "utf8")).selection;
const builds = JSON.parse(readFileSync(`${evidence}/build-manifest.json`, "utf8")).results;
for (const [room, environmentId, asset] of [
  ["stepdown", "stepdown_room_v1", "infinigen-stepdown.glb"],
  ["ward", "inpatient_ward_room_v1", "infinigen-inpatient-ward.glb"],
] as const) {
  const material = ROOM_CHAIN_RECIPES[environmentId].finish?.ceiling.corniceMaterial;
  if (selection.chosen !== `v4-flush-${material}`) throw new Error("Recipe does not match measured winner");
  const out = `.openclinxr/evidence/cornice-flush-promote-tile/${room}`;
  execFileSync("pnpm", ["factory:room:promote", "--", "--environment", environmentId, "--out-dir", out], {
    stdio: "inherit", env: { ...process.env, SHIP_WARD_OUT: `${evidence}/${room}` },
  });
  const glb = `apps/ui-xr/public/xr-assets/environment/${asset}`;
  const actual = createHash("sha256").update(readFileSync(glb)).digest("hex");
  if (actual !== builds[`${environmentId}/${selection.chosen}`].glbSha256) throw new Error("Promotion differs from measured candidate");
  const budget = execFileSync("pnpm", ["exec", "tsx", "tools/openclinxr/evidence/room-ward-finish-chain/ship-ward-budget.ts", glb], { encoding: "utf8" });
  writeFileSync(`${evidence}/${room}/shipped-budget.json`, budget);
  copyFileSync(`${out}/room-evidence-poses.json`, `${evidence}/${room}/promoted-poses.json`);
  const measured = JSON.parse(budget);
  const provenancePath = "apps/ui-xr/public/xr-assets/environment/PROVENANCE.md";
  const provenance = readFileSync(provenancePath, "utf8");
  const start = provenance.indexOf(`- \`${asset}\`\n`);
  const next = provenance.indexOf("\n- `", start + 1);
  if (start < 0 || next < 0) throw new Error(`Missing provenance section for ${asset}`);
  const entry = provenance.slice(start, next)
    .replace(/  - SHA-256:.*$/mu, `  - SHA-256: \`${actual}\`; ${measured.bytes} bytes; ${measured.triangles} triangles; ${measured.primitiveCount} primitives, all authored materials.`)
    .replace(/  - Finish:.*$/mu, `  - Finish: baked Infinigen walls, neutral matte paint, vinyl tile, cove, hospital door, troffer and T-bar grid. The complete 24 mm flush cornice uses the ceiling-tile PBR material with continuous world-XY UVs, including its edge closure. Underside offset is 0 mm, vertical angle edge is 3 mm, and the tile field is inset 24 mm to avoid z-fighting. No new external assets.`)
    .replace(/  - Evidence:.*$/mu, `  - Evidence: \`${evidence}\` contains V2/wall/tile/T-bar learner-runtime comparisons, 4× crops, repeat captures, wall/ceiling contrasts, and regenerated promotion pins. Earlier cornice-ab evidence is preserved byte-for-byte.`)
    .replace(/  - Reproduce:.*$/mu, "  - Reproduce: `pnpm exec tsx tools/openclinxr/evidence/room-chain-wiring/cornice-flush-promote.ts`; promotes both measured candidates and derives their six poses and budgets without rewriting historical evidence.");
  writeFileSync(provenancePath, provenance.slice(0, start) + entry + provenance.slice(next));
}
