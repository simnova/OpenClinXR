/**
 * Case-authored ActorPhenotypeSchema inputs on the actor panel. These fields
 * drive the asset factory's body/wardrobe bakers from the encounter
 * specification (Q1 blueprint input): the four faculty compile-lock override
 * paths (garmentLayers, clothing_style, wardrobeRole, fabricPalette) plus
 * cosmetic identity (skin_tone, hair_color, eye_color, gender_presentation).
 *
 * Form-field names are `[actorIndex, "phenotype", "<key>"]`, matching
 * ActorPhenotypeSchema key order. Option vocabularies are seeded from the
 * authored scenario-bank fixtures so faculty pick values the bakers already
 * handle; the schema stays free-form, so garmentLayers tags remain editable.
 *
 * This surface authors case *definitions* only. It is notEvidenceFor clinical
 * validity, exam equivalence, scoring, or learner readiness.
 */

import { Divider, Form, Select, Space } from "antd";
import type { ReactElement } from "react";

function toOptions(values: readonly string[]): { label: string; value: string }[] {
  return values.map((value) => ({ label: value, value }));
}

/** Seeded from authored scenario-bank phenotypes (known-good bake vocabulary). */
const garmentLayerOptions = toOptions([
  "casual_top",
  "hospital_gown",
  "lab_coat",
  "open_cardigan",
  "scrub_pants",
  "scrub_pocket",
  "scrub_shirt",
  "scrub_top",
  "short_sleeve_exam_tshirt",
]);
const clothingStyleOptions = toOptions([
  "clinical_exam_tshirt_chest_pain",
  "muted_rose_guardian_cardigan",
  "pediatric_soft_blue_exam_tshirt",
  "teal_clinical_scrubs_with_name_badge",
  "white_lab_coat_over_scrubs",
]);
const wardrobeRoleOptions = toOptions([
  "anxious_parent_casual",
  "ed_patient_exam",
  "patient_casual_child",
  "pediatric_nurse_scrubs",
  "physician_clinical",
]);
const fabricPaletteOptions = toOptions([
  "clinical_teal_and_white",
  "hospital_gown_blue_pattern",
  "muted_rose_and_neutral",
  "soft_blue_and_warm_white",
  "teal_scrubs_and_white_badge",
]);
const skinToneOptions = toOptions(["medium_warm", "warm_light", "warm_light_child", "warm_medium"]);
const hairColorOptions = toOptions(["black", "brown", "dark_brown", "light_brown"]);
const eyeColorOptions = toOptions(["blue", "brown", "green"]);
const genderPresentationOptions = toOptions([
  "adult_female_parent",
  "adult_male",
  "adult_male_nurse",
  "adult_male_physician",
  "child",
]);
const bodyProfileOptions = toOptions([
  "adult_clinical_physician",
  "adult_clinical_team",
  "adult_standard",
  "adult_standard_parent",
  "pediatric_school_age",
]);
const poseOptions = toOptions([
  "standing_anxious_guardian",
  "standing_clinical_ready",
  "standing_neutral_chest_pain_priority",
  "standing_neutral_work_of_breathing",
]);
const clothingColorOptions = toOptions(["soft_blue", "teal", "white"]);
const roleVisualCueOptions = toOptions([
  "ed_chest_pain_patient",
  "pediatric_patient",
  "anxious_parent",
  "clinical_team",
]);
const materialFinishOptions = toOptions([
  "cotton_knit_matte",
  "cotton_matte",
  "cotton_slight_sheen",
  "poly_cotton_slight_sheen",
]);
const accessoryMarkerOptions = toOptions(["badge", "name_badge", "stethoscope"]);
const fitProfileOptions = toOptions([
  "adult_clinical_average_fit",
  "adult_parent_average_fit",
  "adult_standard_fit",
  "pediatric_slim_fit",
]);

export type ActorPhenotypeFieldsProps = {
  /** Form.List index of the actor row (names are `[fieldName, "phenotype", "<key>"]`). */
  fieldName: number;
};

export function ActorPhenotypeFields({ fieldName }: ActorPhenotypeFieldsProps): ReactElement {
  return (
    <div>
      <Divider style={{ margin: "8px 0" }}>Phenotype (optional, drives factory bake)</Divider>
      <Form.Item
        name={[fieldName, "phenotype", "garmentLayers"]}
        label="Garment layers"
        style={{ marginBottom: 8 }}
      >
        <Select
          mode="tags"
          allowClear
          virtual={false}
          options={garmentLayerOptions}
          style={{ minWidth: 360 }}
          aria-label="Phenotype garment layers"
          placeholder="e.g. hospital_gown"
        />
      </Form.Item>
      <Space wrap size="large">
        <Form.Item name={[fieldName, "phenotype", "clothing_style"]} label="Clothing style">
          <Select
            allowClear
          virtual={false}
            showSearch
            options={clothingStyleOptions}
            style={{ minWidth: 260 }}
            aria-label="Phenotype clothing style"
            placeholder="none"
          />
        </Form.Item>
        <Form.Item name={[fieldName, "phenotype", "wardrobeRole"]} label="Wardrobe role">
          <Select
            allowClear
          virtual={false}
            showSearch
            options={wardrobeRoleOptions}
            style={{ minWidth: 220 }}
            aria-label="Phenotype wardrobe role"
            placeholder="none"
          />
        </Form.Item>
        <Form.Item name={[fieldName, "phenotype", "fabricPalette"]} label="Fabric palette">
          <Select
            allowClear
          virtual={false}
            showSearch
            options={fabricPaletteOptions}
            style={{ minWidth: 240 }}
            aria-label="Phenotype fabric palette"
            placeholder="none"
          />
        </Form.Item>
      </Space>
      <Space wrap size="large">
        <Form.Item name={[fieldName, "phenotype", "skin_tone"]} label="Skin tone">
          <Select
            allowClear
          virtual={false}
            showSearch
            options={skinToneOptions}
            style={{ minWidth: 180 }}
            aria-label="Phenotype skin tone"
            placeholder="none"
          />
        </Form.Item>
        <Form.Item name={[fieldName, "phenotype", "hair_color"]} label="Hair color">
          <Select
            allowClear
          virtual={false}
            showSearch
            options={hairColorOptions}
            style={{ minWidth: 180 }}
            aria-label="Phenotype hair color"
            placeholder="none"
          />
        </Form.Item>
        <Form.Item name={[fieldName, "phenotype", "eye_color"]} label="Eye color">
          <Select
            allowClear
          virtual={false}
            showSearch
            options={eyeColorOptions}
            style={{ minWidth: 160 }}
            aria-label="Phenotype eye color"
            placeholder="none"
          />
        </Form.Item>
        <Form.Item name={[fieldName, "phenotype", "gender_presentation"]} label="Gender presentation">
          <Select
            allowClear
          virtual={false}
            showSearch
            options={genderPresentationOptions}
            style={{ minWidth: 200 }}
            aria-label="Phenotype gender presentation"
            placeholder="none"
          />
        </Form.Item>
      </Space>
      <Space wrap size="large">
        <Form.Item name={[fieldName, "phenotype", "body_profile"]} label="Body profile">
          <Select
            allowClear
            virtual={false}
            showSearch
            options={bodyProfileOptions}
            style={{ minWidth: 220 }}
            aria-label="Phenotype body profile"
            placeholder="none"
          />
        </Form.Item>
        <Form.Item name={[fieldName, "phenotype", "pose"]} label="Pose">
          <Select
            allowClear
            virtual={false}
            showSearch
            options={poseOptions}
            style={{ minWidth: 260 }}
            aria-label="Phenotype pose"
            placeholder="none"
          />
        </Form.Item>
        <Form.Item name={[fieldName, "phenotype", "clothing_color"]} label="Clothing color">
          <Select
            allowClear
            virtual={false}
            showSearch
            options={clothingColorOptions}
            style={{ minWidth: 160 }}
            aria-label="Phenotype clothing color"
            placeholder="none"
          />
        </Form.Item>
        <Form.Item name={[fieldName, "phenotype", "role_visual_cue"]} label="Role visual cue">
          <Select
            allowClear
            virtual={false}
            showSearch
            options={roleVisualCueOptions}
            style={{ minWidth: 200 }}
            aria-label="Phenotype role visual cue"
            placeholder="none"
          />
        </Form.Item>
      </Space>
      <Space wrap size="large">
        <Form.Item name={[fieldName, "phenotype", "materialFinish"]} label="Material finish">
          <Select
            allowClear
            virtual={false}
            showSearch
            options={materialFinishOptions}
            style={{ minWidth: 200 }}
            aria-label="Phenotype material finish"
            placeholder="none"
          />
        </Form.Item>
        <Form.Item name={[fieldName, "phenotype", "fitProfile"]} label="Fit profile">
          <Select
            allowClear
            virtual={false}
            showSearch
            options={fitProfileOptions}
            style={{ minWidth: 220 }}
            aria-label="Phenotype fit profile"
            placeholder="none"
          />
        </Form.Item>
      </Space>
      <Form.Item
        name={[fieldName, "phenotype", "accessoryMarkers"]}
        label="Accessory markers"
        style={{ marginBottom: 8 }}
      >
        <Select
          mode="tags"
          allowClear
          virtual={false}
          options={accessoryMarkerOptions}
          style={{ minWidth: 360 }}
          aria-label="Phenotype accessory markers"
          placeholder="e.g. stethoscope"
        />
      </Form.Item>
    </div>
  );
}
