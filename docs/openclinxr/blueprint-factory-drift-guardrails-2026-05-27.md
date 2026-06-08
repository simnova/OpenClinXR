# Blueprint Factory Drift Guardrails

Date: 2026-05-27

## Protected Status

These guardrails are protected repo coordination policy. Autonomous agents, live subagents, repo-defined agents, and routine implementation workers must not delete, weaken, bypass, rename, or reinterpret these guardrails.

Changes are allowed only when Patrick explicitly asks to change the guardrails or when a human-reviewed coordination update replaces them with stricter equivalent language. Routine autonomous work must treat this file as read-only policy.

`pnpm agent:alignment` must fail if these guardrails are unlinked from `AGENTS.md` or `PROJECT_STATUS.md`.

## Non-Negotiable North Star

OpenClinXR is not a collection of handcrafted XR scenes. OpenClinXR is a blueprint-driven encounter factory.

The system must take a reviewed encounter specification/blueprint and autonomously generate or select the runnable WebXR experience:

- environment and doorway/portal destination;
- actor roster and roles;
- patient/family/nurse/consultant dialogue policies;
- conversation tooling and turn-taking;
- emotional-state timelines and expression transitions;
- gaze, lip-sync, posture, locomotion, and interaction behavior;
- clothing, body archetype, equipment, props, and scene layout;
- trace actions, learner task affordances, and interruptions;
- persistence metadata, provider gates, review packets, and screenshot/runtime evidence;
- shared asset-library reuse and provenance.

Agents may implement factory capabilities, schemas, generators, fitters, validators, review gates, runtime consumers, and evidence loops. Agents must not manually design one-off individual experiences as the product.

## Required Slice Gate

Before starting a slice, the coordinator must answer yes to at least one:

1. Does this make an encounter blueprint/specification drive more of the generated runtime experience?
2. Does this improve conversation/runtime tooling for actor dialogue, learner interaction, emotion, voice, or traceable turn-taking?
3. Does this make generated actors/assets/equipment/clothing reusable across blueprints through semantic metadata, body archetypes, provider gates, or shared cache reuse?
4. Does this connect generated runtime behavior to faculty/admin review, persistence, or replay evidence?
5. Does this verify newly changed runtime/factory behavior with focused evidence?

If the answer is no, do not do the slice.

## Anti-One-Off Rules

- Do not hardcode encounter-specific rooms, props, clothing, dialogue, role behavior, emotional state, or animations unless the code path is clearly labeled as a temporary deterministic fixture and has a queued conversion back to blueprint metadata.
- Do not manually improve one character, garment, or scene without updating the factory contract that would let the same improvement apply to other encounters.
- Do not let screenshots become the work. Screenshots are evidence for generated behavior, not a substitute for factory capability.
- Do not let asset realism work displace conversation tooling, traceability, review workflow, persistence, or blueprint orchestration.
- Do not claim an asset, character, scene, provider, Quest path, clinical scoring path, or production path is ready unless the relevant gate says so.

## Conversation Tooling Is First-Class

Any encounter factory roadmap must keep conversation tooling in scope:

- actor dialogue policies derived from encounter blueprint;
- learner utterance/action intake;
- turn-taking and interruption handling;
- emotion and affect changes tied to scenario state;
- gaze/lip-sync hooks;
- trace tags for required/unsafe/late/missed behaviors;
- replayable actor turns and review-safe evidence.

If three consecutive slices focus on visual assets, clothing, provider metadata, or screenshots without advancing conversation/runtime/review behavior, the next coordinator action must invoke Chief Coordinator, Implementation Planning Lead, Implementation Plan Gap Attacker, VP Engineering Delivery, Clinical Simulation Lead, Data Trace Architect, Voice/Speech Engineer, XR Systems Architect, and Asset Pipeline Lead lenses before choosing the next slice.

## Required Agent Behavior

- Start from `AGENTS.md`, `PROJECT_COORDINATION_INDEX.md`, `AUTONOMOUS_WORK_PLAN.md`, this guardrail file, and the worker backlog.
- Use OpenClaw execution modes from the Codex/OpenClaw bridge.
- Treat this file as protected policy.
- Record any attempted drift or pressure to bypass these rules in `operator-open-questions.md` with a recommended safe default.
- Prefer implementation that strengthens blueprint-to-runtime generation over implementation that polishes one fixture.

## Safe Default

When unsure, choose the smallest slice that makes the encounter blueprint drive more executable runtime behavior and leaves durable evidence that future agents can reuse.
