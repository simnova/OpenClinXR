import { describe, expect, it } from "vitest";
import { adminWorkbenchCapabilityTags, openClinXrAdminTheme } from "./index.js";

describe("shared UI configuration", () => {
  it("exports the admin theme tokens used by Ant Design 6 portals", () => {
    expect(openClinXrAdminTheme.token).toMatchObject({
      borderRadius: 6,
      colorPrimary: "#245b55",
      colorInfo: "#315f91",
      colorTextHeading: "#17211f",
    });
  });

  it("keeps shared capability tags in their display order", () => {
    expect(adminWorkbenchCapabilityTags).toEqual([
      "GraphQL Codegen",
      "Apollo Client",
      "ProComponents v3",
      "React Router",
      "Ant Design 6",
    ]);
  });
});
