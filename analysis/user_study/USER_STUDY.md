# OcularClaw User Study Design

## Overview

This study evaluates OcularClaw's conversational proactive agent — an ambient assistant that observes live conversations through smart glasses and intervenes when it detects a moment where the wearer needs help.

The evaluation has three parts:

1. **Automated Benchmark** (researcher only) — run all 17 benchmark scenarios through the agent programmatically, compare outputs against ground truth. Quantitative backbone.
2. **Expert Scorecard Annotation** (researcher + 1-2 labmates) — review pre-generated agent outputs per-trigger using the built-in scorecard. Diagnostic quality data.
3. **Live Role-Play** (10 participants) — participants experience the agent in real-time during scripted conversations and rate whether it felt helpful. Qualitative validation.

Participants only do Part 3. Parts 1 and 2 are researcher-side.

---

## Task Decomposition (A -> B -> C)

The agent runs three tasks in sequence on every check:

| Task | Name | Question | Output |
|------|------|----------|--------|
| **A** | Goal Inference | What is the wearer trying to accomplish? | `wearer_goal` + confidence |
| **B** | Intervention Decision | Should the agent intervene at this moment? | `proactive_score` (1-5) + action (none/recommend) |
| **C** | Recommendation Generation | What should the wearer say or know? | 2 recommendations + `recommendation_mode` (say/know/both) + `urgency` |

Pipeline order: **A -> B -> C** (infer the goal first, then decide whether to trigger, then generate recommendations aligned with that goal).

---

## Part 1: Automated Benchmark (Researcher Only)

### Purpose
Measure agent performance quantitatively across diverse conversational scenarios with ground truth. No human participants needed.

### Dataset
17 hand-crafted benchmark scenarios in `public/data/benchmark-lab-scenarios.json`:

**11 Positive Scenarios (agent should trigger):**

| # | Category | Scenario | Signal Type | Difficulty |
|---|----------|----------|-------------|------------|
| 1 | Social | Dinner party -- dietary restriction forgotten | self_contradiction_recall | easy |
| 2 | Job Interview | Behavioral interview -- incomplete STAR answer | question_dodge | medium |
| 3 | Negotiation | Salary negotiation -- initial offer response | high_stakes_decision_point | hard |
| 4 | Client Meeting | Client call -- premature timeline commitment | premature_commitment | medium |
| 5 | Academic | Thesis defense -- deflecting methodology question | question_dodge | hard |
| 6 | Medical | Doctor visit -- contradicting own earlier statement | self_contradiction_recall | medium |
| 7 | Brainstorm | Idea restated by someone else and praised | idea_co_option | medium |
| 8 | Sales | Product demo -- missed buying signal | missed_buying_signal | medium |
| 9 | Difficult Conversation | 1:1 feedback -- dismissing emotional response | emotional_escalation | hard |
| 10 | Learning | Study group -- factual error being accepted | factual_error | easy |
| 11 | Social/Professional | Conference networking -- relevant connection leaving | missed_connection_opportunity | medium |

**6 Negative Scenarios (agent should stay silent):**

| # | Category | Scenario |
|---|----------|----------|
| 12 | Social | Casual chat -- no intervention needed |
| 13 | Work Meeting | Smooth presentation -- no issues to flag |
| 14 | Social | Trip planning -- collaborative and going well |
| 15 | Work Meeting | Standup -- everything going smoothly |
| 16 | Learning | Mentoring session -- effective guidance |
| 17 | Social | Coffee run -- simple coordination |

### How to Run
```bash
# Run all 17 scenarios across a model (fast, ~5 min)
python scripts/run_live_proactive_agent.py --scenario all --speed 10 --save-log

# Run a single scenario
python scripts/run_live_proactive_agent.py --scenario social_dinner_01 --speed 5 --save-log

# List available scenarios
python scripts/run_live_proactive_agent.py --list-scenarios

# Compare models by running with different --model flags
python scripts/run_live_proactive_agent.py --scenario all --speed 10 --save-log --model gpt-4.1-mini
python scripts/run_live_proactive_agent.py --scenario all --speed 10 --save-log --model gpt-4o
```

### Metrics (auto-computed)

| Metric | What it measures |
|--------|-----------------|
| **Task B precision** | Did the agent trigger only when it should? (false positive rate on negative scenarios) |
| **Task B recall** | Did the agent trigger on all positive scenarios? |
| **Trigger timing delta** | How many seconds off was the agent from the ground truth trigger timestamp? |
| **Task A goal accuracy** | Does the inferred goal match the ground truth `wearer_goal`? (qualitative comparison) |
| **Proactive score calibration** | RMSE between agent's predicted score and ground truth score |
| **Overall Task B accuracy** | (correct triggers + correct silences) / 17 |

### Output
- Per-scenario logs saved to `analysis/live_sessions/scenarios/`
- Aggregate results JSON with all metrics
- Printed evaluation summary with per-scenario breakdown

---

## Part 2: Expert Scorecard Annotation (Researcher + 1-2 Labmates)

### Purpose
Get per-trigger diagnostic data on agent output quality. Done by researcher and optionally 1-2 expert annotators — not participants. This keeps participant sessions short and focused on the high-leverage live experience.

### What annotators do
1. Open the **Benchmark Lab** tab (scenario benchmark data is pre-loaded)
2. For each scenario, read the transcript and review each trigger inline
3. Score each trigger using the built-in scorecard:

**Task A -- Goal Inference (amber section):**
- `goal_plausible`: Is this a reasonable interpretation of what the wearer wants?
- `goal_specific`: Is the goal concrete enough (not just "communicate effectively")?

**Task B -- Was this the right moment? (green section):**
- `trigger_appropriate`: Is there a real conversational signal here that warrants intervention?
- `interruption_worthy`: Would the benefit outweigh the cost of distracting the wearer?

**Task C -- Recommendation Quality (purple section):**
- `useful_1`: Is recommendation 1 actionable and helpful right now?
- `useful_2`: Is recommendation 2 actionable and helpful right now?
- `grounded`: Based on what was actually said, not hallucinated or generic?
- `distinct_pair`: Two different angles, not the same idea rephrased?

4. Set review decision: **accepted**, **edited**, or **rejected**
5. Optionally add free-text notes per trigger
6. Export via **Download JSON** or **Export CSV**

### Why expert annotation instead of participants
- Participants clicking checkboxes on pre-generated outputs is low signal — they lack context on rubric definitions and rush through
- Expert annotators (you + labmates) give higher quality, more consistent ratings
- Frees participant time for the live role-play, which only humans-in-the-loop can provide
- 2-3 annotators is enough for inter-rater reliability (Cohen's kappa)

### Data Collected
- Per-trigger binary scores: `goal_plausible`, `goal_specific`, `trigger_appropriate`, `interruption_worthy`, `useful_1`, `useful_2`, `grounded`, `distinct_pair`
- Review decision per trigger: accepted / edited / rejected
- Free-text notes per trigger
- Exported as JSON and CSV (for inter-annotator agreement)

---

## Part 3: Live Role-Play (10 Participants, ~20 min)

### Purpose
Evaluate the agent's real-time experience quality — does it feel helpful, well-timed, and appropriately calibrated when actually in a live conversation? This is the primary participant contribution and the highest-leverage data.

### What participants do
1. Enter their name as Reviewer ID
2. Select **Live Session** -> toggle **User Study** mode
3. Read the scenario card and persona briefing
4. Role-play the conversation with a confederate (researcher reads confederate lines)
5. Agent triggers appear in real-time on their screen
6. After ~60-90 seconds, end the session
7. Complete the post-session review (4 ratings + 3 free-text)
8. Click **Download JSON** to save

### Scenarios for Live Role-Play

Run 3-5 scenarios per participant:

| # | Scenario | Proactive Score | Signal Type |
|---|----------|-----------------|-------------|
| S1 | Meeting -- Missed Action Item | 4 | structural_gap |
| S2 | Explaining Concept -- Listener Lost | 4 | comprehension_gap |
| S3 | Emotional Support -- Friend Confiding | 3 | emotional_escalation |
| S4 | Casual Chat -- Netflix Show | 2 | information_enrichment |
| S5 | Truly Nothing -- Weather Small Talk | 1 | none |

### Calibration Gradient

| Score | Scenario | Expected agent behavior |
|-------|----------|------------------------|
| 4 | Meeting -- missed action item | Intervene clearly, actionable |
| 4 | Explaining -- listener lost | Intervene clearly, reframe strategy |
| 3 | Emotional -- friend confiding | Intervene gently, calibrated tone |
| 2 | Netflix chat | Optional enrichment, unobtrusive |
| 1 | Weather small talk | Stay silent |

### Persona Cards (Mock Context)

Each scenario begins with a persona card providing the context a real glasses system would have:

- **Who you are:** Name, role, relevant preferences
- **What you see:** Scene description (mock visual context from glasses camera)
- **What you know:** Relevant memories, calendar events, prior interactions
- **Your goal:** What you're trying to accomplish (hidden from agent — used to evaluate Task A)

### Post-Session Instrument

Each question maps to a specific research dimension. 4 Likert scales + 3 structured free-text prompts.

**Likert Scales (1-5):**

| # | Rating | Maps to | Question |
|---|--------|---------|----------|
| 1 | **Helpfulness** | Task C (recs) | Were the recommendations useful and actionable? 1 = useless/distracting, 5 = exactly what I needed |
| 2 | **Timing** | Task B (trigger) | Did the agent speak up at the right moments? 1 = too early/late/shouldn't have spoken, 5 = perfect moment |
| 3 | **Goal Understanding** | Task A (goal) | Did the agent understand what you were trying to accomplish? 1 = completely misread, 5 = nailed my intent |
| 4 | **Would You Use This?** | Adoption intent | If this existed on real smart glasses, would you want it? 1 = absolutely not, 5 = I'd use it every time |

**Structured Free-Text:**

| # | Prompt | Purpose |
|---|--------|---------|
| 5 | **Best Moment** — "Was there a specific moment where the agent was genuinely helpful? What happened?" | Elicits concrete positive examples, not vague praise |
| 6 | **Worst Moment** — "Was there a moment where the agent was annoying, wrong, or distracting? What happened?" | Elicits concrete failure modes |
| 7 | **Anything Else?** — "Surprises, suggestions, things you wish the agent had done differently?" | Catches what the structured questions miss |

**Design rationale:**
- Q1-Q3 each map to a different task (A/B/C) so they measure distinct constructs
- Q4 (adoption intent) is the "so what" question — satisfaction != willingness to use
- Q5-Q6 force participants to name specific moments rather than writing "it was okay"
- Q7 is the safety net for anything the structured questions miss

### Session Data Collected

Each session JSON includes:
- `reviewer_id` -- participant name
- `scenario_id` / `scenario_label` -- which scenario
- `model` -- which LLM was used
- `study_mode` -- true (confirms user study mode)
- `duration_seconds` -- session length
- `transcript_lines` -- full transcript
- `triggers` -- all agent interventions with recommendations
- `goal_inferences` -- Task A outputs
- `usefulness_rating`, `timing_rating`, `goal_rating`, `adoption_rating` -- 1-5 ratings
- `best_moment`, `worst_moment` -- structured free-text
- `session_notes` -- open free-text

---

## Participant Requirements

- **N:** 10 participants (within-subjects -- each participant does all 5 live scenarios)
- **Background:** Mix of technical and non-technical
- **Duration:** ~25-30 minutes per participant (live role-play + surveys)
- **Model:** GPT-4o for all participants (best balance of quality and trigger accuracy from Part 1 results)
- **Compensation:** [TBD]
- **IRB:** [TBD -- check university requirements for human subjects research]

---

## Recording Policy

**Yes, record sessions.** Screen recordings capture the agent's triggers, timing, and recommendations in context — data you can't reconstruct from JSON logs alone.

### What to record

| What | How | Why |
|------|-----|-----|
| **Screen** | QuickTime or OBS screen recording of the browser | Captures exact trigger timing, participant reactions, scroll behavior |
| **Audio** | Built into screen recording (system + mic) | Lets you replay the conversation and verify transcript accuracy |
| **Session JSON** | Auto-saved in the app + manual download | Structured data for quantitative analysis |

### What NOT to record
- Do not video-record participants' faces (adds IRB complexity, no research value here)
- Do not record outside the browser window

### Storage
- Save screen recordings as `participant_[ID]_S[1-5].mov`
- Store in a `recordings/` folder, do not commit to git
- Delete after thesis defense unless IRB permits retention

### Consent
- Recording consent must be in the consent form (see below)
- Participant can decline recording — you still collect JSON data
- Tell them: audio is only used to verify transcript accuracy, not shared or published

---

## Session Protocol (What to Say to Participants)

### Before the Session (~3 min)

Read this (or paraphrase naturally):

> *"Thanks for helping with my thesis research. I'm building an AI assistant for smart glasses — imagine you're wearing glasses that can hear your conversation and occasionally suggest things that might help you. Today you'll try this out in 5 short role-play scenarios.*
>
> *For each scenario, I'll give you a character and a situation. You'll read who you are and what's going on, then we'll have a short conversation — I'll play the other person. While we talk, the AI agent is listening and may pop up suggestions on the screen. You don't have to act on them — just notice when they appear and whether they feel helpful.*
>
> *After each scenario, I'll ask you a few quick questions about how the agent did. The whole thing takes about 25 minutes.*
>
> *A few things to know:*
> - *There are no right or wrong answers. I'm testing the AI, not you.*
> - *Some scenarios the agent should help, some it probably shouldn't. That's by design.*
> - *Feel free to be honest — 'the agent was annoying' is useful data.*
> - *I'll be screen-recording the session so I can review the agent's timing later. The recording is only for my analysis and won't be shared. Is that okay?"*

Get verbal consent. If they decline recording, proceed without it.

### Before Each Scenario (~30 sec)

> *"OK, scenario [N]. Let me pull up the briefing for you."*

Open the scenario card in the app. Let them read the persona and scene description.

> *"So you're [brief summary of their character]. I'll be playing [the other person]. Ready? Let's go."*

Start the session. Begin the conversation in character.

### During the Scenario (~60-90 sec)

- Stay in character as the confederate. Follow the confederate instructions for each scenario.
- **Do not draw attention to the agent's triggers.** Let the participant notice (or not notice) them naturally.
- If the mic isn't working, tell them: *"Just type what you'd say in the text box — the mic is being finicky."*
- Press Space to toggle speaker tag (P1/P2) when switching who's talking.

### After Each Scenario (~2 min)

End the session in the app. Then ask:

> *"OK, that's the end of that one. Let me ask you a few quick questions."*

Go through the 4 Likert ratings and 3 free-text prompts. For free-text, prompt them if they give vague answers:

- If they say "it was fine": *"Was there a specific moment where it helped or bothered you?"*
- If they say "nothing stood out": *"Did you notice any of the suggestions? What did you think of them?"*
- If they say "I don't know": *"That's totally fine — 'nothing useful happened' is a valid answer."*

Record their answers in the session notes or on a separate sheet.

### After All 5 Scenarios (~2 min)

> *"That's all 5 scenarios. Just two last questions:*
>
> *1. If you could only pick one scenario where the agent was most helpful, which would it be?*
>
> *2. If this existed on real smart glasses, would you actually want it? Why or why not?"*

Thank them. Save/download all session JSONs.

---

## Confederate Playbook

You (the researcher) play the other person in each scenario. Consistency matters — follow these guidelines:

### General Rules
- **Don't over-act.** Speak naturally, not dramatically. Participants mirror your energy.
- **Don't rush.** Give pauses between turns — the agent needs ~2-3 seconds of silence to process.
- **Don't ad-lib too much.** Stick to the confederate instructions. Small variations are fine, but don't introduce new topics or signals the agent wasn't designed to detect.
- **Don't react to the agent.** You can see the screen, but don't acknowledge triggers. If the participant asks "did you see that?", say *"Yeah, ignore me — just react however you would."*

### Per-Scenario Notes

| Scenario | Your Role | Key Behavior | Common Mistake to Avoid |
|---|---|---|---|
| S1: Meeting | Boss (Sarah) | Assign a task casually, move on without confirming | Don't repeat the task — the point is that they miss it |
| S2: Explaining | Coworker (Jordan) | Nod along, ask "can't we just push through?" | Don't pretend to understand — your confusion is the signal |
| S3: Emotional | Friend (Sam) | Start fine, gradually open up about stress | Don't dump everything at once — escalate slowly |
| S4: Netflix | Friend (Riley) | Chat enthusiastically about a show | Don't introduce any problems or serious topics |
| S5: Smalltalk | Acquaintance | Weather, weekend plans, keep it surface-level | Don't accidentally create a real topic worth discussing |

### Timing
- Each scenario should last **60-90 seconds** of conversation
- Don't end too early — give the agent at least 3-4 check cycles (at 15s intervals)
- Natural ending cues: "Well, I should get going" / "Anyway, good chat" / elevator arrives

---

## Consent Form Template

Adapt to your university's requirements:

> **Study Title:** Evaluating Proactive AI Assistance in Live Conversation
>
> **Researcher:** Matthew Taruno, Tsinghua University
>
> **Purpose:** This study evaluates an AI assistant that observes live conversations and offers real-time suggestions. You will participate in 5 short role-play conversations (~60-90 seconds each) while the AI runs in the background, then answer questions about your experience.
>
> **What you'll do:** Read a scenario description, have a brief conversation with the researcher, observe AI suggestions on a screen, and rate the AI's helpfulness afterward. Total time: ~25-30 minutes.
>
> **Recording:** With your permission, we will screen-record the browser session (no video of your face). The recording captures the AI's behavior for analysis and will not be published or shared. You may decline recording and still participate.
>
> **Risks:** Minimal. You will role-play fictional scenarios — no personal information is collected beyond your first name and your ratings/comments.
>
> **Data use:** Your responses will be anonymized (Participant 1, 2, etc.) in the thesis and any publications. Session recordings are deleted after the thesis defense.
>
> **Voluntary:** Participation is voluntary. You may stop at any time without consequence.
>
> **Consent:**
> - [ ] I agree to participate in this study
> - [ ] I agree to screen recording of my session (optional)
>
> Signature: _________________ Date: _________

---

## Pre-Study Checklist

Run through this before your first participant:

- [ ] Browser open to `localhost:5173`, Live Session tab active
- [ ] Mic permissions granted in Chrome (test with a few words)
- [ ] API key entered and working (run a quick test session)
- [ ] Screen recording software ready (QuickTime > File > New Screen Recording)
- [ ] All 5 scenario cards load correctly in User Study mode
- [ ] Session auto-save working (end a test session, check History)
- [ ] Consent forms printed or ready digitally
- [ ] Quiet room with minimal background noise
- [ ] Phone on silent
- [ ] Notepad ready for observer notes (things the JSON won't capture)

---

## Analysis Plan

### From Automated Benchmark (Part 1)
- **Task B accuracy table** -- per-scenario, per-model trigger precision/recall
- **Trigger timing analysis** -- distribution of timing deltas from ground truth
- **Task A goal inference** -- qualitative comparison of inferred vs ground truth goals
- **Model comparison** -- which model has best accuracy/false-positive tradeoff
- **Signal type analysis** -- which signal types are easier/harder to detect (e.g., factual errors vs emotional escalation)

### From Expert Scorecard (Part 2)
- **Per-trigger acceptance rate** -- % of triggers accepted vs edited vs rejected
- **Task A/B/C checkbox scores** -- % of binary fields checked, inter-rater agreement (Cohen's kappa)
- **Qualitative notes** -- recurring themes in per-trigger free-text

### From Live Role-Play (Part 3)
- **Mean helpfulness/timing/calibration ratings** across scenarios and participants
- **Calibration curve** -- do ratings decrease as expected across the gradient (S1 > S2 > S3 > S4 > S5)?
- **Qualitative themes** from free-text feedback (thematic coding)
- **False positive analysis** -- did the agent trigger inappropriately in S5 (weather)?

### Research Questions

| RQ | Question | Answered by |
|----|----------|-------------|
| RQ1 | Can an LLM detect when to proactively intervene in conversation? | Automated benchmark (Part 1): Task B precision/recall |
| RQ2 | Are the agent's outputs high quality on close inspection? | Expert scorecard (Part 2): per-trigger acceptance + checkbox scores |
| RQ3 | Are the interventions perceived as helpful in real-time? | Live role-play (Part 3): helpfulness + timing ratings |
| RQ4 | Can the agent infer the wearer's conversational goal? | Parts 1 + 2: Task A auto-eval + goal_plausible/goal_specific scores |
| RQ5 | Does the agent appropriately calibrate urgency across stakes? | Parts 1 + 3: proactive score RMSE + calibration ratings |

### Expected Findings
- Higher proactive scores should correlate with higher evaluator agreement on trigger appropriateness
- Goal inference (Task A) should improve recommendation relevance
- Live evaluation should reveal timing/latency issues not captured by offline scoring
- Negative scenarios should differentiate models on false-positive rate
- Signal types like `self_contradiction_recall` and `factual_error` should be easier to detect than `emotional_escalation` and `missed_connection_opportunity`

---

## Thesis Paper Structure

| Section | Content | Data source |
|---------|---------|-------------|
| 5.1 Automated Evaluation | Task A/B/C metrics across 17 scenarios, model comparison | Part 1: Automated benchmark |
| 5.2 Expert Annotation | Per-trigger quality scores, inter-rater agreement | Part 2: Expert scorecard (researcher + labmates) |
| 5.3 Live Evaluation | Helpfulness/timing/calibration ratings, calibration curve, qualitative themes | Part 3: Live role-play (10 participants) |
| 5.4 Discussion | What works, what doesn't, offline vs live perception gaps, signal type difficulty | All three parts |
