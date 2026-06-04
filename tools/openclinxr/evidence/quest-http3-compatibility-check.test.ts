import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildQuestHttp3CompatibilityCheck,
  type QuestHttp3CompatibilityReport,
} from "./check-quest-http3-compatibility.js";

function completedQuestHttp3Report(): QuestHttp3CompatibilityReport {
  return {
    schemaVersion: "openclinxr.quest-http3-compatibility.v1",
    generatedAt: "2026-05-05T17:30:00.000Z",
    runContext: {
      performedBy: "protocol-evidence-lead",
      durationMinutes: 10,
      notes: "Local no-cloud Quest Browser HTTP/3 compatibility run.",
    },
    localServer: {
      appPath: "apps/api",
      serverKind: "bun-hono-http3-spike",
      bunVersion: "1.3.13",
      honoVersion: "4.10.6",
      h3Enabled: true,
      h3TrueEnabled: true,
      origin: "https://openclinxr-http3.localhost:4443",
      tls: {
        secureContext: true,
        certificateTrust: "local_ca_trusted_on_quest",
        alpnProtocols: ["h3"],
      },
    },
    questBrowser: {
      deviceModel: "Meta Quest 3",
      browserName: "Meta Quest Browser",
      browserVersion: "38.0.0",
      userAgent: "Mozilla/5.0 Quest Browser Chromium",
      foregroundPageConfirmed: true,
    },
    test: {
      physicalQuestUsed: true,
      cloudRelayUsed: false,
      paidApisUsed: false,
      url: "https://openclinxr-http3.localhost:4443/http3-probe",
      navigationSucceeded: true,
      resourceTimingNextHopProtocol: "h3",
      serverReportedProtocol: "h3",
      webTransportApiPresent: true,
      webTransportSessionAttempted: false,
      webTransportSessionSucceeded: null,
      websocketFallbackUsed: false,
      mediaFramesSent: false,
    },
    notEvidenceFor: [
      "azure_http3_ingress_readiness",
      "production_protocol_readiness",
      "clinical_media_transport_readiness",
      "low_latency_voice_readiness",
    ],
  };
}

describe("Quest HTTP/3 compatibility checker", () => {
  it("keeps the committed template as a valid blocked-state artifact", () => {
    const template = JSON.parse(
      readFileSync("docs/openclinxr/quest-http3-compatibility-template.json", "utf8"),
    ) as QuestHttp3CompatibilityReport;
    const check = buildQuestHttp3CompatibilityCheck(
      "docs/openclinxr/quest-http3-compatibility-template.json",
      template,
    );

    expect(check.readyToClaimQuestHttp3Reachability).toBe(false);
    expect(check.readyToClaimWebTransportCompatibility).toBe(false);
    expect(check.readyToClaimAzureIngress).toBe(false);
    expect(check.readyToClaimClinicalMedia).toBe(false);
    expect(check.http3Blockers).toEqual(expect.arrayContaining([
      "generated_at_invalid_or_missing",
      "performed_by_missing",
      "duration_under_10_minutes",
      "physical_quest_not_used",
      "h3_not_enabled",
      "h3_true_not_enabled",
      "secure_context_missing",
      "quest_browser_foreground_not_confirmed",
      "navigation_not_successful",
      "http3_protocol_not_observed",
    ]));
  });

  it("accepts Quest HTTP/3 reachability without promoting WebTransport or media readiness", () => {
    const check = buildQuestHttp3CompatibilityCheck("quest-http3.json", completedQuestHttp3Report());

    expect(check.readyToClaimQuestHttp3Reachability).toBe(true);
    expect(check.readyToClaimWebTransportCompatibility).toBe(false);
    expect(check.readyToClaimAzureIngress).toBe(false);
    expect(check.readyToClaimClinicalMedia).toBe(false);
    expect(check.http3Blockers).toEqual([]);
    expect(check.webTransportBlockers).toEqual([
      "webtransport_session_not_attempted",
      "webtransport_session_not_succeeded",
    ]);
    expect(check.satisfiedConditions).toEqual(expect.arrayContaining([
      "physical_quest_used",
      "bun_hono_http3_spike_recorded",
      "h3_enabled",
      "local_ca_trusted_on_quest",
      "quest_browser_foreground_confirmed",
      "navigation_succeeded",
      "http3_protocol_observed",
    ]));
    expect(check.notEvidenceFor).toEqual(expect.arrayContaining([
      "azure_http3_ingress_readiness",
      "production_protocol_readiness",
      "clinical_media_transport_readiness",
      "low_latency_voice_readiness",
    ]));
  });

  it("separately accepts WebTransport compatibility only when the API and session both succeed", () => {
    const report = completedQuestHttp3Report();
    report.test.webTransportSessionAttempted = true;
    report.test.webTransportSessionSucceeded = true;

    const check = buildQuestHttp3CompatibilityCheck("quest-http3-webtransport.json", report);

    expect(check.readyToClaimQuestHttp3Reachability).toBe(true);
    expect(check.readyToClaimWebTransportCompatibility).toBe(true);
    expect(check.readyToClaimAzureIngress).toBe(false);
    expect(check.readyToClaimClinicalMedia).toBe(false);
    expect(check.webTransportBlockers).toEqual([]);
    expect(check.satisfiedConditions).toEqual(expect.arrayContaining([
      "webtransport_api_present",
      "webtransport_session_attempted",
      "webtransport_session_succeeded",
    ]));
  });

  it("rejects fallback, cloud, paid, or non-Quest evidence as HTTP/3 proof", () => {
    const report = completedQuestHttp3Report();
    report.test.physicalQuestUsed = false;
    report.test.cloudRelayUsed = true;
    report.test.paidApisUsed = true;
    report.test.resourceTimingNextHopProtocol = "h2";
    report.test.serverReportedProtocol = "http/1.1";
    report.test.websocketFallbackUsed = true;

    const check = buildQuestHttp3CompatibilityCheck("quest-http3-invalid.json", report);

    expect(check.readyToClaimQuestHttp3Reachability).toBe(false);
    expect(check.http3Blockers).toEqual(expect.arrayContaining([
      "physical_quest_not_used",
      "cloud_relay_used",
      "paid_api_used",
      "http3_protocol_not_observed",
      "websocket_fallback_used",
    ]));
  });

  it("keeps the root script available for future captured evidence scoring", () => {
    const rootPackage = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(rootPackage.scripts?.["xr:quest:http3:check"]).toBe(
      "tsx tools/openclinxr/evidence/check-quest-http3-compatibility.ts",
    );
  });
});
