#!/usr/bin/env python3
"""Build pipeline-compatible CSV and JSON from scenario transcripts.

Reads analysis/live_scenarios/scenario_transcripts.json and outputs:
  - analysis/live_scenarios/scenario_windows.csv          (window format)
  - analysis/live_scenarios/scenario_triggers.csv          (trigger format)
  - analysis/live_scenarios/scenario_review_sheet.csv       (review sheet)
  - public/data/benchmark-lab-scenarios.json                (frontend JSON)

This makes the scenario benchmark compatible with:
  1. The batch recommendation pipeline (run_ocularclaw_recommendation_experiment.py)
  2. The React frontend review lab (App.jsx)
  3. The live proactive agent (run_live_proactive_agent.py) for role-play testing
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

# ── CSV field definitions (match existing pipeline) ──────────────────────────

WINDOW_FIELDS = [
    "window_id",
    "video_name",
    "conversation_id",
    "split",
    "start_sec",
    "end_sec",
    "duration_seconds",
    "window_word_count",
    "window_speaker_count",
    "speaker_ids_in_window",
    "background_fan",
    "background_music",
    "review_status",
    "trigger_decision",
    "reviewer_notes",
    "transcript_turn_count",
    "transcript_speaker_ids",
    "transcript_text",
]

TRIGGER_FIELDS = [
    "window_id",
    "conversation_id",
    "video_name",
    "start_sec",
    "end_sec",
    "trigger_id",
    "trigger_timestamp",
    "recommendation_mode",
    "recommendation_1",
    "recommendation_2",
    "urgency",
    "rationale",
    "annotation_status",
]

REVIEW_FIELDS = TRIGGER_FIELDS + [
    "review_decision",
    "useful_1",
    "useful_2",
    "grounded",
    "distinct_pair",
    "final_trigger_timestamp",
    "final_recommendation_mode",
    "final_recommendation_1",
    "final_recommendation_2",
    "final_urgency",
    "final_rationale",
    "review_notes",
]


def write_csv(path: Path, rows: list[dict], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    print(f"  wrote {len(rows)} rows → {path}")


def count_words(text: str) -> int:
    return len(text.split())


def extract_speakers(text: str) -> list[str]:
    import re
    return sorted(set(re.findall(r"(P\d+):", text)))


def count_turns(text: str) -> int:
    return len([line for line in text.strip().splitlines() if line.strip()])


def build_window_row(scenario: dict) -> dict:
    sid = scenario["id"]
    transcript = scenario["transcript_text"]
    speakers = extract_speakers(transcript)
    speaker_nums = " ".join(s.replace("P", "") for s in speakers)

    return {
        "window_id": f"scenario__{sid}__0000_{scenario['duration_seconds']:04d}",
        "video_name": f"scenario__{sid}",
        "conversation_id": f"scenario__{scenario['category']}__{sid}",
        "split": "scenario_test",
        "start_sec": "0",
        "end_sec": str(scenario["duration_seconds"]),
        "duration_seconds": str(scenario["duration_seconds"]),
        "window_word_count": str(count_words(transcript)),
        "window_speaker_count": str(len(speakers)),
        "speaker_ids_in_window": speaker_nums,
        "background_fan": "False",
        "background_music": "False",
        "review_status": "reviewed",
        "trigger_decision": "has_triggers" if scenario["triggers"] else "no_trigger",
        "reviewer_notes": f"Scenario: {scenario['title']}. Category: {scenario['category']}.",
        "transcript_turn_count": str(count_turns(transcript)),
        "transcript_speaker_ids": speaker_nums,
        "transcript_text": transcript,
    }


def build_trigger_rows(scenario: dict, window_row: dict) -> list[dict]:
    rows = []
    for trigger in scenario["triggers"]:
        rows.append({
            "window_id": window_row["window_id"],
            "conversation_id": window_row["conversation_id"],
            "video_name": window_row["video_name"],
            "start_sec": window_row["start_sec"],
            "end_sec": window_row["end_sec"],
            "trigger_id": trigger["trigger_id"],
            "trigger_timestamp": f"{trigger['trigger_timestamp']:.2f}",
            "recommendation_mode": trigger["recommendation_mode"],
            "recommendation_1": trigger.get("recommendation_1") or trigger.get("expected_recommendation", ""),
            "recommendation_2": trigger.get("recommendation_2", ""),
            "urgency": trigger["urgency"],
            "rationale": trigger["rationale"],
            "annotation_status": "ground_truth__scenario_benchmark",
        })
    return rows


def build_review_rows(trigger_rows: list[dict]) -> list[dict]:
    rows = []
    for row in trigger_rows:
        review = dict(row)
        review.update({
            "review_decision": "",
            "useful_1": "",
            "useful_2": "",
            "grounded": "",
            "distinct_pair": "",
            "final_trigger_timestamp": row["trigger_timestamp"],
            "final_recommendation_mode": row["recommendation_mode"],
            "final_recommendation_1": row["recommendation_1"],
            "final_recommendation_2": row["recommendation_2"],
            "final_urgency": row["urgency"],
            "final_rationale": row["rationale"],
            "review_notes": "",
        })
        rows.append(review)
    return rows


def build_benchmark_lab_json(scenarios: list[dict], window_rows: list[dict], trigger_rows: list[dict]) -> dict:
    """Build the frontend-compatible benchmark-lab JSON."""
    # Index triggers by window_id
    triggers_by_window: dict[str, list[dict]] = {}
    for tr in trigger_rows:
        triggers_by_window.setdefault(tr["window_id"], []).append(tr)

    windows = []
    for scenario, win_row in zip(scenarios, window_rows):
        win_triggers = triggers_by_window.get(win_row["window_id"], [])
        trigger_entries = []
        for tr in win_triggers:
            trigger_entries.append({
                "trigger_id": tr["trigger_id"],
                "trigger_timestamp": tr["trigger_timestamp"],
                "recommendation_mode": tr["recommendation_mode"],
                "recommendation_1": tr["recommendation_1"],
                "recommendation_2": tr["recommendation_2"],
                "urgency": tr["urgency"],
                "rationale": tr["rationale"],
                "annotation_status": tr["annotation_status"],
                "review_decision": "",
                "useful_1": "",
                "useful_2": "",
                "grounded": "",
                "distinct_pair": "",
            })

        windows.append({
            "window_id": win_row["window_id"],
            "video_name": win_row["video_name"],
            "conversation_id": win_row["conversation_id"],
            "split": win_row["split"],
            "start_sec": win_row["start_sec"],
            "end_sec": win_row["end_sec"],
            "duration_seconds": win_row["duration_seconds"],
            "window_word_count": win_row["window_word_count"],
            "window_speaker_count": win_row["window_speaker_count"],
            "speaker_ids_in_window": win_row["speaker_ids_in_window"],
            "background_fan": win_row["background_fan"],
            "background_music": win_row["background_music"],
            "review_status": win_row["review_status"],
            "trigger_decision": win_row["trigger_decision"],
            "reviewer_notes": win_row["reviewer_notes"],
            "transcript_turn_count": win_row["transcript_turn_count"],
            "transcript_speaker_ids": win_row["transcript_speaker_ids"],
            "transcript_text": win_row["transcript_text"],
            "context_intro": {
                "title": scenario["title"],
                "summary": f"Category: {scenario['category']}. {scenario['title']}.",
                "signals": [],
                "future_context": [],
            },
            "triggers": trigger_entries,
        })

    return {
        "default_method_id": "ground_truth__scenario_benchmark",
        "methods": [
            {
                "id": "ground_truth__scenario_benchmark",
                "label": "Scenario Benchmark (Ground Truth)",
                "windows": windows,
            }
        ],
    }


def main() -> None:
    src_path = REPO_ROOT / "analysis" / "live_scenarios" / "scenario_transcripts.json"
    if not src_path.exists():
        print(f"Error: {src_path} not found")
        return

    data = json.loads(src_path.read_text())
    scenarios = data["scenarios"]
    print(f"Loaded {len(scenarios)} scenarios")

    # Build rows
    window_rows = []
    all_trigger_rows = []
    for scenario in scenarios:
        win_row = build_window_row(scenario)
        window_rows.append(win_row)
        all_trigger_rows.extend(build_trigger_rows(scenario, win_row))

    review_rows = build_review_rows(all_trigger_rows)

    # Write CSVs
    out_dir = REPO_ROOT / "analysis" / "live_scenarios"
    write_csv(out_dir / "scenario_windows.csv", window_rows, WINDOW_FIELDS)
    write_csv(out_dir / "scenario_triggers.csv", all_trigger_rows, TRIGGER_FIELDS)
    write_csv(out_dir / "scenario_review_sheet.csv", review_rows, REVIEW_FIELDS)

    # Write frontend JSON
    lab_json = build_benchmark_lab_json(scenarios, window_rows, all_trigger_rows)
    lab_path = REPO_ROOT / "public" / "data" / "benchmark-lab-scenarios.json"
    lab_path.parent.mkdir(parents=True, exist_ok=True)
    lab_path.write_text(json.dumps(lab_json, indent=2))
    print(f"  wrote frontend JSON → {lab_path}")

    # Summary
    print()
    print("Scenario Benchmark Summary")
    print(f"  scenarios:  {len(scenarios)}")
    print(f"  windows:    {len(window_rows)}")
    print(f"  triggers:   {len(all_trigger_rows)}")
    print()
    print("Categories:")
    from collections import Counter
    cats = Counter(s["category"] for s in scenarios)
    for cat, count in cats.most_common():
        print(f"  {cat}: {count}")
    print()
    print("How to use:")
    print("  1. Batch eval:  python scripts/run_ocularclaw_recommendation_experiment.py \\")
    print(f"                    --input-windows {out_dir / 'scenario_windows.csv'} \\")
    print(f"                    --anchor-triggers {out_dir / 'scenario_triggers.csv'} \\")
    print("                    --output-dir analysis/scenario_runs/")
    print("  2. Live test:   python scripts/run_live_proactive_agent.py --duration 300")
    print("                  (role-play each scenario into your mic)")
    print("  3. Frontend:    npm run dev  →  load benchmark-lab-scenarios.json")


if __name__ == "__main__":
    main()
