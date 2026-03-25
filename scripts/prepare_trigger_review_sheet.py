#!/usr/bin/env python3
"""Create a manual review sheet from AI-proposed EgoCom trigger rows."""

import argparse
import csv
from pathlib import Path


REVIEW_FIELDS = [
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


def load_csv(path):
    with open(path, newline="") as handle:
        return list(csv.DictReader(handle))


def build_review_rows(rows):
    review_rows = []
    for row in rows:
        review_rows.append(
            {
                "window_id": row["window_id"],
                "conversation_id": row["conversation_id"],
                "video_name": row["video_name"],
                "start_sec": row["start_sec"],
                "end_sec": row["end_sec"],
                "trigger_id": row["trigger_id"],
                "trigger_timestamp": row["trigger_timestamp"],
                "recommendation_mode": row["recommendation_mode"],
                "recommendation_1": row["recommendation_1"],
                "recommendation_2": row["recommendation_2"],
                "urgency": row["urgency"],
                "rationale": row["rationale"],
                "annotation_status": row["annotation_status"],
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
            }
        )
    return review_rows


def write_csv(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=REVIEW_FIELDS)
        writer.writeheader()
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-triggers", required=True)
    parser.add_argument("--output-review-sheet", required=True)
    args = parser.parse_args()

    rows = load_csv(args.input_triggers)
    review_rows = build_review_rows(rows)
    write_csv(Path(args.output_review_sheet), review_rows)
    print(f"wrote {len(review_rows)} review rows to {args.output_review_sheet}")


if __name__ == "__main__":
    main()
