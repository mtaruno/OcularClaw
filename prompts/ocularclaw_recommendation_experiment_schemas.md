# OcularClaw Recommendation Experiment Schemas

This note records the JSON structures used by the anchor-based experiment runner
in `scripts/run_ocularclaw_recommendation_experiment.py`.

The current benchmark compares recommendation quality at fixed trigger anchors
from the current pilot.

## Direct-2 From Anchors Output

```json
{
  "recommendation_mode": "both",
  "recommendation_1": "",
  "recommendation_2": "",
  "urgency": "low|medium|high",
  "rationale": ""
}
```

## Generate-5 Candidates Output

```json
{
  "candidates": [
    {
      "candidate_id": "c1",
      "mode": "say",
      "text": "",
      "rationale": "",
      "intended_benefit": ""
    }
  ]
}
```

## Review Workflow

Each method run writes:
- a trigger CSV compatible with the existing benchmark artifact schema
- a candidate CSV for ranking-oriented methods
- a review sheet CSV compatible with the existing manual rubric
- a raw JSONL trace for debugging and analysis

This keeps the comparison between `direct2_from_anchors` and
`generate5_from_anchors` inside the same reviewer workflow already used in the
thesis.
