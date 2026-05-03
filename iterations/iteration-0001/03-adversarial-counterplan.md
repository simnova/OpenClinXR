# Iteration 0001 Adversarial Counterplan

## Attack Summary

The Core Plan is directionally strong but still too ambitious for a first pilot. It tries to hold XR, faculty review, trace schema, scenario authoring, security packet, legal posture, validation gates, and GTM packaging in one MVP. That breadth risks a slow build and weak proof. The adversarial replacement is a sharper two-stage pilot: prove faculty-visible trace/replay and human scoring first, then layer Quest XR only where it creates evidence value.

## High-Severity Holes

1. **XR dependency could obscure the actual buyer proof.**
   Assessment leaders may care more about faculty review time and defensible evidence than headset novelty.

2. **The first scenario set may still be too broad.**
   ED chest pain plus breaking bad news plus workflow queue activates many specialties and review rubrics.

3. **Scripted-first is good, but generative AI still appears too available.**
   The plan should explicitly prohibit generative clinical dialogue in the first dry run.

4. **Psychometric plan is framed correctly but not operational enough.**
   It needs a first rater-calibration protocol and a minimum viable scoring form.

5. **Legal/compliance posture is issue-aware but not contract-ready.**
   The plan needs a pilot data-flow appendix, retention schedule, and prohibited claims list.

6. **Open-source strategy is premature for MVP execution.**
   The open-source core can exist as architecture posture, but public contribution and marketplace governance should wait.

## Better Competing Approach

Replace the first MVP plan with a **Pilot Evidence Spine**:

- **M0: Faculty Evidence Prototype**
  Desktop/browser scenario playback, structured event trace, faculty rubric, audit export, and consent/data-flow packet. No headset required.

- **M1: Quest XR Interaction Slice**
  One ED chest pain encounter with limited hand/gaze/tool interactions. The XR slice exists to test whether embodied interaction adds useful trace evidence, not to prove the full platform.

- **M2: Design-Partner Pilot**
  Only after M0 and M1 pass usability, trace completeness, review-time, and safety gates.

This approach preserves the OpenClinXR vision but makes the first proof point harder to dismiss.

## Specific Replacements

| Core Assumption | Replacement | Owner | Expected Rubric Improvement |
|---|---|---|---|
| Two full scenarios plus workflow queue in MVP | One full ED chest pain scenario, one communication storyboard, and one workflow micro-module | Chief Coordinator | Higher implementation readiness |
| Quest XR is the first demonstrable surface | Desktop faculty evidence prototype comes first; Quest XR follows as interaction slice | CTO | Higher technical feasibility and cost efficiency |
| Generative dialogue can be introduced after gates | No generative clinical dialogue in M0/M1; use scripted branching only | Clinical Safety Critic | Higher clinical and legal resilience |
| Trace schema covers many event families | Minimum trace schema covers lifecycle, learner action, timing, faculty review, audit, and scenario version | Data And Trace Architect | Higher architecture coherence |
| Pilot packet can be developed alongside product | Create legal/compliance packet before design-partner contracting | General Counsel | Higher legal/regulatory resilience |
| Open-source and marketplace governance are MVP themes | Keep public marketplace out of first pilot; focus on internal source provenance and scenario certification criteria | Open-Source Sustainability Critic | Higher sustainability and focus |

## Clinical And Specialty Objections

- Emergency Medicine: ED chest pain is a strong first scenario, but escalation and red-flag handling must be faculty-reviewed before learner release.
- Internal Medicine: Diagnostic reasoning should capture uncertainty and differential evolution, not only final diagnosis.
- Pediatrics: Pediatric variants should be excluded from first pilot unless guardianship, consent, and age-specific communication are explicitly designed.
- Psychiatry: Breaking-bad-news and distress scenarios can be valuable but should not include suicide risk in the first version unless crisis escalation is built.
- Surgery: Procedure-heavy expansion should remain outside MVP.

## Psychometric Objections

- Trace completeness is not validity evidence by itself.
- Faculty score forms must define constructs before data collection.
- Two-rater sampling needs a sampling rule, not a vague aspiration.
- G-study planning should identify facets: learner, case, rater, site, device, and scenario version.
- Consequence validity should be deferred until remediation and follow-up data exist.

## Legal And Compliance Objections

- The first pilot needs a prohibited-claims list for sales, demos, and investor materials.
- Consent should distinguish debrief recording, faculty scoring, research export, and de-identified improvement analytics.
- Vendor data flow must be documented even if no real patient data is used.
- Avatar, voice, and generated asset provenance require IP review before public release.
- Any institutional pilot needs a retention and deletion schedule.

## Cost And Performance Objections

- Quest performance risk should not block the faculty evidence prototype.
- Real-time voice and avatar generation should not be on the pilot critical path.
- WebTransport should remain an abstraction until measured against fallback options.
- Cloud/model cost should be capped per learner-hour before paid pilot terms are proposed.
- Staffing plan should prioritize trace/replay, scenario design, faculty UX, and compliance before marketplace features.

## Evidence Debt

- Verify current WebXR/OpenXR status and headset browser capability.
- Verify current regulatory/non-device framing with counsel.
- Verify AAMC/ACGME/NBME/USMLE facts before external use.
- Verify competitor and market-size claims before investor use.
- Verify FERPA/HIPAA/data-residency obligations with counsel for the first design-partner state/institution.

## Decision Debt

- M0 desktop evidence prototype before M1 Quest XR.
- First scenario scope and excluded specialty variants.
- Generative dialogue prohibition duration.
- Minimum rater-calibration protocol.
- Allowed external claims for design-partner outreach.
