/**
 * Apply-card to approval-group map (PSR program structure, in code so workers cannot drift it).
 *
 * Apply cards name themselves, not review groups: PSR-02 runs `--require-applied psr-02`
 * while the approval lives at approvals/psr-01b.json and apply cards cannot write
 * approvals/. `--require-applied` resolves through this map and checks ONLY that apply
 * card's package subset of the group. A group id directly (psr-01b) checks the whole group.
 */

import type { ApplyScope } from "./gates.js";

export const REVIEW_GROUPS = ["psr-01b", "psr-01c", "psr-01d", "psr-01e"] as const;

/** The seven PSR-07 XR packages: facade work owned by the XR lane. */
export const PSR_07_PACKAGES: readonly string[] = [
  "packages/openclinxr/xr-runtime-state",
  "packages/openclinxr/xr-station",
  "packages/openclinxr/xr-scene",
  "packages/openclinxr/xr-dialogue",
  "packages/openclinxr/xr-locomotion",
  "packages/openclinxr/xr-pose",
  "packages/openclinxr/xr-humanoid-animation",
];

/** Apply-card ids PSR-02..PSR-08. Program acceptance uses REVIEW_GROUPS; cards use these. */
export const APPLY_CARD_IDS: readonly string[] = [
  "psr-02",
  "psr-03",
  "psr-04",
  "psr-05",
  "psr-06",
  "psr-07",
  "psr-08",
];

const APPLY_TARGETS: Record<string, { group: string; packages: readonly string[] }> = {
  "psr-02": {
    group: "psr-01b",
    packages: [
      "packages/openclinxr/config-rolldown",
      "packages/openclinxr/physics-touch-artifacts",
      "packages/openclinxr/test-harness",
      "packages/openclinxr/auth",
      "packages/openclinxr/telemetry",
    ],
  },
  "psr-03": {
    group: "psr-01c",
    packages: [
      "packages/openclinxr/data-mongodb",
      "packages/openclinxr/motion-compiler",
      "packages/openclinxr/conversation-policy",
      "packages/openclinxr/model-gateway",
      "packages/openclinxr/graphql",
    ],
  },
  "psr-04": { group: "psr-01d", packages: ["packages/openclinxr/rest"] },
  "psr-05": { group: "psr-01d", packages: ["packages/openclinxr/asset-registry"] },
  "psr-06": { group: "psr-01d", packages: ["packages/openclinxr/ui-route-admin"] },
  "psr-07": { group: "psr-01e", packages: PSR_07_PACKAGES },
};

export type ApplyResolution = { group: string; scope: ApplyScope };
/**
 * Resolve an apply id or group id to its approval group plus check scope.
 * psr-08 is the complement: every psr-01e package not listed for psr-07, plus any
 * package no group names. Unknown ids resolve to undefined.
 */
export function resolveApplyId(id: string): ApplyResolution | undefined {
  if ((REVIEW_GROUPS as readonly string[]).includes(id)) {
    return { group: id, scope: { kind: "group" } };
  }
  if (id === "psr-08") {
    return { group: "psr-01e", scope: { kind: "complement", exclude: PSR_07_PACKAGES } };
  }
  const target = APPLY_TARGETS[id];
  if (target === undefined) return undefined;
  return { group: target.group, scope: { kind: "packages", packages: target.packages } };
}
