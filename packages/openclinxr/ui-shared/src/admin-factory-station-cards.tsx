import { Button, Card, Input, InputNumber, Space, Switch, Typography } from "antd";
import { type ReactElement, useMemo, useState } from "react";
import {
  factoryStationSchemas,
  productionStationIds,
  type ProductionStationId,
} from "@openclinxr/shared-schemas";

export type FactoryStationCardsProps = {
  values?: Partial<Record<ProductionStationId, Record<string, unknown>>>;
  onChange?: (stationId: ProductionStationId, value: Record<string, unknown>) => void;
  onAddTrellisModel?: (payload: { modelId: string; subjectId: string; packId: string }) => void;
};

function defaultValue(type: "string" | "number" | "boolean"): unknown {
  if (type === "number") return 0;
  if (type === "boolean") return false;
  return "";
}

export function FactoryStationCards({ values, onChange, onAddTrellisModel }: FactoryStationCardsProps): ReactElement {
  const stations = useMemo(() => productionStationIds(), []);
  const [drafts, setDrafts] = useState<Partial<Record<ProductionStationId, Record<string, unknown>>>>({});
  const [errors, setErrors] = useState<Partial<Record<ProductionStationId, string>>>({});

  return (
    <fieldset className="station-queue-row" aria-label="Factory station cards">
      <Typography.Text strong>Factory station cards</Typography.Text>
      <Typography.Text type="secondary">
        One card per production station; controls derived from jsonSchema.input. instrument is not a card.
      </Typography.Text>
      <Button
        size="small"
        aria-label="Add TRELLIS bake model"
        onClick={() => {
          const modelId = `trellis_worldview_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
          onAddTrellisModel?.({
            modelId,
            subjectId: "ecg-cart-imagine-box",
            packId: "ecg-cart-imagine-box",
          });
        }}
      >
        Add TRELLIS bake model
      </Button>
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        {stations.map((stationId) => {
          const schema = factoryStationSchemas[stationId];
          const json = schema.jsonSchema.input({ target: "draft-2020-12" });
          const current = drafts[stationId] ?? values?.[stationId] ?? {};
          return (
            <Card key={stationId} size="small" title={stationId} aria-label={`${stationId} station card`}>
              <Space direction="vertical" size={8} style={{ width: "100%" }}>
                {Object.entries(json.properties).map(([name, prop]) => {
                  const label = `${stationId}.${name}`;
                  const value = current[name] ?? defaultValue(prop.type);
                  if (prop.type === "boolean") {
                    return (
                      <label key={name}>
                        {name}
                        <Switch
                          aria-label={label}
                          checked={Boolean(value)}
                          onChange={(checked) => patch(stationId, current, name, checked)}
                        />
                      </label>
                    );
                  }
                  if (prop.type === "number") {
                    return (
                      <label key={name}>
                        {name}
                        <InputNumber
                          aria-label={label}
                          value={typeof value === "number" ? value : 0}
                          onChange={(next) => patch(stationId, current, name, next ?? 0)}
                        />
                      </label>
                    );
                  }
                  return (
                    <label key={name}>
                      {name}
                      <Input
                        aria-label={label}
                        value={typeof value === "string" ? value : String(value ?? "")}
                        onChange={(event) => patch(stationId, current, name, event.target.value)}
                      />
                    </label>
                  );
                })}
                <Button size="small" aria-label={`Apply ${stationId}`} onClick={() => apply(stationId, current)}>
                  Apply
                </Button>
                {errors[stationId] ? (
                  <Typography.Text type="danger" role="alert">
                    {errors[stationId]}
                  </Typography.Text>
                ) : null}
              </Space>
            </Card>
          );
        })}
      </Space>
    </fieldset>
  );

  function patch(
    stationId: ProductionStationId,
    current: Record<string, unknown>,
    name: string,
    value: unknown,
  ): void {
    setDrafts((draft) => ({ ...draft, [stationId]: { ...current, [name]: value } }));
  }

  function apply(stationId: ProductionStationId, next: Record<string, unknown>): void {
    const result = factoryStationSchemas[stationId]["~standard"].validate(next);
    if ("issues" in result) {
      setErrors((current) => ({ ...current, [stationId]: result.issues.map((issue) => issue.message).join("; ") }));
      return;
    }
    setErrors((current) => ({ ...current, [stationId]: undefined }));
    onChange?.(stationId, result.value);
  }
}
