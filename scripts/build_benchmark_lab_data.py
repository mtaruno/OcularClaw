#!/usr/bin/env python3
"""Build a frontend-friendly JSON bundle for the benchmark lab app."""

import csv
import json
import re
from pathlib import Path


def load_csv(path):
    with open(path, newline="") as handle:
        return list(csv.DictReader(handle))


def parse_transcript_lines(transcript_text):
    lines = []
    for raw_line in transcript_text.splitlines():
        raw_line = raw_line.strip()
        if not raw_line:
            continue
        match = re.match(r"^\[(\d+):(\d+\.\d+)\]\s+(P\d+):\s+(.*)$", raw_line)
        if match:
            minutes = int(match.group(1))
            seconds = float(match.group(2))
            lines.append(
                {
                    "seconds": minutes * 60 + seconds,
                    "speaker": match.group(3),
                    "text": match.group(4),
                }
            )
        else:
            lines.append({"seconds": None, "speaker": None, "text": raw_line})
    return lines


def infer_activity_label(text_blob):
    lowered = text_blob.lower()
    keyword_map = [
        ("describe", "a description task"),
        ("color", "an object-description exchange"),
        ("fruit", "a casual object and food discussion"),
        ("favorite", "a personal preference discussion"),
        ("game", "a lightweight game or prompt exercise"),
        ("question", "a guided question-and-answer prompt"),
        ("wearing", "a shared-observation icebreaker"),
    ]
    for keyword, label in keyword_map:
        if keyword in lowered:
            return label
    return "an open-ended conversational exchange"


def build_context_intro(window_row):
    transcript_lines = parse_transcript_lines(window_row.get("transcript_text", ""))
    if not transcript_lines:
        return {
            "title": "Transcript-Derived Context Intro",
            "summary": "No transcript context is available for this window.",
            "signals": [],
            "future_context": [],
        }

    speakers = []
    seen = set()
    for line in transcript_lines:
        speaker = line.get("speaker")
        if speaker and speaker not in seen:
            seen.add(speaker)
            speakers.append(speaker)

    opening_excerpt = " ".join(line["text"] for line in transcript_lines[:3] if line.get("text"))
    opening_excerpt = opening_excerpt[:220].rstrip()
    activity_label = infer_activity_label(" ".join(line["text"] for line in transcript_lines[:8]))
    trigger_density = window_row.get("trigger_decision", "")

    summary = (
        f"This window shows {activity_label} involving {', '.join(speakers) or 'multiple speakers'}. "
        f"The opening exchange suggests that the group is working through a shared conversational prompt rather than sitting in silence. "
        f"Early transcript cues include: \"{opening_excerpt}\""
    )

    signals = [
        "Current context is derived from transcript timing, speaker turns, and AI-proposed trigger moments.",
        "This intro is transcript-based only; it does not yet incorporate direct visual scene understanding.",
    ]
    if trigger_density == "has_triggers":
        signals.append(
            "The current pilot labels this window as containing at least one plausible assistance moment."
        )
    elif trigger_density == "no_trigger":
        signals.append(
            "The current pilot labels this window as having no strong trigger moment."
        )

    future_context = [
        "Prior relationship memory: who the wearer has spoken with before and what topics have recurred.",
        "Second-brain memory: persistent notes, prior action items, and historical conversational context.",
        "Visual cues: scene changes, gestures, shared objects, and gaze-relevant evidence from the video stream.",
        "Audio cues beyond transcript text: interruptions, hesitation, emphasis, and turn-taking pressure.",
    ]

    return {
        "title": "Transcript-Derived Context Intro",
        "summary": summary,
        "signals": signals,
        "future_context": future_context,
    }


def main():
    repo_root = Path(__file__).resolve().parents[1]
    windows_path = repo_root / "analysis" / "egocom_annotation_windows_test_host_ai_proposed.csv"
    triggers_path = repo_root / "analysis" / "egocom_trigger_annotations_ai_proposed.csv"
    review_path = repo_root / "analysis" / "egocom_trigger_review_sheet.csv"
    output_path = repo_root / "public" / "data" / "benchmark-lab.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)

    windows = load_csv(windows_path)
    triggers = load_csv(triggers_path)
    review_rows = load_csv(review_path)
    review_by_key = {
        f"{row['window_id']}::{row['trigger_id']}": row
        for row in review_rows
    }

    grouped = {}
    for window_row in windows:
        grouped[window_row["window_id"]] = {
            **window_row,
            "context_intro": build_context_intro(window_row),
            "triggers": [],
        }

    for trigger_row in triggers:
        key = f"{trigger_row['window_id']}::{trigger_row['trigger_id']}"
        review = review_by_key.get(key, {})
        grouped[trigger_row["window_id"]]["triggers"].append({**trigger_row, **review})

    payload = {
        "windows": list(grouped.values()),
    }
    output_path.write_text(json.dumps(payload, indent=2))
    print(f"wrote benchmark lab dataset to {output_path}")


if __name__ == "__main__":
    main()
