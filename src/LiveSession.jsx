import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Prompts (mirrored from run_live_proactive_agent.py)
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are OcularClaw, an ambient proactive agent observing a live conversation through the wearer's perspective. You perform three tasks in sequence:

Task C (Goal Inference): What is the wearer trying to accomplish right now?
Task A (Intervention Decision): Should you intervene at this moment?
Task B (Recommendation): If yes, generate two recommendations aligned with the wearer's goal.

You must be selective. Most moments do NOT warrant intervention. Only trigger when you detect a clear conversational signal: a self-contradiction, a question being dodged, emotional escalation, a factual error, a missed social cue, a premature commitment, or an actionable opportunity the wearer is about to miss.

CRITICAL RULES:
- Keep recommendations SHORT — max 15 words each. For "say" mode, give ONLY the exact phrase to say.
- NEVER repeat a recommendation you already gave. If a prior recommendation list is provided, each new recommendation must be substantially different in both content and intent.
- If there is nothing NEW to recommend, return action: "none" even if the moment seems important.

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
persuasion, negotiation, social_coordination, relationship_management, information_exchange, collaborative_problem_solving, collaborative_learning, relationship_building, social_bonding, information_delivery, teaching

Return JSON only.`;

function buildUserPrompt(transcript, elapsed, persona, priorRecs) {
  const personaBlock = persona
    ? `\n--- WEARER PERSONA ---\n${persona}\n--- END PERSONA ---\n`
    : "";
  const priorBlock = priorRecs && priorRecs.length > 0
    ? `\n--- PRIOR RECOMMENDATIONS (DO NOT REPEAT) ---\n${priorRecs.map((r, i) => `${i + 1}. ${r}`).join("\n")}\n--- END PRIOR ---\n`
    : "";
  return `Below is the live rolling transcript of the conversation so far (from the wearer's microphone). The current elapsed time is ${elapsed.toFixed(1)} seconds.
${personaBlock}${priorBlock}
--- TRANSCRIPT ---
${transcript}
--- END TRANSCRIPT ---

Perform these three tasks in order:

Task C — Goal Inference:
What is the wearer (P1) trying to accomplish in this conversation right now? Be specific and concrete, not generic. Pick the closest goal_type from the list. Rate your confidence: high, medium, or low.

Task A — Intervention Decision:
Given the wearer's goal, should you intervene at this exact moment? Be selective — only intervene if there is a clear, concrete signal. If triggering, identify which signal_type best describes why.${priorRecs && priorRecs.length > 0 ? " Do NOT trigger if your recommendations would duplicate any prior recommendation listed above." : ""}

Task B — Recommendation (only if intervening):
Generate exactly two recommendations that are aligned with the wearer's goal:
  - recommendation_mode: "say" (suggest what to say), "know" (internal info), or "both"
  - recommendation_1 and recommendation_2: MAX 15 WORDS EACH. For "say" mode, give ONLY the phrase to say. For "know" mode, give ONLY the key fact.
  - Each recommendation must be different from ALL prior recommendations
  - proactive_score: 1-5 (1=no intervention needed, 5=critical moment)
  - rationale: one sentence, why this moment matters

Return one of:

If NO intervention needed:
{"action": "none", "wearer_goal": "...", "goal_type": "...", "goal_confidence": "high|medium|low", "proactive_score": 1, "reason": "brief reason"}

If intervention IS warranted:
{"action": "recommend", "wearer_goal": "...", "goal_type": "...", "goal_confidence": "high|medium|low", "signal_type": "...", "proactive_score": 3, "recommendation_mode": "say|know|both", "recommendation_1": "...", "recommendation_2": "...", "urgency": "low|medium|high", "rationale": "..."}`;
}

// ---------------------------------------------------------------------------
// Speech recognition hook
// ---------------------------------------------------------------------------

function useSpeechRecognition() {
  const recognitionRef = useRef(null);
  const [isListening, setIsListening] = useState(false);
  const [supported, setSupported] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSupported(false);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognitionRef.current = recognition;
  }, []);

  const start = useCallback((onResult, onEnd) => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    setError("");
    setStatus("starting...");
    recognition.onresult = (event) => {
      setStatus("receiving speech");
      onResult(event);
    };
    recognition.onaudiostart = () => setStatus("mic active — listening for speech");
    recognition.onspeechstart = () => setStatus("speech detected");
    recognition.onspeechend = () => setStatus("speech ended, waiting...");
    recognition.onend = () => {
      if (recognitionRef.current?._shouldRestart) {
        setStatus("restarting...");
        try { recognition.start(); } catch { /* already started */ }
      } else {
        setStatus("stopped");
        setIsListening(false);
        onEnd?.();
      }
    };
    recognition.onerror = (e) => {
      console.error("Speech recognition error:", e.error);
      if (e.error === "no-speech") {
        setStatus("no speech heard — still listening...");
        return;
      }
      if (e.error === "aborted") {
        setStatus("aborted — restarting...");
        return;
      }
      if (e.error === "network") {
        setStatus("network error — retrying in 2s...");
        setTimeout(() => {
          if (recognitionRef.current?._shouldRestart) {
            try { recognition.start(); } catch { /* already started */ }
          }
        }, 2000);
        return;
      }
      const messages = {
        "not-allowed": "Microphone access denied. Click the lock icon in your browser's address bar and allow microphone access, then reload.",
        "audio-capture": "No microphone found. Check that a mic is connected and not muted.",
        "network": "Network error — speech recognition needs an internet connection (audio is processed by Google's servers).",
        "service-not-allowed": "Speech service blocked. Make sure you're on localhost or HTTPS.",
      };
      setError(messages[e.error] || `Speech recognition error: ${e.error}`);
      setStatus(`error: ${e.error}`);
    };
    recognition._shouldRestart = true;
    try {
      recognition.start();
      setIsListening(true);
      setStatus("started — waiting for mic access...");
    } catch (err) {
      setError(`Could not start speech recognition: ${err.message}. Try reloading the page.`);
      setIsListening(false);
      setStatus("failed to start");
    }
  }, []);

  const stop = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    recognition._shouldRestart = false;
    recognition.stop();
    setIsListening(false);
    setStatus("stopped");
  }, []);

  return { start, stop, isListening, supported, error, status };
}

// ---------------------------------------------------------------------------
// LLM call
// ---------------------------------------------------------------------------

async function callProactiveCheck(baseUrl, apiKey, model, transcript, elapsed, persona, priorRecs) {
  const url = baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const isOSeries = /^o\d/.test(model.split("/").pop());
  const body = {
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(transcript, elapsed, persona, priorRecs) },
    ],
  };
  if (!isOSeries) body.temperature = 0.3;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`LLM error: ${resp.status}`);
  const data = await resp.json();
  return JSON.parse(data.choices[0].message.content);
}

// ---------------------------------------------------------------------------
// Session history (localStorage)
// ---------------------------------------------------------------------------

const STORAGE_KEY = "ocularclaw-live-sessions";
const EXIT_SURVEY_KEY = "ocularclaw-exit-surveys";

function loadSessionHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSessionHistory(sessions) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

function loadExitSurveys() {
  try {
    const raw = localStorage.getItem(EXIT_SURVEY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveExitSurveys(surveys) {
  localStorage.setItem(EXIT_SURVEY_KEY, JSON.stringify(surveys));
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const URGENCY_COLORS = {
  low: "border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/40",
  medium: "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40",
  high: "border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/40",
};

const SUGGESTED_PERSONAS = [
  { label: "Asking for a Raise", value: "You've been at your job for 2 years and feel underpaid compared to market rates. You're meeting with your boss to ask for a raise. You're nervous but have prepared examples of your contributions." },
  { label: "Job Interview", value: "You're interviewing for a job you really want. You want to come across as confident and capable while asking smart questions about the role and team." },
  { label: "Doctor's Appointment", value: "You're at a doctor's appointment discussing some symptoms you've been worried about. You want to make sure you ask all your questions and understand the doctor's recommendations." },
  { label: "Parent-Teacher Meeting", value: "You're meeting your child's teacher to discuss their progress. Your child has been struggling with math and you want to find out how to help at home." },
  { label: "Apartment Viewing", value: "You're viewing an apartment you might rent. You want to ask the right questions about the lease, neighborhood, and any hidden costs before making a decision." },
  { label: "Car Buying", value: "You're at a car dealership negotiating the price of a used car. You've done research on fair prices and don't want to get pressured into extras you don't need." },
  { label: "First Date", value: "You're on a first date at a coffee shop. You want to be genuine and interesting while getting to know the other person. You're a bit nervous." },
  { label: "Planning a Trip", value: "You're planning a group vacation with 3 friends. Everyone has different budgets and preferences. You're trying to find something that works for everyone." },
];

// ---------------------------------------------------------------------------
// User Study Scenarios (5 structured scenarios for guided live sessions)
// ---------------------------------------------------------------------------

const USER_STUDY_SCENARIOS = [
  {
    id: "us_meeting_action_item",
    label: "S1: Team Meeting",
    category: "work",
    expected_trigger: true,
    expected_score: 4,
    goal_type: "information_exchange",
    signal_type: "structural_gap",
    persona: "You work at a mid-size company. You're in a team meeting where your boss is handing out tasks for the week. You've got a lot on your plate and are thinking about your own to-do list.",
    scene_description: "A regular team meeting. Your boss is going around the room assigning tasks. There are a few other people in the meeting.",
    briefing: "A normal team standup. Your boss will go around the room covering status updates and assigning work. Just participate naturally as you would in a real meeting.",
    confederate_instructions: "You play the boss. Casually assign the participant a task ('can you update the project summary by Thursday?') while they seem distracted. Don't repeat yourself — just move on to the next person.",
  },
  {
    id: "us_explaining_concept",
    label: "S2: One-on-One Discussion",
    category: "work",
    expected_trigger: true,
    expected_score: 4,
    goal_type: "persuasion",
    signal_type: "comprehension_gap",
    persona: "You're trying to explain to a coworker why a project deadline should be pushed back. You understand the reasons well, but the other person doesn't have the same background knowledge as you.",
    scene_description: "A one-on-one meeting. You're sitting across from a coworker who is in charge of the schedule.",
    briefing: "You need to convince your coworker that a deadline should be pushed back. Explain your reasoning naturally and try to get them on board.",
    confederate_instructions: "You play the coworker. Nod along but ask things like 'but can't we just push through?' and 'what's the worst case?' Show that you don't really understand why it's a problem. Don't pretend to understand jargon.",
  },
  {
    id: "us_emotional_support",
    label: "S3: Coffee with a Friend",
    category: "personal",
    expected_trigger: true,
    expected_score: 3,
    goal_type: "relationship_management",
    signal_type: "emotional_escalation",
    persona: "You're catching up with a close friend over coffee. They seem a bit off today — more tired and quiet than usual. You care about them and want to be a good friend.",
    scene_description: "A quiet coffee shop. Your friend looks tired and is fidgeting with their cup.",
    briefing: "You're catching up with a friend who seems a bit down. Just be yourself and have a natural conversation.",
    confederate_instructions: "You play the friend. Start by saying you're fine, then slowly open up about feeling overwhelmed — mention work stress, then hint at relationship problems. Be genuine and relatable, not over-dramatic.",
  },
  {
    id: "us_weekend_plans",
    label: "S4: Planning the Weekend",
    category: "social",
    expected_trigger: true,
    expected_score: 2,
    goal_type: "social_bonding",
    signal_type: "information_enrichment",
    persona: "You and a friend are trying to figure out what to do this Saturday. You're both free all day and want to do something fun but haven't decided what yet.",
    scene_description: "You're sitting with a friend at a cafe, phones out, casually tossing around ideas for the weekend.",
    briefing: "You and a friend are brainstorming weekend plans. Just chat naturally about what sounds fun.",
    confederate_instructions: "Toss out ideas: hiking, checking out a new restaurant, a farmers market, maybe a movie. Be easy-going — shoot down a couple ideas gently ('eh I'm not really feeling a hike') and get excited about others. Keep it casual and collaborative.",
  },
  {
    id: "us_weather_smalltalk",
    label: "S5: Elevator Small Talk",
    category: "social",
    expected_trigger: false,
    expected_score: 1,
    goal_type: "social_bonding",
    signal_type: "none",
    persona: "You're waiting for the elevator with someone you vaguely recognize. You're just making small talk to fill the silence.",
    scene_description: "A hallway near the elevators. You and a casual acquaintance standing side by side, waiting.",
    briefing: "You're waiting for the elevator with an acquaintance. Just chat naturally until it arrives.",
    confederate_instructions: "Make brief small talk: 'nice weather today', 'any plans for the weekend?', 'can't believe how fast this year is going.' Keep it light and surface-level. Don't bring up anything real.",
  },
];

const MODEL_OPTIONS = [
  { label: "GPT-4.1 Mini", value: "openai/gpt-4.1-mini" },
  { label: "GPT-4.1", value: "openai/gpt-4.1" },
  { label: "GPT-4o", value: "openai/gpt-4o" },
  { label: "o3-mini", value: "openai/o3-mini" },
  { label: "Claude Sonnet 4", value: "anthropic/claude-sonnet-4" },
  { label: "Claude Haiku 3.5", value: "anthropic/claude-3.5-haiku" },
  { label: "Gemini 2.5 Flash", value: "google/gemini-2.5-flash-preview" },
  { label: "Gemini 2.5 Pro", value: "google/gemini-2.5-pro-preview" },
];

export default function LiveSession({ apiSettings, setApiSettings, reviewerId, onSessionEnd }) {
  const speech = useSpeechRecognition();

  const [sessionState, setSessionState] = useState("idle"); // idle | running | ended
  const [selectedModel, setSelectedModel] = useState(apiSettings.model || "openai/gpt-4.1-mini");
  const [persona, setPersona] = useState("");
  const [checkInterval, setCheckInterval] = useState(15);
  const [transcriptLines, setTranscriptLines] = useState([]);
  const [interimText, setInterimText] = useState("");
  const [triggers, setTriggers] = useState([]);
  const [triggerFeedback, setTriggerFeedback] = useState({}); // { [triggerId]: { vote: "up"|"down"|null, comment: "" } }
  const [goalInferences, setGoalInferences] = useState([]);
  const [checkCount, setCheckCount] = useState(0);
  const [isChecking, setIsChecking] = useState(false);
  const [lastCheckError, setLastCheckError] = useState("");
  const [usefulness, setUsefulness] = useState(null);
  const [timingRating, setTimingRating] = useState(null);
  const [goalRating, setGoalRating] = useState(null);
  const [adoptionRating, setAdoptionRating] = useState(null);
  const [sessionNotes, setSessionNotes] = useState("");
  const [bestMoment, setBestMoment] = useState("");
  const [worstMoment, setWorstMoment] = useState("");
  const [selectedScenario, setSelectedScenario] = useState(null); // USER_STUDY_SCENARIOS entry or null
  const [studyMode, setStudyMode] = useState(false); // guided study vs free-form
  const [speakerTag, setSpeakerTag] = useState("P1"); // "P1" = wearer speaking, "P2" = other person

  // Exit survey (shown after all scenarios) — load from localStorage if exists for this reviewer
  const [showExitSurvey, setShowExitSurvey] = useState(false);
  const [exitFrequencyPref, setExitFrequencyPref] = useState(null);
  const [exitMostNatural, setExitMostNatural] = useState(null);
  const [exitMostAnnoying, setExitMostAnnoying] = useState(null);
  const [exitOneChange, setExitOneChange] = useState("");

  // Session history
  const [sessionHistory, setSessionHistory] = useState(() => loadSessionHistory());
  const [viewingSession, setViewingSession] = useState(null); // null = live view, session object = reviewing
  const [showHistory, setShowHistory] = useState(false);
  const currentSessionIdRef = useRef(null);

  const startTimeRef = useRef(null);
  const intervalRef = useRef(null);
  const transcriptRef = useRef([]);
  const triggersRef = useRef([]);
  const scrollRef = useRef(null);
  const speakerTagRef = useRef("P1");

  // Keep refs in sync
  useEffect(() => {
    transcriptRef.current = transcriptLines;
  }, [transcriptLines]);
  useEffect(() => {
    triggersRef.current = triggers;
  }, [triggers]);
  useEffect(() => {
    speakerTagRef.current = speakerTag;
  }, [speakerTag]);

  // ?demo=active|ended|exit — seed mock state for thesis screenshots (no API key needed)
  useEffect(() => {
    const demo = new URLSearchParams(window.location.search).get("demo");
    if (!demo) return;
    const scenario = USER_STUDY_SCENARIOS[0];
    const transcript = [
      { seconds: 4.2, speaker: "P2", text: "Okay everyone, quick standup. Let's go around with status and any blockers." },
      { seconds: 12.8, speaker: "P1", text: "I'm wrapping up the AI feature spec — should have a draft by Wednesday." },
      { seconds: 28.5, speaker: "P2", text: "Good. And given the limited resources on my team, we'll prioritize the key features for the PRD." },
      { seconds: 46.0, speaker: "P2", text: "Cuz we have a whole Google conference event coming up at the end of next month." },
      { seconds: 61.4, speaker: "P1", text: "Okay, maybe I'll guess a quick way to scope it." },
    ];
    const trigger = {
      id: "demo_t1",
      timestamp: 225.4,
      afterLineIndex: transcript.length - 1,
      result: {
        wearer_goal: "Clarify project scope and resources for the AI feature PRD to manage workload and expectations.",
        goal_type: "negotiation",
        goal_confidence: "high",
        signal_type: "high_stakes_decision_point",
        proactive_score: 4,
        recommendation_mode: "both",
        recommendation_1: "Say: 'Given the limited resources on my team, can we discuss prioritizing the key features for the PRD to ensure we can deliver quality work by the deadline?'",
        recommendation_2: "Know: The team has only 2 PMs and fewer engineers compared to the PM lead's 8 engineers; pushing for a clear prioritization and resource commitment now can prevent overcommitment and missed deadlines.",
        urgency: "high",
        rationale: "The boss is expressing strong expectations to launch the AI feature by the end of the quarter and at a conference next month, but the wearer lacks resources. This is a critical moment to negotiate scope and clarify commitments to avoid overloading the wearer's team and ensure realistic planning.",
      },
    };
    setSelectedScenario(scenario);
    setStudyMode(true);
    setPersona(scenario.persona);
    setTranscriptLines(transcript);
    transcriptRef.current = transcript;
    if (demo === "active" || demo === "ended") {
      setTriggers([trigger]);
      triggersRef.current = [trigger];
      setCheckCount(3);
      setGoalInferences([{ timestamp: 220, wearer_goal: trigger.result.wearer_goal, goal_type: "negotiation", goal_confidence: "high", triggered: true }]);
      startTimeRef.current = Date.now() - 230000;
    }
    if (demo === "active") {
      setSessionState("running");
    } else if (demo === "ended") {
      setSessionState("ended");
      currentSessionIdRef.current = "demo_session";
    } else if (demo === "exit") {
      setSessionState("idle");
      setShowExitSurvey(true);
      setExitFrequencyPref(2);
      setExitMostNatural(2);
      setExitMostAnnoying(4);
      setExitOneChange("");
    }
  }, []);

  // Spacebar toggles speaker during running session (unless typing in an input)
  useEffect(() => {
    if (sessionState !== "running") return;
    const handleKeyDown = (e) => {
      if (e.code !== "Space") return;
      const tag = e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable) return;
      e.preventDefault();
      setSpeakerTag((prev) => (prev === "P1" ? "P2" : "P1"));
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sessionState]);

  // Load exit survey data when reviewer ID changes
  useEffect(() => {
    const all = loadExitSurveys();
    const mine = all.find((s) => s.reviewer_id === reviewerId);
    if (mine) {
      setExitFrequencyPref(mine.frequency_preference || null);
      setExitMostNatural(mine.most_natural_scenario || null);
      setExitMostAnnoying(mine.most_annoying_scenario || null);
      setExitOneChange(mine.one_change || "");
    } else {
      setExitFrequencyPref(null);
      setExitMostNatural(null);
      setExitMostAnnoying(null);
      setExitOneChange("");
    }
  }, [reviewerId]);

  // Auto-save exit survey to localStorage when fields change
  useEffect(() => {
    if (!exitFrequencyPref && !exitMostNatural && !exitMostAnnoying && !exitOneChange) return;
    const timer = setTimeout(() => {
      const survey = {
        reviewer_id: reviewerId || "anonymous",
        created_at: new Date().toISOString(),
        total_sessions: sessionHistory.length,
        frequency_preference: exitFrequencyPref,
        frequency_label: ["", "much less", "less", "about right", "more", "much more"][exitFrequencyPref] || null,
        most_natural_scenario: exitMostNatural,
        most_annoying_scenario: exitMostAnnoying,
        one_change: exitOneChange,
      };
      const all = loadExitSurveys().filter((s) => s.reviewer_id !== (reviewerId || "anonymous"));
      all.push(survey);
      saveExitSurveys(all);
    }, 800);
    return () => clearTimeout(timer);
  }, [exitFrequencyPref, exitMostNatural, exitMostAnnoying, exitOneChange, reviewerId, sessionHistory.length]);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [transcriptLines, triggers, interimText]);

  const getElapsed = () => (Date.now() - startTimeRef.current) / 1000;

  const formatTranscript = () =>
    transcriptRef.current
      .map((l) => {
        const m = Math.floor(l.seconds / 60);
        const s = (l.seconds % 60).toFixed(2).padStart(5, "0");
        return `[${String(m).padStart(2, "0")}:${s}] ${l.speaker}: ${l.text}`;
      })
      .join("\n");

  const runCheck = useCallback(async () => {
    if (!apiSettings.apiKey || transcriptRef.current.length === 0) return;
    setIsChecking(true);
    setLastCheckError("");
    const elapsed = getElapsed();
    // Collect prior recommendations for deduplication
    const priorRecs = triggersRef.current.flatMap((t) => [
      t.result.recommendation_1,
      t.result.recommendation_2,
    ].filter(Boolean));
    try {
      const result = await callProactiveCheck(
        apiSettings.baseUrl, apiSettings.apiKey, selectedModel,
        formatTranscript(), elapsed, persona, priorRecs,
      );
      setCheckCount((c) => c + 1);

      if (result.wearer_goal) {
        setGoalInferences((prev) => [...prev, {
          timestamp: elapsed,
          wearer_goal: result.wearer_goal,
          goal_type: result.goal_type || "",
          goal_confidence: result.goal_confidence || "",
          triggered: result.action === "recommend",
        }]);
      }

      if (result.action === "recommend") {
        const trigger = {
          id: `live_t${Date.now()}`,
          timestamp: elapsed,
          result,
          afterLineIndex: transcriptRef.current.length - 1,
        };
        setTriggers((prev) => [...prev, trigger]);
      }
    } catch (err) {
      setLastCheckError(err.message);
    }
    setIsChecking(false);
  }, [apiSettings, selectedModel, persona]);

  const buildSessionLog = () => {
    const elapsed = startTimeRef.current ? getElapsed() : 0;
    const triggerEntries = triggers.map((t) => {
      const fb = triggerFeedback[t.id] || {};
      return {
        trigger_timestamp: t.timestamp,
        wearer_goal: t.result.wearer_goal || "",
        goal_type: t.result.goal_type || "",
        goal_confidence: t.result.goal_confidence || "",
        signal_type: t.result.signal_type || "",
        proactive_score: t.result.proactive_score || "",
        recommendation_mode: t.result.recommendation_mode || "both",
        recommendation_1: t.result.recommendation_1 || "",
        recommendation_2: t.result.recommendation_2 || "",
        urgency: t.result.urgency || "medium",
        rationale: t.result.rationale || "",
        feedback_vote: fb.vote || null,
        feedback_comment: fb.comment || "",
      };
    });

    return {
      id: currentSessionIdRef.current || `session_${Date.now()}`,
      agent_mode: "proagent",
      model: selectedModel,
      persona,
      scenario_id: selectedScenario?.id || null,
      scenario_label: selectedScenario?.label || null,
      expected_trigger: selectedScenario?.expected_trigger ?? null,
      expected_score: selectedScenario?.expected_score ?? null,
      study_mode: studyMode,
      source: "live_frontend",
      reviewer_id: reviewerId || "anonymous",
      duration_seconds: Math.round(elapsed * 100) / 100,
      check_interval: checkInterval,
      total_checks: checkCount,
      total_triggers: triggers.length,
      transcript_lines: transcriptLines,
      transcript_text: formatTranscript(),
      triggers: triggerEntries,
      goal_inferences: goalInferences,
      usefulness_rating: usefulness,
      timing_rating: timingRating,
      goal_rating: goalRating,
      adoption_rating: adoptionRating,
      session_notes: sessionNotes,
      best_moment: bestMoment,
      worst_moment: worstMoment,
      created_at: new Date().toISOString(),
    };
  };

  /** Save current session to localStorage history */
  const saveSession = useCallback(() => {
    const log = buildSessionLog();
    setSessionHistory((prev) => {
      const exists = prev.findIndex((s) => s.id === log.id);
      let next;
      if (exists >= 0) {
        next = [...prev];
        next[exists] = log;
      } else {
        next = [log, ...prev];
      }
      saveSessionHistory(next);
      return next;
    });
    return log;
  }, [buildSessionLog]);

  const deleteSession = (sessionId) => {
    setSessionHistory((prev) => {
      const next = prev.filter((s) => s.id !== sessionId);
      saveSessionHistory(next);
      return next;
    });
    if (viewingSession?.id === sessionId) {
      setViewingSession(null);
    }
  };

  const downloadSession = (session) => {
    const blob = new Blob([JSON.stringify(session, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ts = (session.created_at || new Date().toISOString()).replace(/[:.]/g, "").slice(0, 15);
    a.download = `live_session_${session.reviewer_id || "anon"}_${ts}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportAllSessions = () => {
    const blob = new Blob([JSON.stringify(sessionHistory, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `all_live_sessions_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importSessions = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.multiple = true;
    input.onchange = async (e) => {
      const files = Array.from(e.target.files || []);
      const imported = [];
      for (const file of files) {
        try {
          const text = await file.text();
          const data = JSON.parse(text);
          // Handle both single session and array of sessions
          const sessions = Array.isArray(data) ? data : [data];
          for (const s of sessions) {
            if (s.id || s.scenario_id || s.reviewer_id) {
              imported.push(s);
            }
          }
        } catch (err) {
          console.warn(`Failed to parse ${file.name}:`, err);
        }
      }
      if (imported.length > 0) {
        setSessionHistory((prev) => {
          const existingIds = new Set(prev.map((s) => s.id));
          const newSessions = imported.filter((s) => !existingIds.has(s.id));
          const next = [...newSessions, ...prev];
          saveSessionHistory(next);
          return next;
        });
        alert(`Imported ${imported.length} session(s).`);
      }
    };
    input.click();
  };

  const exportExitSurvey = () => {
    const data = {
      reviewer_id: reviewerId || "anonymous",
      created_at: new Date().toISOString(),
      total_sessions: sessionHistory.length,
      frequency_preference: exitFrequencyPref,
      frequency_label: ["", "much less", "less", "about right", "more", "much more"][exitFrequencyPref] || null,
      most_natural_scenario: exitMostNatural,
      most_annoying_scenario: exitMostAnnoying,
      one_change: exitOneChange,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `exit_survey_${reviewerId || "anon"}_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const startSession = () => {
    if (!apiSettings.apiKey) {
      setLastCheckError("Set API key in API Settings first.");
      return;
    }
    currentSessionIdRef.current = `session_${Date.now()}`;
    startTimeRef.current = Date.now();
    setSessionState("running");
    setViewingSession(null);
    setShowHistory(false);
    setTranscriptLines([]);
    setTriggers([]);
    setTriggerFeedback({});
    setGoalInferences([]);
    setCheckCount(0);
    setInterimText("");
    setUsefulness(null);
    setTimingRating(null);
    setGoalRating(null);
    setAdoptionRating(null);
    setSessionNotes("");
    setBestMoment("");
    setWorstMoment("");
    setSpeakerTag("P1");

    speech.start((event) => {
      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      let final = "";
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript.trim();
        if (event.results[i].isFinal) {
          final += (final ? " " : "") + text;
        } else {
          interim = text;
        }
      }
      if (final) {
        setTranscriptLines((prev) => [
          ...prev,
          { seconds: Math.round(elapsed * 100) / 100, speaker: speakerTagRef.current, text: final },
        ]);
        setInterimText("");
      } else {
        setInterimText(interim);
      }
    });

    intervalRef.current = setInterval(runCheck, checkInterval * 1000);
  };

  const endSession = () => {
    speech.stop();
    if (intervalRef.current) clearInterval(intervalRef.current);
    runCheck();
    setSessionState("ended");
    // Auto-save immediately (synchronous, so history is populated before user clicks)
    const log = buildSessionLog();
    setSessionHistory((prev) => {
      const next = [log, ...prev.filter((s) => s.id !== log.id)];
      saveSessionHistory(next);
      return next;
    });
  };

  // Load review data when viewing a saved session
  const viewingSessionIdRef = useRef(null);
  useEffect(() => {
    if (viewingSession && viewingSession.id !== viewingSessionIdRef.current) {
      viewingSessionIdRef.current = viewingSession.id;
      setUsefulness(viewingSession.usefulness_rating || null);
      setTimingRating(viewingSession.timing_rating || null);
      setGoalRating(viewingSession.goal_rating || null);
      setAdoptionRating(viewingSession.adoption_rating || null);
      setBestMoment(viewingSession.best_moment || "");
      setWorstMoment(viewingSession.worst_moment || "");
      setSessionNotes(viewingSession.session_notes || "");
      // Restore per-trigger feedback
      const fb = {};
      for (const t of viewingSession.triggers || []) {
        const key = t.id || t.trigger_timestamp;
        if (t.feedback_vote || t.feedback_comment) {
          fb[key] = { vote: t.feedback_vote || null, comment: t.feedback_comment || "" };
        }
      }
      setTriggerFeedback(fb);
    } else if (!viewingSession && viewingSessionIdRef.current) {
      viewingSessionIdRef.current = null;
    }
  }, [viewingSession]);

  // Auto-save when review fields change on ended session
  useEffect(() => {
    if (sessionState === "ended" && currentSessionIdRef.current) {
      const timer = setTimeout(() => {
        const log = buildSessionLog();
        setSessionHistory((prev) => {
          const next = prev.map((s) => (s.id === log.id ? log : s));
          // If not found (first save), prepend
          if (!next.find((s) => s.id === log.id)) next.unshift(log);
          saveSessionHistory(next);
          return next;
        });
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [usefulness, timingRating, goalRating, adoptionRating, sessionNotes, bestMoment, worstMoment, sessionState, triggerFeedback]);

  // Auto-save when review fields change on a VIEWED (history) session
  useEffect(() => {
    if (!viewingSession) return;
    const timer = setTimeout(() => {
      setSessionHistory((prev) => {
        const next = prev.map((s) => {
          if (s.id !== viewingSession.id) return s;
          const updatedTriggers = (s.triggers || []).map((t, i) => {
            const key = `saved_t${i}`;
            const fb = triggerFeedback[key] || triggerFeedback[t.trigger_timestamp];
            return {
              ...t,
              feedback_vote: fb?.vote || t.feedback_vote || null,
              feedback_comment: fb?.comment || t.feedback_comment || "",
            };
          });
          return {
            ...s,
            usefulness_rating: usefulness,
            timing_rating: timingRating,
            goal_rating: goalRating,
            adoption_rating: adoptionRating,
            best_moment: bestMoment,
            worst_moment: worstMoment,
            session_notes: sessionNotes,
            triggers: updatedTriggers,
          };
        });
        saveSessionHistory(next);
        return next;
      });
      // Also update the viewingSession object so header reflects changes
      setViewingSession((prev) => prev ? {
        ...prev,
        usefulness_rating: usefulness,
        timing_rating: timingRating,
        goal_rating: goalRating,
        adoption_rating: adoptionRating,
        best_moment: bestMoment,
        worst_moment: worstMoment,
        session_notes: sessionNotes,
      } : prev);
    }, 800);
    return () => clearTimeout(timer);
  }, [usefulness, timingRating, goalRating, adoptionRating, sessionNotes, bestMoment, worstMoment, triggerFeedback, viewingSession?.id]);

  // Build interleaved transcript + triggers for display
  const buildDisplayElements = (lines, trigs) => {
    const triggersByLine = {};
    for (const t of trigs) {
      const idx = t.afterLineIndex ?? 0;
      if (!triggersByLine[idx]) triggersByLine[idx] = [];
      triggersByLine[idx].push(t);
    }

    const elements = [];
    lines.forEach((line, index) => {
      const m = Math.floor(line.seconds / 60);
      const s = (line.seconds % 60).toFixed(2);
      elements.push(
        <div key={`line-${index}`} className="flex gap-3 text-sm py-1.5">
          <span className="min-w-[72px] font-mono text-xs text-slate-400 dark:text-slate-500 pt-0.5">
            {String(m).padStart(2, "0")}:{s.padStart(5, "0")}
          </span>
          <div>
            <span className={`mr-2 font-semibold ${
              line.speaker === "P1"
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-blue-700 dark:text-blue-400"
            }`}>{line.speaker}</span>
            <span className="text-slate-800 dark:text-slate-200">{line.text}</span>
          </div>
        </div>,
      );

      if (triggersByLine[index]) {
        for (const trigger of triggersByLine[index]) {
          const r = trigger.result || trigger;
          const urgencyClass = URGENCY_COLORS[r.urgency] || URGENCY_COLORS.medium;
          elements.push(
            <div
              key={`trigger-${trigger.id || index}`}
              className={`my-2 rounded-xl border-2 px-4 py-3 ${urgencyClass}`}
            >
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-purple-100 px-2 py-0.5 font-bold text-purple-700 dark:bg-purple-900/60 dark:text-purple-300">
                  AGENT
                </span>
                <span className="font-mono text-slate-500">{(trigger.timestamp ?? trigger.trigger_timestamp ?? 0).toFixed?.(1) || trigger.trigger_timestamp}s</span>
                <span className="rounded-full bg-slate-200 px-2 py-0.5 font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                  {r.recommendation_mode}
                </span>
                {r.proactive_score && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700 dark:bg-amber-900/60 dark:text-amber-300">
                    {r.proactive_score}/5
                  </span>
                )}
                {r.signal_type && (
                  <span className="rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-rose-600 dark:bg-rose-900/60 dark:text-rose-300">
                    {r.signal_type}
                  </span>
                )}
                <span className="rounded-full bg-slate-200 px-2 py-0.5 font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                  {r.urgency}
                </span>
              </div>
              {(r.wearer_goal) && (
                <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-1.5 dark:border-amber-800 dark:bg-amber-950/30">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-500">Goal</span>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    &ldquo;{r.wearer_goal}&rdquo;
                    {r.goal_type ? <span className="ml-1 text-xs text-slate-400">[{r.goal_type}]</span> : ""}
                    {r.goal_confidence ? <span className="ml-1 text-xs text-slate-400">({r.goal_confidence})</span> : ""}
                  </p>
                </div>
              )}
              <div className="mt-2 grid gap-1.5">
                <div className="flex gap-2 text-sm">
                  <span className="font-bold text-cyan-600 dark:text-cyan-400">1:</span>
                  <span className="text-slate-800 dark:text-slate-200">{r.recommendation_1}</span>
                </div>
                <div className="flex gap-2 text-sm">
                  <span className="font-bold text-cyan-600 dark:text-cyan-400">2:</span>
                  <span className="text-slate-800 dark:text-slate-200">{r.recommendation_2}</span>
                </div>
              </div>
              {r.rationale && (
                <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                  {r.rationale}
                </p>
              )}
              {/* Feedback: thumbs up/down + optional comment */}
              <div className="mt-2 flex items-center gap-2 border-t border-slate-200/60 pt-2 dark:border-slate-700/60">
                <button
                  type="button"
                  onClick={() =>
                    setTriggerFeedback((prev) => ({
                      ...prev,
                      [trigger.id || index]: {
                        ...prev[trigger.id || index],
                        vote: prev[trigger.id || index]?.vote === "up" ? null : "up",
                      },
                    }))
                  }
                  className={`rounded-md px-2 py-1 text-sm transition ${
                    triggerFeedback[trigger.id || index]?.vote === "up"
                      ? "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300"
                      : "text-slate-400 hover:bg-slate-100 hover:text-green-600 dark:hover:bg-slate-700"
                  }`}
                  title="Helpful"
                >
                  👍
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setTriggerFeedback((prev) => ({
                      ...prev,
                      [trigger.id || index]: {
                        ...prev[trigger.id || index],
                        vote: prev[trigger.id || index]?.vote === "down" ? null : "down",
                      },
                    }))
                  }
                  className={`rounded-md px-2 py-1 text-sm transition ${
                    triggerFeedback[trigger.id || index]?.vote === "down"
                      ? "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300"
                      : "text-slate-400 hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-700"
                  }`}
                  title="Not helpful"
                >
                  👎
                </button>
                {triggerFeedback[trigger.id || index]?.vote && (
                  <input
                    type="text"
                    placeholder="Optional comment…"
                    value={triggerFeedback[trigger.id || index]?.comment || ""}
                    onChange={(e) =>
                      setTriggerFeedback((prev) => ({
                        ...prev,
                        [trigger.id || index]: {
                          ...prev[trigger.id || index],
                          comment: e.target.value,
                        },
                      }))
                    }
                    className="ml-1 flex-1 rounded-md border border-slate-200 bg-white/60 px-2 py-1 text-xs text-slate-700 placeholder-slate-400 focus:border-purple-400 focus:outline-none dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-200 dark:placeholder-slate-500"
                  />
                )}
              </div>
            </div>,
          );
        }
      }
    });

    // Show interim speech at the end (live only)
    if (!viewingSession && interimText) {
      elements.push(
        <div key="interim" className="flex gap-3 text-sm py-1.5 opacity-50">
          <span className="min-w-[72px] font-mono text-xs text-slate-400">...</span>
          <span className="text-slate-500 italic">{interimText}</span>
        </div>,
      );
    }

    return elements;
  };

  // Reconstruct trigger objects from saved session for display
  const viewingTriggers = viewingSession
    ? (viewingSession.triggers || []).map((t, i) => {
        // Find the transcript line closest to this trigger's timestamp
        const lines = viewingSession.transcript_lines || [];
        let afterIdx = lines.length - 1;
        for (let j = 0; j < lines.length; j++) {
          if (lines[j].seconds > (t.trigger_timestamp || 0)) {
            afterIdx = Math.max(0, j - 1);
            break;
          }
        }
        return { ...t, id: `saved_t${i}`, timestamp: t.trigger_timestamp, result: t, afterLineIndex: afterIdx };
      })
    : [];

  if (!speech.supported) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center dark:border-rose-900 dark:bg-rose-950/30">
        <p className="text-sm text-rose-700 dark:text-rose-300">
          Speech recognition is not supported in this browser. Use Chrome for live sessions.
        </p>
      </div>
    );
  }

  // ---------- Viewing a saved session ----------
  if (viewingSession) {
    const s = viewingSession;
    const lines = s.transcript_lines || [];
    return (
      <div className="flex h-full flex-col gap-4">
        {/* Header */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setViewingSession(null)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-slate-400 transition dark:border-slate-700 dark:text-slate-300"
                >
                  &larr; Back
                </button>
                <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                  Session — {new Date(s.created_at).toLocaleString()}
                </h2>
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500 dark:text-slate-400">
                <span>Model: <strong>{s.model}</strong></span>
                <span>Duration: <strong>{Math.round(s.duration_seconds)}s</strong></span>
                <span>Checks: <strong>{s.total_checks}</strong></span>
                <span>Triggers: <strong>{s.total_triggers}</strong></span>
                <span>Reviewer: <strong>{s.reviewer_id}</strong></span>
                {s.scenario_label && <span>Scenario: <strong>{s.scenario_label}</strong></span>}
              </div>
              {s.persona && (
                <p className="mt-1 text-xs text-purple-600 dark:text-purple-400 italic">{s.persona}</p>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => downloadSession(s)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-slate-400 transition dark:border-slate-700 dark:text-slate-300"
              >
                Download JSON
              </button>
              <button
                onClick={() => { if (confirm("Delete this session?")) deleteSession(s.id); }}
                className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-600 hover:border-rose-400 transition dark:border-rose-700 dark:text-rose-300"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
        {/* Transcript replay */}
        <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-slate-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
          {lines.length > 0
            ? buildDisplayElements(lines, viewingTriggers)
            : <p className="text-sm text-slate-400">No transcript lines recorded.</p>
          }
        </div>

        {/* Editable Session Review for history sessions */}
        <details open={!!(usefulness || timingRating || goalRating || adoptionRating)} className="rounded-2xl border-2 border-indigo-200 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950/30 overflow-hidden">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-bold text-indigo-900 dark:text-indigo-200 hover:bg-indigo-100/50 dark:hover:bg-indigo-900/20 transition">
            Session Review {usefulness ? `(H:${usefulness} T:${timingRating || '-'} G:${goalRating || '-'} A:${adoptionRating || '-'})` : '— click to review'}
          </summary>
          <div className="max-h-[45vh] overflow-auto px-4 pb-4">
          <p className="mt-1 text-xs text-indigo-700 dark:text-indigo-400">
            Rate the agent&apos;s performance. Be honest — low scores are just as valuable. (auto-saves)
          </p>

          {/* Q1: Helpfulness */}
          <div className="mt-4">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-400">
              1. Helpfulness (1-5)
            </span>
            <p className="text-[10px] text-indigo-500 dark:text-indigo-500">
              Were the recommendations useful and actionable?
            </p>
            <div className="mt-1.5 flex gap-2">
              {[1, 2, 3, 4, 5].map((v) => (
                <button
                  key={v}
                  onClick={() => setUsefulness(usefulness === v ? null : v)}
                  className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${
                    usefulness === v
                      ? "border-indigo-500 bg-indigo-100 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-900/40 dark:text-indigo-300"
                      : "border-slate-300 bg-white text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Q2: Timing */}
          <div className="mt-4">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-400">
              2. Timing (1-5)
            </span>
            <p className="text-[10px] text-emerald-500 dark:text-emerald-500">
              Did the agent speak up at the right moments?
            </p>
            <div className="mt-1.5 flex gap-2">
              {[1, 2, 3, 4, 5].map((v) => (
                <button
                  key={v}
                  onClick={() => setTimingRating(timingRating === v ? null : v)}
                  className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${
                    timingRating === v
                      ? "border-emerald-500 bg-emerald-100 text-emerald-700 dark:border-emerald-400 dark:bg-emerald-900/40 dark:text-emerald-300"
                      : "border-slate-300 bg-white text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Q3: Goal Understanding */}
          <div className="mt-4">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-600 dark:text-amber-400">
              3. Goal Understanding (1-5)
            </span>
            <p className="text-[10px] text-amber-500 dark:text-amber-500">
              Did the agent understand what you were trying to accomplish?
            </p>
            <div className="mt-1.5 flex gap-2">
              {[1, 2, 3, 4, 5].map((v) => (
                <button
                  key={v}
                  onClick={() => setGoalRating(goalRating === v ? null : v)}
                  className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${
                    goalRating === v
                      ? "border-amber-500 bg-amber-100 text-amber-700 dark:border-amber-400 dark:bg-amber-900/40 dark:text-amber-300"
                      : "border-slate-300 bg-white text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Q4: Adoption */}
          <div className="mt-4">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-purple-600 dark:text-purple-400">
              4. Would You Use This? (1-5)
            </span>
            <p className="text-[10px] text-purple-500 dark:text-purple-500">
              If this agent existed on real smart glasses, would you want it?
            </p>
            <div className="mt-1.5 flex gap-2">
              {[1, 2, 3, 4, 5].map((v) => (
                <button
                  key={v}
                  onClick={() => setAdoptionRating(adoptionRating === v ? null : v)}
                  className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${
                    adoptionRating === v
                      ? "border-purple-500 bg-purple-100 text-purple-700 dark:border-purple-400 dark:bg-purple-900/40 dark:text-purple-300"
                      : "border-slate-300 bg-white text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Q5-6: Best/Worst */}
          <div className="mt-4">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-400">
                5. Best Moment
              </span>
              <textarea
                rows={2}
                value={bestMoment}
                onChange={(e) => setBestMoment(e.target.value)}
                placeholder="Was there a specific moment where the agent was genuinely helpful?"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </label>
          </div>
          <div className="mt-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-rose-600 dark:text-rose-400">
                6. Worst Moment
              </span>
              <textarea
                rows={2}
                value={worstMoment}
                onChange={(e) => setWorstMoment(e.target.value)}
                placeholder="Was there a moment where the agent was annoying, wrong, or distracting?"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-rose-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </label>
          </div>

          {/* Q7: Notes */}
          <div className="mt-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-400">
                7. Anything Else?
              </span>
              <textarea
                rows={2}
                value={sessionNotes}
                onChange={(e) => setSessionNotes(e.target.value)}
                placeholder="Any other thoughts — surprises, suggestions, things you wish the agent had done differently?"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </label>
          </div>
          </div>
        </details>
      </div>
    );
  }

  // ---------- Main live session UI ----------
  return (
    <div className="flex h-full flex-col gap-4">
      {/* Study Mode Toggle + Scenario Picker */}
      {sessionState === "idle" && (
        <div className="rounded-2xl border border-purple-200 bg-purple-50/50 p-4 dark:border-purple-900/50 dark:bg-purple-950/20">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-purple-900 dark:text-purple-200">Session Mode</h3>
              <p className="mt-0.5 text-xs text-purple-700 dark:text-purple-400">
                {studyMode
                  ? "Guided study — select a scenario below and follow the briefing."
                  : "Free-form — set your own persona and scenario."}
              </p>
            </div>
            <div className="flex rounded-xl border border-purple-300 bg-white overflow-hidden dark:border-purple-700 dark:bg-slate-950">
              {[
                { id: false, label: "Free-form" },
                { id: true, label: "User Study" },
              ].map(({ id, label }) => (
                <button
                  key={String(id)}
                  type="button"
                  onClick={() => {
                    setStudyMode(id);
                    if (!id) setSelectedScenario(null);
                  }}
                  className={`px-4 py-2 text-xs font-semibold transition ${
                    studyMode === id
                      ? "bg-purple-600 text-white"
                      : "text-purple-600 hover:bg-purple-50 dark:text-purple-300 dark:hover:bg-purple-950/40"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {studyMode && (
            <div className="mt-4 space-y-3">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {USER_STUDY_SCENARIOS.map((scenario) => (
                  <button
                    key={scenario.id}
                    type="button"
                    onClick={() => {
                      setSelectedScenario(scenario);
                      setPersona(scenario.persona);
                    }}
                    className={`rounded-xl border-2 px-3 py-3 text-left transition ${
                      selectedScenario?.id === scenario.id
                        ? "border-purple-500 bg-purple-100 ring-2 ring-purple-300 dark:border-purple-400 dark:bg-purple-900/40 dark:ring-purple-700"
                        : "border-slate-200 bg-white hover:border-purple-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-purple-700"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                        {scenario.label}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        {scenario.category}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
                      {scenario.briefing}
                    </p>
                  </button>
                ))}
              </div>

              {/* Scenario briefing card */}
              {selectedScenario && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
                  <h4 className="text-sm font-bold text-amber-900 dark:text-amber-200">
                    Scenario Briefing — {selectedScenario.label}
                  </h4>
                  <div className="mt-3 grid gap-3 text-sm">
                    <div>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">Your Persona</span>
                      <p className="mt-0.5 text-slate-700 dark:text-slate-300">{selectedScenario.persona}</p>
                    </div>
                    <div>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">Scene</span>
                      <p className="mt-0.5 text-slate-700 dark:text-slate-300">{selectedScenario.scene_description}</p>
                    </div>
                    <div>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">Your Task</span>
                      <p className="mt-0.5 text-slate-700 dark:text-slate-300">{selectedScenario.briefing}</p>
                    </div>
                    <details className="rounded-xl border border-rose-200 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-950/20">
                      <summary className="cursor-pointer list-none px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400">
                        Confederate Instructions (for the researcher / other speaker)
                      </summary>
                      <div className="px-3 pb-3">
                        <p className="text-xs text-rose-700 dark:text-rose-300">{selectedScenario.confederate_instructions}</p>
                      </div>
                    </details>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-end gap-4">
          {/* Model selector */}
          <label className="block min-w-[200px]">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Model
            </span>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={sessionState === "running"}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-purple-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              {MODEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
              {!MODEL_OPTIONS.some((o) => o.value === selectedModel) && (
                <option value={selectedModel}>{selectedModel}</option>
              )}
            </select>
          </label>
          {/* Persona */}
          <div className="block flex-1 min-w-[280px]">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Persona
              </span>
              {sessionState !== "running" && (
                <span className="text-[10px] text-slate-400 dark:text-slate-500">click a suggestion or type your own</span>
              )}
            </div>
            <input
              type="text"
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
              disabled={sessionState === "running"}
              placeholder="Describe who you are and what you're trying to accomplish..."
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-purple-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
            {sessionState === "idle" && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {SUGGESTED_PERSONAS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setPersona(p.value)}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                      persona === p.value
                        ? "border-purple-400 bg-purple-50 text-purple-700 dark:border-purple-700 dark:bg-purple-950/40 dark:text-purple-300"
                        : "border-slate-200 bg-slate-50 text-slate-600 hover:border-purple-300 hover:bg-purple-50/50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-purple-700"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <label className="block w-40" title="How often (in seconds) the agent reads the transcript and decides whether to intervene. Lower = more responsive but more API calls.">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Agent Check Every
            </span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={checkInterval}
                onChange={(e) => setCheckInterval(Math.max(5, Number(e.target.value)))}
                disabled={sessionState === "running"}
                min={5}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-purple-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
              <span className="text-xs text-slate-400 whitespace-nowrap">sec</span>
            </div>
          </label>
          <div className="flex gap-2">
            {sessionState === "idle" && (
              <>
                <button
                  onClick={startSession}
                  className="rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 transition"
                >
                  Start Live Session
                </button>
                <button
                  onClick={() => setShowHistory(!showHistory)}
                  className={`rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${
                    showHistory
                      ? "border-indigo-400 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300"
                      : "border-slate-300 text-slate-700 hover:border-slate-400 dark:border-slate-700 dark:text-slate-300"
                  }`}
                >
                  History {sessionHistory.length > 0 && `(${sessionHistory.length})`}
                </button>
                {sessionHistory.length >= 1 && (
                  <button
                    onClick={() => setShowExitSurvey(!showExitSurvey)}
                    className={`rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${
                      showExitSurvey
                        ? "border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                        : "border-slate-300 text-slate-700 hover:border-slate-400 dark:border-slate-700 dark:text-slate-300"
                    }`}
                  >
                    Exit Survey {loadExitSurveys().find(s => s.reviewer_id === reviewerId) ? "✓" : ""}
                  </button>
                )}
              </>
            )}
            {sessionState === "running" && (
              <button
                onClick={endSession}
                className="rounded-xl bg-rose-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-rose-700 transition animate-pulse"
              >
                End Session
              </button>
            )}
            {sessionState === "ended" && (
              <>
                <button
                  onClick={() => downloadSession(buildSessionLog())}
                  className="rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 transition"
                >
                  Download JSON
                </button>
                <button
                  onClick={() => setShowHistory(!showHistory)}
                  className={`rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${
                    showHistory
                      ? "border-indigo-400 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300"
                      : "border-slate-300 text-slate-700 hover:border-slate-400 dark:border-slate-700 dark:text-slate-300"
                  }`}
                >
                  History {sessionHistory.length > 0 && `(${sessionHistory.length})`}
                </button>
                {sessionHistory.length >= 1 && (
                  <button
                    onClick={() => setShowExitSurvey(!showExitSurvey)}
                    className={`rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${
                      showExitSurvey
                        ? "border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                        : "border-slate-300 text-slate-700 hover:border-slate-400 dark:border-slate-700 dark:text-slate-300"
                    }`}
                  >
                    Exit Survey {loadExitSurveys().find(s => s.reviewer_id === reviewerId) ? "✓" : ""}
                  </button>
                )}
                <button
                  onClick={() => {
                    // Save current session BEFORE clearing state & auto-save to disk
                    if (currentSessionIdRef.current) {
                      saveSession();
                      const log = buildSessionLog();
                      fetch("/api/save-session", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(log),
                      }).catch(() => {
                        // Fallback: download if server save fails
                        downloadSession(log);
                      });
                    }
                    setSessionState("idle");
                    setTranscriptLines([]);
                    setTriggers([]);
                    setTriggerFeedback({});
                    setGoalInferences([]);
                    setCheckCount(0);
                    setUsefulness(null);
                    setTimingRating(null);
                    setGoalRating(null);
                    setAdoptionRating(null);
                    setSessionNotes("");
                    setBestMoment("");
                    setWorstMoment("");
                    setSelectedScenario(null);
                    currentSessionIdRef.current = null;
                  }}
                  className="rounded-xl border border-slate-300 px-6 py-2.5 text-sm font-semibold text-slate-700 hover:border-slate-400 transition dark:border-slate-700 dark:text-slate-300"
                >
                  New Session
                </button>
              </>
            )}
          </div>
        </div>
        {/* API Settings (collapsible) */}
        {sessionState === "idle" && (
          <details className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
            <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              API Settings {!apiSettings.apiKey && <span className="ml-2 text-rose-500 normal-case tracking-normal font-normal">(API key required)</span>}
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs text-slate-500">Base URL</span>
                <input
                  type="text"
                  value={apiSettings.baseUrl}
                  onChange={(e) => setApiSettings((prev) => ({ ...prev, baseUrl: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-purple-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-slate-500">API Key</span>
                <input
                  type="password"
                  value={apiSettings.apiKey}
                  onChange={(e) => setApiSettings((prev) => ({ ...prev, apiKey: e.target.value }))}
                  placeholder="sk-..."
                  className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-purple-500 dark:bg-slate-900 dark:text-slate-100 ${
                    apiSettings.apiKey
                      ? "border-slate-300 bg-white dark:border-slate-600"
                      : "border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/30"
                  }`}
                />
              </label>
            </div>
          </details>
        )}
        {/* Error/warning bars */}
        {!apiSettings.apiKey && sessionState === "idle" && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            Enter your API key in the settings above to start a live session.
          </div>
        )}
        {speech.error && (
          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300">
            {speech.error}
          </div>
        )}
        {/* Status bar */}
        {sessionState !== "idle" && (
          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
            {sessionState === "running" && (
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
                {speech.status || "Listening..."}
              </span>
            )}
            {sessionState === "ended" && (
              <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                Saved automatically
              </span>
            )}
            <span>Model: {selectedModel}</span>
            <span>Checks: {checkCount}</span>
            <span>Triggers: {triggers.length}</span>
            <span>Lines: {transcriptLines.length}</span>
            {isChecking && <span className="text-purple-600 dark:text-purple-400">Checking...</span>}
            {lastCheckError && <span className="text-rose-600 dark:text-rose-400">{lastCheckError}</span>}
          </div>
        )}
      </div>

      {/* Session History panel */}
      {showHistory && (sessionState === "idle" || sessionState === "ended") && (
        <div className="rounded-2xl border border-indigo-200 bg-white dark:border-indigo-900 dark:bg-slate-900 overflow-hidden">
          <div className="flex items-center justify-between border-b border-indigo-100 bg-indigo-50/50 px-4 py-3 dark:border-indigo-900/50 dark:bg-indigo-950/20">
            <h3 className="text-sm font-bold text-indigo-900 dark:text-indigo-200">
              Session History ({sessionHistory.length})
            </h3>
            <div className="flex gap-2">
              <button
                onClick={importSessions}
                className="rounded-lg border border-emerald-300 px-3 py-1 text-xs font-semibold text-emerald-600 hover:border-emerald-400 transition dark:border-emerald-700 dark:text-emerald-300"
              >
                Import
              </button>
              {sessionHistory.length > 0 && (
                <button
                  onClick={exportAllSessions}
                  className="rounded-lg border border-indigo-300 px-3 py-1 text-xs font-semibold text-indigo-600 hover:border-indigo-400 transition dark:border-indigo-700 dark:text-indigo-300"
                >
                  Export All
                </button>
              )}
              {sessionHistory.length > 0 && (
                <button
                  onClick={() => { if (confirm(`Delete all ${sessionHistory.length} sessions?`)) { saveSessionHistory([]); setSessionHistory([]); } }}
                  className="rounded-lg border border-rose-300 px-3 py-1 text-xs font-semibold text-rose-600 hover:border-rose-400 transition dark:border-rose-700 dark:text-rose-300"
                >
                  Clear All
                </button>
              )}
            </div>
          </div>
          {sessionHistory.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-400">No sessions yet. Complete a live session and it will appear here.</p>
          ) : (
            <div className="max-h-[300px] overflow-auto divide-y divide-slate-100 dark:divide-slate-800">
              {sessionHistory.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-4 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition cursor-pointer"
                  onClick={() => setViewingSession(s)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
                        {new Date(s.created_at).toLocaleString()}
                      </span>
                      {s.reviewer_id && s.reviewer_id !== "anonymous" && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                          {s.reviewer_id}
                        </span>
                      )}
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        {s.model?.split("/").pop() || "unknown"}
                      </span>
                      {s.usefulness_rating && (
                        <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300">
                          H:{s.usefulness_rating}
                        </span>
                      )}
                      {s.adoption_rating && (
                        <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-semibold text-purple-600 dark:bg-purple-900/40 dark:text-purple-300">
                          A:{s.adoption_rating}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex gap-3 text-[11px] text-slate-400 dark:text-slate-500">
                      <span>{Math.round(s.duration_seconds || 0)}s</span>
                      <span>{s.total_triggers || 0} triggers</span>
                      <span>{(s.transcript_lines || []).length} lines</span>
                      {s.scenario_label && <span className="truncate max-w-[150px]">{s.scenario_label}</span>}
                      {s.persona && <span className="truncate max-w-[200px] italic">{s.persona.slice(0, 50)}...</span>}
                    </div>
                  </div>
                  <div className="flex gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => downloadSession(s)}
                      title="Download JSON"
                      className="rounded-lg border border-slate-200 p-1.5 text-xs text-slate-500 hover:border-slate-400 transition dark:border-slate-700 dark:text-slate-400"
                    >
                      &darr;
                    </button>
                    <button
                      onClick={() => { if (confirm("Delete this session?")) deleteSession(s.id); }}
                      title="Delete"
                      className="rounded-lg border border-rose-200 p-1.5 text-xs text-rose-500 hover:border-rose-400 transition dark:border-rose-700 dark:text-rose-400"
                    >
                      &times;
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {/* Exit survey summary in history */}
          {(() => {
            const allSurveys = loadExitSurveys();
            const reviewerSurveys = allSurveys.filter(
              (s) => !reviewerId || s.reviewer_id === reviewerId
            );
            if (reviewerSurveys.length === 0 && allSurveys.length === 0) return null;
            const surveysToShow = reviewerSurveys.length > 0 ? reviewerSurveys : allSurveys;
            return (
              <div className="border-t border-amber-200 bg-amber-50/30 px-4 py-3 dark:border-amber-900/40 dark:bg-amber-950/10">
                <h4 className="text-xs font-bold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-400">
                  Exit Surveys ({surveysToShow.length})
                </h4>
                {surveysToShow.map((sv, i) => (
                  <div key={i} className="mt-2 rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs dark:border-amber-800 dark:bg-slate-900">
                    <div className="flex flex-wrap gap-3 text-slate-600 dark:text-slate-400">
                      <span>Reviewer: <strong className="text-amber-700 dark:text-amber-300">{sv.reviewer_id}</strong></span>
                      <span>Frequency: <strong>{sv.frequency_label || "—"}</strong></span>
                      <span>Sessions: <strong>{sv.total_sessions}</strong></span>
                      <span className="text-slate-400">{new Date(sv.created_at).toLocaleString()}</span>
                    </div>
                    {sv.most_natural_scenario && (
                      <p className="mt-1 text-emerald-600 dark:text-emerald-400">
                        Most natural: <strong>{sv.most_natural_scenario}</strong>
                      </p>
                    )}
                    {sv.most_annoying_scenario && (
                      <p className="mt-0.5 text-rose-600 dark:text-rose-400">
                        Most annoying: <strong>{sv.most_annoying_scenario}</strong>
                      </p>
                    )}
                    {sv.one_change && (
                      <p className="mt-1 text-slate-600 dark:text-slate-300 border-l-2 border-amber-300 pl-2 italic">
                        {sv.one_change}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {/* Exit survey panel */}
      {showExitSurvey && (sessionState === "idle" || sessionState === "ended") && (
        <div className="rounded-2xl border-2 border-amber-200 bg-amber-50/50 p-4 dark:border-amber-800 dark:bg-amber-950/20">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-amber-900 dark:text-amber-200">
              Exit Survey — Final Thoughts
            </h3>
            <button
              onClick={exportExitSurvey}
              disabled={!exitFrequencyPref}
              className="rounded-lg border border-amber-300 px-3 py-1 text-xs font-semibold text-amber-700 hover:border-amber-400 transition disabled:opacity-40 disabled:cursor-not-allowed dark:border-amber-700 dark:text-amber-300"
            >
              Download Exit Survey
            </button>
          </div>
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
            Now that you&apos;ve completed all scenarios, answer these final questions about the agent overall.
          </p>

          {/* Q1: Frequency preference */}
          <div className="mt-4">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-400">
              1. Intervention Frequency
            </span>
            <p className="text-[10px] text-amber-600 dark:text-amber-500">
              Overall, would you prefer the agent to intervene more or less often?
            </p>
            <div className="mt-1.5 flex gap-1.5">
              {[
                { v: 1, label: "Much less" },
                { v: 2, label: "Less" },
                { v: 3, label: "About right" },
                { v: 4, label: "More" },
                { v: 5, label: "Much more" },
              ].map(({ v, label }) => (
                <button
                  key={v}
                  onClick={() => setExitFrequencyPref(exitFrequencyPref === v ? null : v)}
                  className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                    exitFrequencyPref === v
                      ? "border-amber-500 bg-amber-100 text-amber-800 dark:border-amber-400 dark:bg-amber-900/40 dark:text-amber-200"
                      : "border-slate-300 bg-white text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Q2: Most natural scenario */}
          <div className="mt-4">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-400">
              2. Most Natural Scenario
            </span>
            <p className="text-[10px] text-emerald-600 dark:text-emerald-500">
              Which scenario felt most natural to have an AI assistant helping you?
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {USER_STUDY_SCENARIOS.map((sc) => (
                <button
                  key={sc.id}
                  onClick={() => setExitMostNatural(exitMostNatural === sc.id ? null : sc.id)}
                  className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                    exitMostNatural === sc.id
                      ? "border-emerald-500 bg-emerald-100 text-emerald-800 dark:border-emerald-400 dark:bg-emerald-900/40 dark:text-emerald-200"
                      : "border-slate-300 bg-white text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                  }`}
                >
                  {sc.label.split(":")[0]} {/* S1, S2, etc */}
                </button>
              ))}
            </div>
            {exitMostNatural && (
              <p className="mt-1 text-[10px] text-emerald-600 dark:text-emerald-400 italic">
                {USER_STUDY_SCENARIOS.find((s) => s.id === exitMostNatural)?.label}
              </p>
            )}
          </div>

          {/* Q3: Most annoying scenario */}
          <div className="mt-4">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-700 dark:text-rose-400">
              3. Most Annoying Scenario
            </span>
            <p className="text-[10px] text-rose-600 dark:text-rose-500">
              Which scenario felt most annoying or unnecessary to have an AI assistant?
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {USER_STUDY_SCENARIOS.map((sc) => (
                <button
                  key={sc.id}
                  onClick={() => setExitMostAnnoying(exitMostAnnoying === sc.id ? null : sc.id)}
                  className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                    exitMostAnnoying === sc.id
                      ? "border-rose-500 bg-rose-100 text-rose-800 dark:border-rose-400 dark:bg-rose-900/40 dark:text-rose-200"
                      : "border-slate-300 bg-white text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                  }`}
                >
                  {sc.label.split(":")[0]}
                </button>
              ))}
            </div>
            {exitMostAnnoying && (
              <p className="mt-1 text-[10px] text-rose-600 dark:text-rose-400 italic">
                {USER_STUDY_SCENARIOS.find((s) => s.id === exitMostAnnoying)?.label}
              </p>
            )}
          </div>

          {/* Q4: One thing to change */}
          <div className="mt-4">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-400">
                4. One Thing to Change
              </span>
              <p className="text-[10px] text-amber-600 dark:text-amber-500 mb-1.5">
                If you could change one thing about this agent, what would it be?
              </p>
              <textarea
                rows={2}
                value={exitOneChange}
                onChange={(e) => setExitOneChange(e.target.value)}
                placeholder="The one thing I'd change..."
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-amber-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </label>
          </div>
        </div>
      )}

      {/* Transcript + inline recommendations */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto rounded-2xl border border-slate-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900"
      >
        {sessionState === "idle" ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-400 dark:text-slate-500">
            <div className="text-center max-w-lg">
              <p className="text-lg font-semibold">Ready for live session</p>
              <p className="mt-3">Pick a model, choose or type a persona, set your API key, and hit <strong className="text-emerald-600">Start Live Session</strong>.</p>
              <p className="mt-2">Your browser will ask for <strong>microphone permission</strong> — you must allow it. Speech is transcribed in real-time using Chrome&apos;s built-in speech recognition.</p>
              <p className="mt-2">Every <strong>{checkInterval}s</strong> the agent reads the transcript and decides whether to intervene with a recommendation card.</p>
              <p className="mt-4 text-xs text-slate-300 dark:text-slate-600">Requires Chrome. Audio is processed by Google&apos;s speech servers — not sent to the LLM.</p>
            </div>
          </div>
        ) : (
          <>
            {buildDisplayElements(transcriptLines, triggers)}
            {transcriptLines.length === 0 && sessionState === "running" && (
              <div className="flex flex-col items-center justify-center gap-3 py-10 text-slate-400">
                <span className="h-4 w-4 rounded-full bg-red-500 animate-pulse" />
                <p className="text-sm font-medium">Listening for speech...</p>
                <p className="text-xs">Speak into your mic. If nothing appears, type below instead.</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Speaker tag toggle — visible during running session */}
      {sessionState === "running" && (
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Who&apos;s speaking:
          </span>
          <div className="flex rounded-xl border border-slate-300 bg-slate-100 overflow-hidden dark:border-slate-700 dark:bg-slate-800">
            {[
              { id: "P1", label: "Me (Wearer)", color: "bg-emerald-600" },
              { id: "P2", label: "Other Person", color: "bg-blue-600" },
            ].map(({ id, label, color }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSpeakerTag(id)}
                className={`px-5 py-2.5 text-sm font-semibold transition ${
                  speakerTag === id
                    ? `${color} text-white shadow-inner`
                    : "text-slate-500 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <span className={`ml-2 flex items-center gap-1.5 text-xs font-medium ${
            speakerTag === "P1" ? "text-emerald-600 dark:text-emerald-400" : "text-blue-600 dark:text-blue-400"
          }`}>
            <span className={`h-2.5 w-2.5 rounded-full ${speakerTag === "P1" ? "bg-emerald-500" : "bg-blue-500"} animate-pulse`} />
            Recording as {speakerTag}
          </span>
          <span className="ml-auto text-[10px] text-slate-400 dark:text-slate-500">
            Press Space to switch speakers
          </span>
        </div>
      )}

      {/* Manual text input — always available during session as fallback */}
      {sessionState === "running" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const input = e.target.elements.manualLine;
            const text = input.value.trim();
            if (!text) return;
            const elapsed = getElapsed();
            const speakerMatch = text.match(/^(P\d+):\s*(.*)/i);
            const speaker = speakerMatch ? speakerMatch[1].toUpperCase() : "P1";
            const lineText = speakerMatch ? speakerMatch[2] : text;
            setTranscriptLines((prev) => [
              ...prev,
              { seconds: Math.round(elapsed * 100) / 100, speaker, text: lineText },
            ]);
            input.value = "";
          }}
          className="flex gap-2"
        >
          <input
            name="manualLine"
            type="text"
            placeholder='Type here if mic isn&#39;t working — use "P2: their words" for other speakers'
            className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-purple-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            autoComplete="off"
          />
          <button
            type="submit"
            className="rounded-xl bg-slate-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 transition dark:bg-slate-600 dark:hover:bg-slate-500"
          >
            Send
          </button>
        </form>
      )}

      {/* Post-session rating */}
      {sessionState === "ended" && (
        <details open className="rounded-2xl border-2 border-indigo-200 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950/30 overflow-hidden">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-bold text-indigo-900 dark:text-indigo-200 hover:bg-indigo-100/50 dark:hover:bg-indigo-900/20 transition">
            Session Review {usefulness ? `(H:${usefulness} T:${timingRating || '-'} G:${goalRating || '-'} A:${adoptionRating || '-'})` : '(click to collapse)'}
          </summary>
          <div className="max-h-[45vh] overflow-auto px-4 pb-4">
          <div className="sr-only"><h3>Session Review</h3></div>
          {selectedScenario && (
            <p className="mt-1 text-xs text-purple-600 dark:text-purple-400 font-semibold">
              Scenario: {selectedScenario.label}
            </p>
          )}
          <p className="mt-1 text-xs text-indigo-700 dark:text-indigo-400">
            Rate the agent&apos;s performance. Be honest — low scores are just as valuable. (auto-saves)
          </p>

          {/* Q1: Helpfulness — Task C */}
          <div className="mt-4">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-400">
              1. Helpfulness (1-5)
            </span>
            <p className="text-[10px] text-indigo-500 dark:text-indigo-500">
              Were the recommendations useful and actionable? 1 = useless or distracting, 5 = exactly what I needed
            </p>
            <div className="mt-1.5 flex gap-2">
              {[1, 2, 3, 4, 5].map((v) => (
                <button
                  key={v}
                  onClick={() => setUsefulness(usefulness === v ? null : v)}
                  className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${
                    usefulness === v
                      ? "border-indigo-500 bg-indigo-100 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-900/40 dark:text-indigo-300"
                      : "border-slate-300 bg-white text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Q2: Timing — Task B */}
          <div className="mt-4">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-400">
              2. Timing (1-5)
            </span>
            <p className="text-[10px] text-emerald-500 dark:text-emerald-500">
              Did the agent speak up at the right moments? 1 = too early, too late, or shouldn&apos;t have spoken at all, 5 = perfect moment
            </p>
            <div className="mt-1.5 flex gap-2">
              {[1, 2, 3, 4, 5].map((v) => (
                <button
                  key={v}
                  onClick={() => setTimingRating(timingRating === v ? null : v)}
                  className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${
                    timingRating === v
                      ? "border-emerald-500 bg-emerald-100 text-emerald-700 dark:border-emerald-400 dark:bg-emerald-900/40 dark:text-emerald-300"
                      : "border-slate-300 bg-white text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Q3: Goal Understanding — Task A */}
          <div className="mt-4">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-600 dark:text-amber-400">
              3. Goal Understanding (1-5)
            </span>
            <p className="text-[10px] text-amber-500 dark:text-amber-500">
              Did the agent understand what you were trying to accomplish? 1 = completely misread the situation, 5 = nailed my intent
            </p>
            <div className="mt-1.5 flex gap-2">
              {[1, 2, 3, 4, 5].map((v) => (
                <button
                  key={v}
                  onClick={() => setGoalRating(goalRating === v ? null : v)}
                  className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${
                    goalRating === v
                      ? "border-amber-500 bg-amber-100 text-amber-700 dark:border-amber-400 dark:bg-amber-900/40 dark:text-amber-300"
                      : "border-slate-300 bg-white text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Q4: Adoption Intent */}
          <div className="mt-4">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-purple-600 dark:text-purple-400">
              4. Would You Use This? (1-5)
            </span>
            <p className="text-[10px] text-purple-500 dark:text-purple-500">
              If this agent existed on real smart glasses, would you want it in conversations like this? 1 = absolutely not, 5 = I&apos;d use it every time
            </p>
            <div className="mt-1.5 flex gap-2">
              {[1, 2, 3, 4, 5].map((v) => (
                <button
                  key={v}
                  onClick={() => setAdoptionRating(adoptionRating === v ? null : v)}
                  className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${
                    adoptionRating === v
                      ? "border-purple-500 bg-purple-100 text-purple-700 dark:border-purple-400 dark:bg-purple-900/40 dark:text-purple-300"
                      : "border-slate-300 bg-white text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Q5-6: Structured free-text */}
          <div className="mt-4">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-400">
                5. Best Moment
              </span>
              <textarea
                rows={2}
                value={bestMoment}
                onChange={(e) => setBestMoment(e.target.value)}
                placeholder="Was there a specific moment where the agent was genuinely helpful? What happened?"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </label>
          </div>
          <div className="mt-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-rose-600 dark:text-rose-400">
                6. Worst Moment
              </span>
              <textarea
                rows={2}
                value={worstMoment}
                onChange={(e) => setWorstMoment(e.target.value)}
                placeholder="Was there a moment where the agent was annoying, wrong, or distracting? What happened?"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-rose-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </label>
          </div>

          {/* Q7: Open notes */}
          <div className="mt-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-400">
                7. Anything Else?
              </span>
              <textarea
                rows={2}
                value={sessionNotes}
                onChange={(e) => setSessionNotes(e.target.value)}
                placeholder="Any other thoughts — surprises, suggestions, things you wish the agent had done differently?"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </label>
          </div>
          </div>
        </details>
      )}
    </div>
  );
}
