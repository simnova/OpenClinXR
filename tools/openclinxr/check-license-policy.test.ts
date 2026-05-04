import { describe, expect, it } from "vitest";
import { buildLicensePolicyReportFromInventory } from "./check-license-policy.js";

describe("dependency license policy", () => {
  it("allows the approved IWSDK sidecar sharp libvips native exception only on the devtool path", () => {
    const report = buildLicensePolicyReportFromInventory({
      "LGPL-3.0-or-later": [
        {
          name: "@img/sharp-libvips-darwin-arm64",
          versions: ["1.0.4"],
          paths: ["node_modules/.pnpm/@img+sharp-libvips-darwin-arm64@1.0.4/node_modules/@img/sharp-libvips-darwin-arm64"],
        },
      ],
    }, new Date("2026-05-04T23:30:00.000Z"), {
      iwsdkSharpLibvipsExceptionAllowed: true,
    });

    expect(report.blockedFindings).toEqual([]);
    expect(report.licenseOverridesApplied).toEqual([
      expect.objectContaining({
        name: "@img/sharp-libvips-darwin-arm64",
        reportedLicense: "LGPL-3.0-or-later",
        license: "APPROVED-SIDECAR-EXCEPTION",
      }),
    ]);
  });

  it("blocks sharp libvips native packages outside the approved IWSDK sidecar path", () => {
    const report = buildLicensePolicyReportFromInventory({
      "LGPL-3.0-or-later": [
        {
          name: "@img/sharp-libvips-darwin-arm64",
          versions: ["1.0.4"],
          paths: ["node_modules/.pnpm/@img+sharp-libvips-darwin-arm64@1.0.4/node_modules/@img/sharp-libvips-darwin-arm64"],
        },
      ],
    }, new Date("2026-05-04T23:30:00.000Z"), {
      iwsdkSharpLibvipsExceptionAllowed: false,
    });

    expect(report.blockedFindings).toEqual([
      expect.objectContaining({
        name: "@img/sharp-libvips-darwin-arm64",
        license: "LGPL-3.0-or-later",
      }),
    ]);
  });
});
