export type AdminGraphqlDocument = {
  routeId: string;
  operationName: string;
  source: string;
};

export const adminGraphqlDocuments: AdminGraphqlDocument[] = [
  {
    routeId: "scenario-bank",
    operationName: "ScenarioBank",
    source: `query ScenarioBank($status: ScenarioStatus) {
  scenarios(status: $status) {
    scenarioId
    version
    title
    status
    clinicalObjectives
    requiredTraceTags
    review {
      clinical
      psychometric
      legal
      simulationQa
    }
    governance {
      scoreUseLabel
      syntheticCaseDisclosure
      validationStage
      requiredReviewerRoles
      sourceIds
    }
    actors {
      actorId
      role
      displayName
      demeanor
    }
    assetNeeds {
      assetId
      assetType
      licenseStatus
    }
  }
}
`,
  },
  {
    routeId: "review-packet-replay",
    operationName: "ReviewPacketReplay",
    source: `query ReviewPacketReplay($stationRunId: ID!) {
  reviewPacket(stationRunId: $stationRunId) {
    stationRunId
    scenarioId
    observedTraceTags
    missingRequiredTraceTags
    lateTraceTags
    timeline {
      sequence
      atSecond
      eventType
      source
      actorId
      tag
      summary
    }
    traceQuality {
      eventCount
      modelGeneratedEventCount
      modelFailedEventCount
      voiceAudioEventCount
      blockedGuardrailCount
      unsafeEventCount
      missingRequiredTraceTagCount
      hasPatientNote
      hasModelProvenance
    }
    patientNote {
      submittedAtSecond
      text
    }
    facultyScoreDraft {
      reviewerId
      status
      comments
    }
  }
  traceEvents(stationRunId: $stationRunId) {
    sequence
    eventType
    atSecond
    source
    actorId
    tag
  }
}
`,
  },
  {
    routeId: "exam-form-workbench",
    operationName: "ExamFormWorkbench",
    source: `query ExamFormWorkbench($examFormId: ID!, $scenarioId: ID!, $scenarioVersion: Int!) {
  examForm(examFormId: $examFormId) {
    examFormId
    blueprintId
    status
    stationRefs {
      order
      scenarioId
      scenarioVersion
      title
    }
    coverage
  }
  assetReadiness(scenarioId: $scenarioId, version: $scenarioVersion) {
    devReady
    productionReady
    missingRequiredAssetIds
    productionBlockedAssets {
      assetId
      blockers
    }
  }
}
`,
  },
  {
    routeId: "exam-form-assembly",
    operationName: "AssembleExamForm",
    source: `mutation AssembleExamForm($input: AssembleExamFormInput!) {
  assembleExamForm(input: $input) {
    examFormId
    blueprintId
    status
    stationRefs {
      order
      scenarioId
      scenarioVersion
      title
    }
  }
}
`,
  },
];
