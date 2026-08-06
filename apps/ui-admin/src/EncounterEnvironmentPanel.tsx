/**
 * Shell facts for the selected encounter environmentId (#69).
 * Not a 3D preview — displayName, dimensions, and floor colour from the shared descriptor table.
 */

import { ENVIRONMENT_SHELL_DESCRIPTORS } from "@openclinxr/asset-registry";
import { Alert, Card, Space, Typography } from "antd";
import { type ReactElement, useMemo } from "react";

export type EncounterEnvironmentPanelProps = {
  environmentId: string | undefined;
};

export function EncounterEnvironmentPanel({ environmentId }: EncounterEnvironmentPanelProps): ReactElement {
  const shell = useMemo(() => {
    if (!environmentId) {
      return null;
    }
    const descriptor = ENVIRONMENT_SHELL_DESCRIPTORS[environmentId];
    return {
      environmentId,
      displayName: descriptor?.displayName ?? environmentId,
      roomWidthMeters: descriptor?.roomWidthMeters,
      roomDepthMeters: descriptor?.roomDepthMeters,
      roomHeightMeters: descriptor?.roomHeightMeters,
      floorColor: descriptor?.floorColor,
      known: Boolean(descriptor),
    };
  }, [environmentId]);

  return (
    <section aria-label="Encounter environment" style={{ marginBottom: 16 }}>
      <Card title="Encounter environment" size="small">
        {shell ? (
          <div>
            <Typography.Paragraph style={{ marginBottom: 8 }}>
              <Typography.Text strong>Room: </Typography.Text>
              <Typography.Text>{shell.displayName}</Typography.Text>
            </Typography.Paragraph>
            <Typography.Paragraph style={{ marginBottom: 8 }}>
              <Typography.Text type="secondary">environmentId: </Typography.Text>
              <Typography.Text code>{shell.environmentId}</Typography.Text>
            </Typography.Paragraph>
            {shell.known && shell.roomWidthMeters != null ? (
              <Space wrap size="large">
                <Typography.Text>width {shell.roomWidthMeters} m</Typography.Text>
                <Typography.Text>depth {shell.roomDepthMeters} m</Typography.Text>
                <Typography.Text>height {shell.roomHeightMeters} m</Typography.Text>
                {typeof shell.floorColor === "number" ? (
                  <Typography.Text>
                    floor #{shell.floorColor.toString(16).padStart(6, "0")}
                  </Typography.Text>
                ) : null}
              </Space>
            ) : (
              <Alert
                type="warning"
                showIcon
                message="No shell descriptor for this environmentId"
                description="The runtime will fall back to the generic shell until a descriptor is registered."
              />
            )}
            <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
              Shell facts from the shared environment descriptor (runtime + factory use the same table).
              Not a 3D preview; notEvidenceFor clinical room realism.
            </Typography.Paragraph>
          </div>
        ) : (
          <Typography.Text type="secondary">
            No environment.environmentId on this case yet.
          </Typography.Text>
        )}
      </Card>
    </section>
  );
}
