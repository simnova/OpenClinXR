# Statecharts And Sequences

Date: 2026-05-03
Status: Development-readiness draft

## Exam Session Statechart

```mermaid
stateDiagram-v2
  [*] --> Created
  Created --> Consent: learner opens exam
  Consent --> Orientation: consent accepted
  Consent --> Cancelled: consent declined
  Orientation --> StationDoorway: start exam
  StationDoorway --> Encounter: timer starts
  Encounter --> PatientNote: encounter timer expires or learner ends encounter
  PatientNote --> InterStationBreak: note submitted or note timer expires
  InterStationBreak --> StationDoorway: next station
  InterStationBreak --> Complete: no stations remain
  Complete --> FacultyReviewQueued
  FacultyReviewQueued --> Scored: required reviews complete
  Scored --> DebriefReleased: faculty releases feedback
  Cancelled --> [*]
  DebriefReleased --> [*]
```

## Station Runtime Statechart

```mermaid
stateDiagram-v2
  [*] --> LoadingAssets
  LoadingAssets --> DoorwayInstructions
  DoorwayInstructions --> EncounterActive
  EncounterActive --> SafetyHold: guardrail block
  SafetyHold --> EncounterActive: faculty/system clears
  EncounterActive --> DeteriorationEvent: scheduled or triggered
  DeteriorationEvent --> EncounterActive
  EncounterActive --> EncounterEnded: timer expires
  EncounterActive --> EncounterEnded: learner ends station
  EncounterEnded --> NoteEntry
  NoteEntry --> NoteSubmitted
  NoteEntry --> NoteAutoSubmitted: note timer expires
  NoteSubmitted --> TraceFinalized
  NoteAutoSubmitted --> TraceFinalized
  TraceFinalized --> [*]
```

## Actor Cell Statechart

```mermaid
stateDiagram-v2
  [*] --> Initialized
  Initialized --> Listening
  Listening --> RetrievingMemory: learner speech/action observed
  RetrievingMemory --> PlanningResponse
  PlanningResponse --> SafetyCheck
  SafetyCheck --> Speaking: response allowed
  SafetyCheck --> GuardrailBlocked: unsafe or out-of-role response
  Speaking --> UpdatingEmotion
  UpdatingEmotion --> WritingMemory
  WritingMemory --> Listening
  GuardrailBlocked --> Escalating
  Escalating --> Listening: fallback response sent
```

## Scenario Generation And Review Sequence

```mermaid
sequenceDiagram
  participant Faculty as Faculty Author
  participant Blueprint as Blueprint Service
  participant Gen as LLM Scenario Generator
  participant KG as Knowledge Graph
  participant Review as Review Workflow
  participant Bank as Scenario Bank

  Faculty->>Blueprint: create exam blueprint
  Blueprint->>KG: retrieve coverage gaps and source constraints
  Blueprint->>Gen: request candidate station set
  Gen->>KG: retrieve specialty and rubric patterns
  Gen-->>Blueprint: draft station, actors, environment, rubric
  Blueprint->>Review: create clinical review packet
  Review->>Review: clinical review
  Review->>Review: psychometric review
  Review->>Review: legal/compliance/IP review
  Review-->>Blueprint: approve or request changes
  Blueprint->>Bank: publish approved scenario version
```

## Live Encounter Sequence

```mermaid
sequenceDiagram
  participant Learner as Learner XR Client
  participant Station as Station Runtime
  participant Actor as Actor Cell
  participant Memory as Actor Memory Retriever
  participant LLM as LLM Dialogue Gateway
  participant Speech as ASR/TTS Gateway
  participant Trace as Trace Ledger

  Learner->>Speech: speech audio stream
  Speech-->>Station: transcript and confidence
  Station->>Trace: record learner_speech
  Station->>Actor: LearnerSpeechObserved
  Actor->>Memory: retrieve relevant memories
  Memory-->>Actor: memories ranked by relevance, recency, importance
  Actor->>LLM: bounded response request
  LLM-->>Actor: response, emotion delta, gesture cue
  Actor->>Trace: record llm_audit and actor_response
  Actor->>Speech: synthesize response
  Speech-->>Learner: audio response
  Actor-->>Station: actor state update
  Station-->>Learner: avatar and environment update
```

## Faculty Review Sequence

```mermaid
sequenceDiagram
  participant Faculty as Faculty Reviewer
  participant Review as Review Console
  participant Trace as Trace Ledger
  participant Replay as Replay Builder
  participant Score as Scoring Service
  participant Audit as Audit Log

  Faculty->>Review: open review queue
  Review->>Trace: fetch station trace
  Review->>Replay: build timeline and highlights
  Replay-->>Review: replay packet
  Faculty->>Score: submit rubric scores and comments
  Score->>Audit: record score submission
  Score->>Trace: append faculty_score event
  Score-->>Review: scoring complete
```

## Exam Assembly Sequence

```mermaid
sequenceDiagram
  participant Admin as Exam Admin
  participant Blueprint as Blueprint Service
  participant Bank as Scenario Bank
  participant Assembler as Exam Form Assembler
  participant Psych as Psychometric Reviewer
  participant Form as Exam Form Store

  Admin->>Blueprint: choose blueprint
  Blueprint->>Assembler: request station candidates
  Assembler->>Bank: query approved scenarios by domain and constraints
  Bank-->>Assembler: candidates
  Assembler-->>Admin: draft ordered exam form
  Admin->>Psych: request blueprint/form review
  Psych-->>Assembler: coverage changes
  Assembler->>Form: save exam form version
```

