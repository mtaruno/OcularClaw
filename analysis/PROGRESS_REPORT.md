# OcularClaw — Thesis Progress Report

**Author:** Matthew Taruno  
**Advisor:** Qinkai Zheng  
**Date:** April 14, 2026  

---

## Abstract

Always-on AI assistants in wearable devices like smart glasses face a decision that current benchmarks do not measure: *when to speak and when to stay silent* during live human conversation. Existing agent benchmarks evaluate task completion (AgentBench), activity anticipation (PARSE-Ego4D), or response generation quality (ProactiveBench), but none decompose real-time conversational assistance into its constituent decisions — trigger timing, recommendation quality, and interaction cost — as separately evaluable dimensions at the moment level.

We present OcularClaw, a benchmark and live agent system for proactive ambient assistance in egocentric conversation. We formulate proactive assistance as a three-stage pipeline: (A) *Goal Inference* — what is the wearer trying to accomplish? (B) *Intervention Decision* — should the agent intervene at this exact moment? (C) *Recommendation Generation* — what should the wearer say or know? This decomposition enables fine-grained diagnosis of where models succeed and fail.

Our benchmark introduces a *calibration gradient* — 5 scenarios spanning from high-stakes professional contexts (missed action items, comprehension gaps) to low-stakes social ones (casual TV chat, elevator small talk) — that tests whether models can modulate their behavior across social contexts. We evaluate 5 frontier LLMs and find that proactive assistance quality is partially independent of general model capability: models over-trigger by 2-5x on average, with distinct failure profiles ranging from excessive caution (GPT-4.1-mini: 0 triggers on a missed action item) to aggressive over-intervention (Claude Sonnet 4.5: triggering during small talk). Critically, no model matches the ground truth trigger distribution, suggesting that *social calibration* — knowing when help is welcome vs. intrusive — remains an unsolved capability for current LLMs.

---

## What Makes This Work Different

### The Gap We Fill

Most prior work on proactive AI assistance focuses on building better *systems*. We focus on building a better *evaluation* — and in doing so, we surface a capability axis that existing benchmarks miss entirely.

### Positioning Against Related Work

**Proactive Agent Systems (ProAgent, ContextAgent, LlamaPIE, EgoProceAssist):**  
These are deployed systems with specific architectures — ProAgent uses on-demand sensory contexts, ContextAgent achieves 89.3% proactive prediction accuracy via persona+sensor fusion, LlamaPIE explores dual-model architectures for in-ear delivery. OcularClaw is not a competing system but a *benchmark protocol* that any proactive system could be evaluated against. We define what "good proactive behavior" means and how to measure it — these systems currently lack a shared evaluation standard.

**Agent Benchmarks (AgentBench, PARSE-Ego4D, ProactiveBench):**  
AgentBench and SWE-Bench measure multi-step task completion. PARSE-Ego4D evaluates activity-level action anticipation ("what should the person do next?"). ProactiveBench tests whether models can generate proactive responses but treats all proactive moments equally. None of these decompose the problem into *trigger timing vs. recommendation quality vs. interaction cost* as separate human-reviewable dimensions. OcularClaw's unit of analysis is the *moment-level intervention decision* in free-form conversation — a fundamentally different grain size.

**Smart Glasses Benchmarks (SUPERGLASSES, VRA-Ego, EgoIntent, LifeEval):**  
These focus on visual understanding and procedural assistance. OcularClaw targets the *conversational* modality — detecting social and cognitive signals (comprehension gaps, emotional escalation, missed commitments) that are invisible to vision-only systems.

**Standard Dialogue Evaluation (BLEU, ROUGE, BERTScore):**  
These measure response quality in isolation. OcularClaw evaluates whether a response should have been delivered *at all*. A perfectly written recommendation at the wrong moment is a failure. Our evaluation framework captures this by separating "Is the recommendation good?" (Task C) from "Should it have been shown?" (Task B).

### Our Unique Contributions

1. **Benchmarking social calibration.** The 5-scenario gradient (scores 4→4→3→2→1) tests whether models understand social context well enough to modulate their behavior: intervene firmly during a work meeting, gently during emotional support, optionally during casual chat, and *never* during small talk. This tests a capability — social dynamics knowledge — that no existing benchmark isolates.

2. **Benchmarking restraint.** Most benchmarks reward action. Ours rewards correct *inaction*. A model that stays silent during elevator small talk (true negative) is performing well. A model that triggers during small talk (false positive) is penalized. This reframes the evaluation: trigger precision matters as much as recall.

3. **Pipeline decomposition for diagnosis.** By separating A→B→C, we can identify *where* a model fails. A model might infer the goal correctly (Task A) but misjudge the timing (Task B). Another might trigger at the right moment but produce generic recommendations (Task C). This diagnostic granularity is absent from prior proactive benchmarks.

---

## What's Built

### System (fully functional)

| Component | Status | Description |
|-----------|--------|-------------|
| **Live Proactive Agent** | Done | Browser-based: mic -> Web Speech API -> rolling transcript -> periodic LLM checks -> real-time recommendations |
| **3-Task Pipeline** | Done | Task A (Goal Inference) -> Task B (Intervention Decision) -> Task C (Recommendation Generation) |
| **Benchmark Lab** | Done | 5 user study + 17 EgoCom scenarios with ground truth, automated replay, no future context leakage |
| **User Study UI** | Done | Live role-play with speech recognition, session history, post-session survey |
| **Model Comparison** | Done | Cross-model benchmark across 5 frontier LLMs via proper replay pipeline |
| **Expert Scorecard** | Done | Per-trigger annotation (8 binary quality metrics), preference ranking, review progress dashboard |

### Evaluation Design (3-part)

| Part | What | Who | Status |
|------|------|-----|--------|
| **Part 1: Cross-Model Benchmark** | 5 scenarios x 5 models, trigger precision/recall, calibration analysis | Automated + researcher | **Complete** |
| **Part 2: Expert Scorecard** | Per-trigger quality annotation (8 metrics + inter-rater reliability) | Researcher + labmates | Ready |
| **Part 3: Live Role-Play** | 5 scenarios x 8-12 participants, post-session ratings + free-text | Participants | Ready |

---

## Key Results (Cross-Model Comparison)

All model outputs generated through the proper replay pipeline with 15-second check intervals. Each model only sees transcript up to the check timestamp — no future context leakage.

### Trigger Distribution Across Calibration Gradient

| Model | S1: Meeting (exp: trigger) | S2: Explaining (exp: trigger) | S3: Emotional (exp: gentle) | S4: Netflix (exp: low) | S5: Smalltalk (exp: silent) | Total |
|---|---|---|---|---|---|---|
| **Ground Truth** | 1 | 1 | 1 | 1 | 0 | **4** |
| GPT-4.1-mini | 0 | 6 | 3 | 0 | 0 | 9 |
| GPT-4o | 1 | 7 | 5 | 0 | 0 | 13 |
| Claude 3.5 Haiku | 3 | 7 | 7 | 0 | 0 | 17 |
| Claude Sonnet 4.5 | 6 | 7 | 5 | 1 | 1 | 20 |
| Gemini 2.5 Flash | 5 | 7 | 2 | 1 | 0 | 15 |

### Key Findings

**1. All models over-trigger.** Every model produces 2-5x more triggers than ground truth. The ground truth has 4 carefully placed interventions; the most aggressive model (Claude Sonnet 4.5) produces 20. This confirms that *restraint* is the harder capability — models default to helpfulness when the right answer is silence.

**2. Social calibration varies significantly.** On S5 (small talk where no trigger is appropriate), most models correctly stay silent — except Claude Sonnet 4.5, which produces a false positive. On S4 (casual Netflix chat, low-stakes), only Gemini and Sonnet trigger, which is debatable but reasonable. The gradient works: models differentiate high-stakes from low-stakes, but not precisely enough.

**3. GPT-4.1-mini is dangerously conservative on S1.** It completely misses the meeting scenario where the wearer is assigned a task they don't acknowledge — arguably the highest-value intervention in the benchmark. This is a recall failure that would matter in deployment.

**4. S2 (Comprehension Gap) is trivially easy.** Every model triggers on nearly every check — the "listener isn't understanding" signal is too obvious. This scenario may need redesign or serves as a ceiling test.

**5. Model ranking does not track general capability.** Claude 3.5 Haiku (a smaller model) produces more triggers than GPT-4o (a larger model), and Gemini 2.5 Flash shows the best restraint on S3 (emotional support) with only 2 triggers vs. Claude Haiku's 7. Proactive assistance is a partially independent capability axis.

---

## Research Questions

| RQ | Question | Data Source |
|----|----------|-------------|
| RQ1 | Can LLMs detect when to proactively intervene in live conversation? | Part 1: trigger precision/recall |
| RQ2 | Do models calibrate intervention urgency across social contexts? | Part 1: calibration gradient analysis |
| RQ3 | Are the agent's recommendations high quality on expert inspection? | Part 2: expert scorecard |
| RQ4 | Are interventions perceived as helpful in real-time interaction? | Part 3: participant ratings |
| RQ5 | Does goal inference (Task A) improve downstream recommendation quality? | Parts 1+2: A→B→C vs B→C ablation |
