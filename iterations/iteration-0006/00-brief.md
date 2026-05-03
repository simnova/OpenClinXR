# Iteration 0006 Brief

Date: 2026-05-03
Loop focus: adversarial implementation gap closure and automated verification

## Objective

Convert the implementation plan from an architectural backlog into a worker-ready build sequence that can survive skeptical review. This iteration asks the Core team to prove the first vertical slice is small enough to build, the Adversarial team to attack every implied dependency and missing test, and Senior Leadership to decide whether the next code phase has sufficient guardrails.

## Activated Agents

Core:

- Implementation Planning Lead
- Test Automation Lead
- Local AI Inference Engineer
- Voice And Speech Engineer
- Solution Architect
- Data And Trace Architect
- XR Systems Architect
- Security And Privacy Lead
- Psychometrics Lead
- Clinical Simulation Lead

Adversarial:

- Implementation Plan Gap Attacker
- Supply Chain Dependency Attacker
- Local Model Performance Skeptic
- Voice Safety Misuse Attacker
- Security Privacy Attacker
- Psychometric Overclaim Critic
- UX Friction Critic

Leadership:

- VP Engineering Delivery
- CTO
- Chief AI Safety Officer
- Chief Medical Education Officer
- Chief Psychometrician
- Chief Nursing Interprofessional Officer
- General Counsel
- Simulation Center Director

## Inputs

- `docs/openclinxr/code-implementation-plan.md`
- `docs/superpowers/plans/2026-05-03-openclinxr-code-implementation-plan.md`
- `docs/openclinxr/local-hardware-spike-results.md`
- `docs/openclinxr/local-ai-voice-model-strategy.md`
- `docs/openclinxr/station-pack-ed-chest-pain-v1.md`
- `madr/0021-local-first-no-cloud-implementation-spikes.md`
- `madr/0022-local-llm-runtime-and-model-tiering.md`
- `madr/0023-vibevoice-as-local-voice-candidate.md`
- `madr/0024-pnpm-node-first-bun-deployment-gate.md`
- `madr/0025-implementation-plan-as-versioned-artifact.md`

## Required Output

- A gap-attacked implementation sequence.
- A verification matrix for every early package and app.
- Explicit no-cloud local-runtime gates.
- Dependency and license controls before optional AI/voice/XR tools enter the build.
- Updated memory notes for agents whose responsibilities changed.

