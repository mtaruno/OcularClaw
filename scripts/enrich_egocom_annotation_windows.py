#!/usr/bin/env python3
"""Enrich EgoCom annotation windows with readable transcripts and a labeling workbook."""

import argparse
import csv
from collections import defaultdict
from pathlib import Path


PUNCTUATION = {".", ",", "!", "?", ";", ":", "%", ")", "]", "}", "..."}
JOIN_NEXT = {"'", "’"}
NO_SPACE_BEFORE = PUNCTUATION | JOIN_NEXT | {"n't", "'s", "'re", "'ve", "'ll", "'d", "'m"}


def make_window_id(video_name, start_sec, end_sec):
    return f"{video_name}__{int(float(start_sec)):04d}_{int(float(end_sec)):04d}"


def load_windows(path):
    with open(path, newline="") as handle:
        return list(csv.DictReader(handle))


def load_transcripts(path):
    by_conversation = defaultdict(list)
    with open(path, newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            start = row.get("startTime", "").strip()
            end = row.get("endTime", "").strip()
            word = row.get("word", "").strip()
            speaker_id = row.get("speaker_id", "").strip()
            conversation_id = row.get("conversation_id", "").strip()
            if not start or not end or not word or not speaker_id or not conversation_id:
                continue
            try:
                start_time = float(start)
                end_time = float(end)
            except ValueError:
                continue
            by_conversation[conversation_id].append(
                {
                    "start": start_time,
                    "end": end_time,
                    "speaker_id": speaker_id,
                    "word": word,
                }
            )
    return by_conversation


def format_seconds(value):
    minutes = int(value // 60)
    seconds = value - (minutes * 60)
    return f"{minutes:02d}:{seconds:05.2f}"


def render_words(words):
    text = ""
    join_next = False
    for word in words:
        if not text:
            text = word
            join_next = word in JOIN_NEXT
            continue
        if join_next or word in NO_SPACE_BEFORE:
            text += word
        else:
            text += " " + word
        join_next = word in JOIN_NEXT
    return text


def build_turns(tokens):
    turns = []
    current = None
    for token in tokens:
        if current and current["speaker_id"] == token["speaker_id"]:
            current["words"].append(token["word"])
            current["end"] = token["end"]
            continue
        if current:
            turns.append(current)
        current = {
            "speaker_id": token["speaker_id"],
            "start": token["start"],
            "end": token["end"],
            "words": [token["word"]],
        }
    if current:
        turns.append(current)
    return turns


def render_turns(turns):
    rendered = []
    for turn in turns:
        line = (
            f"[{format_seconds(turn['start'])}] "
            f"P{turn['speaker_id']}: {render_words(turn['words'])}"
        )
        rendered.append(line)
    return "\n".join(rendered)


def window_tokens(transcripts, conversation_id, start_sec, end_sec):
    tokens = [
        token
        for token in transcripts.get(conversation_id, [])
        if start_sec <= token["start"] < end_sec
    ]
    tokens.sort(key=lambda token: (token["start"], token["speaker_id"]))
    return tokens


def enrich_rows(rows, transcripts):
    enriched = []
    for row in rows:
        start_sec = float(row["start_sec"])
        end_sec = float(row["end_sec"])
        tokens = window_tokens(transcripts, row["conversation_id"], start_sec, end_sec)
        turns = build_turns(tokens)
        transcript_text = render_turns(turns)
        unique_speakers = sorted({token["speaker_id"] for token in tokens})
        enriched_row = dict(row)
        enriched_row["window_id"] = row.get("window_id") or make_window_id(
            row["video_name"], row["start_sec"], row["end_sec"]
        )
        enriched_row["transcript_turn_count"] = str(len(turns))
        enriched_row["transcript_speaker_ids"] = " ".join(unique_speakers)
        enriched_row["transcript_text"] = transcript_text
        enriched.append(enriched_row)
    return enriched


def write_csv(rows, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="") as handle:
        fieldnames = list(rows[0].keys()) if rows else []
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        if rows:
            writer.writeheader()
            writer.writerows(rows)


def write_workbook(rows, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# EgoCom Annotation Workbook",
        "",
        "Review each 60-second window, then record zero or more trigger events in",
        "`analysis/egocom_trigger_annotations.csv`.",
        "",
        "Window review fields:",
        "- `review_status`: `pending`, `reviewed`, or `skipped`",
        "- `trigger_decision`: `no_trigger` or `has_triggers`",
        "- `reviewer_notes`",
        "",
        "Trigger row format in `egocom_trigger_annotations.csv`:",
        "- `window_id`",
        "- `trigger_id`",
        "- `trigger_timestamp`",
        "- `recommendation_mode`: `say`, `know`, or `both`",
        "- `recommendation_1`",
        "- `recommendation_2`",
        "- `urgency`",
        "- `rationale`",
        "- `annotation_status`",
        "",
    ]
    for index, row in enumerate(rows, start=1):
        lines.extend(
            [
                f"## Window {index}",
                "",
                f"- `window_id`: {row['window_id']}",
                f"- `video_name`: {row['video_name']}",
                f"- `conversation_id`: {row['conversation_id']}",
                f"- `time_range`: {int(float(row['start_sec']))}-{int(float(row['end_sec']))}s",
                f"- `word_count`: {row['window_word_count']}",
                f"- `speaker_ids`: {row['speaker_ids_in_window']}",
                "",
                "Window review template:",
                f"- `review_status`: {row.get('review_status', '')}",
                f"- `trigger_decision`: {row.get('trigger_decision', '')}",
                f"- `reviewer_notes`: {row.get('reviewer_notes', '')}",
                "",
                "Trigger template:",
                "- Repeat this block zero or more times in `egocom_trigger_annotations.csv`.",
                f"- `window_id`: {row['window_id']}",
                "- `trigger_id`: ",
                "- `trigger_timestamp`: ",
                "- `recommendation_mode`: ",
                "- `recommendation_1`: ",
                "- `recommendation_2`: ",
                "- `urgency`: ",
                "- `rationale`: ",
                "- `annotation_status`: ",
                "",
                "Transcript:",
                "",
                "```text",
                row["transcript_text"],
                "```",
                "",
            ]
        )
    path.write_text("\n".join(lines))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-windows", required=True)
    parser.add_argument("--transcripts", required=True)
    parser.add_argument("--output-csv", required=True)
    parser.add_argument("--output-md", required=True)
    args = parser.parse_args()

    windows = load_windows(args.input_windows)
    transcripts = load_transcripts(args.transcripts)
    enriched_rows = enrich_rows(windows, transcripts)
    write_csv(enriched_rows, Path(args.output_csv))
    write_workbook(enriched_rows, Path(args.output_md))

    print(f"wrote {len(enriched_rows)} enriched rows to {args.output_csv}")
    print(f"wrote workbook to {args.output_md}")


if __name__ == "__main__":
    main()
