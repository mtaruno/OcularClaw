"""
Run multiple models against the 5 user study scenarios and produce
benchmark-lab-scenarios.json with one method entry per model.

Usage:
    export OPENROUTER_API_KEY="sk-or-..."
    python scripts/run_user_study_models.py

    # Or specify models:
    python scripts/run_user_study_models.py --models openai/gpt-4.1-mini openai/gpt-4o openai/o3-mini anthropic/claude-sonnet-4 google/gemini-2.5-flash-preview
"""

import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.error

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

SCENARIOS_PATH = os.path.join(
    os.path.dirname(__file__), "..", "public", "data", "benchmark-lab-scenarios.json"
)

DEFAULT_MODELS = [
    "openai/gpt-4.1-mini",    # fast/cheap OpenAI
    "openai/gpt-4o",           # frontier OpenAI  
    "anthropic/claude-3.5-haiku",  # fast/cheap Anthropic
    "anthropic/claude-sonnet-4",   # frontier Anthropic
    "google/gemini-2.5-flash",  # fast Google (cross-provider)
]


BASE_URL = "https://openrouter.ai/api/v1/chat/completions"

# ---------------------------------------------------------------------------
# Prompt (same as LiveSession.jsx)
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are OcularClaw, an ambient proactive agent observing a live conversation through the wearer's perspective. You perform three tasks in sequence:

Task A (Goal Inference): What is the wearer trying to accomplish right now?
Task B (Intervention Decision): Should you intervene at this moment?
Task C (Recommendation): If yes, generate two recommendations aligned with the wearer's goal.

You must be selective. Most moments do NOT warrant intervention. Only trigger when you detect a clear conversational signal: a self-contradiction, a question being dodged, emotional escalation, a factual error, a missed social cue, a premature commitment, or an actionable opportunity the wearer is about to miss.

Signal types you should watch for:
- self_contradiction_recall: wearer contradicts something said earlier
- question_dodge: wearer pivots away from the actual question
- emotional_escalation: conversation tension is rising
- comprehension_gap: listener isn't understanding what speaker is saying
- idea_co_option: someone restates the wearer's earlier idea as their own
- missed_buying_signal: prospect signals interest but wearer keeps pitching
- premature_commitment: wearer is about to overcommit
- factual_error: incorrect information going uncorrected
- structural_gap: response is missing a key component
- information_enrichment: opportunity to surface helpful context
- high_stakes_decision_point: critical moment requiring careful response
- missed_connection_opportunity: relevant connection the wearer is about to miss

Goal types to choose from:
persuasion, negotiation, social_coordination, relationship_management, information_exchange, collaborative_problem_solving, collaborative_learning, relationship_building, social_bonding, information_delivery, teaching

You will analyze the ENTIRE transcript and identify ALL moments where intervention would be appropriate. For each trigger moment, provide the exact timestamp.

Return a JSON object with this shape:
{
  "triggers": [
    {
      "trigger_timestamp": 36.5,  // IMPORTANT: must be in absolute seconds. Convert [MM:SS.ss] → seconds (e.g. [00:36.50]=36.5, [01:05.00]=65.0, [00:06.00]=6.0)
      "wearer_goal": "...",
      "goal_type": "...",
      "goal_confidence": "high|medium|low",
      "signal_type": "...",
      "proactive_score": 4,
      "recommendation_mode": "say|know|both",
      "recommendation_1": "...",
      "recommendation_2": "...",
      "urgency": "low|medium|high",
      "rationale": "..."
    }
  ]
}

If NO intervention is warranted at any point in the conversation, return:
{"triggers": [], "no_trigger_reason": "brief explanation of why no intervention was needed"}

Important:
- "know" recommendations MUST contain the actual information — never say "go research"
- "say" recommendations should be natural utterances the wearer could speak
- Each trigger must have a specific timestamp from the transcript, expressed in ABSOLUTE SECONDS (e.g. [00:21.00] → 21.0, [01:09.00] → 69.0). Do NOT use MM:SS or decimal-minute formats.
- proactive_score: 1=no intervention needed, 2=marginal, 3=moderate, 4=strong, 5=critical
- Be selective — not every conversation needs intervention"""


def build_user_prompt(transcript_text, persona):
    persona_block = f"\n--- WEARER PERSONA ---\n{persona}\n--- END PERSONA ---\n" if persona else ""
    return f"""Below is a full transcript of a conversation captured by the wearer's AR glasses.
{persona_block}
--- TRANSCRIPT ---
{transcript_text}
--- END TRANSCRIPT ---

Analyze the entire transcript and identify ALL moments where proactive intervention would help the wearer. For each moment, perform:

Task A — Goal Inference:
What is the wearer (P1) trying to accomplish? Pick the closest goal_type. Rate confidence.

Task B — Intervention Decision:
At which specific timestamps should you intervene? What signal_type justifies each?

Task C — Recommendation:
For each trigger, generate exactly two recommendations (mode: say/know/both).

Return JSON only."""


# ---------------------------------------------------------------------------
# Robust JSON parsing
# ---------------------------------------------------------------------------

import re

def parse_json_response(content):
    """Try multiple strategies to extract valid JSON from model output."""
    content = content.strip()

    # Strategy 1: direct parse
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        pass

    # Strategy 2: strip markdown fences (```json ... ``` or ``` ... ```)
    fence_match = re.search(r"```(?:json)?\s*\n?(.*?)```", content, re.DOTALL)
    if fence_match:
        try:
            return json.loads(fence_match.group(1).strip())
        except json.JSONDecodeError:
            pass

    # Strategy 3: fix unquoted timestamp values like 00:21.00 → "00:21.00"
    # Haiku outputs trigger_timestamp: 00:21.00 which is invalid JSON
    fixed = re.sub(r':\s*(\d{2}:\d{2}\.\d+)', r': "\1"', content)
    try:
        return json.loads(fixed)
    except json.JSONDecodeError:
        pass

    # Strategy 4: find the first { ... } block (greedy)
    brace_match = re.search(r"\{.*\}", content, re.DOTALL)
    if brace_match:
        candidate = brace_match.group(0)
        # Also fix timestamps in extracted block
        candidate = re.sub(r':\s*(\d{2}:\d{2}\.\d+)', r': "\1"', candidate)
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            # Strategy 5: try removing trailing commas (common LLM mistake)
            cleaned = re.sub(r",\s*([}\]])", r"\1", candidate)
            try:
                return json.loads(cleaned)
            except json.JSONDecodeError:
                pass

    # Strategy 5: find a JSON array of triggers directly
    array_match = re.search(r"\[.*\]", content, re.DOTALL)
    if array_match:
        try:
            arr = json.loads(array_match.group(0))
            return {"triggers": arr}
        except json.JSONDecodeError:
            pass

    # Debug: print first 300 chars so we can see what's happening
    print(f"\n    [DEBUG] Could not parse response. First 300 chars:\n    {content[:300]}\n")
    return None


# ---------------------------------------------------------------------------
# API call
# ---------------------------------------------------------------------------

def call_model(api_key, model, transcript_text, persona, retries=3):
    """Call a model via OpenRouter and return parsed JSON."""
    is_o_series = model.split("/")[-1].startswith("o")

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": build_user_prompt(transcript_text, persona)},
    ]

    is_gemini = "gemini" in model.lower()

    body = {
        "model": model,
        "messages": messages,
    }
    # Gemini doesn't support response_format via OpenRouter
    if not is_gemini:
        body["response_format"] = {"type": "json_object"}
    if not is_o_series and not is_gemini:
        body["temperature"] = 0.3

    data = json.dumps(body).encode("utf-8")

    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                BASE_URL,
                data=data,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}",
                },
            )
            with urllib.request.urlopen(req, timeout=120) as resp:
                result = json.loads(resp.read().decode("utf-8"))

            content = result["choices"][0]["message"]["content"]
            parsed = parse_json_response(content)
            if parsed is not None:
                return parsed
            raise json.JSONDecodeError("Could not parse response", content[:200], 0)

        except (urllib.error.HTTPError, urllib.error.URLError, json.JSONDecodeError, KeyError) as e:
            print(f"    Attempt {attempt + 1}/{retries} failed: {e}")
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
            else:
                print(f"    FAILED after {retries} attempts")
                return {"triggers": []}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Run models against user study scenarios")
    parser.add_argument("--models", nargs="+", default=DEFAULT_MODELS, help="Models to run")
    parser.add_argument("--api-key", default=os.environ.get("OPENROUTER_API_KEY", ""), help="OpenRouter API key")
    parser.add_argument("--output", default=SCENARIOS_PATH, help="Output path")
    args = parser.parse_args()

    if not args.api_key:
        print("ERROR: Set OPENROUTER_API_KEY env var or pass --api-key")
        sys.exit(1)

    # Load current scenarios (ground truth)
    with open(SCENARIOS_PATH, "r") as f:
        data = json.load(f)

    # Get ground truth method and its windows
    gt_method = data["methods"][0]
    gt_windows = gt_method["windows"]

    print(f"Loaded {len(gt_windows)} scenarios")
    print(f"Models to run: {args.models}")
    print()

    # Remove any existing model methods (keep only ground truth)
    data["methods"] = [gt_method]

    # Run each model
    for model in args.models:
        model_short = model.split("/")[-1]
        method_id = f"model__{model_short}"
        print(f"=== Running {model} ===")

        model_windows = []
        for window in gt_windows:
            scenario_id = window["window_id"]
            transcript = window["transcript_text"]
            persona = window.get("scenario_meta", {}).get("persona", "")

            print(f"  {scenario_id}...", end=" ", flush=True)
            result = call_model(args.api_key, model, transcript, persona)

            raw_triggers = result.get("triggers", [])
            if not raw_triggers and result:
                # Some models nest triggers differently — check common alternate keys
                for alt_key in ["recommendations", "interventions", "actions", "results"]:
                    if alt_key in result and isinstance(result[alt_key], list):
                        raw_triggers = result[alt_key]
                        break
                if not raw_triggers:
                    # Maybe the result itself is a single trigger (not wrapped in {"triggers": [...]})
                    if "trigger_timestamp" in result or "recommendation_1" in result:
                        raw_triggers = [result]
                    elif not raw_triggers:
                        print(f"0 triggers (keys: {list(result.keys())})")
                    else:
                        print(f"{len(raw_triggers)} triggers")
                else:
                    print(f"{len(raw_triggers)} triggers (alt key)")
            else:
                print(f"{len(raw_triggers)} triggers")

            # Convert to window format
            triggers = []
            for i, t in enumerate(raw_triggers):
                triggers.append({
                    "trigger_id": f"t{i + 1}",
                    "trigger_timestamp": str(t.get("trigger_timestamp", 0)),
                    "recommendation_mode": t.get("recommendation_mode", "both"),
                    "recommendation_1": t.get("recommendation_1", ""),
                    "recommendation_2": t.get("recommendation_2", ""),
                    "urgency": t.get("urgency", "medium"),
                    "rationale": t.get("rationale", ""),
                    "proactive_score": t.get("proactive_score", ""),
                    "signal_type": t.get("signal_type", ""),
                    "wearer_goal": t.get("wearer_goal", ""),
                    "goal_type": t.get("goal_type", ""),
                    "annotation_status": method_id,
                    "review_decision": "",
                    "useful_1": "",
                    "useful_2": "",
                    "grounded": "",
                    "distinct_pair": "",
                })

            # Capture no-trigger reasoning if model explained why it didn't trigger
            no_trigger_reason = result.get("no_trigger_reason", "") if not raw_triggers else ""

            # Clone window metadata, replace triggers
            model_window = {
                **window,
                "triggers": triggers,
                "no_trigger_reason": no_trigger_reason,
            }
            model_windows.append(model_window)

            # Rate limit
            time.sleep(1)

        data["methods"].append({
            "id": method_id,
            "label": model_short,
            "windows": model_windows,
        })

        print()

    # Save
    with open(args.output, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print(f"Saved to {args.output}")
    print(f"Total methods: {len(data['methods'])} (1 ground truth + {len(args.models)} models)")


if __name__ == "__main__":
    main()
