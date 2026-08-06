import { signToken, type AuthTokenPayload } from "@openclinxr/auth";
import { buildSessionRoutePath, routeById } from "@openclinxr/rest";
import { describe, expect, it } from "vitest";
import { createApiApp } from "./app.js";

const AUTH_SECRET = "auth-middleware-test-secret";

function tokenFor(userId: string, role: AuthTokenPayload["role"]): string {
  return signToken(
    {
      sub: userId,
      role,
      name: userId,
      iat: 0,
      exp: 0,
    },
    AUTH_SECRET,
    3600,
  );
}

function bearer(userId: string, role: AuthTokenPayload["role"]): Record<string, string> {
  return { authorization: `Bearer ${tokenFor(userId, role)}` };
}

async function json(response: Response): Promise<unknown> {
  return response.json() as Promise<unknown>;
}

function createAuthEnabledApp() {
  return createApiApp(undefined, {}, {
    auth: {
      enabled: true,
      secret: AUTH_SECRET,
    },
  });
}

describe("API auth middleware + role/ownership gates", () => {
  it("enabled: review-packet and trace-events without Authorization -> 401", async () => {
    const app = createAuthEnabledApp();
    const stationRunId = "run_missing_auth";

    const review = await app.request(buildSessionRoutePath("review-packet", stationRunId));
    expect(review.status).toBe(401);
    expect(await json(review)).toEqual({ error: "unauthenticated" });

    const traces = await app.request(buildSessionRoutePath("trace-events", stationRunId));
    expect(traces.status).toBe(401);
    expect(await json(traces)).toEqual({ error: "unauthenticated" });
  });

  it("enabled: health stays public without Authorization", async () => {
    const app = createAuthEnabledApp();
    const response = await app.request(routeById("health").path);
    expect(response.status).toBe(200);
  });

  it("enabled: learner ownership — other learner 403, owner 200, faculty allowed", async () => {
    const app = createAuthEnabledApp();

    const start = await app.request(routeById("start-session").path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...bearer("learner_a", "learner"),
      },
      body: JSON.stringify({ learnerId: "ignored_body_id", consentAccepted: true }),
    });
    expect(start.status).toBe(201);
    const started = await json(start) as { stationRunId: string; learnerId?: string };
    expect(started.stationRunId).toBeTruthy();
    // Learner identity overrides body learnerId when auth enabled
    if (typeof started.learnerId === "string") {
      expect(started.learnerId).toBe("learner_a");
    }

    const reviewPath = buildSessionRoutePath("review-packet", started.stationRunId);
    const tracePath = buildSessionRoutePath("trace-events", started.stationRunId);

    const otherReview = await app.request(reviewPath, {
      headers: bearer("learner_b", "learner"),
    });
    expect(otherReview.status).toBe(403);
    expect(await json(otherReview)).toEqual({ error: "forbidden_not_run_owner" });

    const otherTrace = await app.request(tracePath, {
      headers: bearer("learner_b", "learner"),
    });
    expect(otherTrace.status).toBe(403);
    expect(await json(otherTrace)).toEqual({ error: "forbidden_not_run_owner" });

    const ownerReview = await app.request(reviewPath, {
      headers: bearer("learner_a", "learner"),
    });
    expect(ownerReview.status).toBe(200);

    const ownerTrace = await app.request(tracePath, {
      headers: bearer("learner_a", "learner"),
    });
    expect(ownerTrace.status).toBe(200);

    const facultyReview = await app.request(reviewPath, {
      headers: bearer("faculty_1", "faculty"),
    });
    expect(facultyReview.status).not.toBe(403);
    expect(facultyReview.status).toBe(200);

    const facultyTrace = await app.request(tracePath, {
      headers: bearer("faculty_1", "faculty"),
    });
    expect(facultyTrace.status).not.toBe(403);
    expect(facultyTrace.status).toBe(200);

    const adminReview = await app.request(reviewPath, {
      headers: bearer("admin_1", "admin"),
    });
    expect(adminReview.status).toBe(200);
  });

  it("enabled: faculty-gated route rejects learner and allows faculty", async () => {
    const app = createAuthEnabledApp();
    const path = routeById("save-authored-scenario").path;

    const learnerDenied = await app.request(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...bearer("learner_a", "learner"),
      },
      body: JSON.stringify({ scenario: {} }),
    });
    expect(learnerDenied.status).toBe(403);
    expect(await json(learnerDenied)).toEqual({ error: "forbidden_requires_faculty" });

    const facultyAllowed = await app.request(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...bearer("faculty_1", "faculty"),
      },
      body: JSON.stringify({ scenario: {} }),
    });
    // Faculty passes role gate; may still fail validation (400) or persistence (503) — not 403.
    expect(facultyAllowed.status).not.toBe(403);
    expect(facultyAllowed.status).not.toBe(401);
  });

  it("default app (auth disabled): review-packet without header still works (additive)", async () => {
    const app = createApiApp();

    const start = await app.request(routeById("start-session").path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ learnerId: "learner_no_auth", consentAccepted: true }),
    });
    expect(start.status).toBe(201);
    const started = await json(start) as { stationRunId: string };

    const review = await app.request(buildSessionRoutePath("review-packet", started.stationRunId));
    expect(review.status).not.toBe(401);
    expect(review.status).toBe(200);

    const traces = await app.request(buildSessionRoutePath("trace-events", started.stationRunId));
    expect(traces.status).not.toBe(401);
    expect(traces.status).toBe(200);
  });

  it("enabled: CORS allows authorization header", async () => {
    const app = createAuthEnabledApp();
    const preflight = await app.request(routeById("health").path, {
      method: "OPTIONS",
      headers: {
        origin: "http://127.0.0.1:5173",
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization",
      },
    });
    expect(preflight.status).toBe(204);
    const allow = preflight.headers.get("access-control-allow-headers") ?? "";
    expect(allow.toLowerCase()).toContain("authorization");
  });
});
