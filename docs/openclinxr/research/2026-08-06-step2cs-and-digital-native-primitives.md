# Step 2 CS, OSCEs, and a digital-native primitive set — deep research

**Date:** 2026-08-06
**Researcher:** grok-4.5 with internet access, read-only
**Session:** `019fd547-b3f0-7ba1-8664-fbfbe93cf399` (resumable) · $0.45
**Posture:** research only. Nothing here is an exam-equivalence, clinical-validity, or licensure
claim, and the report says so itself: *you do not inherit CS validity evidence by copying its phases.*

**Why this was commissioned:** the repo committed to `doorway → encounter → note → review`,
checklists and timed stations — primitives lifted from a physical exam nobody here had special
knowledge of. The question was whether they are pedagogically load-bearing or artifacts of corridor
logistics.

---

I'll research Step 2 CS / OSCE primary sources and literature, then map that against the repo's station primitives — read-only, report only.# Step 2 CS, OSCEs, and a digital-native clinical-skills primitive set

**READ-ONLY research report. Not exam-equivalence, not clinical-validity, not licensure claims.**

---

## BOTTOM LINE

**Drop / transform first:** treat **`doorway` as a first-class timed station phase** as cargo-cult. In the physical exam it was a corridor artifact—read the door card, knock, enter. OpenClinXR has already reified it as a hard phase in the exam runtime (`ExamRunStationPhase = "doorway" | "encounter" | "note" | …`, with default `doorwaySeconds: 60`). That is logistics dressed as pedagogy. Keep *briefing* as an optional information channel; do not keep a mandatory clocked doorway gate.

**Highest-value XR unlock Step 2 CS could not measure at all:** **instrumented process traces under deterministic, branchable encounters with perfect replay**—not “did they ask the checklist items,” but *when* they sought which information, how they revised hypotheses under controlled uncertainty, and whether their attention and actions tracked the evolving case. Physical SP circuits cannot give every examinee the same rare branch, the same rewind, or second-by-second process data.

---

# PART 1 — What was it, actually

## Source quality map

| Kind | Examples |
| --- | --- |
| **Primary / program documentation** | USMLE *Step 2 CS Content Description and General Information* (FSMB/NBME, e.g. 2012 edition); official USMLE discontinuation notice (26 Jan 2021); USMLE performance-data tables; GMC PLAB 2 results documentation; MCC materials on MCCQE Part II (until 2019) |
| **Peer-reviewed research** | Harden et al. OSCE origin (BMJ 1975); Cuddy et al. on CS data-gathering / data-interpretation validity (*Academic Medicine* 2016); Winward et al. on CIS vs residency communication ratings (*Academic Medicine* 2013); ASPE Standards of Best Practice (Lewis et al., *Advances in Simulation* 2017) |
| **Secondary / commentary** | AMA/student-media coverage of cancellation; prep blogs (e.g. Ben White); cost advocacy pieces; institutional “how to study CS” PDFs that restate the manual |

Below, primary claims are preferred. Commentary is labeled.

---

## 1. Structure as administered (Step 2 CS)

From the official CS content manual (2012 edition; structure was stable for years prior to suspension):

### Session shape
- **12 patient encounters** per administration (a small number were **nonscored pilots** for case development/research and did not count toward the score).
- Full day **~8 hours**, with **two breaks** (manual: first **30 min**, second **15 min**).
- Delivered only at **Clinical Skills Evaluation Collaboration (CSEC) centers**—commonly cited five U.S. cities (Atlanta, Chicago, Houston, Los Angeles, Philadelphia). Geography is a logistics fact, not pedagogy.

### Doorway / examinee instructions
Outside each room: a cubicle/computer for notes and a **doorway instruction sheet** stating, at minimum:
- Patient **name, age, gender**
- **Reason for visit**
- **Vital signs** (HR, BP, temperature °C/°F, respiratory rate) unless otherwise noted—examinees could accept these as accurate; rechecking was allowed but originals still governed the intended differential
- Sometimes **lab results** for a return-visit format

Announcements controlled: start of encounter, **5 minutes remaining**, end. Early exit from the room was allowed; **re-entry was forbidden** (misconduct).

### Encounter (15 minutes)
- Role: at least a **PGY-1 with primary responsibility** for the patient.
- Task: focused history + focused physical → provisional differential + plan to discuss with the patient.
- SPs trained so that **the same questions yield the same information** across examinees; quality control used live observation and **digital recordings**.
- **Telephone stations** existed (no physical exam; PE section of note left blank).
- Physical exam: positive findings could be **real or simulated**—treat as real. Hard bans: **rectal, pelvic, GU, inguinal hernia, female breast, corneal reflex**; no throat swab—list those on the workup instead. Sensitivity to SP fatigue (gentle exam) was explicit policy.

### Patient note (10 minutes after each encounter)
Typed on a computer (handwriting only if systems failed). Structure (post-2012 form emphasized justification):
- Pertinent history and PE findings **actually obtained**
- Up to **three** diagnoses, ordered by likelihood, with **supporting +/− findings**
- Next **diagnostic studies** (not treatment/referrals)
- No credit for “I would have asked/examined X if I had more time”

### Movement
Examinees rotated through a **fixed circuit** of rooms on a shared clock. That enforces equal sampling and parallel throughput—classic OSCE logistics (Harden’s original problem: reduce dependence on a single long-case patient/examiner).

### Comparators (publicly documented shapes)
| Exam | Rough shape | Notes |
| --- | --- | --- |
| **OSCE (generic)** | ~10–25 stations, 5–20 min each (varies) | Harden 1975: structured tasks, checklists, multi-station sampling |
| **MCCQE Part II** (until ~2019) | **12 OSCE stations** over **two days** (8 + 4) | Mix of longer encounter and shorter paired stations (secondary prep sources: ~14 min vs ~6 min paired) |
| **PLAB 2** (current GMC) | **16 scored stations + rest**, **8 min** + **~90 s** reading outside | Domains: data gathering / clinical management / interpersonal; borderline-regression station cut scores |

---

## 2. What was scored and how

**Composite rule (hard):** pass/fail overall **only if ICE, CIS, and SEP all passed in the same sitting**. Fail any one → fail CS.

### Integrated Clinical Encounter (ICE)
Two pieces:

1. **Data gathering**  
   - **Physical-exam checklist completed by the SP** for maneuvers performed/elicited.  
   - History content was inseparable from the case design: cases specified “essential history and physical examination elements.” Commentary often treats history as checklist-like; the official manual’s explicit SP checklist language for ICE emphasizes **PE**, with history evidence mainly via what appears in the note and communication behaviors.  
   - A checklist **item** in this tradition is typically a **binary, observable action or finding-elicitation** (e.g. “auscultated lungs bilaterally,” “asked about radiation of pain”)—not a global quality judgment. That analytic grain is what made OSCEs “objective” relative to the old long case; it is also what later critics say **penalizes efficient experts** and rewards ritual completeness.

2. **Data interpretation**  
   - **Physician raters** scored the patient note: documentation quality, differential, **justification**, and initial studies (global ratings after rater training).

### Communication and Interpersonal Skills (CIS)
SP-scored checklist of **observable behaviors**, organized by official domains:
- Fostering the relationship  
- Gathering information (chronology, open invitation of patient narrative/concerns)  
- Providing information (clear explanation, amount matched to patient, check understanding)  
- Helping the patient make decisions (next steps + rationale + assess agreement/ability)  
- Supporting emotions (when warranted)

This is **not** “did the SP like you” as a free gestalt—though human feeling still leaks into behavioral ratings.

### Spoken English Proficiency (SEP)
SP **rating scales**: pronunciation/word-choice errors that affect comprehension; listener effort. Lowest failure mode for US/Canadian graduates in secondary analyses; more consequential for some IMG cohorts.

### Who scored what (summary)

| Component | Rater | Instrument |
| --- | --- | --- |
| PE data gathering | SP | Case-specific checklist |
| Note / interpretation | Trained physicians | Structured global ratings of note domains |
| CIS | SP | Behavior checklist |
| SEP | SP | Rating scales |

### Pass-rate pattern (official tables; illustrative)
USMLE performance data show **very high first-taker pass rates for US/Canadian MDs** (often mid-to-high 90s%) and **materially lower rates for non-US/Canadian first takers** (often mid-70s% range in published tables, year-dependent). That pattern fueled the “expensive English/behavior gate for IMGs, near-floor for US grads” critique—**pattern is documented; causal interpretation is contested**.

---

## 3. Standardized-patient methodology

### What SPs were (and were not)
- **Trained role players** portraying a scripted clinical problem with standardized answers to standardized questions.  
- Could portray history, affect, some simulated findings; could **not** safely or ethically absorb unlimited invasive exams; could not be true multi-day illness trajectories; could not be rare unstable physiology without simulation devices.  
- Manual: consistency via training + live QA + **video review**.

### Training / calibration (field standard, not only CS)
ASPE Standards of Best Practice (2017) formalize domains: safe work environment; case development; **SP training for portrayal, feedback, and assessment instruments**; program management; professional development. Training for **checklist completion** is a distinct skill from portrayal—SPs are measurement instruments, not just actors.

### What consistency meant
- **Same answers to same questions** (content standardization)  
- **Similar affect and difficulty** across forms via blueprint (complaint categories, acuity, age/gender, findings)  
- **Rater monitoring** for SP checklist drift  

**Honest limit:** human standardization reduces variance; it never reaches machine identity. Fatigue, halo effects, and subtle coaching differences remain residual error—acknowledged in OSCE psychometrics literature generally, not uniquely CS.

---

## 4. Why discontinued in 2021

### Stated reasons (primary)
FSMB/NBME (26 Jan 2021):  
1. Suspended **May 2020** for COVID-19.  
2. Planned 12–18 months to relaunch a **“modified… appreciably better”** CS.  
3. After review of progress + “rapidly evolving medical education, practice and technology landscapes,” **discontinued work to relaunch**; **no plans to bring CS back**; pivot to partnering on “innovative ways to assess clinical skills.”  
4. Clinical reasoning/communication would continue in other Steps (e.g. Step 3 CCS; communication content elsewhere)—explicitly **not** a full replacement.

### Documented criticisms that preceded the pandemic (secondary + research, not “official cause”)
- **Cost:** registration often cited ~$1,200–$1,600 class, **plus mandatory travel** to few cities—regressive for students/IMGs.  
- **Travel / scheduling burden:** limited centers, long booking lead times, retake logistics colliding with Match.  
- **Very high US pass rates** → weak selection utility for domestic graduates; strong gatekeeping optics for IMGs.  
- **Validity / usefulness doubts** (see Part 2)—especially data-gathering checklist utility.  
- **Examinee culture:** widely described as “an English test” / performance theater; anxiety high relative to failure base rates for US grads.  
- **COMLEX Level 2-PE** was canceled in the same era (parallel osteopathic clinical skills exam)—suggests systemic pressure, not only NBME idiosyncrasy.

**Pandemic as trigger vs cause (judgment, labeled):** COVID made physical multi-city SP exams operationally impossible and forced a restart decision. The restart was abandoned amid **pre-existing cost, logistics, and utility critiques**. Treating COVID as sole *cause* under-reads a decade of criticism; treating CS as “already dead on merits” over-reads—NBME still claimed interest in performance assessment, just not *this* product.

---

# PART 2 — What it did well, and badly

## 5. What the format genuinely assessed that written exams could not

**Constructs with face and some empirical support:**

1. **Interactive communication under social pressure** — listen, explain, negotiate next steps, respond to emotion *with another human in real time*. MCQs and even written Step content do not force this channel. Winward et al.: CIS scores had a **modest positive** relationship with PGY-1 internal-medicine program-director communication ratings after covariates—evidence of *some* extrapolation, not strong prediction.

2. **Integrated clinical encounter behavior** — selecting focused history/PE under time, then **documenting and justifying** a differential. That is closer to Miller’s “shows how” than “knows how.”

3. **Spoken English in a clinical register** (SEP) — a real construct for safe care, though politically and psychometrically fraught as a licensure gate.

4. **Professional physical-exam conduct** (modesty, consent norms, safe pressure)—thinly measured, but present.

**What it did *not* deeply assess (despite folklore):** full physical diagnostic skill, multi-day continuity, team-based care, procedural competence, or complex systems navigation.

---

## 6. Validity criticisms and prediction evidence

### Strong, specific finding (peer-reviewed)
**Cuddy et al., *Academic Medicine* 2016** (n≈6,306 IM residents, 238 programs):  
- **Data interpretation** (note) scores **positively related** to subsequent history-taking and PE ratings in residency.  
- **Data gathering** scores **not related** to those ratings after other USMLE scores were accounted for.  
Authors’ conclusion: less evidence for usefulness of **data gathering** scores; more for **interpretation**.

That is the most important validity result for design: **the checklist-of-maneuvers half of ICE is the weaker half**. If a digital system reifies PE/history checklists as the core score, it may be cargo-culting the *least* validated piece.

### Communication
Winward et al. 2013: CIS → modest prediction of residency communication ratings. Useful signal, not destiny.

### Broader OSCE literature (context)
- Checklists improve inter-rater reliability vs unstandardized long cases (Harden’s original win).  
- Later work often finds **global/domain ratings** better at discriminating expertise than long analytic checklists, which can reward thoroughness over clinical judgment.  
- OSCE validity is **station- and design-dependent**; “OSCEs are valid” is not a free-floating truth.

### Null / weak / absent
- No robust public evidence that CS pass/fail strongly predicted **patient outcomes**, malpractice, or long-horizon clinical excellence.  
- High US pass rates imply **limited discrimination** among domestic graduates.  
- **Flier et al.–class commentary** (secondary) summarized very small practical effect sizes from some prediction analyses—treat magnitude claims carefully; the Cuddy null on data gathering is the cleaner result.

**Honest bottom on validity:** CS had **partial** evidence for communication and note/interpretation constructs; **weak** evidence that SP PE checklists measured durable clinical skill; **insufficient** evidence as a broad predictor of later performance. That does not prove “clinical skills don’t matter”; it proves **this measurement system was a blunt, expensive instrument**.

---

## 7. Physical logistics vs pedagogy

| Feature | Logistics driver | Pedagogical necessity? |
| --- | --- | --- |
| Fixed 12 stations / shared day clock | Throughput, sampling reliability, staffing | Sampling matters; **12** and **shared wall clock** do not |
| 15 + 10 min split | Room occupancy + note computers outside | Time pressure can be a construct; **this cut** is historical |
| One examinee per SP per slot | Human SP is single-threaded | No—machines scale |
| Few national centers | Buildings, SP pools, security | No |
| Doorway card | Physical room; shared vital-sign standardization | Briefing channel yes; **door ritual** no |
| Typed note after exit | Can’t write in room at scale; need rater artifact | Documentation construct yes; **post-exit paper/computer ritual** no |
| Real-time human observation | Only sensors available in 2004–2020 product | Observation yes; **only-human, only-live** no |
| No re-entry / no rewind | Fairness + SP protection + security | Fairness matters; **no-rewind** is anti-learning for formative use |
| Banned intimate exams | SP safety/ethics | Ethics still bind digital claims about those exams |

---

# PART 3 — Re-imagine it (not a faithful port)

## 8. Primitives: keep / transform / drop

Repo anchor: `ExamRunStationPhase` and timing already encode **doorway → encounter → note** as first-class structure. Faculty **review** lives adjacent (review packets/workflows), not as the same learner phase enum—good instinct, still easy to cargo-cult CS sequence.

| Primitive | Verdict | Why |
| --- | --- | --- |
| **`doorway`** | **Drop as phase; transform into optional `brief` channel** | Pure corridor logistics. Context can be ambient, staged, interruptible, multi-source (EMS radio, EHR snippet, parent in hall). A mandatory 60s doorway clock is cosplay. |
| **`encounter`** | **Keep, but de-reify as single continuous 15-min SP chat** | Load-bearing: interaction with an other under uncertainty. Transform into **multi-modal session** (dialogue, exam actions, environment, collaterals) with possible **state changes mid-session**. |
| **`note`** | **Transform hard** | Documentation/synthesis is load-bearing (and was the better-validated ICE piece). Do **not** require a 10-minute post-exit typed PN clone. Prefer: structured synthesis artifacts, spoken articulation, order-entry rationale, or **in-encounter** hypothesis boards—timed when the construct needs time pressure, not because CS did. |
| **`review`** | **Keep as system capability; do not CS-ify as station 13** | Faculty/admin review + learner debrief are product gold. Physical CS had almost no immediate educational review for the examinee. Digital should make **replay-mediated review** central—not a fourth timed station mimicking the circuit. |
| **`checklist`** | **Transform or demote** | Binary SP PE/history checklists are the **weakest validated** ICE piece and train ritual completeness. Keep checklists as **authoring/QA blueprints** and as **process probes**, not as the primary score. Prefer hypothesis-linked evidence, critical omissions, and dangerous actions. |
| **`station`** | **Keep as sampling unit; drop as architecture religion** | Multi-case sampling is Harden’s real gift. Fixed room-count circuits are not. Stations can be **adaptive**, **variable length**, **case families**, or **longitudinal mini-arcs**. |
| **`timed`** | **Keep as optional construct, not universal law** | Time pressure measures prioritization—real skill. Universal identical clocks mainly equalize logistics. Use **construct-driven time** (unstable patient vs chronic counseling). |

**Cargo-cult risk in the repo (blunt):** encoding CS’s physical circuit as the default product grammar (`doorwaySeconds` + `encounterSeconds` + `noteSeconds`) will pull every scenario toward a 2004 CSEC room even when XR can do better.

---

## 9. What XR makes possible that human SPs could not

Labeled **capability**, not proven validity:

1. **Near-perfect consistency** across examinees (same dialogue policy, same findings, same emotional triggers)—beyond SP QA.  
2. **Rare / dangerous / unethical-to-simulate-live presentations** (unstable airway, severe psych crisis, pediatric decompensation)—with claim control that this is training simulation, not real patient care.  
3. **Deterministic replay** of the *same* encounter for scoring adjudication, teaching, and inter-rater calibration.  
4. **Branching on behavior** (information missed → different physiology; empathetic vs dismissive path → different disclosure). Physical circuits cannot afford true trees.  
5. **Instrumentation:** gaze, proximity, hesitation, interruption patterns, exam-sequence order, time-to-critical-question—signals CS never captured at scale.  
6. **Unlimited attempts / spaced practice** for formative use (CS was a single high-stakes day).  
7. **Rewind / counterfactuals:** “What if you had asked about X at minute 3?”—formative gold; high-stakes use needs careful design so rewind isn’t a cheat code.  
8. **Multi-actor encounters** (patient + parent + nurse) without tripling SP payroll—aligned with your peds/anxiety scenarios.

---

## 10. What gets harder or is lost

Honesty over marketing:

| Lost / harder | Why it matters |
| --- | --- |
| **True haptic physical diagnosis** | Palpation quality, real tissue, unexpected anatomy—WebXR cannot claim this without overclaim. |
| **Genuine mutual emotion** | SP affect is performed but *human*; synthetic affect can be consistent yet hollow. Learners detect “NPC.” |
| **SP judgment of how they were made to feel** | CIS tried to operationalize this; raw human reaction still carries information checklists miss. |
| **Unscripted surprise** | Standardization kills the weird real patient; pure scripts can train brittleness. (Mitigation: controlled stochasticity + human review gates.) |
| **Accountability of a shared social reality** | Being rude to a person hits different than rude to a mesh. |
| **Validity inheritance** | You do **not** inherit CS’s (already modest) validity evidence by copying its phases. New measures need new evidence—or stay explicitly formative/non-licensure. |

---

## 11. Proposed primitive set (digital-native, arguable)

These replace the CS circuit as **product grammar**. Argue with them.

### 1. **Case Seed**
Minimal authored state: chief concern, hidden ground truth, allowed findings, safety bounds, claim tags (`notEvidenceFor`).  
*Replaces:* doorway card as the only context object.  
*Analogue:* case blueprint—not a door.

### 2. **Context Channel(s)**
One or more briefing surfaces: chart fragment, EMS handoff audio, doorway poster, nurse whisper, vital stream. **Composable, not a phase.**  
*Replaces:* mandatory doorway phase.  
*No pure physical analogue* at this flexibility.

### 3. **Actor Policy**
Dialogue + emotion + disclosure rules + consistency contract (deterministic seed). Multi-actor capable.  
*Replaces:* single SP body as the only “other.”  
*Transforms:* standardized patient into **policy + embodiment**.

### 4. **Session**
Bounded interactive runtime (the true “encounter”). May contain sub-scenes.  
*Keeps:* encounter as interaction unit.  
*Drops:* assumption of one room / one body / one 15-minute block.

### 5. **World Affordance Graph**
What can be examined, ordered, moved, used; with instrumentation hooks.  
*Replaces:* PE checklist-as-score with **action space + consequences**.  
*Physical analogue:* exam room equipment—but graph is explicit and loggable.

### 6. **Hypothesis Trace**
Learner’s evolving differential / goals—elicited continuously or at probes (spoken, UI, or inferred under uncertainty).  
*Replaces:* post-hoc note as the only window into reasoning.  
*Weak physical analogue:* examiner oral questions (rare in CS).

### 7. **Branch Scheduler**
Deterministic function: `(seed, learner_events) → next_state`. Enables rare paths and fair common stems.  
*No physical SP-circuit analogue at scale.*

### 8. **Critical Event Markers**
Safety and quality flags: dangerous act, missed red flag, forced closure, disrespect triggers—scored as events, not average thoroughness.  
*Transforms:* checklist items into **asymmetric, construct-weighted events**.

### 9. **Synthesis Artifact**
Whatever product proves interpretation: note, order set with rationale, handoff, family explanation. Chosen per case objective.  
*Transforms:* fixed PN template.  
*Keeps:* the validated *idea* of data interpretation.

### 10. **Process Trace**
Time-aligned log: utterances, gaze, proximity, actions, pauses, branch points. First-class evidence object.  
*No CS analogue.* Core XR differentiator.

### 11. **Replay Bundle**
Deterministic restaging for learner debrief and faculty review.  
*Transforms:* one-way video QA used only by the testing org.

### 12. **Review Packet**
Faculty/admin decision object linking traces, artifacts, claimScope, notEvidenceFor.  
*Already in your architecture instincts—keep it product-native, not “station phase 4.”*

### 13. **Sampling Plan** (not “12 stations”)
Blueprint over constructs: acute vs chronic, communication-heavy vs data-heavy, multi-actor, telephone, etc. Length and count are parameters.  
*Keeps:* Harden’s multi-sample reliability insight.  
*Drops:* CSEC day shape.

### 14. **Pressure Profile**
Optional time, interruption, deterioration, or dual-task pressure applied when it serves a construct.  
*Transforms:* universal wall clock.

---

## 12. Single highest-value measure CS could not take

**Process-sensitive clinical reasoning under controlled uncertainty**—specifically:

> Whether the learner’s **information-seeking sequence, attention, and mid-case belief revision** converge on safe management when the case **branches identically for everyone** and can be **replayed**.

CS could approximate “asked enough items” and “wrote a decent note.” It could **not**:
- give all examinees the same rare branch,
- measure gaze/hesitation/order of inquiry,
- separate lucky checklist completion from causal reasoning,
- or let faculty re-watch a perfect restaging with alternate counterfactuals.

That is the non-flattering design implication: **if OpenClinXR mainly rebuilds doorway + 15-minute SP + checklist + note, it will recreate a discontinued instrument’s logistics shell while missing the only measurement frontier that justifies XR.**

---

# Implications that may disagree with current build instincts

1. **`doorway` as enum phase** is the clearest cargo-cult. Demote to context channel.  
2. **Checklist-primary scoring** follows the **weaker** half of ICE validity evidence—prefer synthesis + critical events + process traces.  
3. **Faithful timing clones** (60/900/600s) buy familiarity, not validity.  
4. **Review** should be the star of a digital system (CS was weak here); do not bury it under more station cosplay.  
5. **XR embodiment** is necessary for presence and some exam affordances; it is **not** sufficient for assessment value without instrumentation and branching.  
6. **Claim discipline:** none of the above licenses “exam equivalence,” “clinical validity,” or “predicts residency success.” CS itself barely earned those claims.

---

# Selected citations (for your own follow-up)

**Primary / program**  
- FSMB/NBME. *USMLE Step 2 CS Content Description and General Information* (e.g. 2012).  
- USMLE. “Work to relaunch USMLE Step 2 CS discontinued.” 26 Jan 2021.  
- USMLE performance data tables (Step 2 CS historical pass rates).  
- GMC. PLAB 2 results / scoring (domains + borderline regression).  
- Medical Council of Canada. MCCQE Part II description (historical).

**Research**  
- Harden RM et al. Assessment of clinical competence using objective structured examination. *BMJ* 1975.  
- Cuddy MM et al. Evaluating validity evidence for USMLE Step 2 CS data gathering and data interpretation scores. *Acad Med* 2016;91:133.  
- Winward ML et al. Relationship between Step 2 CS CIS scores and PGY-1 communication ratings. *Acad Med* 2013.  
- Lewis KL et al. ASPE Standards of Best Practice. *Adv Simul* 2017.

**Secondary (cost/culture)**  
- Student/advocacy coverage of CS fees and travel; prep commentary on failure modes (treat as non-primary).

---

**Posture close:** This report is for product design argument inside an **inspired-by**, local-first, non-licensure, non-claim system. The useful inheritance from Step 2 CS is **multi-case sampling, human-other interaction, and synthesis under uncertainty**—not the door, the 15+10 clock, or the PE checklist religion.