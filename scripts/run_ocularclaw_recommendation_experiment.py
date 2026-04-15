#!/usr/bin/env python3
"""Run anchor-based OcularClaw recommendation experiments over EgoCom windows.

This script creates experiment-ready outputs that fit the existing review workflow:
- method-specific window review CSVs
- method-specific trigger CSVs
- candidate CSVs for ranking-oriented methods
- method-specific review sheets
- raw JSONL traces for inspection
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import socket
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path


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

CANDIDATE_FIELDS = [
    "window_id",
    "conversation_id",
    "video_name",
    "start_sec",
    "end_sec",
    "trigger_id",
    "trigger_timestamp",
    "candidate_id",
    "candidate_position",
    "mode",
    "text",
    "rationale",
    "intended_benefit",
    "annotation_status",
    "model_rank",
]

WINDOW_REVIEW_FIELDS = ["window_id", "review_status", "trigger_decision", "reviewer_notes"]

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

VALID_RECOMMENDATION_MODES = {"say", "know", "both"}

TRANSCRIPT_RE = re.compile(r"^\[(\d+):(\d+\.\d+)\]\s+(P\d+):\s+(.*)$")


def load_env_file(path: str) -> None:
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


def load_csv(path: str) -> list[dict[str, str]]:
    with open(path, newline="") as handle:
        return list(csv.DictReader(handle))


def write_csv(path: Path, rows: list[dict[str, str]], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def write_jsonl(path: Path, objects: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as handle:
        for obj in objects:
            handle.write(json.dumps(obj, ensure_ascii=True) + "\n")


def parse_transcript_line(line: str) -> dict[str, object]:
    match = TRANSCRIPT_RE.match(line.strip())
    if not match:
        return {"seconds": None, "speaker": None, "text": line.strip()}
    minutes = int(match.group(1))
    seconds = float(match.group(2))
    return {
        "seconds": minutes * 60 + seconds,
        "speaker": match.group(3),
        "text": match.group(4).strip(),
    }


def parse_transcript_text(text: str) -> list[dict[str, object]]:
    return [parse_transcript_line(line) for line in text.splitlines() if line.strip()]


def infer_wearer_id(video_name: str) -> str:
    match = re.search(r"person_(\d+)", video_name)
    if match:
        return f"P{int(match.group(1))}"
    return "P1"


def format_turns(turns: list[dict[str, object]]) -> str:
    lines = []
    for turn in turns:
        seconds = turn.get("seconds")
        speaker = turn.get("speaker") or "UNK"
        text = str(turn.get("text") or "")
        if seconds is None:
            lines.append(f"[note] {speaker}: {text}")
            continue
        minutes = int(float(seconds) // 60)
        remainder = float(seconds) - minutes * 60
        lines.append(f"[{minutes:02d}:{remainder:05.2f}] {speaker}: {text}")
    return "\n".join(lines)


def build_recent_state(turns: list[dict[str, object]], wearer_id: str) -> dict[str, object]:
    speakers = [turn["speaker"] for turn in turns if turn.get("speaker")]
    last_speaker = speakers[-1] if speakers else ""
    wearer_recent = any(speaker == wearer_id for speaker in speakers[-4:])
    text_blob = " ".join(str(turn.get("text") or "") for turn in turns[-4:])
    signal_counter = Counter()
    if "?" in text_blob or re.search(r"\b(what|why|how|which|who|when|do|does|did|can|could|would|should)\b", text_blob, re.I):
        signal_counter["question"] += 1
    if re.search(r"\b(um|uh|hmm|wait|hold on|not sure|maybe)\b", text_blob, re.I):
        signal_counter["hesitation"] += 1
    if re.search(r"\b(okay|so|but|actually|anyway|then)\b", text_blob, re.I):
        signal_counter["transition"] += 1
    if re.search(r"\b(need to|should|let's|action|next|follow up)\b", text_blob, re.I):
        signal_counter["decision"] += 1
    return {
        "recent_speakers": speakers[-6:],
        "last_speaker": last_speaker,
        "wearer_recently_spoke": wearer_recent,
        "detected_signals": [name for name, count in signal_counter.items() if count > 0],
    }


def build_local_context_packet(
    row: dict[str, str],
    turns: list[dict[str, object]],
    trigger_timestamp: float,
    context_seconds: float,
) -> dict[str, object]:
    start_sec = float(row["start_sec"])
    local_start = max(start_sec, trigger_timestamp - context_seconds)
    visible_turns = [
        turn
        for turn in turns
        if turn.get("seconds") is not None and local_start <= float(turn["seconds"]) <= trigger_timestamp
    ]
    wearer_id = infer_wearer_id(row["video_name"])
    state = build_recent_state(visible_turns, wearer_id)
    return {
        "window_id": row["window_id"],
        "conversation_id": row["conversation_id"],
        "video_name": row["video_name"],
        "wearer_id": wearer_id,
        "trigger_timestamp": round(trigger_timestamp, 2),
        "context_start": round(local_start, 2),
        "context_end": round(trigger_timestamp, 2),
        "local_transcript": format_turns(visible_turns),
        "recent_speakers": state["recent_speakers"],
        "last_speaker": state["last_speaker"],
        "wearer_recently_spoke": state["wearer_recently_spoke"],
        "detected_signals": state["detected_signals"],
    }


def build_request(base_url: str, api_key: str, model: str, system_prompt: str, user_prompt: str, temperature: float) -> urllib.request.Request:
    url = base_url.rstrip("/") + "/chat/completions"
    payload = {
        "model": model,
        "temperature": temperature,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    body = json.dumps(payload).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }
    return urllib.request.Request(url, data=body, headers=headers, method="POST")


def call_chat_completion(
    base_url: str,
    api_key: str,
    model: str,
    system_prompt: str,
    user_prompt: str,
    temperature: float,
    timeout_seconds: float,
    retry_count: int,
) -> dict:
    last_exc = None
    for attempt in range(retry_count + 1):
        try:
            request = build_request(base_url, api_key, model, system_prompt, user_prompt, temperature)
            with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
                payload = json.loads(response.read().decode("utf-8"))
            content = payload["choices"][0]["message"]["content"]
            return json.loads(content)
        except (socket.timeout, TimeoutError, urllib.error.URLError) as exc:
            last_exc = exc
            if attempt >= retry_count:
                raise
            time.sleep(1.5 * (attempt + 1))
    raise last_exc


def build_trigger_record(
    row: dict[str, str],
    trigger_id: str,
    trigger_timestamp: float,
    recommendation_mode: str,
    recommendation_1: str,
    recommendation_2: str,
    urgency: str,
    rationale: str,
    annotation_status: str,
) -> dict[str, str]:
    mode = recommendation_mode.strip().lower()
    if mode not in VALID_RECOMMENDATION_MODES:
        mode = "both"
    return {
        "window_id": row["window_id"],
        "conversation_id": row["conversation_id"],
        "video_name": row["video_name"],
        "start_sec": row["start_sec"],
        "end_sec": row["end_sec"],
        "trigger_id": trigger_id,
        "trigger_timestamp": f"{trigger_timestamp:.2f}",
        "recommendation_mode": mode,
        "recommendation_1": recommendation_1.strip(),
        "recommendation_2": recommendation_2.strip(),
        "urgency": urgency.strip(),
        "rationale": rationale.strip(),
        "annotation_status": annotation_status,
    }


def build_review_rows(trigger_rows: list[dict[str, str]]) -> list[dict[str, str]]:
    rows = []
    for row in trigger_rows:
        rows.append(
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
    return rows


def load_anchor_rows(review_sheet_path: str | None, triggers_path: str | None) -> list[dict[str, str]]:
    anchors: list[dict[str, str]] = []
    if review_sheet_path and Path(review_sheet_path).exists():
        for row in load_csv(review_sheet_path):
            decision = str(row.get("review_decision", "")).strip().lower()
            if decision == "rejected":
                continue
            trigger_timestamp = (
                row.get("final_trigger_timestamp")
                or row.get("trigger_timestamp")
                or ""
            )
            if not trigger_timestamp:
                continue
            anchors.append(
                {
                    "window_id": row["window_id"],
                    "trigger_id": row["trigger_id"],
                    "trigger_timestamp": trigger_timestamp,
                    "recommendation_mode": row.get("final_recommendation_mode")
                    or row.get("recommendation_mode", ""),
                    "recommendation_1": row.get("final_recommendation_1")
                    or row.get("recommendation_1", ""),
                    "recommendation_2": row.get("final_recommendation_2")
                    or row.get("recommendation_2", ""),
                    "urgency": row.get("final_urgency") or row.get("urgency", ""),
                    "rationale": row.get("final_rationale") or row.get("rationale", ""),
                    "annotation_status": row.get("annotation_status", "anchor__source"),
                    "anchor_review_decision": decision or "unreviewed",
                }
            )
    if anchors:
        return anchors
    if triggers_path and Path(triggers_path).exists():
        return load_csv(triggers_path)
    return []


def index_anchors_by_window(anchor_rows: list[dict[str, str]]) -> dict[str, list[dict[str, str]]]:
    grouped: dict[str, list[dict[str, str]]] = {}
    for row in anchor_rows:
        grouped.setdefault(row["window_id"], []).append(row)
    for values in grouped.values():
        values.sort(key=lambda item: float(item.get("trigger_timestamp", 0) or 0))
    return grouped


def direct2_anchor_prompts(context_packet: dict[str, object]) -> tuple[str, str]:
    system_prompt = (
        "You generate exactly two proactive recommendations for OcularClaw at a fixed trigger anchor. "
        "Return JSON only. "
        "Use only the provided local context packet, help the wearer directly, and avoid any future leakage."
    )
    user_prompt = f"""You are given a fixed trigger anchor and local context packet.

Context packet:
{json.dumps(context_packet, ensure_ascii=True, indent=2)}

Task:
- Generate exactly two final recommendations for this fixed trigger.
- recommendation_mode must be say, know, or both.
- Recommendations must help the wearer at this moment.
- They must be grounded in the provided context only.
- Do not use or infer any future transcript content after the trigger timestamp.
- Avoid generic coaching and redundant pairs.

Return JSON in this shape:
{{
  "recommendation_mode": "both",
  "recommendation_1": "",
  "recommendation_2": "",
  "urgency": "low|medium|high",
  "rationale": ""
}}"""
    return system_prompt, user_prompt


def run_direct2_from_anchors(
    row: dict[str, str],
    turns: list[dict[str, object]],
    anchor_rows: list[dict[str, str]],
    base_url: str,
    api_key: str,
    model: str,
    temperature: float,
    context_seconds: float,
    timeout_seconds: float,
    retry_count: int,
) -> tuple[dict[str, str], list[dict[str, str]], list[dict[str, str]], dict]:
    review = {
        "window_id": row["window_id"],
        "review_status": "reviewed",
        "trigger_decision": "has_triggers" if anchor_rows else "no_trigger",
        "reviewer_notes": "Recommendation generation evaluated on fixed current-pilot anchors.",
    }
    if not anchor_rows:
        return review, [], [], {"anchors": []}

    triggers: list[dict[str, str]] = []
    raw_anchors: list[dict[str, object]] = []
    for anchor in anchor_rows:
        trigger_timestamp = float(anchor["trigger_timestamp"])
        context_packet = build_local_context_packet(row, turns, trigger_timestamp, context_seconds)
        system_prompt, user_prompt = direct2_anchor_prompts(context_packet)
        payload = call_chat_completion(
            base_url,
            api_key,
            model,
            system_prompt,
            user_prompt,
            temperature,
            timeout_seconds,
            retry_count,
        )
        trigger_row = build_trigger_record(
            row=row,
            trigger_id=str(anchor.get("trigger_id") or f"anchor_{len(triggers) + 1}"),
            trigger_timestamp=trigger_timestamp,
            recommendation_mode=str(payload.get("recommendation_mode", "both")),
            recommendation_1=str(payload.get("recommendation_1", "")),
            recommendation_2=str(payload.get("recommendation_2", "")),
            urgency=str(payload.get("urgency", "medium")),
            rationale=str(payload.get("rationale", "")),
            annotation_status="proposed_by_ai__direct2_from_anchors",
        )
        triggers.append(trigger_row)
        raw_anchors.append(
            {
                "anchor": anchor,
                "context_packet": context_packet,
                "generated": payload,
            }
        )
    return review, triggers, [], {"anchors": raw_anchors}


def method_filenames(output_dir: Path, method_name: str) -> dict[str, Path]:
    return {
        "window_reviews": output_dir / f"{method_name}_window_reviews.csv",
        "triggers": output_dir / f"{method_name}_triggers.csv",
        "review_sheet": output_dir / f"{method_name}_review_sheet.csv",
        "candidates": output_dir / f"{method_name}_candidates.csv",
        "raw": output_dir / f"{method_name}_raw.jsonl",
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-windows", required=True)
    parser.add_argument("--output-dir", required=True)
    _repo_root = Path(__file__).resolve().parents[1]
    parser.add_argument("--env-file", default=str(_repo_root / ".env"))
    parser.add_argument("--base-url", default=None)
    parser.add_argument("--api-key", default=None)
    parser.add_argument("--model", default=None)
    parser.add_argument("--temperature", type=float, default=0.3)
    parser.add_argument("--methods", default="direct2_from_anchors")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--window-ids", default="")
    parser.add_argument(
        "--anchor-review-sheet",
        default=str(_repo_root / "analysis" / "egocom_trigger_review_sheet.csv"),
    )
    parser.add_argument(
        "--anchor-triggers",
        default=str(_repo_root / "analysis" / "egocom_trigger_annotations_ai_proposed.csv"),
    )
    parser.add_argument("--context-seconds", type=float, default=20.0)
    parser.add_argument("--request-timeout", type=float, default=180.0)
    parser.add_argument("--retry-count", type=int, default=1)
    parser.add_argument("--sleep-seconds", type=float, default=0.0)
    parser.add_argument("--stop-on-error", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def filter_rows(rows: list[dict[str, str]], limit: int | None, window_ids: str) -> list[dict[str, str]]:
    selected = rows
    if window_ids:
        wanted = {item.strip() for item in window_ids.split(",") if item.strip()}
        selected = [row for row in selected if row["window_id"] in wanted]
    if limit is not None:
        selected = selected[:limit]
    return selected


def main() -> int:
    args = parse_args()
    load_env_file(args.env_file)

    base_url = args.base_url or os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")
    api_key = args.api_key or os.environ.get("OPENAI_API_KEY", "")
    model = args.model or os.environ.get("OPENAI_MODEL", "gpt-4.1-mini")
    methods = [item.strip() for item in args.methods.split(",") if item.strip()]

    rows = filter_rows(load_csv(args.input_windows), args.limit, args.window_ids)
    if not rows:
        print("no input windows selected", file=sys.stderr)
        return 1

    anchor_index = index_anchors_by_window(load_anchor_rows(args.anchor_review_sheet, args.anchor_triggers))

    if args.dry_run:
        print(f"selected {len(rows)} windows")
        print(f"methods: {methods}")
        sample_row = rows[0]
        turns = parse_transcript_text(sample_row["transcript_text"])
        packet = build_local_context_packet(
            sample_row,
            turns,
            trigger_timestamp=float(sample_row["start_sec"]) + min(args.context_seconds, 10.0),
            context_seconds=args.context_seconds,
        )
        print(f"anchor_count: {len(anchor_index.get(sample_row['window_id'], []))}")
        print(json.dumps(packet, ensure_ascii=True, indent=2))
        return 0

    if not api_key:
        print("missing OPENAI_API_KEY or --api-key", file=sys.stderr)
        return 2

    output_dir = Path(args.output_dir)
    for method in methods:
        method_output = method_filenames(output_dir, method)
        window_reviews = []
        triggers = []
        candidate_rows = []
        raw_objects = []

        for row in rows:
            turns = parse_transcript_text(row["transcript_text"])
            window_anchors = anchor_index.get(row["window_id"], [])
            try:
                if method == "direct2_from_anchors":
                    review, trigger_rows, candidate_chunk, raw_payload = run_direct2_from_anchors(
                        row=row,
                        turns=turns,
                        anchor_rows=window_anchors,
                        base_url=base_url,
                        api_key=api_key,
                        model=model,
                        temperature=args.temperature,
                        context_seconds=args.context_seconds,
                        timeout_seconds=args.request_timeout,
                        retry_count=args.retry_count,
                    )
                else:
                    raise ValueError(
                        f"unsupported method: {method}. Supported methods are direct2_from_anchors."
                    )
            except Exception as exc:
                if args.stop_on_error:
                    raise
                review = {
                    "window_id": row["window_id"],
                    "review_status": "pending",
                    "trigger_decision": "no_trigger",
                    "reviewer_notes": f"error: {exc}",
                }
                trigger_rows = []
                candidate_chunk = []
                raw_payload = {"error": str(exc)}

            window_reviews.append(review)
            triggers.extend(trigger_rows)
            candidate_rows.extend(candidate_chunk)
            raw_objects.append(
                {
                    "method": method,
                    "window_id": row["window_id"],
                    "anchor_count": len(window_anchors),
                    "result": raw_payload,
                }
            )
            if args.sleep_seconds:
                time.sleep(args.sleep_seconds)
            review_sheet = build_review_rows(triggers)
            write_csv(method_output["window_reviews"], window_reviews, WINDOW_REVIEW_FIELDS)
            write_csv(method_output["triggers"], triggers, TRIGGER_FIELDS)
            write_csv(method_output["review_sheet"], review_sheet, REVIEW_FIELDS)
            if candidate_rows:
                write_csv(method_output["candidates"], candidate_rows, CANDIDATE_FIELDS)
            write_jsonl(method_output["raw"], raw_objects)

        review_sheet = build_review_rows(triggers)
        write_csv(method_output["window_reviews"], window_reviews, WINDOW_REVIEW_FIELDS)
        write_csv(method_output["triggers"], triggers, TRIGGER_FIELDS)
        write_csv(method_output["review_sheet"], review_sheet, REVIEW_FIELDS)
        if candidate_rows:
            write_csv(method_output["candidates"], candidate_rows, CANDIDATE_FIELDS)
        write_jsonl(method_output["raw"], raw_objects)
        print(f"{method}: wrote {len(window_reviews)} window reviews")
        print(f"{method}: wrote {len(triggers)} trigger rows")
        if candidate_rows:
            print(f"{method}: wrote {len(candidate_rows)} candidate rows")
        print(f"{method}: wrote review sheet to {method_output['review_sheet']}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
