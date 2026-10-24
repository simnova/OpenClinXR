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

  it("normalizes bumped pmndrs 6.6.30/1.0.74 license-file metadata via version-pinned overrides", () => {
    const report = buildLicensePolicyReportFromInventory({
      Unknown: [
        { name: "@pmndrs/handle", versions: ["6.6.30"], paths: [] },
        { name: "@pmndrs/pointer-events", versions: ["6.6.30"], paths: [] },
        { name: "@pmndrs/uikit", versions: ["1.0.74"], paths: [] },
        { name: "@pmndrs/uikit-lucide", versions: ["1.0.74"], paths: [] },
      ],
    }, new Date("2026-10-20T00:00:00.000Z"));

    expect(report.blockedFindings).toEqual([]);
    expect(report.licenseOverridesApplied).toEqual([
      expect.objectContaining({ name: "@pmndrs/handle", versions: ["6.6.30"], reportedLicense: "Unknown", license: "MIT" }),
      expect.objectContaining({ name: "@pmndrs/pointer-events", versions: ["6.6.30"], reportedLicense: "Unknown", license: "MIT" }),
      expect.objectContaining({ name: "@pmndrs/uikit", versions: ["1.0.74"], reportedLicense: "Unknown", license: "MIT" }),
      expect.objectContaining({ name: "@pmndrs/uikit-lucide", versions: ["1.0.74"], reportedLicense: "Unknown", license: "MIT" }),
    ]);
  });

  it("still flags genuinely unresolvable license metadata without inventing approvals", () => {
    const report = buildLicensePolicyReportFromInventory({
      Unknown: [
        { name: "@drawcall/uikitml", versions: ["0.1.8"], paths: [] },
      ],
      "LGPL-3.0-or-later": [
        { name: "@img/sharp-libvips-darwin-arm64", versions: ["1.3.0"], paths: [] },
      ],
    }, new Date("2026-10-20T00:00:00.000Z"), {
      iwsdkSharpLibvipsExceptionAllowed: false,
    });

    expect(report.blockedFindings).toEqual([
      expect.objectContaining({ name: "@img/sharp-libvips-darwin-arm64", license: "LGPL-3.0-or-later" }),
      expect.objectContaining({ name: "@drawcall/uikitml", license: "Unknown" }),
    ]);
  });

  it("passes the licensed IWSDK 0.4-line inventory (MIT uikitml, approved libvips within exception)", () => {
    const report = buildLicensePolicyReportFromInventory({
      MIT: [
        { name: "@pmndrs/uikitml", versions: ["0.1.12"], paths: [] },
      ],
      "LGPL-3.0-or-later": [
        {
          name: "@img/sharp-libvips-darwin-arm64",
          versions: ["1.0.4"],
          paths: ["node_modules/.pnpm/@img+sharp-libvips-darwin-arm64@1.0.4/node_modules/@img/sharp-libvips-darwin-arm64"],
        },
      ],
    }, new Date("2026-10-20T00:00:00.000Z"), {
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

  it("allows libvips 1.3.0 under the approved dev-only gate extension", () => {
    const report = buildLicensePolicyReportFromInventory({
      "LGPL-3.0-or-later": [
        {
          name: "@img/sharp-libvips-darwin-arm64",
          versions: ["1.3.0"],
          paths: ["node_modules/.pnpm/@img+sharp-libvips-darwin-arm64@1.3.0/node_modules/@img/sharp-libvips-darwin-arm64"],
        },
      ],
    }, new Date("2026-10-20T00:00:00.000Z"), {
      iwsdkSharpLibvipsExceptionAllowed: true,
    });

    expect(report.blockedFindings).toEqual([]);
    expect(report.licenseOverridesApplied).toEqual([
      expect.objectContaining({
        name: "@img/sharp-libvips-darwin-arm64",
        versions: ["1.3.0"],
        reportedLicense: "LGPL-3.0-or-later",
        license: "APPROVED-SIDECAR-EXCEPTION",
      }),
    ]);
  });

  it("still blocks libvips 1.3.0 when the dev-only gate is off", () => {
    const report = buildLicensePolicyReportFromInventory({
      "LGPL-3.0-or-later": [
        { name: "@img/sharp-libvips-darwin-arm64", versions: ["1.3.0"], paths: [] },
      ],
    }, new Date("2026-10-20T00:00:00.000Z"), {
      iwsdkSharpLibvipsExceptionAllowed: false,
    });

    expect(report.blockedFindings).toEqual([
      expect.objectContaining({
        name: "@img/sharp-libvips-darwin-arm64",
        license: "LGPL-3.0-or-later",
      }),
    ]);
  });

  it("does not widen the extension to neighboring unapproved versions (1.2.3, 1.3.1)", () => {
    const report = buildLicensePolicyReportFromInventory({
      "LGPL-3.0-or-later": [
        { name: "@img/sharp-libvips-darwin-arm64", versions: ["1.2.3"], paths: [] },
        { name: "@img/sharp-libvips-linux-x64", versions: ["1.3.1"], paths: [] },
      ],
    }, new Date("2026-10-20T00:00:00.000Z"), {
      iwsdkSharpLibvipsExceptionAllowed: true,
    });

    expect(report.blockedFindings).toEqual([
      expect.objectContaining({ name: "@img/sharp-libvips-darwin-arm64", license: "LGPL-3.0-or-later" }),
      expect.objectContaining({ name: "@img/sharp-libvips-linux-x64", license: "LGPL-3.0-or-later" }),
    ]);
  });

  it("allows libvips 1.3.4 under the approved dev-only gate extension", () => {
    const report = buildLicensePolicyReportFromInventory({
      "LGPL-3.0-or-later": [
        {
          name: "@img/sharp-libvips-darwin-arm64",
          versions: ["1.3.4"],
          paths: ["node_modules/.pnpm/@img+sharp-libvips-darwin-arm64@1.3.4/node_modules/@img/sharp-libvips-darwin-arm64"],
        },
      ],
    }, new Date("2026-10-21T00:00:00.000Z"), {
      iwsdkSharpLibvipsExceptionAllowed: true,
    });

    expect(report.blockedFindings).toEqual([]);
    expect(report.licenseOverridesApplied).toEqual([
      expect.objectContaining({
        name: "@img/sharp-libvips-darwin-arm64",
        versions: ["1.3.4"],
        reportedLicense: "LGPL-3.0-or-later",
        license: "APPROVED-SIDECAR-EXCEPTION",
      }),
    ]);
  });

  it("still blocks libvips 1.3.4 when the dev-only gate is off", () => {
    const report = buildLicensePolicyReportFromInventory({
      "LGPL-3.0-or-later": [
        { name: "@img/sharp-libvips-darwin-arm64", versions: ["1.3.4"], paths: [] },
      ],
    }, new Date("2026-10-21T00:00:00.000Z"), {
      iwsdkSharpLibvipsExceptionAllowed: false,
    });

    expect(report.blockedFindings).toEqual([
      expect.objectContaining({
        name: "@img/sharp-libvips-darwin-arm64",
        license: "LGPL-3.0-or-later",
      }),
    ]);
  });

  it("does not widen the extension to the neighboring unapproved 1.3.5", () => {
    const report = buildLicensePolicyReportFromInventory({
      "LGPL-3.0-or-later": [
        { name: "@img/sharp-libvips-darwin-arm64", versions: ["1.3.5"], paths: [] },
      ],
    }, new Date("2026-10-21T00:00:00.000Z"), {
      iwsdkSharpLibvipsExceptionAllowed: true,
    });

    expect(report.blockedFindings).toEqual([
      expect.objectContaining({
        name: "@img/sharp-libvips-darwin-arm64",
        license: "LGPL-3.0-or-later",
      }),
    ]);
  });
});
