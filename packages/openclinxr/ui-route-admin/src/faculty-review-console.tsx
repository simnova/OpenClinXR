import type { EncounterSnapshot, SyncConnection } from "@openclinxr/xr-sync-client";
import { connect } from "@openclinxr/xr-sync-client";
import { Button, Card, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";

/**
 * Faculty review console: joins a finished encounter room as faculty over the
 * existing C13/C14 review protocol (review rubric; finalize-review) and
 * renders the same facts the sync probes render — station turn counts from
 * lobbyStations, the per-station score badges from the probe-c13
 * `rubric: ... || scored: ...` facts, and the sign-off state from the
 * probe-c14 `signoff:finalized/open` fact. Faculty-readable labels render as
 * block elements (one per line); the machine tokens ride on data-*
 * attributes on the same elements. Finalize sends finalize-review and shows
 * the server-acked serverTs as an ISO string (never the client clock), with
 * the raw ms on data-server-ts and title. The ?rubric= param supplies only
 * id->label; per-item checked state comes from the server lobbyScores items
 * (one rubric line per station, server values win over the param), so no new
 * protocol messages and no new server state.
 */
export interface FacultyReviewRubricItem {
  id: string;
  label: string;
  checked: boolean;
}

export interface FacultyReviewConsoleProps {
  syncUrl: string;
  rubric?: FacultyReviewRubricItem[];
  connectFn?: typeof connect;
}

/**
 * Faculty-readable station name: "station-1" renders as "Station 1".
 * Unknown id shapes render verbatim (never blank).
 */
function stationDisplayName(stationId: string): string {
  const match = /-(\d+)$/.exec(stationId);
  return match ? `Station ${match[1]}` : stationId;
}

export function FacultyReviewConsole({
  syncUrl,
  rubric = [],
  connectFn = connect,
}: FacultyReviewConsoleProps): React.ReactElement {
  const [snapshot, setSnapshot] = useState<EncounterSnapshot | null>(null);
  const [finalizedTs, setFinalizedTs] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState<string | null>(null);
  const [sending, setSending] = useState<boolean>(false);
  const connectionRef = useRef<SyncConnection | null>(null);

  useEffect(() => {
    if (syncUrl === "") {
      return;
    }
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    let connection: SyncConnection | undefined;
    void connectFn(syncUrl, { roomOptions: { reviewLobby: true } }).then(
      (next) => {
        if (cancelled) {
          void next.leave().catch(() => undefined);
          return;
        }
        connection = next;
        connectionRef.current = next;
        unsubscribe = next.onState((state) => {
          if (!cancelled) {
            setSnapshot(state);
          }
        });
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
      connectionRef.current = null;
      unsubscribe?.();
      void connection?.leave().catch(() => undefined);
    };
  }, [connectFn, syncUrl]);

  const stations = snapshot?.lobbyStations ?? [];
  const scores = snapshot?.lobbyScores ?? [];
  const signoffToken = snapshot?.reviewFinalized === true ? "signoff:finalized" : "signoff:open";
  const signoffLabel = snapshot?.reviewFinalized === true ? "Sign-off: finalized" : "Sign-off: open";
  // The ?rubric= param is caller-supplied, so it names the items only
  // (id->label). Check values come from the server lobbyScores items; a
  // station with no valid score file has no items and renders "not scored".
  const rubricToken = rubric.map((item) => item.id).join(" | ");
  const rubricLabel = rubric.length > 0 ? `Rubric items: ${rubric.map((item) => item.label).join(" · ")}` : "Rubric items: -";
  const scoredToken = scores.map((badge) => `${badge.stationId}:${badge.checkedCount}`).join(" | ");
  const scoredLabel =
    scores.length > 0
      ? `Scores: ${scores.map((badge) => `${stationDisplayName(badge.stationId)}: ${badge.checkedCount}`).join(" · ")}`
      : "Scores: -";
  const labelById = new Map(rubric.map((item) => [item.id, item.label]));
  const badgeByStation = new Map(scores.map((badge) => [badge.stationId, badge]));
  const stationScoreRows = stations.map((station) => {
    const badge = badgeByStation.get(station.stationId);
    const items = badge?.items ?? [];
    if (items.length > 0) {
      const parts = items.map((item) => `${labelById.get(item.id) ?? item.id} ${item.checked ? "✓" : "✗"}`);
      return { stationId: station.stationId, text: `${stationDisplayName(station.stationId)}: ${parts.join(", ")}` };
    }
    if (badge !== undefined) {
      return { stationId: station.stationId, text: `${stationDisplayName(station.stationId)}: ${badge.checkedCount} checked` };
    }
    return { stationId: station.stationId, text: `${stationDisplayName(station.stationId)}: not scored` };
  });

  const finalize = (): void => {
    const connection = connectionRef.current;
    if (connection === null || sending) {
      return;
    }
    setSending(true);
    setRejectReason(null);
    void connection
      .sendIntent("finalize-review", {})
      .then(
        (result) => {
          if (result.status === "ack") {
            setFinalizedTs(result.serverTs);
          } else {
            setRejectReason(result.reason);
          }
        },
        () => undefined,
      )
      .finally(() => {
        setSending(false);
      });
  };

  // F1: one block element per fact line, in order: sign-off, stations,
  // rubric, scored, station scores, action row, finalized, reject. Plain
  // block elements (never adjacent inline Text) so labels cannot fuse lines.
  return (
    <Card title="Faculty Review Console">
      <Typography.Paragraph>
        Faculty sign-off over the synced review lobby: stations, rubric, scores, then finalize.
      </Typography.Paragraph>
      {syncUrl === "" ? <Typography.Paragraph>Provide ?sync=ws://... to join the review lobby.</Typography.Paragraph> : null}
      <p data-signoff={signoffToken}>{signoffLabel}</p>
      <ul aria-label="Review stations">
        {stations.map((station) => (
          <li key={station.stationId}>{`${stationDisplayName(station.stationId)}: ${station.turnCount} turns`}</li>
        ))}
      </ul>
      <p data-rubric={rubricToken}>{rubricLabel}</p>
      <p data-scored={scoredToken}>{scoredLabel}</p>
      <ul aria-label="Station scores">
        {stationScoreRows.map((row) => (
          <li key={row.stationId} data-station={row.stationId}>{row.text}</li>
        ))}
      </ul>
      <div style={{ marginBottom: "1em" }}>
        <Button onClick={finalize} disabled={sending || finalizedTs !== null}>
          Finalize
        </Button>
      </div>
      {finalizedTs === null ? null : (
        <p data-server-ts={String(finalizedTs)} title={String(finalizedTs)}>{`Finalized at ${new Date(finalizedTs).toISOString()}`}</p>
      )}
      {rejectReason === null ? null : <p>{`Finalize rejected: ${rejectReason}`}</p>}
    </Card>
  );
}

/** The /faculty-review route: reads ?sync= and ?rubric= and renders the console. */
export function FacultyReviewRoute(): React.ReactElement {
  const [searchParams] = useSearchParams();
  const syncUrl = searchParams.get("sync") ?? "";
  const rubric = parseFacultyRubricParam(searchParams.get("rubric"));
  return <FacultyReviewConsole syncUrl={syncUrl} rubric={rubric} />;
}

/**
 * Parse the ?rubric= page parameter (JSON array of { id, label, checked },
 * the same shape the C14 probe route carries in rr1-run.mjs c14HostReviewUrl).
 * Malformed input yields an empty checklist, never a throw.
 */
function parseFacultyRubricParam(raw: string | null): FacultyReviewRubricItem[] {
  if (raw === null || raw === "") {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const items: FacultyReviewRubricItem[] = [];
    for (const entry of parsed) {
      if (typeof entry !== "object" || entry === null) {
        continue;
      }
      const record = entry as Record<string, unknown>;
      if (typeof record["id"] !== "string" || typeof record["label"] !== "string") {
        continue;
      }
      items.push({ id: record["id"], label: record["label"], checked: record["checked"] === true });
    }
    return items;
  } catch {
    return [];
  }
}
