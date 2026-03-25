#!/usr/bin/env python3
"""Create an empty dynamic trigger-annotation CSV for EgoCom windows."""

import argparse
import csv
from pathlib import Path


FIELDNAMES = [
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDNAMES)
        writer.writeheader()

    print(f"initialized trigger annotation CSV at {output_path}")


if __name__ == "__main__":
    main()
