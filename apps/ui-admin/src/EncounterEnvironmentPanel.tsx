/**
 * Shell facts for the selected encounter environmentId (#69) + the faculty-picked
 * registered shell id (the authoring form writes environmentId). The Select is the
 * form's only environment control; facts follow the live selection so the author
 * sees the room change before export. Not a 3D preview — displayName, dimensions,
 * floor/wall colour, and fixture slotIds from the shared descriptor table.
 */

import { ENVIRONMENT_SHELL_DESCRIPTORS } from "@openclinxr/asset-registry";
import { Alert, Card, Form, Select, Space, Typography } from "antd";
import { type ReactElement, useMemo } from "react";
import type { ScenarioFormValues } from "./case-authoring-model.js";

/** Option source stays the shared registry — never a hardcoded list. */
const environmentOptions = Object.values(ENVIRONMENT_SHELL_DESCRIPTORS).map((descriptor) => ({
  value: descriptor.environmentId,
  label: descriptor.displayName,
}));

export type EncounterEnvironmentPanelProps = {
  /** Imported base environmentId; facts fall back to it until the form store carries a selection. */
  environmentId?: string | undefined;
};

export function EncounterEnvironmentPanel({ environmentId: importedEnvironmentId }: EncounterEnvironmentPanelProps): ReactElement {
  const form = Form.useFormInstance<ScenarioFormValues>();
  const selectedId = (Form.useWatch("environmentId", form) ?? importedEnvironmentId) as string | undefined;
  const shell = useMemo(() => {
    if (!selectedId) {
      return null;
    }
    const descriptor = ENVIRONMENT_SHELL_DESCRIPTORS[selectedId];
    return {
      environmentId: selectedId,
      displayName: descriptor?.displayName ?? selectedId,
      roomWidthMeters: descriptor?.roomWidthMeters,
      roomDepthMeters: descriptor?.roomDepthMeters,
      roomHeightMeters: descriptor?.roomHeightMeters,
      floorColor: descriptor?.floorColor,
      wallColor: descriptor?.wallColor,
      fixtureSlots: descriptor?.fixtureSlots,
      known: Boolean(descriptor),
    };
  }, [selectedId]);

  return (
    <section aria-label="Encounter environment" style={{ marginBottom: 16 }}>
      <Card title="Encounter environment" size="small">
        <Form.Item label="Environment" name="environmentId" style={{ marginBottom: 12 }}>
          <Select
            aria-label="Environment shell"
            placeholder="Select a registered environment shell"
            allowClear
            showSearch
            optionFilterProp="label"
            options={environmentOptions}
          />
        </Form.Item>
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
                {typeof shell.wallColor === "number" ? (
                  <Typography.Text>
                    wall #{shell.wallColor.toString(16).padStart(6, "0")}
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
            {shell.known && shell.fixtureSlots != null && shell.fixtureSlots.length > 0 ? (
              <div style={{ marginTop: 12 }}>
                <Typography.Text strong>Fixture slots: </Typography.Text>
                <ul aria-label="Fixture slots" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {shell.fixtureSlots.map((slot) => (
                    <li key={slot.slotId} style={{ marginBottom: 2 }}>
                      {slot.slotId}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
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
