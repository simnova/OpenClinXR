import { describe, expect, it } from "vitest";
import {
  authoredContentIdentity,
  authoredContentIdentityEvidenceRef,
  authoredContentIdentityFromEvidenceRefs,
  snapshotAuthoredContent,
} from "./authored-content-identity.js";

describe("canonical authored-content identity", () => {
  it("omits root review/status and nested __typename, and is key-order independent", () => {
    const left = {
      scenarioId: "case_v1",
      version: 1,
      title: "Chest pain",
      status: "draft",
      review: { clinical: "draft" },
      actor: { name: "Maya", __typename: "Actor" },
    };
    const right = {
      actor: { name: "Maya" },
      title: "Chest pain",
      version: 1,
      scenarioId: "case_v1",
      status: "approved",
      review: { clinical: "approved" },
    };

    expect(authoredContentIdentity(left)).toBe(authoredContentIdentity(right));
  });

  it("changes when authored content changes", () => {
    const base = { scenarioId: "case_v1", title: "Chest pain", version: 1 };
    const edited = { scenarioId: "case_v1", title: "Chest pain with radiation", version: 1 };
    expect(authoredContentIdentity(base)).not.toBe(authoredContentIdentity(edited));
  });

  it("snapshots JSON-like content so nested mutation of the original input cannot change identity", () => {
    const original = {
      title: "Chest pain",
      actor: { name: "Maya", notes: ["baseline"] },
      status: "draft",
    };
    const snapshot = snapshotAuthoredContent(original);
    original.actor.name = "Hacked";
    original.actor.notes.push("after snapshot");
    original.status = "approved";

    expect(snapshot).toEqual({ actor: { name: "Maya", notes: ["baseline"] }, title: "Chest pain" });
    expect(authoredContentIdentity(snapshot)).toBe(authoredContentIdentity({ title: "Chest pain", actor: { name: "Maya", notes: ["baseline"] } }));
    expect(authoredContentIdentity(snapshot)).not.toBe(authoredContentIdentity(original));
  });

  it("round-trips identity through evidence refs", () => {
    const identity = authoredContentIdentity({ scenarioId: "case_v1", title: "Chest pain" });
    const ref = authoredContentIdentityEvidenceRef(identity);
    expect(authoredContentIdentityFromEvidenceRefs(["evidence:clinical:1", ref])).toBe(identity);
    expect(authoredContentIdentityFromEvidenceRefs(["evidence:clinical:1"])).toBeUndefined();
  });
});
