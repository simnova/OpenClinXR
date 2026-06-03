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

  it("normalizes the reviewed UIKitML sidecar uikit license-file metadata", () => {
    const report = buildLicensePolicyReportFromInventory({
      Unknown: [
        {
          name: "@pmndrs/uikit",
          versions: ["1.0.66"],
          paths: ["node_modules/.pnpm/@pmndrs+uikit@1.0.66_three@0.184.0/node_modules/@pmndrs/uikit"],
        },
      ],
      "SIL OPEN FONT LICENSE Version 1.1 OR OFL": [
        {
          name: "@pmndrs/msdfonts",
          versions: ["1.0.66"],
          paths: ["node_modules/.pnpm/@pmndrs+msdfonts@1.0.66/node_modules/@pmndrs/msdfonts"],
        },
      ],
    }, new Date("2026-05-05T17:20:00.000Z"));

    expect(report.blockedFindings).toEqual([]);
    expect(report.licenseOverridesApplied).toEqual([
      expect.objectContaining({
        name: "@pmndrs/uikit",
        versions: ["1.0.66"],
        reportedLicense: "Unknown",
        license: "MIT",
      }),
    ]);
    expect(report.reviewFindings).toEqual([
      expect.objectContaining({
        name: "@pmndrs/msdfonts",
        license: "SIL OPEN FONT LICENSE Version 1.1 OR OFL",
      }),
    ]);
  });
});
