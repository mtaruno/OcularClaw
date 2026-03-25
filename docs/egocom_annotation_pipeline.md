# EgoCom Trigger Annotation Pipeline

This document standardizes how OcularClaw annotates 60-second EgoCom windows for
`V1` proactive recommendation moment detection.

The target task is:
- input: one 60-second conversation window
- output: `0..N` trigger moments inside that window
- for each trigger: two helpful recommendations

The recommendations may be:
- something the wearer should say
- something the wearer should know
- one of each

## Core Principle

The annotation unit is a `window`, but the prediction unit is a `trigger`.

That means:
- [egocom_annotation_windows_test_host.csv](/Users/matthewtaruno/Dev/OcularClaw/analysis/egocom_annotation_windows_test_host.csv) tracks whether a window has been reviewed and whether any trigger moments exist
- [egocom_trigger_annotations.csv](/Users/matthewtaruno/Dev/OcularClaw/analysis/egocom_trigger_annotations.csv) stores one row per trigger event

## Files

Source windows:
- [egocom_annotation_windows_test_host.csv](/Users/matthewtaruno/Dev/OcularClaw/analysis/egocom_annotation_windows_test_host.csv)

Transcript-enriched windows:
- [egocom_annotation_windows_test_host_enriched.csv](/Users/matthewtaruno/Dev/OcularClaw/analysis/egocom_annotation_windows_test_host_enriched.csv)

Trigger rows:
- [egocom_trigger_annotations.csv](/Users/matthewtaruno/Dev/OcularClaw/analysis/egocom_trigger_annotations.csv)

Prompt template:
- [egocom_trigger_annotation_prompt.md](/Users/matthewtaruno/Dev/OcularClaw/prompts/egocom_trigger_annotation_prompt.md)

## Step 1. Review the window

For each row in the enriched windows CSV:
1. Read `window_id`, `video_name`, `conversation_id`, `start_sec`, `end_sec`.
2. Read `transcript_text`.
3. Decide whether the window contains any moment where proactive assistance would be useful.

Update the window row with:
- `review_status`: `reviewed`
- `trigger_decision`: `no_trigger` or `has_triggers`
- `reviewer_notes`: optional short note

If there is no useful intervention moment, stop there.

## Step 2. Create trigger rows

If the window has trigger moments, add one row per trigger to the trigger CSV.

Required fields:
- `window_id`
- `conversation_id`
- `video_name`
- `start_sec`
- `end_sec`
- `trigger_id`
- `trigger_timestamp`
- `recommendation_mode`
- `recommendation_1`
- `recommendation_2`
- `urgency`
- `rationale`
- `annotation_status`

## Step 3. Decide whether a trigger should exist

A trigger should exist only if the intervention is:
- timely: it matters at that moment, not just somewhere in the minute
- useful: it would help the wearer act, decide, respond, or notice something important
- grounded: it is supported by the transcript and immediate context

Do not create triggers for:
- generic filler advice
- information already obvious or already stated clearly
- speculative business facts not grounded in the conversation
- repeated moments that say the same thing as a nearby trigger

## Step 4. Set the recommendation mode

Use:
- `say`: both recommendations are things the wearer could say next
- `know`: both recommendations are useful internal pointers for the wearer
- `both`: one recommendation is primarily for saying and the other is primarily for knowing, or the moment clearly supports both styles

## Step 5. Write the two recommendations

Each trigger must include exactly two recommendations.

Requirements:
- keep them short
- make them distinct
- keep them specific to the local context
- prefer actionable wording over vague coaching language

Good examples:
- `say`: "Ask whether they mean current revenue or projected revenue."
- `say`: "Follow up on the blocker they just mentioned."
- `know`: "The speaker shifted from a firm claim to a softer hedge."
- `know`: "This sounds like an action item; capture owner and deadline."

Bad examples:
- "Be more confident."
- "Say something useful."
- "This seems important."

## Step 6. AI-assisted workflow

Recommended workflow:
1. Feed one enriched window into the AI prompt.
2. Let the model produce structured JSON.
3. Review the proposed trigger set manually.
4. Copy accepted values into the window CSV and trigger CSV.
5. Mark `annotation_status` in the trigger row as `accepted`, `edited`, or `rejected`.

## Quality checks

Before accepting AI output:
- verify each `trigger_timestamp` falls inside the window
- verify the trigger is not duplicated nearby
- verify the two recommendations are not redundant
- verify the content is grounded in the transcript
- verify the mode matches the actual recommendation style

## Suggested status values

Window-level:
- `pending`
- `reviewed`
- `skipped`

Trigger-level:
- `proposed_by_ai`
- `accepted`
- `edited`
- `rejected`

## Minimum thesis-ready procedure

If time is limited, use this lightweight protocol:
1. Run the AI prompt over all windows.
2. Manually verify every proposed trigger.
3. Keep only reviewed windows in the pilot.
4. Report that annotations were AI-assisted and human-verified.

That is much more defensible than purely unreviewed prompting.
