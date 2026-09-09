import { Form, InputNumber, Select, Space, Typography } from "antd";

/**
 * One actor's staging authoring row: support surface and the signed {x,y,z} plant offset.
 *
 * Extracted from environment-generation-queue-panel.tsx rather than left inline. Adding the
 * three-axis vector control took that file to 613 lines against a frozen ceiling of 595, and
 * file-size-budgets.ts says "freeze ceilings may only shrink — split the file; do NOT raise the
 * ceiling".
 */
export function PlacementAuthoringRow({
  fieldName,
  subject,
  supportSurfaceSelectOptions,
}: {
  fieldName: number;
  subject: string;
  supportSurfaceSelectOptions: readonly { label: string; value: string }[];
}) {
  return (
    <Space wrap align="end" size={8}>
                        <Typography.Text strong style={{ minWidth: 240 }}>
                          {subject}
                        </Typography.Text>
                        <Form.Item
                          name={[fieldName, "placement", "supportSurface"]}
                          label="Support surface"
                          tooltip="Where this actor is staged (stretcher|chair|none); 'none' is an explicit standing decision. Writes ActorCard.placement.supportSurface — the field the factory Placement compile node and PLACEMENT_OVERRIDE_PATHS consume."
                        >
                          <Select
                            allowClear
                            options={[...supportSurfaceSelectOptions]}
                            style={{ minWidth: 160 }}
                            aria-label={`Support surface for ${subject}`}
                            placeholder="unset"
                          />
                        </Form.Item>
                        <Form.Item
                          label="Plant offset (m)"
                          tooltip="Signed {x,y,z} floor offset in meters applied to the actor placement (PLACEMENT_OVERRIDE_PATHS /plantOffsetMeters)."
                        >
                          {/* antd binds a field through Form.Item's `name`, not the input's.
                              InputNumber's own `name` is a plain string, so passing the array
                              path to it does not bind and does not typecheck. One noStyle
                              Form.Item per component is the shape that binds all three. */}
                          <Space size={4} wrap>
                            {(["x", "y", "z"] as const).map((axis) => (
                              <Form.Item
                                key={axis}
                                name={[fieldName, "placement", "plantOffsetMeters", axis]}
                                noStyle
                              >
                                <InputNumber
                                  min={-10}
                                  max={10}
                                  step={0.01}
                                  style={{ width: 80 }}
                                  aria-label={`Plant offset ${axis.toUpperCase()} for ${subject}`}
                                  placeholder={axis}
                                />
                              </Form.Item>
                            ))}
        </Space>
                        </Form.Item>
    </Space>
  );
}
