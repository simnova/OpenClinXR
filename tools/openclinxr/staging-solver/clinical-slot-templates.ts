export type ClinicalSlotTemplate = {
  slotId: string;
  roles: readonly string[];
  anchor: "head" | "foot" | "side_head" | "chair";
  side: -1 | 0 | 1;
  alongMeters: number;
  acrossMeters: number;
  standingOnly?: boolean;
};

/** Role-bound clinical topology. Offsets are searched only inside ±0.3 m of these centres. */
export const CLINICAL_SLOT_TEMPLATES: readonly ClinicalSlotTemplate[] = [
  { slotId: "nurse_head_of_bed", roles: ["nurse"], anchor: "head", side: 0, alongMeters: 0.45, acrossMeters: 0, standingOnly: true },
  { slotId: "nurse_bedside_head", roles: ["nurse"], anchor: "side_head", side: -1, alongMeters: -0.35, acrossMeters: 0.62, standingOnly: true },
  { slotId: "physician_bedside", roles: ["physician"], anchor: "side_head", side: 1, alongMeters: -0.35, acrossMeters: 0.62, standingOnly: true },
  { slotId: "companion_chair", roles: ["family"], anchor: "chair", side: 0, alongMeters: 0, acrossMeters: 0 },
  { slotId: "companion_bedside", roles: ["family"], anchor: "side_head", side: -1, alongMeters: -0.15, acrossMeters: 0.75, standingOnly: true },
  { slotId: "interpreter_opposite", roles: ["interpreter"], anchor: "side_head", side: 1, alongMeters: -0.1, acrossMeters: 0.78, standingOnly: true },
  { slotId: "second_staff_opposite", roles: ["medical_assistant", "respiratory_therapist"], anchor: "side_head", side: 1, alongMeters: -0.1, acrossMeters: 0.78, standingOnly: true },
  { slotId: "consultant_foot_of_bed", roles: ["consultant"], anchor: "foot", side: 0, alongMeters: 0.55, acrossMeters: 0, standingOnly: true },
  { slotId: "system_foot_of_bed", roles: ["system"], anchor: "foot", side: 1, alongMeters: 0.45, acrossMeters: 0.45, standingOnly: true },
] as const;

export function templatesForRole(role: string, seated: boolean): ClinicalSlotTemplate[] {
  const matched = CLINICAL_SLOT_TEMPLATES.filter((row) => row.roles.includes(role));
  return matched.filter((row) => seated ? row.anchor === "chair" : row.anchor !== "chair");
}
