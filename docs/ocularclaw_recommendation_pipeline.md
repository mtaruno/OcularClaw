#r OcularClaw Recommendation Pipeline


## Goal

Given an egocentric conversational window, OcularClaw should:

1. identify whether intervention-worthy trigger moments exist,
2. construct only the context available up to each candidate moment,
3. generate multiple candidate recommendations for the wearer,
4. rerank those candidates for usefulness and grounding,
5. return the best final pair or suppress the trigger if it is not worth surfacing.

The core design principle is that recommendation quality is not a one-shot text
generation problem. It is a staged decision problem over timing, context,
candidate quality, and final selection.

## Pipeline Stages

### Stage 1: Context Construction

Input at time `t`:
- transcript history up to `t`
- speaker turns
- recent conversational dynamics
- optional visual signals later
- optional memory signals later

Important rule:
- no future leakage
- the model should never see transcript content after the candidate trigger time

### Stage 2: Trigger Proposal

The system first proposes candidate trigger moments rather than final
recommendations.

For each window:
- generate up to `K` candidate timestamps
- include a `no_trigger` option

Candidate signals include:
- ambiguity or unclear reference
- unanswered question or weak follow-up
- hesitation or stalled response
- topic transition
- disagreement or repair
- decision point
- action-item opportunity

Each trigger proposal contains:
- candidate timestamp
- short reason
- confidence

### Stage 3: Context-Sliced Packaging

For each candidate trigger at time `t_i`, the pipeline builds a local context
packet using only context available before `t_i`.

The current packet includes:
- recent transcript slice before `t_i`
- recent speakers
- inferred wearer identity
- last speaker
- local question/transition signals

This improves on whole-window prompting because it reduces future leakage and
weak timestamp choices.

### Stage 4: Candidate Recommendation Generation

For each candidate trigger:
- generate `N` recommendation candidates instead of directly emitting the final pair

Each candidate contains:
- mode: `say`, `know`, or `both`
- text
- rationale
- intended benefit

Prompt constraints:
- help the wearer, not the group in the abstract
- stay grounded in available context
- do not use future information
- avoid generic coaching
- remain actionable and specific

### Stage 5: Reranking and Pair Selection

Each candidate is scored on:
- usefulness
- groundedness
- wearer-centricity
- timeliness
- interruption-worthiness
- specificity

Candidate pairs are scored on:
- distinctness
- complementarity

The final pair should have:
- high individual quality
- low redundancy
- a sensible mode mix

### Stage 6: Trigger Filtering

Before final output, reject or suppress triggers if:
- both recommendations are too generic
- they are grounded but too obvious
- the moment is not worth interrupting for
- the recommendation helps the wrong participant
- the timestamp is weak relative to nearby candidates

## Manual Review as Supervision

The current manual review sheet already exposes useful failure categories:
- wrong wearer perspective
- future leakage
- weak timing
- obvious or low-value recommendations
- interruption not worth it
- redundant recommendation pairs

These become explicit optimization targets for the recommendation pipeline.

## Experimental Comparison

The first method comparison should be:

### Baseline: `direct2_from_anchors`
- use a fixed trigger anchor from the current pilot
- build local context up to that trigger moment
- directly generate the final two recommendations

## Metrics

Use the existing review rubric:
- `review_decision`
- `useful_1`
- `useful_2`
- `grounded`
- `distinct_pair`

Derived comparison metrics:
- acceptance rate
- any useful percentage
- both useful percentage
- grounded percentage
- distinct-pair percentage

## Thesis Framing

This minimum viable pipeline supports a cleaner thesis claim:

OcularClaw is an anchor-based recommendation-generation benchmark that tests
whether a model can produce two grounded and useful recommendations from
context available only up to a fixed trigger moment.
