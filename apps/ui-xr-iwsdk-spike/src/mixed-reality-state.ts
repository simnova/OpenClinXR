export type MixedRealitySupportStatus =
  | "operator_gate_required"
  | "webxr_unavailable"
  | "checking"
  | "ready"
  | "unsupported"
  | "check_blocked";

export type MixedRealitySupportState = {
  mode: "immersive-ar";
  operatorApproved: boolean;
  status: MixedRealitySupportStatus;
  offerable: boolean;
  label: string;
};

export const mixedRealityOptionalFeatures = ["local-floor", "hand-tracking"] as const;

export function hasApprovedMixedRealityOperatorGate(search: string): boolean {
  return new URLSearchParams(search).get("mr") === "approved";
}

export function buildMixedRealitySupportState(input: {
  operatorApproved: boolean;
  webXrAvailable: boolean;
  immersiveArSupported?: boolean;
  checkBlocked?: boolean;
}): MixedRealitySupportState {
  if (!input.operatorApproved) {
    return createState(input.operatorApproved, "operator_gate_required", false, "MR requires ?mr=approved");
  }
  if (!input.webXrAvailable) {
    return createState(input.operatorApproved, "webxr_unavailable", false, "WebXR unavailable");
  }
  if (input.checkBlocked) {
    return createState(input.operatorApproved, "check_blocked", false, "MR check blocked");
  }
  if (input.immersiveArSupported === undefined) {
    return createState(input.operatorApproved, "checking", false, "Mixed Reality checking");
  }
  if (!input.immersiveArSupported) {
    return createState(input.operatorApproved, "unsupported", false, "Mixed Reality unavailable");
  }
  return createState(input.operatorApproved, "ready", true, "Mixed Reality ready");
}

function createState(
  operatorApproved: boolean,
  status: MixedRealitySupportStatus,
  offerable: boolean,
  label: string,
): MixedRealitySupportState {
  return {
    mode: "immersive-ar",
    operatorApproved,
    status,
    offerable,
    label,
  };
}
