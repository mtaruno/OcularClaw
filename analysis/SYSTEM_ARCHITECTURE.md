# OcularClaw System Architecture

Use this as reference to recreate in Figma. Each box = a component, each arrow = data flow.

---

## High-Level Overview

```
+===========================================================================+
|                        OcularClaw System                                  |
|                                                                           |
|  "A proactive conversational AI agent for smart glasses"                  |
|                                                                           |
|   +-----------------+     +-------------------+     +-----------------+   |
|   | INPUT LAYER     | --> | PROCESSING LAYER  | --> | OUTPUT LAYER    |   |
|   |                 |     |                   |     |                 |   |
|   | - Microphone    |     | - Transcript Mgmt |     | - Visual HUD    |   |
|   | - Speech-to-    |     | - 3-Task Pipeline |     | - Recommendations|  |
|   |   Text          |     | - LLM Reasoning  |     | - Session Logs  |   |
|   +-----------------+     +-------------------+     +-----------------+   |
+===========================================================================+
```

---

## Core Pipeline: 3-Task Architecture (A -> B -> C)

```
+------------------------------------------------------------------+
|                  EVERY 15 SECONDS                                |
|                                                                  |
|  +-------------------+                                           |
|  | Rolling Transcript|   (last ~120s of conversation)            |
|  | Buffer            |                                           |
|  +--------+----------+                                           |
|           |                                                      |
|           v                                                      |
|  +--------+----------+                                           |
|  | TASK A:            |                                          |
|  | Goal Inference     |   "What is the wearer trying to do?"    |
|  |                    |                                          |
|  | Output:            |                                          |
|  |  - wearer_goal     |   e.g. "convince PM to delay launch"    |
|  |  - goal_type       |   e.g. "persuasion"                     |
|  |  - goal_confidence |   high / medium / low                   |
|  +--------+-----------+                                          |
|           |                                                      |
|           v                                                      |
|  +--------+-----------+                                          |
|  | TASK B:             |                                         |
|  | Intervention        |   "Should I speak up RIGHT NOW?"       |
|  | Decision            |                                         |
|  |                     |                                         |
|  | Output:             |                                         |
|  |  - action           |   none / recommend                     |
|  |  - proactive_score  |   1-5 (1=silent, 5=critical)           |
|  |  - signal_type      |   e.g. "comprehension_gap"             |
|  |  - reason           |   why now (or why not)                 |
|  +--------+------------+                                         |
|           |                                                      |
|      action = "recommend"?                                       |
|       /          \                                               |
|     NO            YES                                            |
|      |             |                                             |
|   (silent)         v                                             |
|            +-------+----------+                                  |
|            | TASK C:           |                                  |
|            | Recommendation    |   "What should they say/know?"  |
|            | Generation        |                                  |
|            |                   |                                  |
|            | Output:           |                                  |
|            |  - rec_1          |   concrete suggestion            |
|            |  - rec_2          |   alternative angle              |
|            |  - rec_mode       |   say / know / both             |
|            |  - urgency        |   low / medium / high           |
|            +------------------+                                  |
+------------------------------------------------------------------+
```

---

## Signal Type Taxonomy

```
+------------------------------------------------------------------+
|                     SIGNAL TYPES                                 |
|                                                                  |
|  HIGH STAKES (score 4-5)           MEDIUM (score 3)             |
|  +------------------------+        +------------------------+    |
|  | structural_gap         |        | emotional_escalation   |    |
|  | comprehension_gap      |        | idea_co_option         |    |
|  | high_stakes_decision   |        | missed_buying_signal   |    |
|  | premature_commitment   |        | missed_connection_opp  |    |
|  | self_contradiction     |        |                        |    |
|  | question_dodge         |        +------------------------+    |
|  | factual_error          |                                      |
|  +------------------------+        LOW / NONE (score 1-2)        |
|                                    +------------------------+    |
|                                    | information_enrichment |    |
|                                    | none                   |    |
|                                    +------------------------+    |
+------------------------------------------------------------------+
```

---

## Live Session Data Flow

```
+--------+    +-------------+    +------------------+    +---------+
| User   |    | Web Speech  |    | Transcript       |    | LLM     |
| (Mic)  |--->| Recognition |--->| Buffer           |--->| (GPT-   |
|        |    | API         |    | (rolling, P1/P2) |    | 4.1-    |
+--------+    +-------------+    +------------------+    | mini)   |
                                                         +----+----+
                                                              |
                                                              v
+--------+    +-------------+    +------------------+    +----+----+
| Session |<---| Post-Session|<---| Real-Time HUD   |<---| JSON    |
| JSON    |    | Survey      |    | (recommendations |    | Response|
| Export  |    | (Q1-Q7)     |    |  displayed live) |    |         |
+---------+   +-------------+    +------------------+    +---------+
```

---

## Automated Benchmark Data Flow

```
+-------------------+    +------------------+    +------------------+
| 17 Benchmark      |    | Scenario Replay  |    | Model Under Test |
| Scenarios         |--->| Engine           |--->| (any LLM)        |
| (JSON)            |    | (progressive     |    |                  |
|                   |    |  transcript feed)|    +--------+---------+
| - 11 positive     |    +------------------+             |
| - 6 negative      |                                     v
| - ground truth    |                          +----------+---------+
|   triggers        |                          | Per-Scenario       |
+-------------------+                          | Result JSON        |
                                               |                    |
                                               | - triggers fired   |
                                               | - timing deltas    |
                                               | - proactive scores |
                                               | - recommendations  |
                                               +----------+---------+
                                                          |
                                                          v
                                               +----------+---------+
                                               | Aggregate Metrics  |
                                               |                    |
                                               | - Precision/Recall |
                                               | - Timing accuracy  |
                                               | - Score calibration|
                                               | - Model comparison |
                                               +--------------------+
```

---

## 3-Part Evaluation Framework

```
+===========================================================================+
|                                                                           |
|  PART 1: Automated Benchmark          PART 2: Expert Scorecard           |
|  (Researcher only)                     (Researcher + Labmates)           |
|                                                                           |
|  +-----------------------------+      +-----------------------------+     |
|  | 17 scenarios x 7 models    |      | Per-trigger annotation      |     |
|  |                             |      |                             |     |
|  | Metrics:                    |      | 8 binary quality metrics:   |     |
|  |  - Task B precision/recall  |      |  - goal_plausible           |     |
|  |  - Trigger timing delta     |      |  - goal_specific            |     |
|  |  - Proactive score RMSE     |      |  - trigger_appropriate      |     |
|  |  - Goal accuracy            |      |  - interruption_worthy      |     |
|  |                             |      |  - useful_1, useful_2       |     |
|  | Answers: RQ1, RQ4, RQ5     |      |  - grounded, distinct_pair  |     |
|  +-----------------------------+      |                             |     |
|                                       | + Cohen's kappa (agreement) |     |
|                                       |                             |     |
|                                       | Answers: RQ2, RQ4           |     |
|                                       +-----------------------------+     |
|                                                                           |
|  PART 3: Live Role-Play                                                  |
|  (10 Participants)                                                       |
|                                                                           |
|  +------------------------------------------------------------+          |
|  | 5 scenarios per participant (calibration gradient)          |          |
|  |                                                             |          |
|  |  S1: Team Meeting          (proactive_score = 4)           |          |
|  |  S2: One-on-One Discussion (proactive_score = 4)           |          |
|  |  S3: Coffee with a Friend  (proactive_score = 3)           |          |
|  |  S4: Planning the Weekend  (proactive_score = 2)           |          |
|  |  S5: Elevator Small Talk   (proactive_score = 1)           |          |
|  |                                                             |          |
|  |  Post-session: 4 Likert + 3 free-text (per scenario)      |          |
|  |  Exit survey: frequency pref, best/worst scenario          |          |
|  |                                                             |          |
|  |  Answers: RQ3, RQ5                                         |          |
|  +------------------------------------------------------------+          |
|                                                                           |
+===========================================================================+
```

---

## Tech Stack Summary (for Figma diagram labels)

```
+-------------------+-------------------+-------------------+
| FRONTEND          | BACKEND / AGENT   | DATA              |
|                   |                   |                   |
| React 18          | Python 3          | localStorage      |
| Vite              | faster-whisper    | JSON exports      |
| Tailwind CSS      | Web Speech API    | CSV exports       |
| react-player      | OpenAI API        | benchmark-lab.json|
|                   | OpenRouter API    | Session JSONs     |
+-------------------+-------------------+-------------------+
```

---

## Figma Recreation Notes

**Color coding suggestion:**
- **Blue** = Input/data sources (mic, transcripts, scenarios)
- **Amber/Yellow** = Task A (Goal Inference)
- **Green** = Task B (Intervention Decision)
- **Purple** = Task C (Recommendation Generation)
- **Rose/Red** = Evaluation (metrics, surveys, annotation)
- **Slate/Gray** = Infrastructure (APIs, storage, UI)

**Layout suggestion:**
- Top row: System overview (input -> processing -> output)
- Middle row: 3-Task pipeline (the core contribution)
- Bottom row: 3-Part evaluation framework
- Side panel: Tech stack + signal taxonomy
