/** Local roles for HMAC-JWT identity (no external IdP). */
export type AuthRole = "learner" | "faculty" | "admin";

export type AuthIdentity = {
  /** Stable subject (JWT `sub`). */
  subject: string;
  role: AuthRole;
  /**
   * Learner scope used for run ownership and session-create attach.
   * Required for `learner`; optional for faculty/admin (may act on behalf).
   */
  learnerId?: string;
};

export type SignTokenInput = {
  identity: AuthIdentity;
  /** HMAC secret (UTF-8). */
  secret: string;
  /** Expiry in seconds from now (default 8h). */
  expiresInSeconds?: number;
  /** Optional issued-at override (unix seconds). */
  issuedAt?: number;
};

export type VerifyTokenInput = {
  token: string;
  secret: string;
  /** Clock skew tolerance in seconds (default 30). */
  clockToleranceSeconds?: number;
  /** Optional now override (unix seconds). */
  now?: number;
};

export type VerifyTokenResult =
  | { ok: true; identity: AuthIdentity; expiresAt: number }
  | { ok: false; error: "invalid_token" | "token_expired" | "invalid_claims" };

/** Additive single-user default so memory-sink / existing tests keep working. */
export const DEFAULT_DEV_AUTH_IDENTITY: AuthIdentity = Object.freeze({
  subject: "dev_admin",
  role: "admin",
  learnerId: "learner_001",
});

/** Local-only default HMAC secret — never use for production claims. */
export const DEFAULT_DEV_AUTH_SECRET = "openclinxr-local-dev-hmac-secret-v1";

export const AUTH_CLAIM_BOUNDARY = "local_hmac_jwt_not_production_identity_provider" as const;

export const AUTH_NOT_EVIDENCE_FOR = Object.freeze([
  "production_identity_provider",
  "oauth_oidc_federation",
  "multi_tenant_sso",
  "clinical_validity",
  "scoring_validity",
  "quest_readiness",
] as const);
