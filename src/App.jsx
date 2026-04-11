import { useEffect, useMemo, useRef, useState } from "react";
import ReactPlayer from "react-player";

const STORAGE_KEYS = {
  reviewerId: "benchmark-lab-reviewer-id",
  reviewExport: "benchmark-lab-review-export",
  reviewMap: "benchmark-lab-review-map",
  preferenceMap: "benchmark-lab-preference-map",
  apiSettings: "benchmark-lab-api-settings",
  videoUrls: "benchmark-lab-video-urls",
  manualComments: "benchmark-lab-manual-comments",
  theme: "benchmark-lab-theme",
  selectedMethod: "benchmark-lab-selected-method",
  selectedDataset: "benchmark-lab-selected-dataset",
};

/** Prefix a storage key with the reviewer ID so each reviewer gets their own namespace. */
function reviewerKey(baseKey, reviewerId) {
  if (!reviewerId) return baseKey;
  return `${baseKey}::${reviewerId}`;
}

const reviewSheetColumns = [
  "reviewer_id",
  "method_id",
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
  "trigger_appropriate",
  "trigger_timing",
  "interruption_worthy",
  "useful_1",
  "useful_2",
  "grounded",
  "distinct_pair",
  "goal_plausible",
  "goal_specific",
  "goal_useful_for_recs",
  "final_trigger_timestamp",
  "final_recommendation_mode",
  "final_recommendation_1",
  "final_recommendation_2",
  "final_urgency",
  "final_rationale",
  "review_notes",
];

const reviewDecisions = ["accepted", "edited", "rejected"];
const recommendationModes = ["say", "know", "both"];

function cn(...values) {
  return values.filter(Boolean).join(" ");
}

function parseJsonStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function escapeCsvCell(value) {
  const stringValue = value == null ? "" : String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function rowsToCsv(columns, rows) {
  const header = columns.join(",");
  const body = rows.map((row) => columns.map((column) => escapeCsvCell(row[column])).join(","));
  return [header, ...body].join("\n");
}

function triggerKey(methodId, windowId, triggerId) {
  return `${methodId}::${windowId}::${triggerId}`;
}

function parseTranscriptLine(line) {
  const match = line.match(/^\[(\d+):(\d+\.\d+)\]\s+(P\d+):\s+(.*)$/);
  if (!match) {
    return { raw: line, seconds: null, speaker: null, text: line };
  }
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  return {
    raw: line,
    seconds: minutes * 60 + seconds,
    speaker: match[3],
    text: match[4],
  };
}

function buildInitialReviewMap(methods) {
  const next = {};
  for (const methodEntry of methods) {
    for (const windowEntry of methodEntry.windows || []) {
      for (const trigger of windowEntry.triggers) {
        const key = triggerKey(methodEntry.id, windowEntry.window_id, trigger.trigger_id);
        next[key] = {
          review_decision: trigger.review_decision || "",
          // Task A
          trigger_appropriate: trigger.trigger_appropriate || "",
          trigger_timing: trigger.trigger_timing || "",
          interruption_worthy: trigger.interruption_worthy || "",
          // Task B
          useful_1: trigger.useful_1 || "",
          useful_2: trigger.useful_2 || "",
          grounded: trigger.grounded || "",
          distinct_pair: trigger.distinct_pair || "",
          // Task C
          goal_plausible: trigger.goal_plausible || "",
          goal_specific: trigger.goal_specific || "",
          goal_useful_for_recs: trigger.goal_useful_for_recs || "",
          final_trigger_timestamp: trigger.final_trigger_timestamp || trigger.trigger_timestamp || "",
          final_recommendation_mode:
            trigger.final_recommendation_mode || trigger.recommendation_mode || "say",
          final_recommendation_1:
            trigger.final_recommendation_1 || trigger.recommendation_1 || "",
          final_recommendation_2:
            trigger.final_recommendation_2 || trigger.recommendation_2 || "",
          final_urgency: trigger.final_urgency || trigger.urgency || "",
          final_rationale: trigger.final_rationale || trigger.rationale || "",
          review_notes: trigger.review_notes || "",
        };
      }
    }
  }
  return next;
}

async function loadJson(path, fallback) {
  try {
    const response = await fetch(path);
    if (!response.ok) {
      return fallback;
    }
    return await response.json();
  } catch {
    return fallback;
  }
}

async function generateAiRecommendation({
  apiKey,
  baseUrl,
  model,
  windowEntry,
  selectedTrigger,
}) {
  const anchor = selectedTrigger
    ? `Use ${selectedTrigger.trigger_timestamp}s as the anchor moment if it still makes sense.`
    : "Identify the single best trigger moment within the current window.";

  const scenarioMeta = windowEntry.scenario_meta;
  const scenarioContext = scenarioMeta
    ? `\nScenario context:\n- persona: ${scenarioMeta.persona || "unknown"}\n- wearer goal: ${scenarioMeta.wearer_goal || "unknown"}\n- signal type: ${scenarioMeta.signal_type || "none"}\n`
    : "";

  const prompt = `You are reviewing a conversation window for proactive assistance.

Window metadata:
- window_id: ${windowEntry.window_id}
- conversation_id: ${windowEntry.conversation_id}
- start_sec: ${windowEntry.start_sec}
- end_sec: ${windowEntry.end_sec}
${scenarioContext}
Transcript:
${windowEntry.transcript_text}

Task:
- ${anchor}
- Produce one candidate trigger with exactly two recommendations.
- Recommendations must be grounded, specific, and useful.
- recommendation_mode must be "say", "know", or "both".
- trigger_timestamp must be in absolute conversation seconds.

Return JSON only in this shape:
{
  "trigger_timestamp": 0,
  "recommendation_mode": "say",
  "recommendation_1": "",
  "recommendation_2": "",
  "rationale": ""
}`;

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You generate concise benchmark-review recommendations for proactive conversational assistance. Return only JSON.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Missing model response content");
  }
  const clean = content.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
  return JSON.parse(clean);
}

/** Scan localStorage for all reviewer IDs that have saved review data. */
function getKnownReviewerIds() {
  const prefix = STORAGE_KEYS.reviewMap + "::";
  const ids = new Set();
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix)) {
      ids.add(key.slice(prefix.length));
    }
  }
  // Also include anonymous (no suffix) if it exists
  if (localStorage.getItem(STORAGE_KEYS.reviewMap)) {
    ids.add("");
  }
  return [...ids].sort();
}

function ReviewRubric() {
  return (
    <details className="rounded-2xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/50 dark:bg-blue-950/20">
      <summary className="cursor-pointer list-none text-sm font-semibold text-blue-800 dark:text-blue-300">
        Review Rubric & Guidelines
      </summary>
      <div className="mt-4 space-y-4 text-sm text-slate-700 dark:text-slate-300">
        <div>
          <h4 className="font-semibold text-indigo-800 dark:text-indigo-300">Step 1: Preference Ranking (per scenario)</h4>
          <p className="mt-1">For each scenario, switch between methods using the dropdown. Read the agent&apos;s recommendations inline in the transcript. Then pick which model you&apos;d most want as your assistant.</p>
          <ul className="mt-1 space-y-1 pl-4">
            <li><strong>Preferred Method</strong> — Which model&apos;s overall output (timing + recommendations) would be most helpful to you in this situation?</li>
            <li><strong>Overall Usefulness</strong> — How useful was the best output? 1 = useless/distracting, 3 = somewhat helpful, 5 = exactly what I&apos;d want</li>
            <li><strong>Why?</strong> — Optional: what made one model better? (better timing, more specific, less noisy, etc.)</li>
          </ul>
        </div>
        <div>
          <h4 className="font-semibold text-slate-900 dark:text-slate-100">Step 2: Per-Trigger Diagnostics (optional, for deeper analysis)</h4>
          <p className="mt-1">Click any trigger card in the transcript to score it individually. This is optional but gives richer data.</p>
          <ul className="mt-1 space-y-1 pl-4">
            <li><strong>Task A</strong> — Was this the right moment? Appropriate (yes/no), Worth Interruption (yes/no), Timing (1-3)</li>
            <li><strong>Task B</strong> — Are the recommendations useful, grounded in the transcript, and distinct from each other?</li>
            <li><strong>Task C</strong> — Is the inferred goal plausible, specific, and useful for producing good recommendations?</li>
          </ul>
        </div>
        <div>
          <h4 className="font-semibold text-slate-900 dark:text-slate-100">Good vs Bad Recommendations</h4>
          <div className="mt-1 grid gap-2 md:grid-cols-2">
            <div className="rounded-lg bg-emerald-50 p-2 dark:bg-emerald-950/30">
              <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Good</div>
              <ul className="mt-1 space-y-1 text-xs">
                <li>&ldquo;Ask whether they mean current or projected revenue.&rdquo;</li>
                <li>&ldquo;Senior SWE median in SF is $185-210k base — you have room to push.&rdquo;</li>
                <li>&ldquo;Capture the action item: owner and deadline.&rdquo;</li>
              </ul>
            </div>
            <div className="rounded-lg bg-rose-50 p-2 dark:bg-rose-950/30">
              <div className="text-xs font-semibold text-rose-700 dark:text-rose-400">Bad</div>
              <ul className="mt-1 space-y-1 text-xs">
                <li>&ldquo;Be more confident.&rdquo;</li>
                <li>&ldquo;Research salary ranges for your area.&rdquo;</li>
                <li>&ldquo;Express appreciation and ask about flexibility.&rdquo;</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </details>
  );
}

function Panel({ title, subtitle, children, action }) {
  return (
    <section className="flex min-h-0 flex-col rounded-2xl border border-slate-200 bg-white shadow-panel dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
          ) : null}
        </div>
        {action}
      </div>
      <div className="min-h-0 flex-1 p-5">{children}</div>
    </section>
  );
}

function TextInput({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-labPurple focus:ring-2 focus:ring-purple-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:ring-purple-900/40"
      />
    </label>
  );
}

function TextArea({ label, value, onChange, rows = 3, placeholder }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </span>
      <textarea
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-labPurple focus:ring-2 focus:ring-purple-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:ring-purple-900/40"
      />
    </label>
  );
}

export default function App() {
  const playerRef = useRef(null);
  const [reviewerId, setReviewerId] = useState(
    () => localStorage.getItem(STORAGE_KEYS.reviewerId) || "",
  );
  const [datasets, setDatasets] = useState({ egocom: null, scenarios: null });
  const [selectedDataset, setSelectedDataset] = useState(
    () => localStorage.getItem(STORAGE_KEYS.selectedDataset) || "egocom",
  );
  const [selectedMethodId, setSelectedMethodId] = useState(
    () => localStorage.getItem(STORAGE_KEYS.selectedMethod) || "",
  );
  const [selectedWindowId, setSelectedWindowId] = useState("");
  const [selectedTriggerId, setSelectedTriggerId] = useState("");
  const [reviewMap, setReviewMap] = useState({});
  const [preferenceMap, setPreferenceMap] = useState(() =>
    parseJsonStorage(reviewerKey(STORAGE_KEYS.preferenceMap, localStorage.getItem(STORAGE_KEYS.reviewerId) || ""), {}),
  );
  const [videoUrls, setVideoUrls] = useState(() => parseJsonStorage(STORAGE_KEYS.videoUrls, {}));
  const [manualComments, setManualComments] = useState(() =>
    parseJsonStorage(reviewerKey(STORAGE_KEYS.manualComments, localStorage.getItem(STORAGE_KEYS.reviewerId) || ""), {}),
  );
  const [apiSettings, setApiSettings] = useState(() =>
    parseJsonStorage(STORAGE_KEYS.apiSettings, {
      baseUrl: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4.1-mini",
      apiKey: "",
    }),
  );
  const [theme, setTheme] = useState(() => localStorage.getItem(STORAGE_KEYS.theme) || "light");
  const [draftComment, setDraftComment] = useState({
    timestamp: "",
    recommendationMode: "say",
    recommendation1: "",
    recommendation2: "",
    rationale: "",
  });
  const [currentPlayback, setCurrentPlayback] = useState(0);
  const [generatedDraft, setGeneratedDraft] = useState(null);
  const [generatorState, setGeneratorState] = useState({ loading: false, error: "" });
  const [exportPreview, setExportPreview] = useState(() =>
    parseJsonStorage(reviewerKey(STORAGE_KEYS.reviewExport, localStorage.getItem(STORAGE_KEYS.reviewerId) || ""), null),
  );

  // Track the last reviewer ID to detect switches
  const lastReviewerIdRef = useRef(reviewerId);

  useEffect(() => {
    async function bootstrap() {
      const [egocomData, scenarioData, manifest] = await Promise.all([
        loadJson("/data/benchmark-lab.json", { methods: [] }),
        loadJson("/data/benchmark-lab-scenarios.json", { methods: [] }),
        loadJson("/data/video-manifest.json", {}),
      ]);

      const nextDatasets = { egocom: egocomData, scenarios: scenarioData };
      setDatasets(nextDatasets);

      // Build combined review map from both datasets so autosave covers all keys
      const allMethods = [
        ...(egocomData.methods || []),
        ...(scenarioData.methods || []),
      ];
      const initialMap = buildInitialReviewMap(allMethods);
      const currentReviewer = localStorage.getItem(STORAGE_KEYS.reviewerId) || "";
      const savedMap = parseJsonStorage(reviewerKey(STORAGE_KEYS.reviewMap, currentReviewer), null);
      if (savedMap && typeof savedMap === "object") {
        for (const [key, value] of Object.entries(savedMap)) {
          if (key in initialMap) {
            initialMap[key] = { ...initialMap[key], ...value };
          }
        }
      }
      setReviewMap(initialMap);
      setVideoUrls((current) => ({ ...manifest, ...current }));

      // Initialize selection for the active dataset
      const activeDataset = localStorage.getItem(STORAGE_KEYS.selectedDataset) || "egocom";
      const activeData = nextDatasets[activeDataset] || egocomData;
      const methods = activeData.methods || [];
      const initialMethodId =
        localStorage.getItem(STORAGE_KEYS.selectedMethod) ||
        activeData.default_method_id ||
        methods[0]?.id ||
        "";
      const initialMethod =
        methods.find((entry) => entry.id === initialMethodId) || methods[0] || { windows: [] };
      setSelectedMethodId(initialMethodId);
      setSelectedWindowId(initialMethod.windows?.[0]?.window_id || "");
      setSelectedTriggerId(initialMethod.windows?.[0]?.triggers?.[0]?.trigger_id || "");
    }
    bootstrap();
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.videoUrls, JSON.stringify(videoUrls));
  }, [videoUrls]);

  useEffect(() => {
    localStorage.setItem(reviewerKey(STORAGE_KEYS.manualComments, reviewerId), JSON.stringify(manualComments));
  }, [manualComments, reviewerId]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.apiSettings, JSON.stringify(apiSettings));
  }, [apiSettings]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.theme, theme);
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    if (selectedMethodId) {
      localStorage.setItem(STORAGE_KEYS.selectedMethod, selectedMethodId);
    }
  }, [selectedMethodId]);

  // Autosave review decisions to localStorage on every change (namespaced by reviewer)
  useEffect(() => {
    if (Object.keys(reviewMap).length > 0) {
      localStorage.setItem(reviewerKey(STORAGE_KEYS.reviewMap, reviewerId), JSON.stringify(reviewMap));
    }
  }, [reviewMap, reviewerId]);

  // Autosave preference rankings
  useEffect(() => {
    localStorage.setItem(reviewerKey(STORAGE_KEYS.preferenceMap, reviewerId), JSON.stringify(preferenceMap));
  }, [preferenceMap, reviewerId]);

  // Handle reviewer switch — save current, load new reviewer's data
  useEffect(() => {
    if (lastReviewerIdRef.current === reviewerId) return;
    localStorage.setItem(STORAGE_KEYS.reviewerId, reviewerId);
    lastReviewerIdRef.current = reviewerId;

    // Reload review map for the new reviewer
    const allMethods = [
      ...(datasets.egocom?.methods || []),
      ...(datasets.scenarios?.methods || []),
    ];
    if (allMethods.length === 0) return; // not bootstrapped yet
    const freshMap = buildInitialReviewMap(allMethods);
    const savedMap = parseJsonStorage(reviewerKey(STORAGE_KEYS.reviewMap, reviewerId), null);
    if (savedMap && typeof savedMap === "object") {
      for (const [key, value] of Object.entries(savedMap)) {
        if (key in freshMap) {
          freshMap[key] = { ...freshMap[key], ...value };
        }
      }
    }
    setReviewMap(freshMap);

    // Reload manual comments and preferences for the new reviewer
    setManualComments(parseJsonStorage(reviewerKey(STORAGE_KEYS.manualComments, reviewerId), {}));
    setPreferenceMap(parseJsonStorage(reviewerKey(STORAGE_KEYS.preferenceMap, reviewerId), {}));
    setExportPreview(parseJsonStorage(reviewerKey(STORAGE_KEYS.reviewExport, reviewerId), null));
  }, [reviewerId, datasets]);

  // Active dataset derived from selection
  const dataset = datasets[selectedDataset] || null;

  function switchDataset(nextDataset) {
    setSelectedDataset(nextDataset);
    localStorage.setItem(STORAGE_KEYS.selectedDataset, nextDataset);
    const activeData = datasets[nextDataset];
    if (!activeData) return;
    const methods = activeData.methods || [];
    const initialMethodId = activeData.default_method_id || methods[0]?.id || "";
    const initialMethod =
      methods.find((entry) => entry.id === initialMethodId) || methods[0] || { windows: [] };
    const firstWindow = initialMethod.windows?.[0];
    setSelectedMethodId(initialMethodId);
    setSelectedWindowId(firstWindow?.window_id || "");
    setSelectedTriggerId(firstWindow?.triggers?.[0]?.trigger_id || "");
    setGeneratedDraft(null);
  }

  const methods = dataset?.methods || [];
  const selectedMethod = useMemo(
    () => methods.find((entry) => entry.id === selectedMethodId) || methods[0] || null,
    [methods, selectedMethodId],
  );

  const windows = selectedMethod?.windows || dataset?.windows || [];

  const selectedWindow = useMemo(
    () => windows.find((entry) => entry.window_id === selectedWindowId) || windows[0] || null,
    [windows, selectedWindowId],
  );

  const selectedTrigger = useMemo(() => {
    if (!selectedWindow) {
      return null;
    }
    return (
      selectedWindow.triggers.find((entry) => entry.trigger_id === selectedTriggerId) ||
      selectedWindow.triggers[0] ||
      null
    );
  }, [selectedWindow, selectedTriggerId]);

  const transcriptLines = useMemo(
    () =>
      (selectedWindow?.transcript_text || "")
        .split("\n")
        .filter(Boolean)
        .map((line) => parseTranscriptLine(line)),
    [selectedWindow],
  );

  // Collect all methods' outputs for the current scenario (for preference comparison)
  const methodSummaries = useMemo(() => {
    if (!selectedWindow || methods.length <= 1) return [];
    const windowId = selectedWindow.window_id;
    return methods.map((method) => {
      const win = method.windows?.find((w) => w.window_id === windowId);
      return {
        methodId: method.id,
        label: method.label,
        triggers: win?.triggers || [],
        hasTriggers: (win?.triggers || []).length > 0,
      };
    });
  }, [methods, selectedWindow]);

  const activeTriggerKey = selectedMethod && selectedWindow && selectedTrigger
    ? triggerKey(selectedMethod.id, selectedWindow.window_id, selectedTrigger.trigger_id)
    : null;

  const activeReviewState = activeTriggerKey
    ? reviewMap[activeTriggerKey] || {}
    : {};

  const currentWindowComments = selectedWindow
    ? manualComments[selectedWindow.window_id] || []
    : [];

  const windowStartSec = selectedWindow ? Number(selectedWindow.start_sec || 0) : 0;
  const windowEndSec = selectedWindow ? Number(selectedWindow.end_sec || 0) : 0;
  const hasWindowClip = selectedWindow ? Boolean(videoUrls[selectedWindow.window_id]) : false;

  const currentVideoUrl = selectedWindow
    ? videoUrls[selectedWindow.window_id] ||
      videoUrls[selectedWindow.video_name] ||
      ""
    : "";

  function absoluteToClipSeconds(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return 0;
    }
    if (hasWindowClip) {
      return Math.max(0, numeric - windowStartSec);
    }
    return numeric;
  }

  function clipToAbsoluteSeconds(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return windowStartSec;
    }
    if (hasWindowClip) {
      return numeric + windowStartSec;
    }
    return numeric;
  }

  function formatTriggerLabel(value) {
    const absolute = Number(value);
    if (!Number.isFinite(absolute)) {
      return "unknown";
    }
    const clip = absoluteToClipSeconds(absolute);
    if (hasWindowClip) {
      return `${clip.toFixed(2)}s clip · ${absolute.toFixed(2)}s abs`;
    }
    return `${absolute.toFixed(2)}s`;
  }

  const exportPayload = useMemo(() => {
    const triggerReviews = windows.flatMap((windowEntry) =>
      windowEntry.triggers.map((trigger) => {
        const key = triggerKey(
          selectedMethod?.id || "active_method",
          windowEntry.window_id,
          trigger.trigger_id,
        );
        return {
          method_id: selectedMethod?.id || "active_method",
          window_id: windowEntry.window_id,
          conversation_id: windowEntry.conversation_id,
          video_name: windowEntry.video_name,
          trigger_id: trigger.trigger_id,
          proposed: trigger,
          review: reviewMap[key] || {},
        };
      }),
    );

    return {
      updated_at: new Date().toISOString(),
      reviewer_id: reviewerId || "anonymous",
      method_id: selectedMethod?.id || "active_method",
      windows: windows.map((windowEntry) => ({
        window_id: windowEntry.window_id,
        video_name: windowEntry.video_name,
        review_status: windowEntry.review_status,
        trigger_decision: windowEntry.trigger_decision,
        reviewer_notes: windowEntry.reviewer_notes,
      })),
      trigger_reviews: triggerReviews,
      preferences: preferenceMap,
      manual_comments: manualComments,
      video_urls: videoUrls,
    };
  }, [manualComments, preferenceMap, reviewerId, reviewMap, selectedMethod, videoUrls, windows]);

  const reviewSheetRows = useMemo(
    () =>
      windows.flatMap((windowEntry) =>
        windowEntry.triggers.map((trigger) => {
          const key = triggerKey(
            selectedMethod?.id || "active_method",
            windowEntry.window_id,
            trigger.trigger_id,
          );
          const review = reviewMap[key] || {};
          return {
            reviewer_id: reviewerId || "anonymous",
            method_id: selectedMethod?.id || "active_method",
            window_id: windowEntry.window_id,
            conversation_id: windowEntry.conversation_id,
            video_name: windowEntry.video_name,
            start_sec: trigger.start_sec ?? windowEntry.start_sec ?? "",
            end_sec: trigger.end_sec ?? windowEntry.end_sec ?? "",
            trigger_id: trigger.trigger_id,
            trigger_timestamp: trigger.trigger_timestamp ?? "",
            recommendation_mode: trigger.recommendation_mode ?? "",
            recommendation_1: trigger.recommendation_1 ?? "",
            recommendation_2: trigger.recommendation_2 ?? "",
            urgency: trigger.urgency ?? "",
            rationale: trigger.rationale ?? "",
            annotation_status: trigger.annotation_status ?? "",
            review_decision: review.review_decision ?? "",
            trigger_appropriate: review.trigger_appropriate ?? "",
            trigger_timing: review.trigger_timing ?? "",
            interruption_worthy: review.interruption_worthy ?? "",
            useful_1: review.useful_1 ?? "",
            useful_2: review.useful_2 ?? "",
            grounded: review.grounded ?? "",
            distinct_pair: review.distinct_pair ?? "",
            goal_plausible: review.goal_plausible ?? "",
            goal_specific: review.goal_specific ?? "",
            goal_useful_for_recs: review.goal_useful_for_recs ?? "",
            final_trigger_timestamp:
              review.final_trigger_timestamp ?? trigger.final_trigger_timestamp ?? trigger.trigger_timestamp ?? "",
            final_recommendation_mode:
              review.final_recommendation_mode ??
              trigger.final_recommendation_mode ??
              trigger.recommendation_mode ??
              "",
            final_recommendation_1:
              review.final_recommendation_1 ??
              trigger.final_recommendation_1 ??
              trigger.recommendation_1 ??
              "",
            final_recommendation_2:
              review.final_recommendation_2 ??
              trigger.final_recommendation_2 ??
              trigger.recommendation_2 ??
              "",
            final_urgency: review.final_urgency ?? trigger.final_urgency ?? trigger.urgency ?? "",
            final_rationale:
              review.final_rationale ?? trigger.final_rationale ?? trigger.rationale ?? "",
            review_notes: review.review_notes ?? "",
          };
        }),
      ),
    [reviewMap, selectedMethod, windows],
  );

  function seekTo(seconds) {
    const clipSeconds = absoluteToClipSeconds(seconds);
    if (playerRef.current && Number.isFinite(clipSeconds)) {
      playerRef.current.seekTo(clipSeconds, "seconds");
      setCurrentPlayback(clipSeconds);
    }
  }

  function updateReviewField(field, value) {
    if (!activeTriggerKey) {
      return;
    }
    setReviewMap((current) => ({
      ...current,
      [activeTriggerKey]: {
        ...current[activeTriggerKey],
        [field]: value,
      },
    }));
  }

  function updateVideoUrl(value) {
    if (!selectedWindow) {
      return;
    }
    setVideoUrls((current) => ({
      ...current,
      [selectedWindow.window_id]: value,
    }));
  }

  function handleLocalVideoPick(event) {
    const file = event.target.files?.[0];
    if (!file || !selectedWindow) {
      return;
    }
    updateVideoUrl(URL.createObjectURL(file));
  }

  function addManualComment() {
    if (!selectedWindow || !draftComment.recommendation1 || !draftComment.recommendation2) {
      return;
    }
    const nextComment = {
      id: `manual-${Date.now()}`,
      timestamp: draftComment.timestamp || currentPlayback.toFixed(2),
      recommendation_mode: draftComment.recommendationMode,
      recommendation_1: draftComment.recommendation1,
      recommendation_2: draftComment.recommendation2,
      rationale: draftComment.rationale,
    };
    setManualComments((current) => ({
      ...current,
      [selectedWindow.window_id]: [...(current[selectedWindow.window_id] || []), nextComment],
    }));
    setDraftComment({
      timestamp: "",
      recommendationMode: "say",
      recommendation1: "",
      recommendation2: "",
      rationale: "",
    });
  }

  async function handleGenerate() {
    if (!selectedWindow) {
      return;
    }
    if (!apiSettings.apiKey) {
      setGeneratorState({ loading: false, error: "Enter an API key in Lab settings first." });
      return;
    }
    setGeneratorState({ loading: true, error: "" });
    try {
      const nextDraft = await generateAiRecommendation({
        apiKey: apiSettings.apiKey,
        baseUrl: apiSettings.baseUrl,
        model: apiSettings.model,
        windowEntry: selectedWindow,
        selectedTrigger,
      });
      setGeneratedDraft(nextDraft);
      setDraftComment({
        timestamp: String(nextDraft.trigger_timestamp ?? ""),
        recommendationMode: nextDraft.recommendation_mode || "say",
        recommendation1: nextDraft.recommendation_1 || "",
        recommendation2: nextDraft.recommendation_2 || "",
        rationale: nextDraft.rationale || "",
      });
      setGeneratorState({ loading: false, error: "" });
    } catch (error) {
      setGeneratorState({
        loading: false,
        error: error instanceof Error ? error.message : "Generation failed",
      });
    }
  }

  function saveAndNext() {
    const payload = exportPayload;
    setExportPreview(payload);
    localStorage.setItem(reviewerKey(STORAGE_KEYS.reviewExport, reviewerId), JSON.stringify(payload));
    if (!selectedWindow) {
      return;
    }
    const currentIndex = windows.findIndex((entry) => entry.window_id === selectedWindow.window_id);
    const nextWindow = windows[currentIndex + 1];
    if (nextWindow) {
      setSelectedWindowId(nextWindow.window_id);
      setSelectedTriggerId(nextWindow.triggers[0]?.trigger_id || "");
      setGeneratedDraft(null);
    }
  }

  function downloadJson() {
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `benchmark-lab-review-export${reviewerId ? `_${reviewerId}` : ""}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadReviewCsv() {
    const csvText = rowsToCsv(reviewSheetColumns, reviewSheetRows);
    const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `trigger_review_sheet${reviewerId ? `_${reviewerId}` : ""}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadPreferenceCsv() {
    const prefColumns = ["reviewer_id", "window_id", "preferred_method", "overall_usefulness", "preference_notes"];
    const prefRows = Object.entries(preferenceMap).map(([windowId, pref]) => ({
      reviewer_id: reviewerId || "anonymous",
      window_id: windowId,
      preferred_method: pref.preferred_method || "",
      overall_usefulness: pref.overall_usefulness ?? "",
      preference_notes: pref.preference_notes || "",
    }));
    const csvText = rowsToCsv(prefColumns, prefRows);
    const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `preference_ranking${reviewerId ? `_${reviewerId}` : ""}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (!selectedWindow) {
    return <div className="p-10 text-sm text-slate-500">Loading benchmark lab...</div>;
  }

  return (
    <div className={theme === "dark" ? "dark" : ""}>
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Glasses Benchmark Lab</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Review proactive recommendation triggers against transcript context, video, and scorecard feedback.
            </p>
            {selectedMethod ? (
              <p className="mt-1 text-xs font-semibold uppercase tracking-[0.18em] text-labPurple">
                {selectedMethod.label}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {/* Reviewer ID */}
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Reviewer
              </label>
              <input
                type="text"
                value={reviewerId}
                onChange={(event) => {
                  const next = event.target.value.replace(/[^a-zA-Z0-9_-]/g, "");
                  setReviewerId(next);
                  localStorage.setItem(STORAGE_KEYS.reviewerId, next);
                }}
                placeholder="your_id"
                className={cn(
                  "w-28 rounded-xl border px-3 py-2.5 text-sm outline-none transition",
                  reviewerId
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400"
                    : "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-400",
                )}
              />
            </div>
            {/* Dataset switcher */}
            <div className="flex rounded-xl border border-slate-300 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-950">
              {[
                { id: "egocom", label: "EgoCom" },
                { id: "scenarios", label: "Scenarios" },
              ].map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => switchDataset(id)}
                  className={cn(
                    "px-4 py-2.5 text-sm font-semibold transition",
                    selectedDataset === id
                      ? "bg-labPurple text-white"
                      : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
              className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-slate-600"
            >
              {theme === "dark" ? "Light Mode" : "Dark Mode"}
            </button>
            {methods.length > 1 && (
              <>
                <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Method
                </label>
                <select
                  value={selectedMethod?.id || ""}
                  onChange={(event) => {
                    const nextMethodId = event.target.value;
                    setSelectedMethodId(nextMethodId);
                    const nextMethod = methods.find((entry) => entry.id === nextMethodId);
                    // Try to stay on the same scenario window when switching methods
                    const currentWindowId = selectedWindow?.window_id;
                    const sameWindow = currentWindowId && nextMethod?.windows?.find((w) => w.window_id === currentWindowId);
                    const nextWindow = sameWindow || nextMethod?.windows?.[0];
                    setSelectedWindowId(nextWindow?.window_id || "");
                    setSelectedTriggerId(nextWindow?.triggers?.[0]?.trigger_id || "");
                    setGeneratedDraft(null);
                  }}
                  className="min-w-[220px] rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-labPurple focus:ring-2 focus:ring-purple-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-purple-900/40"
                >
                  {methods.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </>
            )}
            <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              {selectedDataset === "scenarios" ? "Scenario" : "Window"}
            </label>
            <select
              value={selectedWindow.window_id}
              onChange={(event) => {
                const nextId = event.target.value;
                setSelectedWindowId(nextId);
                const nextWindow = windows.find((entry) => entry.window_id === nextId);
                setSelectedTriggerId(nextWindow?.triggers[0]?.trigger_id || "");
                setGeneratedDraft(null);
              }}
              className="min-w-[320px] rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-labPurple focus:ring-2 focus:ring-purple-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-purple-900/40"
            >
              {windows.map((entry) => (
                <option key={entry.window_id} value={entry.window_id}>
                  {entry.context_intro?.title || entry.window_id}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1800px] gap-6 px-6 py-6 xl:grid-cols-[1.2fr_1fr_1fr]">
        <Panel
          title="Video & Context"
          subtitle={`${selectedWindow.video_name} · ${selectedWindow.start_sec}-${selectedWindow.end_sec}s`}
        >
          <div className="flex h-full flex-col gap-5">
            <div className="rounded-2xl border border-purple-200 bg-purple-50 p-4 dark:border-purple-900/50 dark:bg-purple-950/30">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {selectedWindow.context_intro?.title || "Transcript-Derived Context Intro"}
                  </h3>
                  <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
                    {selectedWindow.context_intro?.summary ||
                      "Use this section to understand the current conversational scene before reviewing triggers."}
                  </p>
                </div>
              </div>
              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Current Signals
                  </div>
                  <ul className="mt-2 space-y-2 text-sm text-slate-700">
                    {(selectedWindow.context_intro?.signals || []).map((item) => (
                      <li key={item} className="rounded-xl bg-white/70 px-3 py-2 dark:bg-slate-900/70 dark:text-slate-300">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Future Second-Brain Factors
                  </div>
                  <ul className="mt-2 space-y-2 text-sm text-slate-700">
                    {(selectedWindow.context_intro?.future_context || []).map((item) => (
                      <li key={item} className="rounded-xl bg-white/70 px-3 py-2 dark:bg-slate-900/70 dark:text-slate-300">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            {/* Scenario metadata — only shown for scenario benchmark */}
            {selectedWindow.scenario_meta && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Scenario Metadata</h3>
                  <div className="flex items-center gap-2">
                    {selectedWindow.scenario_meta.proactive_index === true && (
                      <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400">
                        Should Trigger
                      </span>
                    )}
                    {selectedWindow.scenario_meta.proactive_index === false && (
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                        Negative Example
                      </span>
                    )}
                    {selectedWindow.scenario_meta.proactive_score !== "" && (
                      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-950/50 dark:text-amber-400">
                        Score {selectedWindow.scenario_meta.proactive_score}/5
                      </span>
                    )}
                  </div>
                </div>
                <div className="mt-3 grid gap-2">
                  {selectedWindow.scenario_meta.persona && (
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Wearer Persona</div>
                      <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{selectedWindow.scenario_meta.persona}</p>
                    </div>
                  )}
                  {selectedWindow.scenario_meta.wearer_goal && (
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                        Wearer Goal
                        {selectedWindow.scenario_meta.goal_type && (
                          <span className="ml-2 normal-case font-normal text-slate-400">· {selectedWindow.scenario_meta.goal_type}</span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{selectedWindow.scenario_meta.wearer_goal}</p>
                    </div>
                  )}
                  {selectedWindow.scenario_meta.signal_type && selectedWindow.scenario_meta.signal_type !== "none" && (
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Signal Type</div>
                      <span className="mt-1 inline-block rounded-lg bg-white px-2.5 py-1 text-xs font-mono text-slate-700 dark:bg-slate-900 dark:text-slate-300">
                        {selectedWindow.scenario_meta.signal_type}
                      </span>
                    </div>
                  )}
                  {selectedWindow.scenario_meta.context_note && (
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Context Note</div>
                      <p className="mt-1 text-sm text-slate-600 italic dark:text-slate-400">{selectedWindow.scenario_meta.context_note}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-slate-200 bg-slate-950 p-3">
              <div className="aspect-video overflow-hidden rounded-xl bg-slate-900">
                {currentVideoUrl ? (
                  <ReactPlayer
                    ref={playerRef}
                    url={currentVideoUrl}
                    width="100%"
                    height="100%"
                    controls
                    onProgress={({ playedSeconds }) => setCurrentPlayback(playedSeconds)}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center px-8 text-center text-sm text-slate-300">
                    Add a video URL or load a local video file for this `video_name` to review playback.
                  </div>
                )}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <TextInput
                label="Video URL"
                value={currentVideoUrl}
                onChange={updateVideoUrl}
                placeholder="http://localhost:3000/videos/current-window.mp4"
              />
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Load Local Video
                </span>
                <input
                  type="file"
                  accept="video/*"
                  onChange={handleLocalVideoPick}
                  className="block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 file:mr-4 file:rounded-lg file:border-0 file:bg-purple-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-labPurple"
                />
              </label>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/50">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Manual Recommendation Comment</h3>
                <button
                  type="button"
                          onClick={() => setDraftComment((current) => ({
                            ...current,
                            timestamp: clipToAbsoluteSeconds(currentPlayback).toFixed(2),
                          }))}
                  className="rounded-lg bg-purple-50 px-3 py-2 text-xs font-medium text-labPurple dark:bg-purple-950/50"
                >
                  Use Current Playback
                </button>
              </div>
              <div className="mt-4 grid gap-4">
                <div className="grid gap-4 md:grid-cols-[180px_1fr]">
                  <TextInput
                    label="Timestamp"
                    value={draftComment.timestamp}
                    onChange={(value) => setDraftComment((current) => ({ ...current, timestamp: value }))}
                    placeholder="92.50"
                  />
                  <label className="block">
                    <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Recommendation Mode
                    </span>
                    <select
                      value={draftComment.recommendationMode}
                      onChange={(event) =>
                        setDraftComment((current) => ({
                          ...current,
                          recommendationMode: event.target.value,
                        }))
                      }
                      className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-labPurple focus:ring-2 focus:ring-purple-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-purple-900/40"
                    >
                      {recommendationModes.map((mode) => (
                        <option key={mode} value={mode}>
                          {mode}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <TextArea
                  label="Recommendation 1"
                  rows={3}
                  value={draftComment.recommendation1}
                  onChange={(value) =>
                    setDraftComment((current) => ({ ...current, recommendation1: value }))
                  }
                  placeholder="Say: Ask them to clarify the key constraint."
                />
                <TextArea
                  label="Recommendation 2"
                  rows={3}
                  value={draftComment.recommendation2}
                  onChange={(value) =>
                    setDraftComment((current) => ({ ...current, recommendation2: value }))
                  }
                  placeholder="Know: They are signaling uncertainty about scope."
                />
                <TextArea
                  label="Rationale"
                  rows={2}
                  value={draftComment.rationale}
                  onChange={(value) =>
                    setDraftComment((current) => ({ ...current, rationale: value }))
                  }
                  placeholder="Why this recommendation helps at this moment."
                />
                <button
                  type="button"
                  onClick={addManualComment}
                  className="rounded-xl bg-labPurple px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-700"
                >
                  Add Comment Recommendation
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Manual Comments</h3>
                <span className="text-xs text-slate-500 dark:text-slate-400">{currentWindowComments.length} comments</span>
              </div>
              <div className="mt-3 max-h-48 space-y-3 overflow-auto pr-1">
                {currentWindowComments.length ? (
                  currentWindowComments.map((comment) => (
                    <div key={comment.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/50">
                      <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                        <span>{comment.recommendation_mode}</span>
                        <button
                          type="button"
                          onClick={() => seekTo(Number(comment.timestamp))}
                          className="font-semibold text-labPurple"
                        >
                          {comment.timestamp}s
                        </button>
                      </div>
                      <p className="mt-2 text-sm text-slate-800 dark:text-slate-100">{comment.recommendation_1}</p>
                      <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">{comment.recommendation_2}</p>
                      {comment.rationale ? (
                        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{comment.rationale}</p>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-500 dark:text-slate-400">No manual comment recommendations added yet.</p>
                )}
              </div>
            </div>
          </div>
        </Panel>

        <Panel
          title="Transcript & AI Drafting"
          subtitle={`${selectedWindow.triggers.length} AI decision points for this window`}
          action={
            <button
              type="button"
              onClick={handleGenerate}
              className="rounded-xl bg-labPurple px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-700"
            >
              {generatorState.loading ? "Generating..." : "Generate AI Recommendations"}
            </button>
          }
        >
          <div className="flex h-full flex-col gap-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/50">
              <div className="flex flex-wrap items-start gap-3">
                {selectedWindow.triggers.map((trigger) => (
                  <button
                    key={trigger.trigger_id}
                    type="button"
                    onClick={() => {
                      setSelectedTriggerId(trigger.trigger_id);
                      seekTo(Number(trigger.final_trigger_timestamp || trigger.trigger_timestamp));
                    }}
                    className={cn(
                      "rounded-xl border px-3 py-2 text-left text-sm transition",
                      selectedTrigger?.trigger_id === trigger.trigger_id
                        ? "border-labPurple bg-purple-50 text-labPurple dark:bg-purple-950/40"
                        : "border-slate-300 bg-white text-slate-700 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600",
                    )}
                  >
                      <div className="font-semibold">{trigger.trigger_id}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {formatTriggerLabel(trigger.final_trigger_timestamp || trigger.trigger_timestamp)}
                      </div>
                    </button>
                  ))}
              </div>
            </div>

            {selectedTrigger ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Current AI Recommendation</h3>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      Trigger {selectedTrigger.trigger_id} at{" "}
                      {formatTriggerLabel(
                        activeReviewState.final_trigger_timestamp || selectedTrigger.trigger_timestamp,
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      seekTo(Number(activeReviewState.final_trigger_timestamp || selectedTrigger.trigger_timestamp))
                    }
                    className="rounded-lg bg-purple-50 px-3 py-2 text-xs font-semibold text-labPurple dark:bg-purple-950/50"
                  >
                    Jump to Trigger
                  </button>
                </div>
                <div className="mt-4 grid gap-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/50">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                      Recommendation 1
                    </div>
                    <p className="mt-2 text-sm text-slate-900 dark:text-slate-100">{selectedTrigger.recommendation_1}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/50">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                      Recommendation 2
                    </div>
                    <p className="mt-2 text-sm text-slate-900 dark:text-slate-100">{selectedTrigger.recommendation_2}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/50">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                      Rationale
                    </div>
                    <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">{selectedTrigger.rationale}</p>
                  </div>
                </div>
              </div>
            ) : null}

            <details className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <summary className="cursor-pointer list-none text-sm font-semibold text-slate-800 dark:text-slate-100">
                Lab Settings
              </summary>
              <div className="mt-4 grid gap-4">
                <TextInput
                  label="API Base URL"
                  value={apiSettings.baseUrl}
                  onChange={(value) => setApiSettings((current) => ({ ...current, baseUrl: value }))}
                />
                <TextInput
                  label="Model"
                  value={apiSettings.model}
                  onChange={(value) => setApiSettings((current) => ({ ...current, model: value }))}
                />
                <TextInput
                  label="API Key"
                  type="password"
                  value={apiSettings.apiKey}
                  onChange={(value) => setApiSettings((current) => ({ ...current, apiKey: value }))}
                />
                {generatorState.error ? (
                  <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
                    {generatorState.error}
                  </p>
                ) : null}
                {generatedDraft ? (
                  <div className="rounded-xl border border-purple-200 bg-purple-50 p-4 dark:border-purple-900/50 dark:bg-purple-950/30">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-labPurple">
                      Latest Generated Draft
                    </div>
                    <p className="mt-2 text-sm text-slate-800 dark:text-slate-200">
                      {generatedDraft.trigger_timestamp}s · {generatedDraft.recommendation_mode}
                    </p>
                    <p className="mt-2 text-sm text-slate-900 dark:text-slate-100">{generatedDraft.recommendation_1}</p>
                    <p className="mt-2 text-sm text-slate-900 dark:text-slate-100">{generatedDraft.recommendation_2}</p>
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{generatedDraft.rationale}</p>
                  </div>
                ) : null}
              </div>
            </details>

            <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-800 dark:border-slate-800 dark:text-slate-100">
                Transcript
              </div>
              <div className="max-h-[720px] space-y-2 overflow-auto px-4 py-4">
                {(() => {
                  // Build a map of trigger insertions: after which transcript line index should we show each trigger?
                  const triggers = selectedWindow?.triggers || [];
                  const triggerInsertMap = {};
                  for (const trigger of triggers) {
                    const triggerSec = Number(trigger.trigger_timestamp);
                    if (!Number.isFinite(triggerSec)) continue;
                    // Find the last transcript line at or before the trigger timestamp
                    let bestIdx = -1;
                    for (let i = 0; i < transcriptLines.length; i++) {
                      if (transcriptLines[i].seconds !== null && transcriptLines[i].seconds <= triggerSec + 0.5) {
                        bestIdx = i;
                      }
                    }
                    if (bestIdx === -1) bestIdx = 0;
                    if (!triggerInsertMap[bestIdx]) triggerInsertMap[bestIdx] = [];
                    triggerInsertMap[bestIdx].push(trigger);
                  }

                  const elements = [];
                  transcriptLines.forEach((line, index) => {
                    const activeSeconds = Number(
                      activeReviewState.final_trigger_timestamp || selectedTrigger?.trigger_timestamp,
                    );
                    const highlighted =
                      line.seconds !== null && Number.isFinite(activeSeconds)
                        ? Math.abs(line.seconds - activeSeconds) <= 1.5
                        : false;
                    elements.push(
                      <button
                        key={`line-${index}`}
                        type="button"
                        onClick={() => {
                          if (line.seconds !== null) {
                            seekTo(line.seconds);
                            setDraftComment((current) => ({
                              ...current,
                              timestamp: String(line.seconds),
                            }));
                          }
                        }}
                        className={cn(
                          "block w-full rounded-xl border px-4 py-3 text-left transition",
                          highlighted
                            ? "border-purple-200 bg-purple-50 shadow-sm dark:border-purple-900/50 dark:bg-purple-950/30"
                            : "border-transparent bg-white hover:border-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:hover:border-slate-800 dark:hover:bg-slate-950/50",
                        )}
                      >
                        <div className="flex gap-3 text-sm">
                          <span
                            className={cn(
                              "min-w-[86px] font-mono text-xs",
                              highlighted ? "text-labPurple" : "text-slate-400 dark:text-slate-500",
                            )}
                          >
                            {line.seconds !== null
                              ? hasWindowClip
                                ? `${absoluteToClipSeconds(line.seconds).toFixed(2)}s`
                                : `${line.seconds.toFixed(2)}s`
                              : "note"}
                          </span>
                          <div>
                            {line.speaker ? (
                              <span className="mr-2 font-semibold text-slate-700 dark:text-slate-300">{line.speaker}</span>
                            ) : null}
                            <span className={highlighted ? "text-slate-900 dark:text-slate-100" : "text-slate-700 dark:text-slate-300"}>
                              {line.text}
                            </span>
                          </div>
                        </div>
                      </button>,
                    );

                    // Insert inline trigger cards after this line
                    if (triggerInsertMap[index]) {
                      for (const trigger of triggerInsertMap[index]) {
                        const isSelected = trigger.trigger_id === selectedTrigger?.trigger_id;
                        const urgencyColors = { low: "border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/40", medium: "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40", high: "border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/40" };
                        const urgencyBorder = urgencyColors[trigger.urgency] || urgencyColors.medium;
                        elements.push(
                          <button
                            key={`trigger-${trigger.trigger_id}`}
                            type="button"
                            onClick={() => setSelectedTriggerId(trigger.trigger_id)}
                            className={cn(
                              "block w-full rounded-xl border-2 px-4 py-3 text-left transition",
                              isSelected ? "border-purple-400 bg-purple-50 ring-2 ring-purple-200 dark:border-purple-500 dark:bg-purple-950/40 dark:ring-purple-800" : urgencyBorder,
                            )}
                          >
                            <div className="flex items-center gap-2 text-xs">
                              <span className="rounded-full bg-purple-100 px-2 py-0.5 font-bold text-purple-700 dark:bg-purple-900/60 dark:text-purple-300">
                                AGENT
                              </span>
                              <span className="font-mono text-slate-500">{trigger.trigger_timestamp}s</span>
                              <span className="rounded-full bg-slate-200 px-2 py-0.5 font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                                {trigger.recommendation_mode}
                              </span>
                              {trigger.proactive_score !== "" && trigger.proactive_score != null && (
                                <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700 dark:bg-amber-900/60 dark:text-amber-300">
                                  {trigger.proactive_score}/5
                                </span>
                              )}
                              {trigger.signal_type && (
                                <span className="rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-rose-600 dark:bg-rose-900/60 dark:text-rose-300">
                                  {trigger.signal_type}
                                </span>
                              )}
                              <span className="rounded-full bg-slate-200 px-2 py-0.5 font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                                {trigger.urgency}
                              </span>
                            </div>
                            <div className="mt-2 grid gap-1.5">
                              <div className="flex gap-2 text-sm">
                                <span className="font-bold text-cyan-600 dark:text-cyan-400">1:</span>
                                <span className="text-slate-800 dark:text-slate-200">{trigger.recommendation_1}</span>
                              </div>
                              <div className="flex gap-2 text-sm">
                                <span className="font-bold text-cyan-600 dark:text-cyan-400">2:</span>
                                <span className="text-slate-800 dark:text-slate-200">{trigger.recommendation_2}</span>
                              </div>
                            </div>
                            {trigger.rationale && (
                              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                                {trigger.rationale}
                              </p>
                            )}
                          </button>,
                        );
                      }
                    }
                  });
                  return elements;
                })()}
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="The Scorecard" subtitle="Preference ranking and per-trigger diagnostics">
          <div className="flex h-full flex-col gap-4">
            <ReviewRubric />

            {/* ── Preference Ranking (across methods for this scenario) ── */}
            {methodSummaries.length > 1 && selectedWindow && (
              <div className="rounded-2xl border-2 border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-800 dark:bg-indigo-950/30">
                <h3 className="text-sm font-bold text-indigo-900 dark:text-indigo-200">
                  Preference Ranking
                </h3>
                <p className="mt-1 text-xs text-indigo-700 dark:text-indigo-400">
                  Which model&apos;s output would you most want as your assistant for this scenario? Read the recommendations inline in the transcript (switch methods to compare), then pick your preferred one.
                </p>
                <div className="mt-3 space-y-2">
                  {methodSummaries.map((ms) => {
                    const isPreferred = preferenceMap[selectedWindow.window_id]?.preferred_method === ms.methodId;
                    const triggerCount = ms.triggers.length;
                    return (
                      <button
                        key={ms.methodId}
                        type="button"
                        onClick={() => {
                          setPreferenceMap((current) => ({
                            ...current,
                            [selectedWindow.window_id]: {
                              ...current[selectedWindow.window_id],
                              preferred_method: isPreferred ? "" : ms.methodId,
                            },
                          }));
                        }}
                        className={cn(
                          "flex w-full items-center justify-between rounded-xl border-2 px-4 py-3 text-left text-sm transition",
                          isPreferred
                            ? "border-indigo-500 bg-indigo-100 text-indigo-900 ring-2 ring-indigo-300 dark:border-indigo-400 dark:bg-indigo-900/40 dark:text-indigo-100 dark:ring-indigo-700"
                            : "border-slate-200 bg-white text-slate-700 hover:border-indigo-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-indigo-700",
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className={cn("text-lg", isPreferred ? "opacity-100" : "opacity-30")}>
                            {isPreferred ? "\u2605" : "\u2606"}
                          </span>
                          <span className="font-semibold">{ms.label}</span>
                          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-400">
                            {triggerCount} trigger{triggerCount !== 1 ? "s" : ""}
                          </span>
                        </div>
                        {isPreferred && (
                          <span className="rounded-full bg-indigo-200 px-2 py-0.5 text-xs font-bold text-indigo-800 dark:bg-indigo-800 dark:text-indigo-200">
                            PREFERRED
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3">
                  <TextArea
                    label="Why this preference? (optional)"
                    rows={2}
                    value={preferenceMap[selectedWindow?.window_id]?.preference_notes || ""}
                    onChange={(value) => {
                      setPreferenceMap((current) => ({
                        ...current,
                        [selectedWindow.window_id]: {
                          ...current[selectedWindow.window_id],
                          preference_notes: value,
                        },
                      }));
                    }}
                    placeholder="e.g., Better timing, more actionable recs, less over-triggering..."
                  />
                </div>
                <div className="mt-3">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-400">
                    Overall Usefulness (1-5)
                  </span>
                  <p className="mt-0.5 text-xs text-indigo-600/70 dark:text-indigo-400/70">
                    How useful was the best agent output for this scenario? 1 = useless, 3 = somewhat helpful, 5 = exactly what I&apos;d want
                  </p>
                  <div className="mt-2 flex gap-2">
                    {[1, 2, 3, 4, 5].map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => {
                          setPreferenceMap((current) => ({
                            ...current,
                            [selectedWindow.window_id]: {
                              ...current[selectedWindow.window_id],
                              overall_usefulness: preferenceMap[selectedWindow.window_id]?.overall_usefulness === value ? null : value,
                            },
                          }));
                        }}
                        className={cn(
                          "rounded-lg border px-4 py-2 text-sm font-semibold transition",
                          preferenceMap[selectedWindow?.window_id]?.overall_usefulness === value
                            ? "border-indigo-500 bg-indigo-100 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-900/40 dark:text-indigo-300"
                            : "border-slate-300 bg-white text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400",
                        )}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── Per-trigger diagnostics ── */}
            {selectedTrigger ? (
              <>
                <details className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/50" open>
                  <summary className="cursor-pointer list-none text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Trigger Diagnostics: {selectedTrigger.trigger_id} · {selectedTrigger.trigger_timestamp}s
                    {selectedTrigger.proactive_score !== "" && selectedTrigger.proactive_score != null && (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-950/50 dark:text-amber-400">
                        score {selectedTrigger.proactive_score}/5
                      </span>
                    )}
                    {selectedTrigger.signal_type && (
                      <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:bg-rose-950/50 dark:text-rose-400">
                        {selectedTrigger.signal_type}
                      </span>
                    )}
                    <span className="ml-2 rounded-full bg-white px-3 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                      {activeReviewState.review_decision || "pending"}
                    </span>
                  </summary>

                  <div className="mt-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                      Review Decision
                    </div>
                    <div className="mt-3 flex flex-wrap gap-3">
                      {reviewDecisions.map((decision) => (
                        <label
                          key={decision}
                          className={cn(
                            "flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm",
                            activeReviewState.review_decision === decision
                              ? "border-labPurple bg-purple-50 text-labPurple dark:bg-purple-950/40"
                              : "border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
                          )}
                        >
                          <input
                            type="radio"
                            name="review-decision"
                            checked={activeReviewState.review_decision === decision}
                            onChange={() => updateReviewField("review_decision", decision)}
                          />
                          <span className="capitalize">{decision}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Task A — Was this the right moment? */}
                  <div className="mt-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-400">
                      Task A — Was this the right moment?
                    </div>
                    <div className="mt-2 flex flex-wrap gap-3">
                      <label title="Should the agent have triggered here?" className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm cursor-pointer dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                        <input type="checkbox" checked={activeReviewState.trigger_appropriate === "1"} onChange={(e) => updateReviewField("trigger_appropriate", e.target.checked ? "1" : "0")} />
                        Appropriate
                      </label>
                      <label title="Worth the interruption cost?" className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm cursor-pointer dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                        <input type="checkbox" checked={activeReviewState.interruption_worthy === "1"} onChange={(e) => updateReviewField("interruption_worthy", e.target.checked ? "1" : "0")} />
                        Worth Interruption
                      </label>
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-slate-500">Timing:</span>
                        {[1, 2, 3].map((v) => (
                          <button key={v} type="button" onClick={() => updateReviewField("trigger_timing", String(v))}
                            className={cn("rounded-lg border px-3 py-1.5 text-xs font-semibold", activeReviewState.trigger_timing === String(v) ? "border-emerald-400 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40" : "border-slate-300 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-900")}>
                            {v}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Task B — Rec quality */}
                  <div className="mt-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-labPurple">
                      Task B — Recommendation Quality
                    </div>
                    <div className="mt-2 flex flex-wrap gap-3">
                      {[
                        ["useful_1", "Useful 1"],
                        ["useful_2", "Useful 2"],
                        ["grounded", "Grounded"],
                        ["distinct_pair", "Distinct Pair"],
                      ].map(([field, label]) => (
                        <label key={field} className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm cursor-pointer dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                          <input type="checkbox" checked={activeReviewState[field] === "1"} onChange={(e) => updateReviewField(field, e.target.checked ? "1" : "0")} />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Task C — Goal inference */}
                  <div className="mt-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-600 dark:text-amber-400">
                      Task C — Goal Inference
                    </div>
                    {selectedTrigger.wearer_goal && (
                      <p className="mt-1 text-xs text-slate-500 italic dark:text-slate-400">
                        Agent inferred: &ldquo;{selectedTrigger.wearer_goal}&rdquo;
                        {selectedTrigger.goal_type ? ` [${selectedTrigger.goal_type}]` : ""}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-3">
                      {[
                        ["goal_plausible", "Plausible"],
                        ["goal_specific", "Specific"],
                        ["goal_useful_for_recs", "Useful for Recs"],
                      ].map(([field, label]) => (
                        <label key={field} className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm cursor-pointer dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                          <input type="checkbox" checked={activeReviewState[field] === "1"} onChange={(e) => updateReviewField(field, e.target.checked ? "1" : "0")} />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4">
                    <TextArea
                      label="Notes"
                      rows={2}
                      value={activeReviewState.review_notes || ""}
                      onChange={(value) => updateReviewField("review_notes", value)}
                      placeholder="Optional notes on this specific trigger."
                    />
                  </div>
                </details>
              </>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">Select a trigger from the transcript to review it.</p>
            )}
          </div>
        </Panel>
      </main>

      <footer className="sticky bottom-0 border-t border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="text-sm text-slate-500 dark:text-slate-400">
            {!reviewerId && (
              <span className="mr-2 rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-400">
                Set reviewer ID to track your progress
              </span>
            )}
            {reviewerId && (
              <span className="mr-2 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                {reviewerId}
              </span>
            )}
            {exportPreview ? "Autosaved." : "Review decisions autosave on every change."}
            {(() => {
              const known = getKnownReviewerIds().filter(Boolean);
              if (known.length === 0) return null;
              return (
                <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">
                  Reviewers: {known.join(", ")}
                </span>
              );
            })()}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={downloadReviewCsv}
              className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-600"
            >
              Download Review CSV
            </button>
            <button
              type="button"
              onClick={downloadPreferenceCsv}
              className="rounded-xl border border-indigo-300 px-4 py-3 text-sm font-semibold text-indigo-700 transition hover:border-indigo-400 dark:border-indigo-700 dark:text-indigo-300 dark:hover:border-indigo-600"
            >
              Download Preferences CSV
            </button>
            <button
              type="button"
              onClick={downloadJson}
              className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-600"
            >
              Download JSON
            </button>
            <button
              type="button"
              onClick={saveAndNext}
              className="rounded-xl bg-labPurple px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-700"
            >
              Save & Next
            </button>
          </div>
        </div>
      </footer>
    </div>
    </div>
  );
}
