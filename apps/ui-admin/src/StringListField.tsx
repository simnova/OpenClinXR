import { Button, Form, Input, Space } from "antd";
import type { ReactElement } from "react";

type StringListFieldProps = {
  name: string | (string | number)[];
  label: string;
  addLabel: string;
  itemLabel: string;
};

/** Reusable antd Form.List string-list editor (objectives, trace tags, hidden facts, ...). */
export function StringListField({ name, label, addLabel, itemLabel }: StringListFieldProps): ReactElement {
  return (
    <Form.Item label={label} style={{ marginBottom: 8 }}>
      <Form.List name={name}>
        {(fields, { add, remove }) => (
          <div>
            {fields.map((field) => (
              <Space key={field.key} align="baseline" style={{ display: "flex", marginBottom: 6 }}>
                <Form.Item name={field.name} noStyle>
                  <Input aria-label={itemLabel} style={{ minWidth: 320 }} />
                </Form.Item>
                <Button size="small" danger onClick={() => remove(field.name)}>
                  Remove
                </Button>
              </Space>
            ))}
            <Button type="dashed" size="small" onClick={() => add("")}>
              {addLabel}
            </Button>
          </div>
        )}
      </Form.List>
    </Form.Item>
  );
}
