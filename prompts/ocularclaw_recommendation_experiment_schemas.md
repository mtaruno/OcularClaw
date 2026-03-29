# OcularClaw Recommendation Experiment Schemas

This note records the JSON structure used by the minimum viable anchor-based
recommendation experiment runner in
`scripts/run_ocularclaw_recommendation_experiment.py`.

The active benchmark task is:
- take a reviewed trigger anchor
- construct only the local context available up to that trigger time
- generate exactly two recommendations for human review

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

## Review Workflow

Each run writes:
- a trigger CSV compatible with the existing benchmark artifact schema
- a review sheet CSV compatible with the existing manual rubric
- a raw JSONL trace for debugging and analysis

This keeps the benchmark focused on one clear question:
given a fixed trigger moment and only the context available up to that point,
can the method generate two useful, grounded, and non-redundant
recommendations?
