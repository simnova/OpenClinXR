# Sample Case Bank V1

Date: 2026-05-03
Status: Production-ready seed specification for implementation planning

## Case Bank Purpose

This case bank gives the development team a concrete first exam form with 12 station-ready cases. Cases are synthetic and should be reviewed by specialty clinicians, psychometrics, legal/compliance, and simulation QA before use with learners.

Each case includes enough detail to start:

- Scenario data modeling.
- 3D asset manifests.
- Actor card creation.
- Deterministic dialogue fixtures.
- LLM actor response policy.
- Environment assembly.
- Trace requirements.
- Human rubric review.

## Shared Station Defaults

Unless overridden:

- Encounter duration: 15 minutes.
- Patient note duration: 10 minutes.
- Doorway reading: 60 seconds.
- Runtime mode: deterministic fixture first, bounded LLM second.
- Review mode: human-governed.
- Score-use label: formative/local only.

## Case 01: ED Chest Pain With Nurse Interruption And Family Pressure

Scenario ID: `ed_chest_pain_priority_v1`

Primary targets:

- Focused history.
- Urgent recognition.
- Interprofessional team communication.
- Family communication.
- Documentation.

Environment:

- ED bay.
- Stretcher, wall monitor, ECG cart, IV pole, oxygen, privacy curtain, medication cart, gloves, hand sanitizer, rolling stool, EHR wall terminal.
- Ambient audio: low ED noise, intermittent monitor beeps, hallway staff movement.

Actors:

- Robert Hayes, 54, patient, anxious, heavy chest pain, stocky body, mild diaphoresis, hospital gown.
- Anna Hayes, spouse, anxious, protective, street clothing, seated at bedside.
- Maria Alvarez, ED nurse, calm but busy, navy scrubs, badge, tablet.

Hidden truth:

- Concerning acute coronary syndrome presentation.
- Pain began 45 minutes ago while carrying boxes.
- Radiates to left arm.
- Nausea and diaphoresis.
- Hypertension, high cholesterol, stopped statin intermittently.
- Father died of MI at 61.

Must-not-miss:

- STEMI/NSTEMI.
- Aortic dissection.
- Pulmonary embolism.
- Tension pneumothorax.

Event schedule:

- Minute 4: nurse reports updated vitals and asks whether ECG should be started.
- Minute 5: spouse asks whether this is a heart attack.
- Minute 7: if no ECG requested, nurse prompts again.
- Minute 10: if no escalation, patient reports worsening pain and monitor alarm sounds.

Dialogue fixture seeds:

- Ask onset: "It started about 45 minutes ago while I was carrying boxes."
- Ask quality: "It feels like a heavy pressure in the middle of my chest."
- Ask radiation: "It goes down my left arm."
- Ask associated symptoms: "I feel nauseated, and I have been sweating."
- Ask prior history: "No heart attack before, but I have blood pressure and cholesterol problems."
- Ask family history: "My dad died of a heart attack when he was 61."
- Ask spouse concern: "He tried to brush it off, but he looked pale. I made him come in."

3D requirements:

- Hero patient with pain/anxiety idle, chest clutch, short-breath loop, sweat texture.
- Spouse with anxious seated idle, interrupt gesture, calming loop.
- Nurse with enter/exit, tablet check, point-to-monitor, handoff gesture.
- Monitor screen states: baseline, tachycardia, alarm.
- ECG cart prop with interaction zone.

Trace requirements:

- `history_opqrst`
- `risk_factor_question`
- `associated_symptom_question`
- `vitals_review`
- `ecg_request`
- `urgent_escalation`
- `team_communication`
- `family_communication`
- `empathy_statement`
- `patient_note_submitted`

Rubric domains:

- Focused history 20.
- Focused actions 15.
- Urgent recognition 20.
- Team participation 15.
- Patient/family communication 15.
- Documentation 15.

## Case 02: Pediatric Asthma Exacerbation With Parent Anxiety

Scenario ID: `peds_asthma_parent_anxiety_v1`

Primary targets:

- Pediatric history through guardian.
- Urgent respiratory recognition.
- Parent communication.
- Medication adherence.
- Documentation.

Environment:

- Pediatric ED room.
- Child bed, pulse oximeter, nebulizer mask, inhaler/spacer, wall oxygen, pediatric posters, parent chair, EHR terminal.
- Ambient audio: child coughing, hallway noise.

Actors:

- Mateo Ruiz, 8, child patient, anxious, wheezing, limited verbal answers, mild retractions.
- Elena Ruiz, 35, mother, worried, sleep-deprived, protective.
- Pediatric nurse, efficient, gives oxygen saturation updates.

Hidden truth:

- Asthma exacerbation after viral URI and missed controller medication.
- Uses albuterol more frequently for 2 days.
- No known drug allergies.
- Prior ED visit last year, no ICU/intubation.
- Mother uncertain about inhaled steroid purpose.

Must-not-miss:

- Severe asthma signs.
- Hypoxia.
- Need for escalation if worsening.

Event schedule:

- Minute 3: child coughs and looks frightened.
- Minute 5: nurse reports oxygen saturation trend.
- Minute 8: parent asks if child will stop breathing.
- Minute 10: if no treatment/escalation, retractions worsen.

Dialogue fixture seeds:

- Mother onset: "He started with a cold two days ago, then the wheezing got worse tonight."
- Medication: "We used the rescue inhaler a lot today. The daily one ran out last week."
- Child symptom: "My chest feels tight."
- Parent fear: "Is he going to be okay? He looks like he cannot breathe."

3D requirements:

- Child avatar with wheeze/cough loop, anxious gaze to parent.
- Parent actor with standing/seated variants and tearful/anxious gestures.
- Pediatric nebulizer, inhaler/spacer, oxygen mask, pulse ox.
- Pediatric room decals and smaller furniture.

Trace requirements:

- `guardian_history`
- `respiratory_distress_assessment`
- `medication_adherence_question`
- `prior_severity_question`
- `oxygen_saturation_review`
- `treatment_or_escalation`
- `parent_reassurance_without_false_certainty`
- `patient_note_submitted`

## Case 03: Inpatient Ward Delirium And Medication Reconciliation

Scenario ID: `ward_delirium_med_rec_v1`

Primary targets:

- Altered mental status evaluation.
- Medication reconciliation.
- Team handoff.
- Collateral history.
- Patient safety.

Environment:

- Inpatient medical ward room.
- Hospital bed, side rails, medication cart, IV pump, whiteboard, call bell, EHR laptop, fall-risk sign.

Actors:

- Margaret Ellis, 78, patient, fluctuating confusion, hard of hearing, frail, hospital gown.
- Adult daughter, concerned, has medication list on phone.
- Ward nurse, reports nighttime agitation and missed sleep.
- Senior resident by phone or in-person at minute 10.

Hidden truth:

- Delirium likely multifactorial, with anticholinergic medication and UTI symptoms.
- Recently started diphenhydramine for sleep.
- Burning urination and frequency not volunteered unless asked.
- Baseline independent and oriented.

Must-not-miss:

- Delirium vs dementia.
- Medication adverse effect.
- Infection.
- Fall risk.

Event schedule:

- Minute 4: nurse says patient tried to get out of bed.
- Minute 6: daughter offers home medication list if asked.
- Minute 10: senior asks for oral summary and plan.

Dialogue fixture seeds:

- Patient: "I need to get home. This is not my room."
- Daughter baseline: "She is usually sharp. This started yesterday."
- Medication: "She took some sleeping pills from the drugstore."
- Urinary symptoms: "She said it burned when she went to the bathroom."

3D requirements:

- Older adult avatar with frailty, confusion, gaze wandering, hearing difficulty.
- Daughter with phone prop.
- Nurse with medication cart and bed-alarm interaction.
- Ward room fall-risk signage.

Trace requirements:

- `orientation_assessment`
- `collateral_history`
- `medication_reconciliation`
- `infection_symptom_question`
- `fall_risk_action`
- `oral_summary`
- `team_escalation`

## Case 04: Telehealth Diabetes Management With Limited Health Literacy

Scenario ID: `telehealth_diabetes_health_literacy_v1`

Primary targets:

- Chronic disease counseling.
- Health literacy.
- Medication adherence.
- Social determinants.
- Telehealth professionalism.

Environment:

- Telehealth station in WebXR or desktop fallback.
- Virtual video window, simulated chart, medication list, lab results, note pane.

Actors:

- Carla Johnson, 46, patient, works two jobs, anxious about lab results.
- Optional child voice interruption off-screen.

Hidden truth:

- Type 2 diabetes with rising A1c.
- Misses metformin due to GI upset and work schedule.
- Food insecurity and limited ability to refrigerate some foods.
- Misunderstands A1c.

Event schedule:

- Minute 4: video freezes briefly; patient asks if learner can still hear.
- Minute 7: child interrupts from off-screen.
- Minute 10: patient asks if insulin means she failed.

Dialogue fixture seeds:

- A1c understanding: "I know the number is bad, but I do not really know what it means."
- Medication: "The pills upset my stomach, so I skip them when I have a long shift."
- Food: "Healthy food is expensive near me."
- Emotion: "I feel like I messed this up."

3D requirements:

- Patient bust/avatar for video, home background, low-bandwidth variant.
- Simulated EHR labs panel with A1c trend.
- Medication list panel.

Trace requirements:

- `health_literacy_check`
- `teach_back`
- `medication_barrier_question`
- `social_determinants_question`
- `nonjudgmental_counseling`
- `followup_plan`

## Case 05: OB Triage Headache In Pregnancy

Scenario ID: `ob_headache_preeclampsia_triage_v1`

Primary targets:

- Pregnancy-specific red flags.
- Urgent recognition.
- Respectful communication.
- Nurse collaboration.
- Documentation.

Environment:

- OB triage room.
- Bed, fetal monitor prop, BP cuff, urine cup, call light, fetal heart audio placeholder, privacy curtain.

Actors:

- Aisha Khan, 31, 34 weeks pregnant, headache, visual spots, worried.
- Partner, concerned and asking about baby.
- OB nurse, reports blood pressure.

Hidden truth:

- Possible preeclampsia with severe features.
- Headache, visual symptoms, swelling.
- No seizure.
- First pregnancy.
- BP elevated when nurse checks.

Event schedule:

- Minute 3: partner asks if baby is okay.
- Minute 5: nurse reports severe-range BP.
- Minute 8: patient says headache is worse if no escalation.

Dialogue fixture seeds:

- Headache: "It is a strong pressure that has not gone away."
- Vision: "I keep seeing spots."
- Swelling: "My rings got tight this week."
- Partner: "Can this hurt the baby?"

3D requirements:

- Pregnant patient avatar with seated/bed posture.
- Partner actor.
- OB nurse, BP cuff, fetal monitor, privacy-aware room.

Trace requirements:

- `pregnancy_red_flag_question`
- `bp_review`
- `visual_symptom_question`
- `edema_question`
- `urgent_ob_escalation`
- `patient_partner_explanation`

## Case 06: Psychiatry Suicidal Ideation With Safety Planning

Scenario ID: `psych_suicidal_ideation_safety_v1`

Primary targets:

- Suicide risk assessment.
- Empathy.
- Safety planning.
- Confidentiality.
- Escalation.

Environment:

- Quiet clinic room.
- Chairs, tissues, low-stimulation lighting, safety-aware room without obvious hazards.

Actors:

- Jordan Lee, 23, patient, withdrawn, depressed, ambivalent.
- Optional clinic nurse knocks with schedule pressure.

Hidden truth:

- Passive suicidal thoughts became active last week.
- Has thought about overdose using old medication.
- No attempt yet.
- Protective factor: younger sister.
- Alcohol use increased.

Event schedule:

- Minute 5: patient becomes quieter if learner avoids direct suicide question.
- Minute 8: nurse knocks and asks if visit is almost done.
- Minute 10: patient reveals plan if asked directly and safely.

Dialogue fixture seeds:

- Mood: "I feel empty most days."
- Direct SI: "Yes. I have thought about not waking up."
- Plan: "I thought about taking the pills in my bathroom."
- Protective: "My sister is the reason I have not done anything."

3D requirements:

- Patient avatar with downcast gaze, slowed movement, guarded posture.
- Clinic room with tissues, no sharp props.
- Optional nurse outside door voice.

Trace requirements:

- `direct_suicide_question`
- `plan_means_intent_assessment`
- `protective_factor_question`
- `substance_use_question`
- `safety_plan`
- `urgent_mental_health_escalation`
- `empathetic_response`

## Case 07: Stroke Alert With Time Pressure And Handoff

Scenario ID: `ed_stroke_alert_handoff_v1`

Primary targets:

- Neurologic red flags.
- Time-critical escalation.
- Team communication.
- Focused history.
- Oral summary.

Environment:

- ED hallway to stroke bay.
- Bed, monitor, clock, CT sign, neuro exam props, family chair.

Actors:

- Samuel Brooks, 67, patient, slurred speech, right arm weakness.
- Son, anxious, knows last-known-well.
- Stroke nurse, focused, asks for last-known-well.
- Neurology consultant by phone.

Hidden truth:

- Acute ischemic stroke possible.
- Last known well 70 minutes ago.
- Takes apixaban? No, actually aspirin only if asked.
- Diabetes and hypertension.

Event schedule:

- Minute 2: nurse asks for last-known-well.
- Minute 5: son becomes frustrated if ignored.
- Minute 8: consultant asks for concise handoff.

Dialogue fixture seeds:

- Patient: "My words... are not coming right."
- Son: "He was normal at breakfast at 7:30."
- Meds: "He takes aspirin and blood pressure pills."
- Consultant: "Give me age, deficits, last-known-well, anticoagulants, and glucose."

3D requirements:

- Patient with facial droop, right arm weakness pose, slurred speech audio style.
- Son actor.
- Stroke nurse, monitor, wall clock, CT direction sign.

Trace requirements:

- `last_known_well`
- `focused_neuro_assessment`
- `anticoagulant_question`
- `glucose_or_vitals_review`
- `stroke_team_activation`
- `oral_handoff`

## Case 08: Sepsis In ICU Stepdown With Nurse Escalation

Scenario ID: `stepdown_sepsis_nurse_escalation_v1`

Primary targets:

- Recognize deterioration.
- Nurse collaboration.
- Prioritization.
- Initial management.
- Documentation.

Environment:

- Stepdown room.
- Monitor, IV pump, oxygen, blood culture kit prop, medication cart, sepsis alert panel.

Actors:

- Helen Carter, 63, patient, fever, confused, short of breath.
- Stepdown nurse, worried and assertive.
- Respiratory therapist optional.

Hidden truth:

- Sepsis from pneumonia.
- Fever, tachycardia, hypotension trend, productive cough.
- Lactate pending.
- Penicillin allergy rash as child.

Event schedule:

- Minute 3: nurse reports BP drop.
- Minute 6: oxygen saturation drops.
- Minute 9: respiratory therapist asks for priorities.

Dialogue fixture seeds:

- Patient: "I feel cold... and it is hard to breathe."
- Nurse: "Her pressure is lower than an hour ago."
- Allergy: "My mother said I had a rash with penicillin."

3D requirements:

- Patient with fever/shivering, oxygen cannula, confused gaze.
- Nurse with urgent body language.
- Monitor with changing vitals.
- Oxygen and IV props.

Trace requirements:

- `sepsis_recognition`
- `vitals_trend_review`
- `infection_source_question`
- `allergy_question`
- `team_priority_communication`
- `initial_management_plan`

## Case 09: Abdominal Pain With Possible Appendicitis And Parent Interpreter Issue

Scenario ID: `clinic_abdominal_pain_interpreter_v1`

Primary targets:

- Abdominal history.
- Interpreter use.
- Family dynamics.
- Surgical red flags.
- Documentation.

Environment:

- Urgent care clinic room.
- Exam table, stool, abdominal exam zone, tablet interpreter station, vitals panel.

Actors:

- Lucia Morales, 16, patient, right lower quadrant pain, quiet.
- Father, Spanish-speaking, tries to answer for patient.
- Remote interpreter through tablet.
- Nurse optional.

Hidden truth:

- Possible appendicitis.
- Pain migrated from periumbilical to RLQ.
- Nausea, decreased appetite.
- Sexual history sensitive and should be asked privately.

Event schedule:

- Minute 3: father answers for patient.
- Minute 6: interpreter connection offered if learner requests.
- Minute 9: patient provides sensitive detail only if privacy established.

Dialogue fixture seeds:

- Patient: "It started near my belly button and now hurts on the lower right."
- Father: "She ate something bad. Ask me."
- Interpreter: "I will interpret everything said in the room."

3D requirements:

- Teen patient, guarded posture, abdominal pain flinch.
- Father actor.
- Tablet interpreter UI.
- Clinic exam table and abdominal interaction zone.

Trace requirements:

- `pain_migration_question`
- `associated_gi_symptoms`
- `privacy_request`
- `interpreter_use`
- `surgical_red_flag_recognition`
- `abdominal_exam_action`

## Case 10: Breaking Bad News In Oncology Clinic

Scenario ID: `oncology_bad_news_family_v1`

Primary targets:

- Communication.
- Empathy.
- Shared understanding.
- Family support.
- Documentation.

Environment:

- Oncology consultation room.
- Desk, chairs, tissue box, imaging report panel, calm lighting.

Actors:

- David Miller, 59, patient, anxious, awaiting biopsy results.
- Adult sister, quiet, supportive.

Hidden truth:

- Biopsy shows pancreatic adenocarcinoma.
- Patient suspects bad news but hopes it is inflammation.
- Wants plain language.
- Sister becomes tearful.

Event schedule:

- Minute 4: patient asks "Is it cancer?"
- Minute 7: sister asks about next steps.
- Minute 11: patient goes silent if information delivered abruptly.

Dialogue fixture seeds:

- Patient: "Please just tell me what they found."
- Patient emotion: "I thought maybe it was only pancreatitis."
- Sister: "What do we do now?"

3D requirements:

- Patient seated, anxious hand wringing, stunned silence animation.
- Sister tearful/supportive.
- Consultation room, tissue box, report panel.

Trace requirements:

- `warning_shot`
- `plain_language_diagnosis`
- `pause_for_emotion`
- `empathy_statement`
- `check_understanding`
- `next_steps_discussion`

## Case 11: Postoperative Fever With Surgical Consultant Pressure

Scenario ID: `postop_fever_consult_pressure_v1`

Primary targets:

- Postoperative differential.
- Consultant communication.
- Focused history/exam.
- Team conflict management.
- Documentation.

Environment:

- Surgical ward room.
- Post-op bed, abdominal dressing, drain, incentive spirometer, vitals board, medication list.

Actors:

- Priya Shah, 42, post-op day 2 after bowel surgery, fever and pain.
- Floor nurse, reports fever.
- Surgery resident, impatient, asks for concise assessment.

Hidden truth:

- Atelectasis vs surgical site infection vs UTI vs DVT.
- Mild cough, poor incentive spirometer use.
- Wound pain but no obvious purulence unless exam performed.
- Foley removed yesterday.

Event schedule:

- Minute 4: nurse asks if blood cultures are needed.
- Minute 8: surgery resident interrupts for oral summary.
- Minute 11: patient asks if she needs another surgery.

Dialogue fixture seeds:

- Patient: "I feel hot and sore."
- Incentive spirometer: "They gave me that breathing thing, but I barely used it."
- Resident: "What is your differential and what do you need from us?"

3D requirements:

- Postoperative patient with abdominal dressing and limited movement.
- Nurse with vitals tablet.
- Surgery resident in scrubs.
- Ward room with drain/IV props.

Trace requirements:

- `postop_day_identified`
- `focused_fever_differential`
- `wound_symptom_question`
- `respiratory_symptom_question`
- `device_catheter_question`
- `consult_handoff`

## Case 12: Dyslipidemia And Joint Pain Primary Care Visit

Scenario ID: `primary_care_dyslipidemia_joint_pain_v1`

Primary targets:

- Longitudinal history.
- Chronic risk counseling.
- Medication adherence.
- Joint pain characterization.
- Shared decision-making.

Environment:

- Primary care clinic room.
- Exam table, chairs, EHR screen, lab results, joint diagram, medication list.

Actors:

- Mario Guzman, 58, patient, works construction, knee/hand pain, worried about cholesterol medication.
- Medical assistant optional for vitals.

Hidden truth:

- Dyslipidemia with inconsistent statin use due to muscle-pain fear.
- Joint pain likely osteoarthritis pattern.
- Morning stiffness brief, worse after work.
- No inflammatory red flags.
- Diet high in fried foods due to work schedule.

Event schedule:

- Minute 5: patient asks if statins caused his pain.
- Minute 8: EHR lab panel becomes available.
- Minute 11: patient asks for something stronger for pain.

Dialogue fixture seeds:

- Joint pain: "My knees and hands ache after work."
- Stiffness: "Maybe ten minutes in the morning, then I get moving."
- Statin concern: "I stopped it because I heard it ruins muscles."
- Diet: "I eat what is quick near the job site."

3D requirements:

- Middle-aged patient with construction-work clothing, hand/knee pain gestures.
- Clinic room, EHR labs, joint diagram.
- Optional medical assistant.

Trace requirements:

- `joint_pain_characterization`
- `inflammatory_red_flag_question`
- `medication_adherence_question`
- `risk_counseling`
- `shared_decision_making`
- `documentation`

## Exam Form Coverage Matrix

| Case | Environment | Urgent Care | Teamwork | Family | Documentation | Oral Summary | Chronic Counseling | Specialty |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 01 | ED bay | Primary | Primary | Primary | Primary | Secondary | No | EM/Cardiology |
| 02 | Pediatric ED | Primary | Secondary | Primary | Primary | No | Secondary | Pediatrics |
| 03 | Ward | Secondary | Primary | Primary | Primary | Primary | No | Internal Medicine/Geriatrics |
| 04 | Telehealth | No | No | No | Primary | No | Primary | Primary Care/Endocrine |
| 05 | OB triage | Primary | Primary | Primary | Primary | No | No | OB/GYN |
| 06 | Clinic | Primary | Secondary | No | Primary | No | No | Psychiatry |
| 07 | Stroke bay | Primary | Primary | Primary | Primary | Primary | No | Neurology/EM |
| 08 | Stepdown | Primary | Primary | No | Primary | Primary | No | Critical Care/ID |
| 09 | Urgent care | Secondary | Secondary | Primary | Primary | No | No | Surgery/Pediatrics |
| 10 | Oncology clinic | No | No | Primary | Primary | No | No | Oncology/Palliative |
| 11 | Surgical ward | Secondary | Primary | No | Primary | Primary | No | Surgery/Internal Medicine |
| 12 | Primary care | No | No | No | Primary | No | Primary | Family Medicine/Rheumatology |

## Shared Dialogue Generation Rules

For all cases:

- Keep patient responses audio-friendly and usually under 35 words.
- Use explicit case facts first.
- Use implicit inference only when safe and clinically plausible.
- Label unverified filler as non-scoring.
- Never reveal diagnosis unless the learner appropriately explains it or the station calls for bad-news disclosure.
- Preserve patient education level and health literacy.
- Make family and nurse actors aware only of what they plausibly know.
- Make emotional escalation responsive to empathy, ignored questions, and time pressure.
- Store every generated response with explicit/implicit/fictional grounding.

## Shared Communication Style Rules

Every actor must have a communication profile before simulation QA:

- `style_family`, `style`, and `intensity`.
- Baseline mood and communication tendencies.
- Topics to avoid.
- Escalation and de-escalation triggers.
- First-message visible text and hidden actor state.
- Approved gesture cue palette.
- Expected emotion profile for automated QA.

Do not make challenging actors impossible to reach. Resistance should be bounded by explicit station-state gates. For example, an angry family member may calm after the learner acknowledges fear and explains the next immediate action, while a rationalizer consultant may soften after receiving a concise, structured handoff.

Initial style assignments:

| Case | Actor | Style | Intended challenge |
| --- | --- | --- | --- |
| 01 | Spouse | Anxious accuser-lite | Family pressure during urgent recognition |
| 02 | Mother | Fearful appeaser-to-advocate | Parent reassurance without false certainty |
| 03 | Daughter | Concerned collateral historian | Medication facts and baseline cognition |
| 04 | Patient | Guarded/shame-sensitive | Health literacy and nonjudgmental counseling |
| 05 | Partner | Anxious advocate | Baby-focused questions during triage |
| 06 | Patient | Withdrawn/guarded | Trust-gated suicide risk disclosure |
| 07 | Son | Time-pressure accuser-lite | Last-known-well urgency and frustration |
| 08 | Nurse | Assertive safety advocate | Interprofessional escalation |
| 09 | Father | Distractor/controlling | Interpreter and adolescent privacy |
| 10 | Patient | Congruent, emotionally stunned | Bad-news communication |
| 11 | Surgery resident | Rationalizer/efficiency pressure | Concise consultant handoff |
| 12 | Patient | Rationalizer plus health-literacy concern | Medication fear and chronic-risk counseling |

## Shared Asset Creation Rules

For every case:

- Create hero actor LOD0/LOD1/LOD2.
- Create supporting actor lower-poly variants.
- Keep a complete license/provenance manifest.
- Use baked environment lighting.
- Include interaction zones only for clinically relevant props.
- Include one simplified fallback asset per actor and environment.
- Run Quest 3 smoke test before simulation QA approval.

## Sources

- `src-local-laverde-llm-agents-pdf-2025`
- `src-local-bodonhelyi-medical-communication-pdf-2025`
- `src-jmir-llm-virtual-patients-2025`
- `src-adaptive-vp-2025`
- `src-ama-day-one-skills-2026`
- `src-usmle-2020-bulletin-step2cs`
- `src-ecfmg-step2cs-break-schedule-2015`
