import { Card, Space, Tag, Typography } from "antd";
import type { ReactElement } from "react";

export type FactoryRunStationClassification = "deterministic" | "not_run" | "absent" | "error";

export type FactoryRunStationRow = {
  stationId: string;
  classification: FactoryRunStationClassification;
  artifactPaths?: string[];
  notes?: string[];
};

export type FactoryRunCaseRow = {
  caseId: string;
  stations: FactoryRunStationRow[];
};

export type FactoryRunProgressPanelProps = {
  cases: FactoryRunCaseRow[];
};

/** Presentational per-station factory run record; one card per case, rows from data. */
export function FactoryRunProgressPanel({ cases }: FactoryRunProgressPanelProps): ReactElement {
  if (cases.length === 0) {
    return <Typography.Text>No factory runs recorded</Typography.Text>;
  }
  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      {cases.map((row) => (
        <Card key={row.caseId} size="small" title={row.caseId} aria-label={`${row.caseId} factory run`}>
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            {row.stations.map((station) => (
              <div key={station.stationId} data-classification={station.classification}>
                <Tag>{station.classification}</Tag>
                <Typography.Text>{station.stationId}</Typography.Text>
                {station.artifactPaths?.map((path) => (
                  <Typography.Text key={path} type="secondary">
                    {path}
                  </Typography.Text>
                ))}
                {station.notes?.map((note) => (
                  <Typography.Text key={note} type="secondary">
                    {note}
                  </Typography.Text>
                ))}
              </div>
            ))}
          </Space>
        </Card>
      ))}
    </Space>
  );
}
