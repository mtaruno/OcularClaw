#!/usr/bin/env python3
"""Live proactive recommendation agent for OcularClaw.

Captures audio from the Mac microphone, transcribes in real-time via Whisper,
and proactively generates recommendations when the agent detects a moment
where intervention would help the wearer.

Agent modes (start simple, extend later):
  proagent      – baseline periodic check on rolling transcript
  contextagent  – (planned) context-aware triggering with richer signals
  llamapie      – (planned) LLM-as-proactive-interventionist-engine

Usage:
  python scripts/run_live_proactive_agent.py --duration 120
  python scripts/run_live_proactive_agent.py --duration 300 --check-interval 15
"""

from __future__ import annotations

import argparse
import json
import os
import re
import socket
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import wave
from datetime import datetime, timezone
from pathlib import Path

import sounddevice as sd

# ---------------------------------------------------------------------------
# Env helpers (reused from existing pipeline)
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Audio capture
# ---------------------------------------------------------------------------

class ChunkedAudioCapture:
    """Continuously captures mic audio and yields chunks of a fixed duration."""

    def __init__(self, sample_rate: int = 16000, channels: int = 1, chunk_seconds: float = 5.0) -> None:
        self.sample_rate = sample_rate
        self.channels = channels
        self.chunk_seconds = chunk_seconds
        self._buffer: list[bytes] = []
        self._lock = threading.Lock()
        self._stream: sd.RawInputStream | None = None
        self._running = False

    def _callback(self, indata, frames, time_info, status) -> None:
        if status:
            print(f"  [audio] {status}", file=sys.stderr)
        with self._lock:
            self._buffer.append(bytes(indata))

    def start(self) -> None:
        self._running = True
        self._stream = sd.RawInputStream(
            samplerate=self.sample_rate,
            channels=self.channels,
            dtype="int16",
            callback=self._callback,
        )
        self._stream.start()

    def stop(self) -> None:
        self._running = False
        if self._stream:
            self._stream.stop()
            self._stream.close()
            self._stream = None

    def drain_chunk(self) -> bytes | None:
        """Return accumulated audio bytes and clear the buffer. Returns None if empty."""
        with self._lock:
            if not self._buffer:
                return None
            data = b"".join(self._buffer)
            self._buffer.clear()
        return data

    def save_chunk_wav(self, audio_bytes: bytes, path: Path) -> None:
        """Write raw int16 audio bytes to a WAV file."""
        with wave.open(str(path), "wb") as wf:
            wf.setnchannels(self.channels)
            wf.setsampwidth(2)  # int16
            wf.setframerate(self.sample_rate)
            wf.writeframes(audio_bytes)


# ---------------------------------------------------------------------------
# Whisper transcription (local via faster-whisper)
# ---------------------------------------------------------------------------

_whisper_model = None


def get_whisper_model(model_size: str = "base.en"):
    """Lazy-load the faster-whisper model (downloaded on first use)."""
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel
        print(f"  [whisper] loading local model '{model_size}' (first run downloads ~150MB)...")
        _whisper_model = WhisperModel(model_size, device="cpu", compute_type="int8")
        print(f"  [whisper] model ready.")
    return _whisper_model


def transcribe_local(wav_path: Path, model_size: str = "base.en") -> str:
    """Transcribe a WAV file using local faster-whisper. No API key needed."""
    try:
        model = get_whisper_model(model_size)
        segments, _ = model.transcribe(str(wav_path), language="en", beam_size=1)
        return " ".join(seg.text.strip() for seg in segments).strip()
    except Exception as exc:
        print(f"  [whisper] transcription error: {exc}", file=sys.stderr)
        return ""


# ---------------------------------------------------------------------------
# Rolling transcript buffer
# ---------------------------------------------------------------------------

class TranscriptBuffer:
    """Thread-safe rolling buffer of timestamped transcript turns."""

    def __init__(self, max_seconds: float = 120.0) -> None:
        self.max_seconds = max_seconds
        self.turns: list[dict] = []
        self._lock = threading.Lock()

    def add(self, text: str, timestamp_sec: float, speaker: str = "P1") -> None:
        if not text.strip():
            return
        with self._lock:
            self.turns.append({"seconds": round(timestamp_sec, 2), "speaker": speaker, "text": text.strip()})
            # prune turns older than max_seconds from the latest timestamp
            cutoff = timestamp_sec - self.max_seconds
            self.turns = [t for t in self.turns if t["seconds"] >= cutoff]

    def format_transcript(self) -> str:
        with self._lock:
            lines = []
            for t in self.turns:
                m = int(t["seconds"] // 60)
                s = t["seconds"] - m * 60
                lines.append(f"[{m:02d}:{s:05.2f}] {t['speaker']}: {t['text']}")
            return "\n".join(lines)

    def get_recent_text(self, seconds: float = 20.0) -> str:
        with self._lock:
            if not self.turns:
                return ""
            latest = self.turns[-1]["seconds"]
            cutoff = latest - seconds
            return " ".join(t["text"] for t in self.turns if t["seconds"] >= cutoff)

    def has_content(self) -> bool:
        with self._lock:
            return len(self.turns) > 0

    def latest_timestamp(self) -> float:
        with self._lock:
            return self.turns[-1]["seconds"] if self.turns else 0.0


# ---------------------------------------------------------------------------
# Proactive agent – LLM calls
# ---------------------------------------------------------------------------

def build_chat_request(
    base_url: str, api_key: str, model: str,
    system_prompt: str, user_prompt: str, temperature: float,
) -> urllib.request.Request:
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
    return urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )


def call_llm_json(
    base_url: str, api_key: str, model: str,
    system_prompt: str, user_prompt: str,
    temperature: float = 0.3, timeout: float = 60.0,
) -> dict:
    req = build_chat_request(base_url, api_key, model, system_prompt, user_prompt, temperature)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    content = data["choices"][0]["message"]["content"]
    return json.loads(content)


# ---------------------------------------------------------------------------
# Proactive agent prompt (baseline "proagent")
# ---------------------------------------------------------------------------

PROAGENT_SYSTEM = """\
You are OcularClaw, an ambient proactive agent observing a live conversation \
through the wearer's perspective. You perform three tasks in sequence:

Task C (Goal Inference): What is the wearer trying to accomplish right now?
Task A (Intervention Decision): Should you intervene at this moment?
Task B (Recommendation): If yes, generate two recommendations aligned with the wearer's goal.

You must be selective. Most moments do NOT warrant intervention. Only trigger when \
you detect a clear conversational signal: a self-contradiction, a question being \
dodged, emotional escalation, a factual error, a missed social cue, a premature \
commitment, or an actionable opportunity the wearer is about to miss.

Signal types you should watch for:
- self_contradiction_recall: wearer contradicts something said earlier
- question_dodge: wearer pivots away from the actual question
- emotional_escalation: conversation tension is rising
- idea_co_option: someone restates the wearer's earlier idea as their own
- missed_buying_signal: prospect signals interest but wearer keeps pitching
- premature_commitment: wearer is about to overcommit
- factual_error: incorrect information going uncorrected
- structural_gap: response is missing a key component (e.g., STAR result)
- high_stakes_decision_point: critical moment requiring careful response
- missed_connection_opportunity: relevant connection the wearer is about to miss

Goal types to choose from:
persuasion, negotiation, social_coordination, relationship_management, \
information_exchange, collaborative_problem_solving, collaborative_learning, \
relationship_building, social_bonding, information_delivery, teaching

Return JSON only."""

PROAGENT_USER = """\
Below is the live rolling transcript of the conversation so far (from the wearer's \
microphone). The current elapsed time is {elapsed:.1f} seconds.
{persona_block}
--- TRANSCRIPT ---
{transcript}
--- END TRANSCRIPT ---

Perform these three tasks in order:

Task C — Goal Inference:
What is the wearer (P1) trying to accomplish in this conversation right now? \
Be specific and concrete, not generic. Pick the closest goal_type from the list. \
Rate your confidence: high, medium, or low.

Task A — Intervention Decision:
Given the wearer's goal, should you intervene at this exact moment? \
Be selective — only intervene if there is a clear, concrete signal. \
If triggering, identify which signal_type best describes why.

Task B — Recommendation (only if intervening):
Generate exactly two recommendations that are aligned with the wearer's goal:
  - recommendation_mode: "say" (suggest what to say), "know" (internal info), or "both"
  - recommendation_1 and recommendation_2 should be distinct and non-redundant, and informative that helps the wearer achieve the goal, your goal is to add value
  - proactive_score: 1-5 (1=no intervention needed, 5=critical moment)
  - rationale: why this moment matters for the wearer's goal

Return one of:

If NO intervention needed:
{{"action": "none", "wearer_goal": "what the wearer is trying to do", "goal_type": "closest_type", "goal_confidence": "high|medium|low", "proactive_score": 1, "reason": "brief reason"}}

If intervention IS warranted:
{{"action": "recommend", "wearer_goal": "what the wearer is trying to do", "goal_type": "closest_type", "goal_confidence": "high|medium|low", "signal_type": "detected_signal", "proactive_score": 3, "recommendation_mode": "say|know|both", "recommendation_1": "...", "recommendation_2": "...", "urgency": "low|medium|high", "rationale": "..."}}"""


# ---------------------------------------------------------------------------
# Display helpers
# ---------------------------------------------------------------------------

BOLD = "\033[1m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
RED = "\033[91m"
DIM = "\033[2m"
RESET = "\033[0m"

URGENCY_COLOR = {"low": DIM, "medium": YELLOW, "high": RED}


def print_recommendation(result: dict, elapsed: float) -> None:
    urgency = result.get("urgency", "medium")
    color = URGENCY_COLOR.get(urgency, YELLOW)
    mode = result.get("recommendation_mode", "both")
    score = result.get("proactive_score", "?")
    goal = result.get("wearer_goal", "")
    goal_type = result.get("goal_type", "")
    goal_conf = result.get("goal_confidence", "")
    signal = result.get("signal_type", "")

    print()
    print(f"{BOLD}{GREEN}{'=' * 60}{RESET}")
    print(f"{BOLD}{GREEN}  PROACTIVE RECOMMENDATION @ {elapsed:.1f}s{RESET}")
    print(f"{GREEN}{'=' * 60}{RESET}")
    # Task C — Goal
    if goal:
        conf_str = f" ({goal_conf})" if goal_conf else ""
        type_str = f" [{goal_type}]" if goal_type else ""
        print(f"  {DIM}Task C goal:{RESET} {goal}{type_str}{conf_str}")
    # Task A — Signal
    if signal:
        print(f"  {DIM}Task A signal:{RESET} {YELLOW}{signal}{RESET}")
    # Task B — Recommendations
    print(f"  {DIM}mode:{RESET}  {mode}  {DIM}urgency:{RESET} {color}{urgency}{RESET}  {DIM}score:{RESET} {score}/5")
    print()
    print(f"  {CYAN}1:{RESET} {result.get('recommendation_1', '(empty)')}")
    print(f"  {CYAN}2:{RESET} {result.get('recommendation_2', '(empty)')}")
    print()
    print(f"  {DIM}rationale: {result.get('rationale', '')}{RESET}")
    print(f"{GREEN}{'=' * 60}{RESET}")
    print()


def print_status(elapsed: float, transcript_lines: int, checks: int, triggers: int) -> None:
    print(
        f"\r  {DIM}[{elapsed:5.1f}s] transcript_lines={transcript_lines} "
        f"checks={checks} triggers={triggers}{RESET}",
        end="", flush=True,
    )


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--duration", type=float, default=120.0, help="Session duration in seconds (default 120)")
    parser.add_argument("--chunk-seconds", type=float, default=5.0, help="Audio chunk length for transcription (default 5)")
    parser.add_argument("--check-interval", type=float, default=10.0, help="Seconds between proactive checks (default 10)")
    parser.add_argument("--context-window", type=float, default=120.0, help="Rolling transcript buffer in seconds (default 120)")
    parser.add_argument("--camera-index", type=int, default=0, help="OpenCV camera index (for future use)")
    parser.add_argument("--sample-rate", type=int, default=16000, help="Mic sample rate")
    parser.add_argument("--env-file", default=str(repo_root / ".env"), help="Path to .env file")
    parser.add_argument("--base-url", default=None, help="Chat completion API base URL")
    parser.add_argument("--api-key", default=None, help="Chat completion API key")
    parser.add_argument("--model", default=None, help="Chat completion model (e.g. gpt-4.1-mini, gpt-4o, o1-mini)")
    parser.add_argument("--models", default=None, help="Comma-separated list of models to compare on the same scenario (e.g. 'gpt-4.1-mini,gpt-4o'). Requires --scenario.")
    parser.add_argument("--whisper-model", default="base.en", help="Local whisper model size (default base.en)")
    parser.add_argument("--agent-mode", default="proagent", choices=["proagent"], help="Agent mode (default proagent)")
    parser.add_argument("--persona", default="", help="Wearer persona description (e.g. 'Senior engineer in a salary negotiation')")
    parser.add_argument("--save-log", action="store_true", help="Save session log to analysis/live_sessions/")
    parser.add_argument("--temperature", type=float, default=0.3, help="LLM temperature")
    parser.add_argument("--scenario", default=None, help="Scenario ID from scenario_transcripts.json (e.g. 'salary_negotiation_01'). Replays the transcript instead of using the mic.")
    parser.add_argument("--scenario-file", default=None, help="Path to scenario_transcripts.json (default: auto-detect)")
    return parser.parse_args()


def load_scenario(scenario_id: str, scenario_file: str | None, repo_root: Path) -> dict | None:
    """Load a scenario from scenario_transcripts.json by ID."""
    candidates = [
        Path(scenario_file) if scenario_file else None,
        repo_root / "analysis" / "live_scenarios" / "scenario_transcripts.json",
    ]
    for path in candidates:
        if path and path.exists():
            data = json.loads(path.read_text())
            scenarios = data["scenarios"] if isinstance(data, dict) and "scenarios" in data else data
            for s in scenarios:
                if s["id"] == scenario_id:
                    return s
            # Try partial match
            for s in scenarios:
                if scenario_id in s["id"]:
                    return s
            print(f"  Available scenarios:", file=sys.stderr)
            for s in scenarios:
                print(f"    {s['id']}  –  {s['title']}", file=sys.stderr)
            return None
    print(f"Error: scenario_transcripts.json not found.", file=sys.stderr)
    return None


def parse_scenario_turns(transcript_text: str) -> list[dict]:
    """Parse transcript text into timed turns for replay."""
    turns = []
    for line in transcript_text.strip().split("\n"):
        line = line.strip()
        if not line:
            continue
        match = re.match(r"^\[(\d+):(\d+\.\d+)\]\s+(P\d+):\s+(.*)$", line)
        if match:
            minutes = int(match.group(1))
            seconds = float(match.group(2))
            turns.append({
                "seconds": minutes * 60 + seconds,
                "speaker": match.group(3),
                "text": match.group(4),
            })
    return turns


def run_proactive_check(
    base_url: str, api_key: str, model: str, temperature: float,
    transcript: TranscriptBuffer, elapsed: float, persona: str,
    checks: int, triggers: int, session_log: list[dict],
) -> tuple[int, int]:
    """Run a single proactive check against the LLM. Returns updated (checks, triggers)."""
    checks += 1
    formatted = transcript.format_transcript()
    persona_block = ""
    if persona:
        persona_block = f"\n--- WEARER PERSONA ---\n{persona}\n--- END PERSONA ---\n"
    user_prompt = PROAGENT_USER.format(elapsed=elapsed, transcript=formatted, persona_block=persona_block)

    print_status(elapsed, len(transcript.turns), checks, triggers)

    try:
        result = call_llm_json(
            base_url, api_key, model,
            PROAGENT_SYSTEM, user_prompt,
            temperature=temperature,
        )
        action = result.get("action", "none")

        log_entry = {
            "elapsed": round(elapsed, 2),
            "check_number": checks,
            "transcript_snapshot": formatted,
            "result": result,
        }
        session_log.append(log_entry)

        if action == "recommend":
            triggers += 1
            print_recommendation(result, elapsed)
        else:
            reason = result.get("reason", "")
            goal = result.get("wearer_goal", "")
            goal_type = result.get("goal_type", "")
            goal_conf = result.get("goal_confidence", "")
            goal_str = f" | goal: {goal}" if goal else ""
            if goal_type:
                goal_str += f" [{goal_type}]"
            if goal_conf:
                goal_str += f" ({goal_conf})"
            print(f"\r  {DIM}[{elapsed:5.1f}s] check #{checks}: no action – {reason}{goal_str}{RESET}")

    except Exception as exc:
        print(f"\n  {RED}[error] LLM call failed: {exc}{RESET}")
        session_log.append({"elapsed": round(elapsed, 2), "error": str(exc)})

    return checks, triggers


def run_scenario_replay(args, base_url: str, api_key: str, model: str, repo_root: Path) -> tuple[float, int, int, TranscriptBuffer, list]:
    """Replay a scenario transcript, running proactive checks at the specified interval."""
    scenario = load_scenario(args.scenario, args.scenario_file, repo_root)
    if not scenario:
        print(f"Error: scenario '{args.scenario}' not found.", file=sys.stderr)
        raise SystemExit(1)

    turns = parse_scenario_turns(scenario["transcript_text"])
    if not turns:
        print(f"Error: scenario has no parseable transcript turns.", file=sys.stderr)
        raise SystemExit(1)

    persona = args.persona or scenario.get("persona", "")
    transcript = TranscriptBuffer(max_seconds=args.context_window)
    session_log: list[dict] = []

    print(f"{BOLD}OcularClaw Scenario Replay{RESET}")
    print(f"  scenario:       {scenario['id']}")
    print(f"  title:          {scenario['title']}")
    print(f"  category:       {scenario.get('category', '')}")
    if persona:
        print(f"  persona:        {persona}")
    print(f"  turns:          {len(turns)}")
    print(f"  duration:       {scenario.get('duration_seconds', '?')}s")
    print(f"  ground truth:   trigger={'yes' if scenario.get('proactive_index') else 'no'}  score={scenario.get('proactive_score', '?')}/5")
    if scenario.get("wearer_goal"):
        print(f"  wearer goal:    {scenario['wearer_goal']}")
    if scenario.get("signal_type") and scenario["signal_type"] != "none":
        print(f"  signal type:    {scenario['signal_type']}")
    print(f"  check interval: {args.check_interval:.1f}s")
    print(f"  model:          {model}")
    print()

    checks = 0
    triggers = 0
    next_check_at = args.check_interval

    for turn in turns:
        elapsed = turn["seconds"]
        transcript.add(turn["text"], elapsed, speaker=turn["speaker"])
        print(f"  {DIM}[{elapsed:5.1f}s]{RESET} {DIM}{turn['speaker']}:{RESET} {turn['text']}")

        # Run proactive check if enough time has passed
        while elapsed >= next_check_at and transcript.has_content():
            checks, triggers = run_proactive_check(
                base_url, api_key, model, args.temperature,
                transcript, next_check_at, persona,
                checks, triggers, session_log,
            )
            next_check_at += args.check_interval

    # Final check at end of transcript
    if transcript.has_content():
        checks, triggers = run_proactive_check(
            base_url, api_key, model, args.temperature,
            transcript, turns[-1]["seconds"], persona,
            checks, triggers, session_log,
        )

    elapsed_total = turns[-1]["seconds"] if turns else 0
    return elapsed_total, checks, triggers, transcript, session_log


def run_live_mic(args, base_url: str, api_key: str, model: str) -> tuple[float, int, int, TranscriptBuffer, list]:
    """Run the live mic capture loop."""
    # Pre-load local whisper model
    get_whisper_model(args.whisper_model)

    audio = ChunkedAudioCapture(sample_rate=args.sample_rate, chunk_seconds=args.chunk_seconds)
    transcript = TranscriptBuffer(max_seconds=args.context_window)
    session_log: list[dict] = []

    print(f"{BOLD}OcularClaw Live Proactive Agent{RESET}")
    print(f"  mode:           {args.agent_mode}")
    print(f"  duration:       {args.duration:.0f}s")
    print(f"  chunk:          {args.chunk_seconds:.1f}s")
    print(f"  check interval: {args.check_interval:.1f}s")
    print(f"  model:          {model}")
    print(f"  base_url:       {base_url}")
    if args.persona:
        print(f"  persona:        {args.persona}")
    print()
    print(f"{DIM}Starting audio capture... speak into your mic.{RESET}")
    print()

    audio.start()
    start_time = time.time()
    last_check_time = start_time
    checks = 0
    triggers = 0

    tmp_dir = Path(tempfile.mkdtemp(prefix="ocularclaw_live_"))

    try:
        while True:
            now = time.time()
            elapsed = now - start_time
            if elapsed >= args.duration:
                break

            # --- Drain and transcribe audio chunk ---
            chunk_data = audio.drain_chunk()
            if chunk_data and len(chunk_data) > 1000:
                wav_path = tmp_dir / "chunk.wav"
                audio.save_chunk_wav(chunk_data, wav_path)
                text = transcribe_local(wav_path, args.whisper_model)
                if text:
                    transcript.add(text, elapsed)
                    print(f"\r  {DIM}[{elapsed:5.1f}s]{RESET} {text}")

            # --- Proactive check ---
            if (now - last_check_time) >= args.check_interval and transcript.has_content():
                last_check_time = now
                checks, triggers = run_proactive_check(
                    base_url, api_key, model, args.temperature,
                    transcript, elapsed, args.persona,
                    checks, triggers, session_log,
                )

            # Sleep until next chunk is ready
            sleep_for = args.chunk_seconds - (time.time() - now)
            if sleep_for > 0:
                time.sleep(sleep_for)

    except KeyboardInterrupt:
        print(f"\n\n{DIM}Interrupted by user.{RESET}")
    finally:
        audio.stop()

    elapsed_total = time.time() - start_time

    # Cleanup temp files
    import shutil
    shutil.rmtree(tmp_dir, ignore_errors=True)

    return elapsed_total, checks, triggers, transcript, session_log

def print_model_comparison(comparison: list[dict]) -> None:
    """Print a side-by-side summary comparing multiple models on the same scenario."""
    print()
    print(f"{BOLD}{'=' * 70}{RESET}")
    print(f"{BOLD}  MODEL COMPARISON SUMMARY{RESET}")
    print(f"{BOLD}{'=' * 70}{RESET}")
    for entry in comparison:
        m = entry["model"]
        triggers = entry["triggers"]
        checks = entry["checks"]
        rate = f"{100 * len(triggers) / checks:.0f}%" if checks else "n/a"
        print()
        print(f"  {BOLD}{CYAN}{m}{RESET}  (triggers: {len(triggers)}/{checks} checks = {rate})")
        if triggers:
            for i, t in enumerate(triggers, 1):
                score = t.get("proactive_score", "?")
                urgency = t.get("urgency", "?")
                signal = t.get("signal_type", "?")
                color = URGENCY_COLOR.get(urgency, YELLOW)
                print(f"    {DIM}trigger {i} @ {t['trigger_timestamp']:.1f}s  score={score}/5  urgency={color}{urgency}{RESET}  signal={signal}")
                print(f"      {CYAN}1:{RESET} {t.get('recommendation_1', '')}")
                print(f"      {CYAN}2:{RESET} {t.get('recommendation_2', '')}")
                print(f"      {DIM}rationale: {t.get('rationale', '')}{RESET}")
        else:
            print(f"    {DIM}(no triggers){RESET}")
    print()
    print(f"{BOLD}{'=' * 70}{RESET}")
    print()


def run_comparison(args, base_url: str, api_key: str, models: list[str], repo_root: Path) -> None:
    """Run the same scenario through multiple models and compare results."""
    if not args.scenario:
        print("Error: --models requires --scenario.", file=sys.stderr)
        raise SystemExit(1)

    print(f"{BOLD}OcularClaw Model Comparison{RESET}")
    print(f"  scenario:   {args.scenario}")
    print(f"  models:     {', '.join(models)}")
    print()

    comparison = []
    log_dir = repo_root / "analysis" / "live_sessions"

    for model in models:
        print(f"{BOLD}{CYAN}--- Running: {model} ---{RESET}")
        elapsed_total, checks, triggers_count, transcript, session_log = run_scenario_replay(
            args, base_url, api_key, model, repo_root
        )

        # Collect trigger entries for comparison display
        trigger_entries = []
        for entry in session_log:
            result = entry.get("result", {})
            if result.get("action") == "recommend":
                trigger_entries.append({
                    "trigger_timestamp": entry["elapsed"],
                    "signal_type": result.get("signal_type", ""),
                    "proactive_score": result.get("proactive_score", ""),
                    "recommendation_mode": result.get("recommendation_mode", "both"),
                    "recommendation_1": result.get("recommendation_1", ""),
                    "recommendation_2": result.get("recommendation_2", ""),
                    "urgency": result.get("urgency", "medium"),
                    "rationale": result.get("rationale", ""),
                })

        comparison.append({"model": model, "checks": checks, "triggers": trigger_entries})

        if args.save_log:
            log_dir.mkdir(parents=True, exist_ok=True)
            ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            safe_model = model.replace("/", "_").replace(":", "_")
            log_path = log_dir / f"compare_{args.scenario}__{safe_model}__{ts}.json"
            log_path.write_text(json.dumps({
                "model": model, "scenario_id": args.scenario,
                "duration_seconds": round(elapsed_total, 2),
                "check_interval": args.check_interval,
                "total_checks": checks, "total_triggers": triggers_count,
                "triggers": trigger_entries, "raw_log": session_log,
            }, indent=2))
            print(f"  log: {log_path}")

        print()

    print_model_comparison(comparison)


def main() -> int:
    args = parse_args()
    repo_root = Path(__file__).resolve().parents[1]
    load_env_file(args.env_file)

    # Resolve API credentials
    base_url = args.base_url or os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")
    api_key = args.api_key or os.environ.get("OPENAI_API_KEY", "")
    model = args.model or os.environ.get("OPENAI_MODEL", "gpt-4.1-mini")

    if not api_key:
        print("Error: no API key. Set OPENAI_API_KEY or pass --api-key.", file=sys.stderr)
        return 1

    # Multi-model comparison mode
    if args.models:
        models = [m.strip() for m in args.models.split(",") if m.strip()]
        if not models:
            print("Error: --models requires at least one model.", file=sys.stderr)
            return 1
        run_comparison(args, base_url, api_key, models, repo_root)
        return 0

    # Run either scenario replay or live mic
    if args.scenario:
        elapsed_total, checks, triggers, transcript, session_log = run_scenario_replay(
            args, base_url, api_key, model, repo_root
        )
    else:
        elapsed_total, checks, triggers, transcript, session_log = run_live_mic(
            args, base_url, api_key, model
        )

    print()
    print(f"{BOLD}Session complete{RESET}")
    print(f"  duration:  {elapsed_total:.1f}s")
    print(f"  checks:    {checks}")
    print(f"  triggers:  {triggers}")

    # Save session log (benchmark-compatible)
    if args.save_log or session_log:
        log_dir = repo_root / "analysis" / "live_sessions"
        log_dir.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        log_path = log_dir / f"session_{ts}.json"

        # Extract benchmark-compatible triggers from log entries
        trigger_entries = []
        for entry in session_log:
            result = entry.get("result", {})
            if result.get("action") == "recommend":
                trigger_entries.append({
                    "trigger_timestamp": entry["elapsed"],
                    "wearer_goal": result.get("wearer_goal", ""),
                    "goal_type": result.get("goal_type", ""),
                    "goal_confidence": result.get("goal_confidence", ""),
                    "signal_type": result.get("signal_type", ""),
                    "proactive_score": result.get("proactive_score", ""),
                    "recommendation_mode": result.get("recommendation_mode", "both"),
                    "recommendation_1": result.get("recommendation_1", ""),
                    "recommendation_2": result.get("recommendation_2", ""),
                    "urgency": result.get("urgency", "medium"),
                    "rationale": result.get("rationale", ""),
                })

        # Extract all goal inferences (including non-trigger checks) for Task C eval
        goal_inferences = []
        for entry in session_log:
            result = entry.get("result", {})
            if result.get("wearer_goal"):
                goal_inferences.append({
                    "timestamp": entry["elapsed"],
                    "wearer_goal": result["wearer_goal"],
                    "goal_type": result.get("goal_type", ""),
                    "goal_confidence": result.get("goal_confidence", ""),
                    "triggered": result.get("action") == "recommend",
                })

        session_data = {
            "agent_mode": args.agent_mode,
            "model": model,
            "persona": args.persona,
            "scenario_id": args.scenario or None,
            "duration_seconds": round(elapsed_total, 2),
            "check_interval": args.check_interval,
            "total_checks": checks,
            "total_triggers": triggers,
            "transcript_text": transcript.format_transcript(),
            # Benchmark-compatible arrays
            "triggers": trigger_entries,
            "goal_inferences": goal_inferences,
            # Full raw log for debugging
            "raw_log": session_log,
        }
        log_path.write_text(json.dumps(session_data, indent=2))
        print(f"  log:       {log_path}")
        print(f"  triggers:  {len(trigger_entries)} saved")
        print(f"  goals:     {len(goal_inferences)} inferences logged")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
