# OcularClaw

OcularClaw is a research prototype for proactive AI assistance in live human
interaction.

The core contribution is an agentic pipeline that turns multimodal real-world
context into timely, useful recommendations during ongoing conversation. Rather
than treating assistance as a static chatbot problem, OcularClaw is designed for
situations where a user is listening, speaking, deciding, and reacting in real
time.

The pipeline is intended to consume:
- conversational context
- video stream
- audio stream
- accumulated task and memory context

And produce:
- well-timed trigger decisions
- concise recommendations for what the wearer should say
- useful internal pointers for what the wearer should know
- asynchronous artifact generation when slower support is appropriate

## Research Focus

The research goal is to study how an always-available agent can be useful inside
real human interactions such as meetings, negotiation, and collaborative work.

This means the main problem is not only generation quality. It is also:
- when the system should intervene
- what kind of help it should provide
- whether that help should be spoken, shown, or deferred
- how to ground recommendations in immediate multimodal context

## Core Idea

OcularClaw models assistance as a trigger-based agentic workflow:
1. ingest live context from transcript, audio, video, and system state
2. detect whether the current moment warrants intervention
3. decide whether the user needs something to `say`, something to `know`, or both
4. generate two compact recommendations for that moment
5. optionally route richer follow-up work into an asynchronous artifact lane

This is the motivation behind the project’s broader Laminar framing: low-latency
foreground assistance for the human conversation, plus slower background support
for higher-density artifacts.

## EgoCom Pilot Data Prep

This repo now includes a small utility for preparing annotation-ready 1-minute
conversation windows from the EgoCom dataset.

Script:
- `scripts/prepare_egocom_annotation_windows.py`

Example:

```bash
python3 scripts/prepare_egocom_annotation_windows.py \
  --video-info /Users/matthewtaruno/Dev/EgoCom-Dataset/egocom_dataset/video_info.csv \
  --transcripts /Users/matthewtaruno/Dev/EgoCom-Dataset/egocom_dataset/ground_truth_transcriptions.csv \
  --output analysis/egocom_annotation_windows_test_host.csv \
  --split test \
  --host-only \
  --require-three-speakers \
  --clean-only \
  --max-duration-seconds 350 \
  --window-seconds 60 \
  --stride-seconds 60 \
  --min-words 80 \
  --min-speakers-in-window 2
```

This produces one row per 60-second source window. Each window row is used to
decide whether the minute contains any intervention moments at all.

Window review fields:
- `review_status`
- `trigger_decision`
- `reviewer_notes`

To make annotation faster, enrich the window CSV with readable transcript turns and
generate a markdown workbook:

```bash
python3 scripts/enrich_egocom_annotation_windows.py \
  --input-windows analysis/egocom_annotation_windows_test_host.csv \
  --transcripts /Users/matthewtaruno/Dev/EgoCom-Dataset/egocom_dataset/ground_truth_transcriptions.csv \
  --output-csv analysis/egocom_annotation_windows_test_host_enriched.csv \
  --output-md analysis/egocom_annotation_workbook.md
```

The enriched CSV adds transcript text per window, and the workbook gives you a
single file to review without reopening the raw EgoCom transcript dump.

To annotate dynamic trigger moments, initialize a separate trigger-level CSV:

```bash
python3 scripts/initialize_egocom_trigger_annotations.py \
  --output analysis/egocom_trigger_annotations.csv
```

Each trigger row represents one intervention moment inside a window:
- `window_id`
- `trigger_timestamp`
- `recommendation_mode` (`say`, `know`, or `both`)
- `recommendation_1`
- `recommendation_2`
- `urgency`
- `rationale`
- `annotation_status`

Recommendation mode definitions:
- `say`: both recommendations are candidate utterances the wearer could say next
- `know`: both recommendations are internal pointers or situational information the wearer should know at that moment, even if they are not spoken aloud
- `both`: the pair mixes conversational and internal support, or the moment is best served by giving the wearer one thing to say and one thing to keep in mind

For AI-assisted annotation, use:
- `docs/egocom_annotation_pipeline.md`
- `prompts/egocom_trigger_annotation_prompt.md`
- `scripts/run_egocom_trigger_annotation.py`
- `scripts/prepare_trigger_review_sheet.py`
- `scripts/summarize_trigger_review.py`

Example draft-generation run:

```bash
python3 scripts/run_egocom_trigger_annotation.py \
  --input-windows analysis/egocom_annotation_windows_test_host_enriched.csv \
  --prompt-md prompts/egocom_trigger_annotation_prompt.md \
  --output-window-reviews analysis/egocom_annotation_windows_test_host_ai_proposed.csv \
  --output-triggers analysis/egocom_trigger_annotations_ai_proposed.csv \
  --output-jsonl analysis/egocom_trigger_annotation_raw.jsonl \
  --model "$OPENAI_MODEL" \
  --only-unreviewed \
  --json-mode
```

This script reads each enriched window, renders the standardized prompt, calls an
OpenAI-compatible chat endpoint, and writes draft outputs for manual review.

By default the script will load `/Users/matthewtaruno/Dev/OcularClaw/.env`, so you
can keep OpenRouter settings there:

```env
OPENAI_API_KEY=replace_with_your_openrouter_api_key
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_MODEL=openai/gpt-4.1-mini
```

To create a spreadsheet-style review sheet from the AI proposals:

```bash
python3 scripts/prepare_trigger_review_sheet.py \
  --input-triggers analysis/egocom_trigger_annotations_ai_proposed.csv \
  --output-review-sheet analysis/egocom_trigger_review_sheet.csv
```

Review the resulting CSV in Numbers, Excel, or Google Sheets. Fill:
- `review_decision` with `accepted`, `edited`, or `rejected`
- `useful_1`, `useful_2`, `grounded`, `distinct_pair` with `1` or `0`
- any `final_*` fields you want to correct

Then generate a thesis-ready markdown summary:

```bash
python3 scripts/summarize_trigger_review.py \
  --windows analysis/egocom_annotation_windows_test_host_ai_proposed.csv \
  --review-sheet analysis/egocom_trigger_review_sheet.csv \
  --output-md analysis/egocom_pilot_results_summary.md
```

There is also a Jupyter notebook for exploratory analysis:
- `notebooks/egocom_eda.ipynb`

## Recommendation Experiment

This repo now also includes an experiment runner for comparing recommendation
quality at fixed trigger anchors from the current pilot.

Design doc:
- `docs/ocularclaw_recommendation_pipeline.md`
- `prompts/ocularclaw_recommendation_experiment_schemas.md`

Runner:
- `scripts/run_ocularclaw_recommendation_experiment.py`

The comparison is:
- `direct2_from_anchors`: use the current-pilot trigger anchor, build local context up to that moment, and directly generate the final two recommendations
- `generate5_from_anchors`: use the same fixed trigger anchor, build local context up to that moment, and generate five candidates for human reranking

Dry-run the pipeline to inspect context slicing:

```bash
python3 scripts/run_ocularclaw_recommendation_experiment.py \
  --input-windows analysis/egocom_annotation_windows_test_host_enriched.csv \
  --output-dir analysis/experiment_runs \
  --limit 1 \
  --dry-run
```

Run the anchor-based experiment with an OpenAI-compatible endpoint:

```bash
python3 scripts/run_ocularclaw_recommendation_experiment.py \
  --input-windows analysis/egocom_annotation_windows_test_host_enriched.csv \
  --output-dir analysis/experiment_runs \
  --methods direct2_from_anchors,generate5_from_anchors \
  --candidate-count 5 \
  --context-seconds 20
```

Outputs are written per method:
- `*_window_reviews.csv`
- `*_triggers.csv`
- `*_candidates.csv` for candidate-generation methods
- `*_review_sheet.csv`
- `*_raw.jsonl`

That means you can review the direct baseline and the generate-5 candidate set
separately using the same manual rubric, while still relying on the current
pilot annotations internally as the trigger-anchor source.

## Benchmark Lab Frontend

This repo now includes a local React + Vite + Tailwind review app for benchmark
inspection and trigger scoring.

Core features:
- select a `window_id`
- see a transcript-derived context introduction for what is happening in the current window
- load or paste a video URL for the current window
- toggle between light and dark mode
- jump to trigger timestamps
- review transcript with trigger highlighting
- inspect AI recommendations and rationale
- mark `accepted`, `edited`, or `rejected`
- score `useful_1`, `useful_2`, `grounded`, and `distinct_pair`
- add your own recommendation comments at specific timestamps
- generate fresh AI recommendation drafts for the current window
- save progress into a local JSON export
- export a CSV matching `analysis/egocom_trigger_review_sheet.csv`

Build the frontend dataset:

```bash
npm run build:data
```

Start the app:

```bash
npm install
npm run dev
```

Then open the local Vite URL in your browser.

Frontend export workflow:
- use `Save & Next` while reviewing to keep local state in the browser
- use `Download Review CSV` to export a review sheet that matches `analysis/egocom_trigger_review_sheet.csv`
- run `scripts/summarize_trigger_review.py` on that exported CSV to generate thesis-ready summary metrics

Files:
- `src/App.jsx`
- `public/data/benchmark-lab.json`
- `public/data/video-manifest.json`
- `scripts/trim_egocom_window_videos.py`

Video handling:
- if you have a served video URL, paste it into the `Video URL` field
- if not, use `Load Local Video` to attach a local file during the session

Context introduction:
- the frontend now generates a transcript-derived introduction for each window so the reviewer has a quick sense of what is happening before scoring triggers
- this current intro is based on transcript content and turn structure, not full multimodal scene understanding
- later versions can incorporate second-brain factors such as prior-person memory, persistent conversational history, direct visual cues, and richer audio interaction signals

To create synced per-window clips automatically from EgoCom `5min_parts` videos:

```bash
python3 scripts/trim_egocom_window_videos.py \
  --windows analysis/egocom_annotation_windows_test_host_ai_proposed.csv \
  --source-dir /Users/matthewtaruno/Dev/EgoCom-Dataset/egocom/240p/5min_parts \
  --output-dir public/window-clips \
  --manifest-out public/data/video-manifest.json
```

This expects `ffmpeg` to be installed. The app will automatically prefer a
`window_id` clip from `video-manifest.json` when available.

Open it to inspect:
- dataset composition from `video_info.csv`
- transcript timing and speaker-switch dynamics
- the current 60-second annotation-window slice used by OcularClaw
