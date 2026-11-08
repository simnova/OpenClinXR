import { describe, expect, it } from "vitest";
import { buildCaptureSpec, parseCli, runGreyCardHookIfEnabled } from "./vitruvian-compare.js";

const BASE = [
  "--actor", "mpfb-ob-patient-aisha",
  "--new", "apps/ui-xr/public/generated-humanoids",
  "--out", ".openclinxr/evidence/grey-card-test",
];

describe("vitruvian grey-card capture option", () => {
  it("threads --grey-card into the harness hook without touching the lab spec", async () => {
    const cli = parseCli([...BASE, "--grey-card"]);
    const spec = buildCaptureSpec({
      actor: cli.actors[0]!,
      variant: "new",
      lightingSpec: { productEnvironmentId: "ob_triage_room_v1" },
      framing: "forearm-close",
      captureSize: 4096,
      greyCard: cli.greyCard,
    });
    expect(cli.greyCard).toBe(true);
    expect(Object.hasOwn(spec, "greyCard")).toBe(false);
    expect(await runGreyCardHookIfEnabled(cli.greyCard, async () => "card-ran")).toBe("card-ran");
  });

  it("runs no card code with the flag off", async () => {
    const cli = parseCli(BASE);
    const spec = buildCaptureSpec({
      actor: cli.actors[0]!,
      variant: "new",
      lightingSpec: { productEnvironmentId: "ob_triage_room_v1" },
      framing: "forearm-close",
      captureSize: 4096,
      greyCard: cli.greyCard,
    });
    expect(cli.greyCard).toBe(false);
    expect(Object.hasOwn(spec, "greyCard")).toBe(false);
    let calls = 0;
    expect(await runGreyCardHookIfEnabled(cli.greyCard, async () => { calls += 1; return "unexpected"; })).toBeNull();
    expect(calls).toBe(0);
  });
});
