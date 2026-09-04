import type { Hono } from "hono";
import { hasFacultyAccess } from "@openclinxr/auth";
import type { ApiAppContext } from "../../api-app-context.js";
import type { ApiAppVariables } from "../../api-types.js";
import {
  FACULTY_ENCOUNTER_BUNDLE_PROMOTION_PATH,
  FACULTY_ENCOUNTER_BUNDLE_PROMOTION_PREVIEW_PATH,
  facultyEncounterBundlePromotionClaimScope,
  facultyEncounterBundlePromotionNotEvidenceFor,
  hydrateFacultyEncounterBundlePromotionRequest,
  isFacultyEncounterBundlePromotionRequest,
  previewFacultyEncounterBundlePromotion,
  promoteFacultyEncounterBundle,
  type FacultyEncounterBundlePromotionSuccess,
  type FacultyLearnerLaunchIdentity,
} from "./faculty-encounter-bundle-promotion.js";

export {
  FACULTY_ENCOUNTER_BUNDLE_PROMOTION_PATH,
  FACULTY_ENCOUNTER_BUNDLE_PROMOTION_PREVIEW_PATH,
};

type OpaqueLaunchStore = {
  remember(identity: FacultyLearnerLaunchIdentity): FacultyLearnerLaunchIdentity;
};

export function registerEncounterBundlePromotionRoutes(
  app: Hono<{ Variables: ApiAppVariables }>,
  _ctx: ApiAppContext,
  store: OpaqueLaunchStore = createMemoryLaunchStore(),
): void {
  app.post(FACULTY_ENCOUNTER_BUNDLE_PROMOTION_PREVIEW_PATH, async (context) => {
    if (!hasFacultyAccess(context.get("identity"))) {
      return context.json(forbiddenBody(), 403);
    }
    const body = await context.req.json().catch(() => ({}));
    if (!isFacultyEncounterBundlePromotionRequest(body)) {
      return context.json(invalidBody(), 400);
    }
    return context.json(previewFacultyEncounterBundlePromotion(
      hydrateFacultyEncounterBundlePromotionRequest(body),
    ));
  });

  app.post(FACULTY_ENCOUNTER_BUNDLE_PROMOTION_PATH, async (context) => {
    if (!hasFacultyAccess(context.get("identity"))) {
      return context.json(forbiddenBody(), 403);
    }
    const body = await context.req.json().catch(() => ({}));
    if (!isFacultyEncounterBundlePromotionRequest(body)) {
      return context.json(invalidBody(), 400);
    }
    const result = promoteFacultyEncounterBundle(
      hydrateFacultyEncounterBundlePromotionRequest(body),
    );
    if (!result.promoted) {
      return context.json(result, 409);
    }
    return context.json(opaqueSuccess(store.remember(result.learnerLaunchIdentity)));
  });
}

function opaqueSuccess(
  learnerLaunchIdentity: FacultyLearnerLaunchIdentity,
): Pick<
  FacultyEncounterBundlePromotionSuccess,
  "promoted" | "learnerLaunchIdentity" | "claimScope" | "notEvidenceFor"
> {
  return {
    promoted: true,
    learnerLaunchIdentity,
    claimScope: facultyEncounterBundlePromotionClaimScope,
    notEvidenceFor: facultyEncounterBundlePromotionNotEvidenceFor,
  };
}

function createMemoryLaunchStore(): OpaqueLaunchStore {
  const records = new Map<string, FacultyLearnerLaunchIdentity>();
  return {
    remember(identity) {
      const existing = records.get(identity.bundleId);
      if (existing) {
        return existing;
      }
      records.set(identity.bundleId, identity);
      return identity;
    },
  };
}

function forbiddenBody() {
  return {
    error: "forbidden",
    reason: "faculty_role_required",
    promoted: false,
    learnerLaunchIdentity: null,
    claimScope: facultyEncounterBundlePromotionClaimScope,
    notEvidenceFor: facultyEncounterBundlePromotionNotEvidenceFor,
  };
}

function invalidBody() {
  return {
    error: "invalid_body",
    reason: "faculty_encounter_bundle_promotion_required",
    promoted: false,
    learnerLaunchIdentity: null,
    claimScope: facultyEncounterBundlePromotionClaimScope,
    notEvidenceFor: facultyEncounterBundlePromotionNotEvidenceFor,
  };
}
