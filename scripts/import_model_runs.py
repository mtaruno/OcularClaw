#!/usr/bin/env python3
"""Import model comparison logs into the benchmark-lab-scenarios.json for frontend review.

Reads compare_*.json session logs from analysis/live_sessions/ and merges them
into public/data/benchmark-lab-scenarios.json as additional methods alongside
the ground truth.

Usage:
  # Import all compare logs
  python3 scripts/import_model_runs.py

  # Import only specific models
  python3 scripts/import_model_runs.py --models gpt-4.1-mini,gpt-4o

  # Import from a custom directory
  python3 scripts/import_model_runs.py --log-dir analysis/live_sessions/

The frontend can then switch between Ground Truth / gpt-4.1-mini / gpt-4o / etc.
and reviewers can score each model's outputs independently.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


def find_compare_logs(log_dir: Path, model_filter: list[str] | None = None) -> dict[str, dict[str, Path]]:
    """Find compare logs grouped by model → scenario_id → path.

    When multiple logs exist for the same (model, scenario), keeps the latest.
    Returns: {model_name: {scenario_id: path}}
    """
    pattern = re.compile(r"^compare_(.+?)__(.+?)__(\d{8}T\d{6}Z)\.json$")
    logs: dict[str, dict[str, tuple[str, Path]]] = defaultdict(dict)

    for f in sorted(log_dir.glob("compare_*.json")):
        m = pattern.match(f.name)
        if not m:
            continue
        scenario_id, model_name, timestamp = m.group(1), m.group(2), m.group(3)

        if model_filter and model_name not in model_filter:
            continue

        # Keep latest timestamp per (model, scenario)
        existing = logs[model_name].get(scenario_id)
        if existing is None or timestamp > existing[0]:
            logs[model_name][scenario_id] = (timestamp, f)

    return {
        model: {sid: path for sid, (_, path) in scenarios.items()}
        for model, scenarios in logs.items()
    }


def build_method_from_logs(
    model_name: str,
    scenario_logs: dict[str, Path],
    ground_truth_windows: list[dict],
) -> dict:
    """Build a frontend-compatible method entry from model comparison logs.

    Reuses window metadata from ground truth, replaces triggers with model outputs.
    """
    # Index ground truth windows by scenario_id (extracted from window_id)
    gt_by_scenario: dict[str, dict] = {}
    for win in ground_truth_windows:
        # window_id format: scenario__<scenario_id>__0000_XXXX
        parts = win["window_id"].split("__")
        if len(parts) >= 2:
            gt_by_scenario[parts[1]] = win

    windows = []
    for scenario_id, log_path in sorted(scenario_logs.items()):
        gt_win = gt_by_scenario.get(scenario_id)
        if not gt_win:
            print(f"  warning: no ground truth window for scenario '{scenario_id}', skipping")
            continue

        log_data = json.loads(log_path.read_text())
        triggers = log_data.get("triggers", [])

        # Build trigger entries in frontend format
        trigger_entries = []
        for i, t in enumerate(triggers):
            trigger_entries.append({
                "trigger_id": f"{model_name}__{scenario_id}__t{i+1}",
                "trigger_timestamp": f"{t['trigger_timestamp']:.2f}",
                "recommendation_mode": t.get("recommendation_mode", "both"),
                "recommendation_1": t.get("recommendation_1", ""),
                "recommendation_2": t.get("recommendation_2", ""),
                "urgency": t.get("urgency", "medium"),
                "rationale": t.get("rationale", ""),
                "annotation_status": f"model__{model_name}",
                "proactive_score": t.get("proactive_score", ""),
                "signal_type": t.get("signal_type", ""),
                "wearer_goal": t.get("wearer_goal", ""),
                "goal_type": t.get("goal_type", ""),
                "goal_confidence": t.get("goal_confidence", ""),
                # Review fields (empty, to be filled by human reviewers)
                "review_decision": "",
                "useful_1": "",
                "useful_2": "",
                "grounded": "",
                "distinct_pair": "",
            })

        # Clone window from ground truth, replace triggers
        win = dict(gt_win)
        win["triggers"] = trigger_entries
        win["trigger_decision"] = "has_triggers" if trigger_entries else "no_trigger"
        windows.append(win)

    return {
        "id": f"model__{model_name}",
        "label": f"{model_name}",
        "windows": windows,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--log-dir", default=str(REPO_ROOT / "analysis" / "live_sessions"), help="Directory with compare_*.json logs")
    parser.add_argument("--models", default=None, help="Comma-separated model names to import (default: all)")
    parser.add_argument("--output", default=str(REPO_ROOT / "public" / "data" / "benchmark-lab-scenarios.json"), help="Output JSON path")
    args = parser.parse_args()

    log_dir = Path(args.log_dir)
    model_filter = [m.strip() for m in args.models.split(",")] if args.models else None

    # Find all compare logs
    model_logs = find_compare_logs(log_dir, model_filter)
    if not model_logs:
        print(f"No compare logs found in {log_dir}")
        print(f"Run: python3 scripts/run_live_proactive_agent.py --scenario <id> --models 'model1,model2' --save-log")
        return

    print(f"Found logs for {len(model_logs)} model(s): {', '.join(sorted(model_logs.keys()))}")
    for model, scenarios in sorted(model_logs.items()):
        print(f"  {model}: {len(scenarios)} scenario(s)")

    # Load existing benchmark JSON (ground truth)
    output_path = Path(args.output)
    if not output_path.exists():
        print(f"Error: {output_path} not found. Run build_scenario_benchmark_data.py first.")
        return

    benchmark = json.loads(output_path.read_text())

    # Find ground truth method
    gt_method = None
    for method in benchmark["methods"]:
        if method["id"] == "ground_truth__scenario_benchmark":
            gt_method = method
            break

    if not gt_method:
        print("Error: ground truth method not found in benchmark JSON.")
        return

    # Remove old model methods, keep ground truth
    benchmark["methods"] = [m for m in benchmark["methods"] if not m["id"].startswith("model__")]

    # Build and add model methods
    for model_name, scenario_logs in sorted(model_logs.items()):
        method = build_method_from_logs(model_name, scenario_logs, gt_method["windows"])
        benchmark["methods"].append(method)
        print(f"  added method: {method['id']} ({len(method['windows'])} windows)")

    # Write output
    output_path.write_text(json.dumps(benchmark, indent=2))
    print(f"\nWrote {len(benchmark['methods'])} methods → {output_path}")
    print(f"Methods: {', '.join(m['id'] for m in benchmark['methods'])}")
    print(f"\nOpen the frontend (npm run dev) to review model outputs.")


if __name__ == "__main__":
    main()
