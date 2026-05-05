# Proposal: Server-Side Multi-Actor State And Context Management

**Status:** Approved
**Approved by:** Patrick Gidich on 2026-05-05 13:40:16 EDT
**Decision:** Approved with clarification that Codex may evaluate other viable options and may incorporate existing system functionality, including voice, during the spike if it makes sense at that time
**Requested by:** Codex
**Date:** 2026-05-05
**Scope:** Server-side architecture spike only

## Decision Needed

Approve a focused spike to evaluate server-side state management approaches capable of supporting multi-actor clinical scenarios with role-appropriate, context-aware behavior.

The spike should explore architectures that can maintain:

- Distinct actor identities and roles, such as Patient, Nurse, and Attending Physician.
- Context and memory per actor, including emotional state, knowledge boundaries, and relationship to the learner.
- Appropriate responses based on who is being addressed.
- Structured clinical state, including case progress, checklists, orders, findings, and timing.
- Real-time spatial state, including transforms, hand interactions, and object state.

## Recommendation

Approve the spike.

A server-side architecture that supports multiple actors with role-specific context and behavior will be important for realistic clinical training scenarios. The spike should evaluate:

- Colyseus as a mature production-oriented realtime state framework.
- bitECS as a more direct ECS alignment with the IWSDK/client-side model, pending license clarification.
- A fully custom implementation, with or without an ECS foundation.
- Any other viable alternatives that surface during the evaluation.

This broad evaluation should help determine the best long-term path across maintainability, performance, licensing, implementation effort, and alignment with the client architecture.

## Proposed Spike Activities

- Define core actor types needed for representative clinical scenarios, including Patient, Nurse, Physician, Family Member, and Examiner/Observer roles.
- Design a state model supporting per-actor context/memory and structured clinical state.
- Prototype interaction routing so the system responds appropriately based on which actor is being addressed.
- Evaluate Colyseus for multi-actor session management and state synchronization.
- Evaluate bitECS for a pure ECS approach, only if the license posture is acceptable at implementation time.
- Explore a fully custom implementation as a baseline.
- Compare development effort, performance, licensing implications, testing posture, and long-term maintainability.
- Assess support for hybrid behavior, where structured clinical logic remains authoritative while agentic responses are used where appropriate.

## Key Capabilities To Evaluate

| Capability | Why It Matters | Priority |
| --- | --- | --- |
| Multiple distinct actors with roles | Realistic clinical team scenarios | High |
| Per-actor context and memory | Characters stay in role and remember interactions | High |
| Context-aware response routing | Asking the right person the right question | High |
| Structured clinical state tracking | Case progress, checklists, orders, and findings | High |
| Spatial / transform state | Hand tracking and object interaction | High |
| Hybrid structured + agentic behavior | Balance clinical rigor with natural feel | Medium |
| Performance with frequent updates | Multiple actors plus position updates | High |
| Implementation and maintenance effort | Long-term sustainability | High |

## Out Of Scope

- Full LLM integration or voice transport implementation.
- Production deployment.
- Complete scenario content development.
- Final architecture selection without a follow-up proposal.

## Verification And Output

- Spike report comparing architectural options, including Colyseus, bitECS, fully custom, and any other viable alternatives identified.
- Recommended state model for multi-actor clinical XR scenarios.
- Clear recommendation with pros, cons, license posture, performance notes, and estimated effort for the preferred path or paths.
- High-level effort estimate for a follow-up implementation proposal if warranted.

## Rollback

This is an exploratory spike. No production changes should be made. If any spike package is installed, it must be isolated to a spike environment and removed if the spike is deferred, rejected, or fails license/security checks.

## Operator Approval Boundaries

Approval would allow Codex to:

- Install and experiment with Colyseus, bitECS, or other libraries in a spike environment only.
- Prototype multi-actor state models and interaction logic, including custom approaches.
- Document findings and recommendations.

Approval would not allow Codex to:

- Modify production systems.
- Commit to a final architecture without a follow-up proposal.
- Add runtime dependencies to production apps or shared packages.
- Use cloud services, paid APIs, production credentials, or hosted realtime services.
- Treat bitECS as approved until its license posture is acceptable for this project.

## Notes To Recheck Before Implementation

- The bitECS license clarification issue was open on 2026-05-05 and described an inconsistency between website MIT language and the repository `LICENSE` file being MPL-2.0. Treat bitECS as license-gated until resolved.
- Colyseus license/package posture should be checked from package metadata and upstream repository before install.
- Any new package install should be exact-version pinned, license-reviewed, and recorded in the security/license evidence workflow before commit.

## Sources

- bitECS license clarification request: https://github.com/NateTheGreatt/bitECS/issues/212
