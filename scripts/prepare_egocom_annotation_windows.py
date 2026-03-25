#!/usr/bin/env python3
"""Create annotation-ready 1-minute windows from EgoCom metadata and transcripts."""

import argparse
import csv
from collections import defaultdict
from pathlib import Path


def make_window_id(video_name, start_sec, end_sec):
    return f"{video_name}__{int(start_sec):04d}_{int(end_sec):04d}"


def load_video_rows(video_info_path):
    with open(video_info_path, newline="") as handle:
        return list(csv.DictReader(handle))


def load_transcripts(transcript_path):
    by_conversation = defaultdict(list)
    with open(transcript_path, newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            start = row.get("startTime", "").strip()
            speaker = row.get("speaker_id", "").strip()
            word = row.get("word", "").strip()
            if not start or not speaker or not word or word in {".", ",", "!", "?", ";", ":"}:
                continue
            try:
                start_time = float(start)
            except ValueError:
                continue
            by_conversation[row["conversation_id"]].append(
                {"start": start_time, "speaker_id": speaker, "word": word}
            )
    return by_conversation


def iter_windows(duration_seconds, window_seconds, stride_seconds):
    start = 0
    while start + window_seconds <= duration_seconds:
        yield start, start + window_seconds
        start += stride_seconds


def collect_candidates(args):
    video_rows = load_video_rows(args.video_info)
    transcripts = load_transcripts(args.transcripts)

    selected_videos = []
    for row in video_rows:
        if row.get(args.split) != "True":
            continue
        if args.host_only and row.get("speaker_is_host") != "True":
            continue
        if args.require_three_speakers and row.get("num_speakers") != "3":
            continue
        if args.clean_only and (
            row.get("background_fan") != "False" or row.get("background_music") != "False"
        ):
            continue
        duration_seconds = float(row["duration_seconds"])
        if duration_seconds < args.window_seconds or duration_seconds > args.max_duration_seconds:
            continue
        selected_videos.append(row)

    candidates = []
    for row in selected_videos:
        conversation_id = row["conversation_id"]
        transcript_rows = transcripts.get(conversation_id, [])
        if not transcript_rows:
            continue
        for start_sec, end_sec in iter_windows(
            int(float(row["duration_seconds"])), args.window_seconds, args.stride_seconds
        ):
            window_tokens = [
                token for token in transcript_rows if start_sec <= token["start"] < end_sec
            ]
            speakers = sorted({token["speaker_id"] for token in window_tokens})
            if len(window_tokens) < args.min_words or len(speakers) < args.min_speakers_in_window:
                continue
            candidates.append(
                {
                    "window_id": make_window_id(row["video_name"], start_sec, end_sec),
                    "video_name": row["video_name"],
                    "conversation_id": conversation_id,
                    "split": args.split,
                    "start_sec": start_sec,
                    "end_sec": end_sec,
                    "duration_seconds": args.window_seconds,
                    "window_word_count": len(window_tokens),
                    "window_speaker_count": len(speakers),
                    "speaker_ids_in_window": " ".join(speakers),
                    "background_fan": row["background_fan"],
                    "background_music": row["background_music"],
                    "review_status": "",
                    "trigger_decision": "",
                    "reviewer_notes": "",
                }
            )
    return candidates


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--video-info", required=True)
    parser.add_argument("--transcripts", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--split", default="test", choices=["train", "val", "test"])
    parser.add_argument("--window-seconds", type=int, default=60)
    parser.add_argument("--stride-seconds", type=int, default=60)
    parser.add_argument("--max-duration-seconds", type=int, default=350)
    parser.add_argument("--min-words", type=int, default=80)
    parser.add_argument("--min-speakers-in-window", type=int, default=2)
    parser.add_argument("--host-only", action="store_true")
    parser.add_argument("--require-three-speakers", action="store_true")
    parser.add_argument("--clean-only", action="store_true")
    args = parser.parse_args()

    candidates = collect_candidates(args)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", newline="") as handle:
        fieldnames = list(candidates[0].keys()) if candidates else []
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        if candidates:
            writer.writeheader()
            writer.writerows(candidates)

    print(f"wrote {len(candidates)} windows to {output_path}")


if __name__ == "__main__":
    main()
