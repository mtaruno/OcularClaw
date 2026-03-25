#!/usr/bin/env python3
"""Summarize reviewed EgoCom trigger annotations into thesis-ready tables."""

import argparse
import csv
from collections import Counter, defaultdict
from pathlib import Path


def load_csv(path):
    with open(path, newline="") as handle:
        return list(csv.DictReader(handle))


def safe_pct(num, den):
    if not den:
        return 0.0
    return 100.0 * num / den


def accepted_review_rows(rows):
    return [row for row in rows if row.get("review_decision", "").strip().lower() in {"accepted", "edited"}]


def build_corpus_summary(window_rows, review_rows):
    accepted_rows = accepted_review_rows(review_rows)
    accepted_by_window = defaultdict(list)
    for row in accepted_rows:
        accepted_by_window[row["window_id"]].append(row)

    reviewed_windows = len(window_rows)
    windows_with_triggers = sum(1 for row in window_rows if accepted_by_window[row["window_id"]])
    windows_no_trigger = reviewed_windows - windows_with_triggers
    total_triggers = len(accepted_rows)
    avg_triggers = total_triggers / windows_with_triggers if windows_with_triggers else 0.0

    mode_counter = Counter(
        (row.get("final_recommendation_mode") or row.get("recommendation_mode") or "").strip().lower()
        for row in accepted_rows
    )

    return [
        ("Windows reviewed", reviewed_windows),
        ("Windows with triggers", windows_with_triggers),
        ("Windows with no trigger", windows_no_trigger),
        ("Total accepted triggers", total_triggers),
        ("Avg triggers per triggered window", f"{avg_triggers:.2f}"),
        ("say triggers", mode_counter.get("say", 0)),
        ("know triggers", mode_counter.get("know", 0)),
        ("both triggers", mode_counter.get("both", 0)),
    ]


def build_recommendation_quality(review_rows):
    accepted_rows = accepted_review_rows(review_rows)
    matched = len(accepted_rows)
    useful_any = 0
    useful_both = 0
    grounded = 0
    distinct = 0

    for row in accepted_rows:
        useful_1 = str(row.get("useful_1", "")).strip()
        useful_2 = str(row.get("useful_2", "")).strip()
        grounded_flag = str(row.get("grounded", "")).strip()
        distinct_flag = str(row.get("distinct_pair", "")).strip()

        u1 = useful_1 == "1"
        u2 = useful_2 == "1"
        g = grounded_flag == "1"
        d = distinct_flag == "1"

        if u1 or u2:
            useful_any += 1
        if u1 and u2:
            useful_both += 1
        if g:
            grounded += 1
        if d:
            distinct += 1

    return {
        "Matched triggers": matched,
        "Any useful %": f"{safe_pct(useful_any, matched):.1f}",
        "Both useful %": f"{safe_pct(useful_both, matched):.1f}",
        "Grounded %": f"{safe_pct(grounded, matched):.1f}",
        "Distinct pair %": f"{safe_pct(distinct, matched):.1f}",
    }


def format_markdown_table(headers, rows):
    lines = []
    lines.append("| " + " | ".join(headers) + " |")
    lines.append("| " + " | ".join(["---"] * len(headers)) + " |")
    for row in rows:
        lines.append("| " + " | ".join(str(cell) for cell in row) + " |")
    return "\n".join(lines)


def write_summary(path, corpus_rows, quality_metrics):
    lines = [
        "# EgoCom Pilot Results Summary",
        "",
        "## Table 1. Corpus Summary",
        "",
        format_markdown_table(["Metric", "Value"], corpus_rows),
        "",
        "## Table 2. Recommendation Quality",
        "",
        format_markdown_table(
            ["Metric", "Value"],
            [(key, value) for key, value in quality_metrics.items()],
        ),
        "",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--windows", required=True)
    parser.add_argument("--review-sheet", required=True)
    parser.add_argument("--output-md", required=True)
    args = parser.parse_args()

    window_rows = load_csv(args.windows)
    review_rows = load_csv(args.review_sheet)

    corpus_rows = build_corpus_summary(window_rows, review_rows)
    quality_metrics = build_recommendation_quality(review_rows)
    write_summary(Path(args.output_md), corpus_rows, quality_metrics)

    print(f"wrote results summary to {args.output_md}")


if __name__ == "__main__":
    main()
