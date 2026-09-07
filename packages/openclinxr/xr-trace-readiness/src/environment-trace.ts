import type { EnvironmentStateEvidence } from "@openclinxr/xr-runtime-state";
import type { EnvironmentTraceContext } from "./types.js";

export const ROOM_ENVIRONMENTAL_REALISM_CUE_IDS = [
  "floor_scuff_path_between_door_bed_monitor",
  "infection_control_wall_signage",
  "handoff_whiteboard_patient_flow_cue",
  "supply_drawer_labels",
  "privacy_zone_floor_tape",
  "glove_and_sanitizer_touchpoint_cluster",
  "monitor_escalation_status_badge",
  "ecg_paper_strip_ready_cue",
  "nurse_task_tray_workflow_cue",
  "doorway_escalation_badge",
  "monitor_lead_cable_run",
  "bed_wheel_lock_safety_cues",
  "curtain_track_ring_hardware",
  "biohazard_trash_liner_detail",
  "iv_tubing_line_context",
] as const;

export function updateEnvironmentStateForTrace(
  ctx: EnvironmentTraceContext,
  tag: string,
): EnvironmentStateEvidence {
  const activeTraceTags = Array.from(new Set([...ctx.previousActiveTraceTags(), tag]));
  const activeRuntimeEquipmentIds = Array.from(new Set(activeTraceTags.flatMap(ctx.equipmentIdsForTag)));
  const stressCueIds = [
    ...(activeTraceTags.includes("vitals_review") ? ["monitor_waveform_card_soft_warning", "nurse_workflow_lane_attention"] : []),
    ...(activeTraceTags.includes("ecg_request") ? ["ekg_leads_on_bed_ready", "ecg_cart_workflow_attention"] : []),
    ...(activeTraceTags.includes("work_of_breathing_assessment")
      ? ["work_of_breathing_runtime_attention", "pulse_oximeter_runtime_attention"]
      : []),
    ...(activeTraceTags.includes("inhaler_history") ? ["inhaler_spacer_history_runtime_attention"] : []),
    ...(activeTraceTags.includes("trigger_history") ? ["asthma_trigger_history_runtime_attention", "parent_chair_runtime_attention"] : []),
    ...(activeTraceTags.includes("oxygen_request") ? ["oxygen_wall_port_runtime_attention", "pulse_oximeter_runtime_attention"] : []),
    ...(activeTraceTags.includes("bronchodilator_plan")
      ? ["nebulizer_mask_runtime_attention", "inhaler_spacer_runtime_attention"]
      : []),
    ...(activeTraceTags.includes("urgent_escalation") ? ["doorway_station_sign_escalation", "ceiling_exam_light_attention"] : []),
    ...(activeTraceTags.includes("urgent_escalation")
      ? ["pediatric_escalation_runtime_attention", "urgent_family_support_runtime_attention"]
      : []),
    ...(activeTraceTags.includes("empathy_statement")
      ? ["pediatric_empathy_deescalation_runtime_attention", "child_parent_reassurance_runtime_attention"]
      : []),
    ...(activeTraceTags.includes("patient_note_submitted")
      ? ["patient_note_runtime_completion_attention", "faculty_review_handoff_runtime_attention"]
      : []),
  ];
  const evidence: EnvironmentStateEvidence = {
    source: "local_trace_tied_environment_state",
    activeTraceTags,
    stressCueIds,
    environmentalRealismCueIds: [...ctx.realismCueIds],
    monitorState: activeTraceTags.includes("bronchodilator_plan")
      ? "bronchodilator_in_progress"
      : activeTraceTags.includes("oxygen_request")
        ? "oxygen_started"
        : activeTraceTags.includes("ecg_request")
          ? "urgent_ecg_requested"
          : activeTraceTags.includes("vitals_review") || activeTraceTags.includes("work_of_breathing_assessment")
            ? "vitals_concerning"
            : "baseline",
    alarmState: activeTraceTags.includes("urgent_escalation")
      ? "urgent_attention"
      : activeTraceTags.includes("vitals_review") ||
          activeTraceTags.includes("work_of_breathing_assessment") ||
          activeTraceTags.includes("oxygen_request")
        ? "soft_warning"
        : "quiet",
    alarmCueMode:
      activeTraceTags.includes("vitals_review") ||
      activeTraceTags.includes("work_of_breathing_assessment") ||
      activeTraceTags.includes("oxygen_request") ||
      activeTraceTags.includes("urgent_escalation")
        ? "visual_only_no_audio"
        : "none",
    environmentMotionCueMode: activeTraceTags.length > 0 ? "deterministic_visual_pulse" : "none",
    propStateCueIds: [
      "monitor-waveform-card",
      "monitor-vitals-badge",
      "ekg-leads-on-bed",
      "ecg-paper-strip",
      "nurse-task-tray",
      "call-light-remote",
      "ceiling-exam-light",
      "doorway-escalation-badge",
      ...activeRuntimeEquipmentIds,
    ],
    activePropIds: [
      ...(activeTraceTags.includes("vitals_review") ? ["monitor-waveform-card", "monitor-vitals-badge"] : []),
      ...(activeTraceTags.includes("ecg_request") ? ["ekg-leads-on-bed", "ecg-paper-strip", "nurse-task-tray", "call-light-remote"] : []),
      ...(activeTraceTags.includes("urgent_escalation") ? ["ceiling-exam-light", "doorway-escalation-badge"] : []),
      ...activeRuntimeEquipmentIds,
    ],
    productionClinicalMonitoringClaimed: false,
    notEvidenceFor: ["clinical_validity", "scoring_validity", "quest_readiness"],
  };
  ctx.environmentStateWritten(evidence);
  ctx.applyEnvironmentStateVisuals(evidence);
  ctx.applyRuntimeEquipmentTraceVisuals(evidence);
  return evidence;
}

export function formatEnvironmentRoomSummary(evidence: EnvironmentStateEvidence): string {
  return [
    `monitor ${evidence.monitorState}`,
    `alarm ${evidence.alarmState}`,
    evidence.activePropIds.length > 0 ? `active ${evidence.activePropIds.join(", ")}` : "no active props",
  ].join(" | ");
}
