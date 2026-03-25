#!/usr/bin/env python3
"""Run AI-assisted trigger annotation over EgoCom window rows."""

import argparse
import csv
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


WINDOW_REVIEW_FIELDS = ["window_id", "review_status", "trigger_decision", "reviewer_notes"]
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

VALID_TRIGGER_DECISIONS = {"no_trigger", "has_triggers"}
VALID_RECOMMENDATION_MODES = {"say", "know", "both"}
VALID_REVIEW_STATUS = {"reviewed", "pending", "skipped"}


def load_env_file(path):
    env_path = Path(path)
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def load_csv(path):
    with open(path, newline="") as handle:
        return list(csv.DictReader(handle))


def write_csv(path, rows, fieldnames):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def extract_section(text, header):
    marker = f"## {header}"
    start = text.find(marker)
    if start == -1:
        raise ValueError(f"Could not find section {header!r} in prompt markdown")
    start = text.find("\n", start)
    next_header = text.find("\n## ", start + 1)
    end = len(text) if next_header == -1 else next_header
    return text[start:end].strip()


def extract_code_block(text):
    match = re.search(r"```(?:text|json)?\n(.*?)```", text, flags=re.DOTALL)
    if not match:
        raise ValueError("Could not find fenced code block in prompt template")
    return match.group(1).strip()


def load_prompt_parts(path):
    prompt_text = Path(path).read_text()
    system_instruction = extract_section(prompt_text, "System Instruction")
    user_template = extract_code_block(extract_section(prompt_text, "User Prompt Template"))
    return system_instruction, user_template


def render_user_prompt(template, row):
    rendered = template
    for key, value in row.items():
        rendered = rendered.replace(f"{{{{{key}}}}}", str(value))
    return rendered


def strip_code_fence(text):
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[a-zA-Z0-9_-]*\n", "", cleaned)
        cleaned = re.sub(r"\n```$", "", cleaned)
    return cleaned.strip()


def parse_json_response(text):
    cleaned = strip_code_fence(text)
    return json.loads(cleaned)


def validate_window_review(payload, source_row):
    if payload.get("window_id") != source_row["window_id"]:
        raise ValueError(
            f"window_id mismatch: expected {source_row['window_id']} got {payload.get('window_id')}"
        )

    review_status = payload.get("review_status", "reviewed")
    if review_status not in VALID_REVIEW_STATUS:
        raise ValueError(f"Invalid review_status: {review_status}")

    trigger_decision = payload.get("trigger_decision")
    if trigger_decision not in VALID_TRIGGER_DECISIONS:
        raise ValueError(f"Invalid trigger_decision: {trigger_decision}")

    reviewer_notes = payload.get("reviewer_notes", "")
    triggers = payload.get("triggers", [])
    if not isinstance(triggers, list):
        raise ValueError("Payload field 'triggers' must be a list")

    return {
        "window_id": source_row["window_id"],
        "review_status": review_status,
        "trigger_decision": trigger_decision,
        "reviewer_notes": reviewer_notes,
    }, triggers


def validate_trigger(trigger, source_row, trigger_index):
    trigger_id = str(trigger.get("trigger_id") or f"t{trigger_index}")
    mode = str(trigger.get("recommendation_mode", "")).strip().lower()
    if mode not in VALID_RECOMMENDATION_MODES:
        raise ValueError(f"Invalid recommendation_mode for {source_row['window_id']}: {mode}")

    timestamp = trigger.get("trigger_timestamp")
    try:
        timestamp_value = float(timestamp)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Invalid trigger_timestamp for {source_row['window_id']}: {timestamp}") from exc

    start_sec = float(source_row["start_sec"])
    end_sec = float(source_row["end_sec"])
    duration_seconds = end_sec - start_sec
    if not (start_sec <= timestamp_value <= end_sec):
        if 0.0 <= timestamp_value <= duration_seconds:
            timestamp_value = start_sec + timestamp_value
        else:
            raise ValueError(
                f"trigger_timestamp {timestamp_value} outside window {start_sec}-{end_sec} for {source_row['window_id']}"
            )
    if not (start_sec <= timestamp_value <= end_sec):
        raise ValueError(
            f"trigger_timestamp {timestamp_value} outside window {start_sec}-{end_sec} for {source_row['window_id']}"
        )

    recommendation_1 = str(trigger.get("recommendation_1", "")).strip()
    recommendation_2 = str(trigger.get("recommendation_2", "")).strip()
    if not recommendation_1 or not recommendation_2:
        raise ValueError(f"Missing recommendations for {source_row['window_id']} {trigger_id}")

    return {
        "window_id": source_row["window_id"],
        "conversation_id": source_row["conversation_id"],
        "video_name": source_row["video_name"],
        "start_sec": source_row["start_sec"],
        "end_sec": source_row["end_sec"],
        "trigger_id": trigger_id,
        "trigger_timestamp": f"{timestamp_value:.2f}",
        "recommendation_mode": mode,
        "recommendation_1": recommendation_1,
        "recommendation_2": recommendation_2,
        "urgency": str(trigger.get("urgency", "")).strip(),
        "rationale": str(trigger.get("rationale", "")).strip(),
        "annotation_status": str(trigger.get("annotation_status", "proposed_by_ai")).strip()
        or "proposed_by_ai",
    }


def build_request(base_url, api_key, model, system_prompt, user_prompt, temperature, json_mode):
    url = base_url.rstrip("/") + "/chat/completions"
    payload = {
        "model": model,
        "temperature": temperature,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    body = json.dumps(payload).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }
    return urllib.request.Request(url, data=body, headers=headers, method="POST")


def call_chat_completion(base_url, api_key, model, system_prompt, user_prompt, temperature, json_mode):
    request = build_request(
        base_url=base_url,
        api_key=api_key,
        model=model,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        temperature=temperature,
        json_mode=json_mode,
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return payload["choices"][0]["message"]["content"]


def filter_rows(rows, limit, only_unreviewed, window_ids):
    selected = rows
    if window_ids:
        wanted = {item.strip() for item in window_ids.split(",") if item.strip()}
        selected = [row for row in selected if row["window_id"] in wanted]
    if only_unreviewed:
        selected = [
            row
            for row in selected
            if not str(row.get("review_status", "")).strip()
            or str(row.get("review_status", "")).strip() == "pending"
        ]
    if limit is not None:
        selected = selected[:limit]
    return selected


def merge_window_reviews(source_rows, review_updates):
    review_by_window = {row["window_id"]: row for row in review_updates}
    merged = []
    for row in source_rows:
        updated = dict(row)
        if row["window_id"] in review_by_window:
            for field in WINDOW_REVIEW_FIELDS[1:]:
                updated[field] = review_by_window[row["window_id"]][field]
        merged.append(updated)
    return merged


def write_jsonl(path, objects):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as handle:
        for obj in objects:
            handle.write(json.dumps(obj, ensure_ascii=True) + "\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-windows", required=True)
    parser.add_argument("--prompt-md", required=True)
    parser.add_argument("--output-window-reviews", required=True)
    parser.add_argument("--output-triggers", required=True)
    parser.add_argument("--output-jsonl", required=True)
    parser.add_argument("--env-file")
    parser.add_argument("--model", required=False, default=os.environ.get("OPENAI_MODEL", "gpt-4.1"))
    parser.add_argument("--base-url", required=False, default=os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1"))
    parser.add_argument("--api-key-env", default="OPENAI_API_KEY")
    parser.add_argument("--temperature", type=float, default=0.2)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--only-unreviewed", action="store_true")
    parser.add_argument("--window-ids")
    parser.add_argument("--json-mode", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--sleep-seconds", type=float, default=0.0)
    args = parser.parse_args()

    default_env_file = Path(__file__).resolve().parents[1] / ".env"
    load_env_file(args.env_file or default_env_file)
    if args.model == "gpt-4.1" and os.environ.get("OPENAI_MODEL"):
        args.model = os.environ["OPENAI_MODEL"]
    if args.base_url == "https://api.openai.com/v1" and os.environ.get("OPENAI_BASE_URL"):
        args.base_url = os.environ["OPENAI_BASE_URL"]

    source_rows = load_csv(args.input_windows)
    selected_rows = filter_rows(
        rows=source_rows,
        limit=args.limit,
        only_unreviewed=args.only_unreviewed,
        window_ids=args.window_ids,
    )
    if not selected_rows:
        print("No windows selected", file=sys.stderr)
        return 1

    system_prompt, user_template = load_prompt_parts(args.prompt_md)

    api_key = os.environ.get(args.api_key_env)
    if not args.dry_run and not api_key:
        print(f"Missing API key in env var {args.api_key_env}", file=sys.stderr)
        return 2

    prompt_records = []
    review_updates = []
    trigger_rows = []
    raw_records = []

    for row in selected_rows:
        user_prompt = render_user_prompt(user_template, row)
        prompt_records.append({"window_id": row["window_id"], "user_prompt": user_prompt})
        if args.dry_run:
            raw_records.append(
                {
                    "window_id": row["window_id"],
                    "system_prompt": system_prompt,
                    "user_prompt": user_prompt,
                }
            )
            continue

        try:
            content = call_chat_completion(
                base_url=args.base_url,
                api_key=api_key,
                model=args.model,
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                temperature=args.temperature,
                json_mode=args.json_mode,
            )
            payload = parse_json_response(content)
            window_review, triggers = validate_window_review(payload, row)
            review_updates.append(window_review)
            for index, trigger in enumerate(triggers, start=1):
                trigger_rows.append(validate_trigger(trigger, row, index))
            raw_records.append(
                {
                    "window_id": row["window_id"],
                    "response_text": content,
                    "parsed_payload": payload,
                }
            )
        except (ValueError, json.JSONDecodeError, KeyError, urllib.error.URLError) as exc:
            raw_records.append(
                {
                    "window_id": row["window_id"],
                    "error": str(exc),
                }
            )

        if args.sleep_seconds:
            time.sleep(args.sleep_seconds)

    if args.dry_run:
        write_jsonl(Path(args.output_jsonl), raw_records)
        print(f"wrote {len(raw_records)} prompt records to {args.output_jsonl}")
        return 0

    merged_window_rows = merge_window_reviews(source_rows, review_updates)
    write_csv(Path(args.output_window_reviews), merged_window_rows, fieldnames=list(source_rows[0].keys()))
    write_csv(Path(args.output_triggers), trigger_rows, fieldnames=TRIGGER_FIELDS)
    write_jsonl(Path(args.output_jsonl), raw_records)

    print(f"processed {len(selected_rows)} windows")
    print(f"wrote window reviews to {args.output_window_reviews}")
    print(f"wrote {len(trigger_rows)} proposed trigger rows to {args.output_triggers}")
    print(f"wrote raw outputs to {args.output_jsonl}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
