#!/usr/bin/env python3
"""Trim EgoCom source videos into per-window clips for the benchmark lab."""

import argparse
import csv
import json
import shutil
import subprocess
from pathlib import Path


def load_windows(path):
    with open(path, newline="") as handle:
        return list(csv.DictReader(handle))


def find_source_video(source_dir, video_name):
    for candidate in (
        source_dir / f"{video_name}.MP4",
        source_dir / f"{video_name}.mp4",
        source_dir / f"{video_name}.MOV",
        source_dir / f"{video_name}.mov",
    ):
        if candidate.exists():
            return candidate
    return None


def trim_clip(ffmpeg_bin, source_path, start_sec, duration_sec, output_path):
    output_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        ffmpeg_bin,
        "-y",
        "-ss",
        str(start_sec),
        "-i",
        str(source_path),
        "-t",
        str(duration_sec),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        str(output_path),
    ]
    subprocess.run(cmd, check=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--windows", required=True)
    parser.add_argument("--source-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--manifest-out", required=True)
    parser.add_argument("--ffmpeg-bin", default="ffmpeg")
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()

    ffmpeg_path = shutil.which(args.ffmpeg_bin)
    if not ffmpeg_path:
        raise SystemExit(
            "ffmpeg is required but was not found. Install ffmpeg or pass --ffmpeg-bin."
        )

    windows = load_windows(args.windows)
    if args.limit is not None:
        windows = windows[: args.limit]

    source_dir = Path(args.source_dir)
    output_dir = Path(args.output_dir)
    manifest_out = Path(args.manifest_out)

    manifest = {}
    missing_sources = []
    trimmed_count = 0

    for row in windows:
        source_path = find_source_video(source_dir, row["video_name"])
        if not source_path:
            missing_sources.append(row["video_name"])
            continue

        start_sec = float(row["start_sec"])
        end_sec = float(row["end_sec"])
        duration_sec = end_sec - start_sec
        output_path = output_dir / f"{row['window_id']}.mp4"

        trim_clip(
            ffmpeg_bin=ffmpeg_path,
            source_path=source_path,
            start_sec=start_sec,
            duration_sec=duration_sec,
            output_path=output_path,
        )
        manifest[row["window_id"]] = f"/window-clips/{output_path.name}"
        trimmed_count += 1

    manifest_out.parent.mkdir(parents=True, exist_ok=True)
    manifest_out.write_text(json.dumps(manifest, indent=2))

    print(f"trimmed {trimmed_count} window clips")
    print(f"wrote manifest to {manifest_out}")
    if missing_sources:
        unique_missing = sorted(set(missing_sources))
        print(f"missing source videos for {len(unique_missing)} video_names")
        for item in unique_missing:
            print(f"missing: {item}")


if __name__ == "__main__":
    main()
