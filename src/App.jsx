import { useEffect, useMemo, useRef, useState } from "react";
import ReactPlayer from "react-player";

const STORAGE_KEYS = {
  reviewExport: "benchmark-lab-review-export",
  apiSettings: "benchmark-lab-api-settings",
  videoUrls: "benchmark-lab-video-urls",
  manualComments: "benchmark-lab-manual-comments",
  candidateRanks: "benchmark-lab-candidate-ranks",
  theme: "benchmark-lab-theme",
  selectedMethod: "benchmark-lab-selected-method",
};

const reviewSheetColumns = [
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
];

const reviewDecisions = ["accepted", "edited", "rejected"];
const recommendationModes = ["say", "know", "both"];
const candidateRankingColumns = [
  "method_id",
  "window_id",
  "conversation_id",
  "video_name",
  "trigger_id",
  "trigger_timestamp",
  "candidate_id",
  "candidate_position",
  "mode",
  "text",
  "rationale",
  "intended_benefit",
  "model_rank",
  "human_rank",
  "selected_top2",
  "review_notes",
];

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

function candidateKey(methodId, windowId, triggerId, candidateId) {
  return `${methodId}::${windowId}::${triggerId}::${candidateId}`;
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
          useful_1: trigger.useful_1 || "",
          useful_2: trigger.useful_2 || "",
          grounded: trigger.grounded || "",
          distinct_pair: trigger.distinct_pair || "",
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

function buildInitialCandidateRankMap(methods) {
  const next = {};
  for (const methodEntry of methods) {
    for (const windowEntry of methodEntry.windows || []) {
      for (const trigger of windowEntry.triggers || []) {
        for (const candidate of trigger.candidates || []) {
          const key = candidateKey(
            methodEntry.id,
            windowEntry.window_id,
            trigger.trigger_id,
            candidate.candidate_id,
          );
          next[key] = {
            human_rank: candidate.human_rank || "",
            selected_top2: candidate.selected_top2 || "",
            review_notes: candidate.review_notes || "",
          };
        }
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

  const prompt = `You are reviewing one egocentric conversation window for proactive assistance.

Window metadata:
- window_id: ${windowEntry.window_id}
- video_name: ${windowEntry.video_name}
- conversation_id: ${windowEntry.conversation_id}
- start_sec: ${windowEntry.start_sec}
- end_sec: ${windowEntry.end_sec}

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
  const [dataset, setDataset] = useState(null);
  const [selectedMethodId, setSelectedMethodId] = useState(
    () => localStorage.getItem(STORAGE_KEYS.selectedMethod) || "",
  );
  const [selectedWindowId, setSelectedWindowId] = useState("");
  const [selectedTriggerId, setSelectedTriggerId] = useState("");
  const [reviewMap, setReviewMap] = useState({});
  const [videoUrls, setVideoUrls] = useState(() => parseJsonStorage(STORAGE_KEYS.videoUrls, {}));
  const [manualComments, setManualComments] = useState(() =>
    parseJsonStorage(STORAGE_KEYS.manualComments, {}),
  );
  const [candidateRankMap, setCandidateRankMap] = useState(() =>
    parseJsonStorage(STORAGE_KEYS.candidateRanks, {}),
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
    parseJsonStorage(STORAGE_KEYS.reviewExport, null),
  );

  useEffect(() => {
    async function bootstrap() {
      const [labData, manifest] = await Promise.all([
        loadJson("/data/benchmark-lab.json", { windows: [] }),
        loadJson("/data/video-manifest.json", {}),
      ]);
      setDataset(labData);
      const methods = labData.methods || [];
      const initialMethodId =
        localStorage.getItem(STORAGE_KEYS.selectedMethod) ||
        labData.default_method_id ||
        methods[0]?.id ||
        "";
      const initialMethod =
        methods.find((entry) => entry.id === initialMethodId) || methods[0] || { windows: [] };
      const initialWindowId = initialMethod.windows?.[0]?.window_id || "";
      setSelectedMethodId(initialMethodId);
      setSelectedWindowId(initialWindowId);
      setSelectedTriggerId(initialMethod.windows?.[0]?.triggers?.[0]?.trigger_id || "");
      setReviewMap(buildInitialReviewMap(methods));
      setCandidateRankMap((current) => {
        const seeded = buildInitialCandidateRankMap(methods);
        return { ...seeded, ...current };
      });
      setVideoUrls((current) => ({ ...manifest, ...current }));
    }
    bootstrap();
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.videoUrls, JSON.stringify(videoUrls));
  }, [videoUrls]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.manualComments, JSON.stringify(manualComments));
  }, [manualComments]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.candidateRanks, JSON.stringify(candidateRankMap));
  }, [candidateRankMap]);

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

  const activeTriggerKey = selectedMethod && selectedWindow && selectedTrigger
    ? triggerKey(selectedMethod.id, selectedWindow.window_id, selectedTrigger.trigger_id)
    : null;

  const activeReviewState = activeTriggerKey
    ? reviewMap[activeTriggerKey] || {}
    : {};

  const selectedCandidates = selectedTrigger?.candidates || [];

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
      method_id: selectedMethod?.id || "active_method",
      windows: windows.map((windowEntry) => ({
        window_id: windowEntry.window_id,
        video_name: windowEntry.video_name,
        review_status: windowEntry.review_status,
        trigger_decision: windowEntry.trigger_decision,
        reviewer_notes: windowEntry.reviewer_notes,
      })),
      trigger_reviews: triggerReviews,
      candidate_rankings: selectedMethod
        ? windows.flatMap((windowEntry) =>
            (windowEntry.triggers || []).flatMap((trigger) =>
              (trigger.candidates || []).map((candidate) => {
                const key = candidateKey(
                  selectedMethod.id,
                  windowEntry.window_id,
                  trigger.trigger_id,
                  candidate.candidate_id,
                );
                return {
                  method_id: selectedMethod.id,
                  window_id: windowEntry.window_id,
                  trigger_id: trigger.trigger_id,
                  candidate_id: candidate.candidate_id,
                  proposed: candidate,
                  review: candidateRankMap[key] || {},
                };
              }),
            ),
          )
        : [],
      manual_comments: manualComments,
      video_urls: videoUrls,
    };
  }, [candidateRankMap, manualComments, reviewMap, selectedMethod, videoUrls, windows]);

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
            useful_1: review.useful_1 ?? "",
            useful_2: review.useful_2 ?? "",
            grounded: review.grounded ?? "",
            distinct_pair: review.distinct_pair ?? "",
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

  const candidateRankingRows = useMemo(
    () =>
      windows.flatMap((windowEntry) =>
        (windowEntry.triggers || []).flatMap((trigger) =>
          (trigger.candidates || []).map((candidate) => {
            const key = candidateKey(
              selectedMethod?.id || "active_method",
              windowEntry.window_id,
              trigger.trigger_id,
              candidate.candidate_id,
            );
            const state = candidateRankMap[key] || {};
            return {
              method_id: selectedMethod?.id || "active_method",
              window_id: windowEntry.window_id,
              conversation_id: windowEntry.conversation_id,
              video_name: windowEntry.video_name,
              trigger_id: trigger.trigger_id,
              trigger_timestamp: trigger.trigger_timestamp ?? "",
              candidate_id: candidate.candidate_id ?? "",
              candidate_position: candidate.candidate_position ?? "",
              mode: candidate.mode ?? "",
              text: candidate.text ?? "",
              rationale: candidate.rationale ?? "",
              intended_benefit: candidate.intended_benefit ?? "",
              model_rank: candidate.model_rank ?? candidate.candidate_position ?? "",
              human_rank: state.human_rank ?? "",
              selected_top2: state.selected_top2 ?? "",
              review_notes: state.review_notes ?? "",
            };
          }),
        ),
      ),
    [candidateRankMap, selectedMethod, windows],
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

  function updateCandidateField(candidateId, field, value) {
    if (!selectedMethod || !selectedWindow || !selectedTrigger) {
      return;
    }
    const key = candidateKey(
      selectedMethod.id,
      selectedWindow.window_id,
      selectedTrigger.trigger_id,
      candidateId,
    );
    setCandidateRankMap((current) => ({
      ...current,
      [key]: {
        ...current[key],
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
    localStorage.setItem(STORAGE_KEYS.reviewExport, JSON.stringify(payload));
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
    anchor.download = "benchmark-lab-review-export.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadReviewCsv() {
    const csvText = rowsToCsv(reviewSheetColumns, reviewSheetRows);
    const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "egocom_trigger_review_sheet_from_frontend.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadCandidateRankingCsv() {
    const csvText = rowsToCsv(candidateRankingColumns, candidateRankingRows);
    const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "egocom_candidate_rankings_from_frontend.csv";
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
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
              className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-slate-600"
            >
              {theme === "dark" ? "Light Mode" : "Dark Mode"}
            </button>
            <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Method
            </label>
            <select
              value={selectedMethod?.id || ""}
              onChange={(event) => {
                const nextMethodId = event.target.value;
                setSelectedMethodId(nextMethodId);
                const nextMethod = methods.find((entry) => entry.id === nextMethodId);
                const nextWindow = nextMethod?.windows?.[0];
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
            <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Window ID
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
                  {entry.window_id}
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

            {selectedTrigger && selectedCandidates.length ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                      Candidate Recommendations
                    </h3>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      Rank these by usefulness for the wearer at this fixed trigger anchor.
                    </p>
                  </div>
                  <span className="rounded-full bg-purple-50 px-3 py-1 text-xs font-semibold text-labPurple dark:bg-purple-950/40">
                    {selectedCandidates.length} candidates
                  </span>
                </div>
                <div className="mt-4 space-y-3">
                  {selectedCandidates.map((candidate) => {
                    const state =
                      candidateRankMap[
                        candidateKey(
                          selectedMethod?.id || "active_method",
                          selectedWindow.window_id,
                          selectedTrigger.trigger_id,
                          candidate.candidate_id,
                        )
                      ] || {};
                    return (
                      <div
                        key={candidate.candidate_id}
                        className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/50"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                              {candidate.candidate_id} · model rank {candidate.model_rank || candidate.candidate_position}
                            </div>
                            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                              {candidate.mode} · intended benefit: {candidate.intended_benefit || "n/a"}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-3">
                            <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                              Human Rank
                            </label>
                            <select
                              value={state.human_rank || ""}
                              onChange={(event) =>
                                updateCandidateField(candidate.candidate_id, "human_rank", event.target.value)
                              }
                              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-labPurple focus:ring-2 focus:ring-purple-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-purple-900/40"
                            >
                              <option value="">Unranked</option>
                              {selectedCandidates.map((_, index) => (
                                <option key={index + 1} value={String(index + 1)}>
                                  {index + 1}
                                </option>
                              ))}
                            </select>
                            <label className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                              <input
                                type="checkbox"
                                checked={state.selected_top2 === "1"}
                                onChange={(event) =>
                                  updateCandidateField(
                                    candidate.candidate_id,
                                    "selected_top2",
                                    event.target.checked ? "1" : "0",
                                  )
                                }
                              />
                              Top-2
                            </label>
                          </div>
                        </div>
                        <p className="mt-3 text-sm text-slate-900 dark:text-slate-100">{candidate.text}</p>
                        {candidate.rationale ? (
                          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{candidate.rationale}</p>
                        ) : null}
                        <textarea
                          value={state.review_notes || ""}
                          onChange={(event) =>
                            updateCandidateField(candidate.candidate_id, "review_notes", event.target.value)
                          }
                          rows={2}
                          placeholder="Why this candidate deserves its rank."
                          className="mt-3 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-labPurple focus:ring-2 focus:ring-purple-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-purple-900/40"
                        />
                      </div>
                    );
                  })}
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
                {transcriptLines.map((line, index) => {
                  const activeSeconds = Number(
                    activeReviewState.final_trigger_timestamp || selectedTrigger?.trigger_timestamp,
                  );
                  const highlighted =
                    line.seconds !== null && Number.isFinite(activeSeconds)
                      ? Math.abs(line.seconds - activeSeconds) <= 1.5
                      : false;
                  return (
                    <button
                      key={`${line.raw}-${index}`}
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
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="The Scorecard" subtitle="Review decision, binary checks, and final edits">
          <div className="flex h-full flex-col gap-4">
            {selectedTrigger ? (
              <>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/50">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Current Scorecard</h3>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {selectedTrigger.trigger_id} · {selectedTrigger.trigger_timestamp}s · {selectedTrigger.recommendation_mode}
                      </p>
                    </div>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                      {activeReviewState.review_decision || "pending"}
                    </span>
                  </div>

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

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {[
                      ["useful_1", "Useful 1"],
                      ["useful_2", "Useful 2"],
                      ["grounded", "Grounded"],
                      ["distinct_pair", "Distinct Pair"],
                    ].map(([field, label]) => (
                      <label
                        key={field}
                        className="flex items-center gap-3 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                      >
                        <input
                          type="checkbox"
                          checked={activeReviewState[field] === "1"}
                          onChange={(event) =>
                            updateReviewField(field, event.target.checked ? "1" : "0")
                          }
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {activeReviewState.review_decision === "edited" ? (
                  <div className="rounded-2xl border border-purple-200 bg-purple-50 p-4 dark:border-purple-900/50 dark:bg-purple-950/30">
                    <div className="grid gap-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <TextInput
                          label="Final Timestamp"
                          value={activeReviewState.final_trigger_timestamp || ""}
                          onChange={(value) => updateReviewField("final_trigger_timestamp", value)}
                        />
                        <label className="block">
                          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                            Final Mode
                          </span>
                          <select
                            value={activeReviewState.final_recommendation_mode || "say"}
                            onChange={(event) =>
                              updateReviewField("final_recommendation_mode", event.target.value)
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
                        label="Final Recommendation 1"
                        value={activeReviewState.final_recommendation_1 || ""}
                        onChange={(value) => updateReviewField("final_recommendation_1", value)}
                      />
                      <TextArea
                        label="Final Recommendation 2"
                        value={activeReviewState.final_recommendation_2 || ""}
                        onChange={(value) => updateReviewField("final_recommendation_2", value)}
                      />
                      <TextArea
                        label="Final Rationale"
                        rows={2}
                        value={activeReviewState.final_rationale || ""}
                        onChange={(value) => updateReviewField("final_rationale", value)}
                      />
                    </div>
                  </div>
                ) : null}

                <TextArea
                  label="Review Notes"
                  rows={3}
                  value={activeReviewState.review_notes || ""}
                  onChange={(value) => updateReviewField("review_notes", value)}
                  placeholder="Why this trigger was accepted, edited, or rejected."
                />
              </>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">This window has no AI trigger proposals.</p>
            )}

            <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-800 dark:border-slate-800 dark:text-slate-100">
                Entire Scorecard for Current Window
              </div>
              <div className="max-h-[360px] space-y-3 overflow-auto px-4 py-4">
                {selectedWindow.triggers.map((trigger) => {
                  const key = triggerKey(
                    selectedMethod?.id || "active_method",
                    selectedWindow.window_id,
                    trigger.trigger_id,
                  );
                  const state = reviewMap[key] || {};
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSelectedTriggerId(trigger.trigger_id)}
                      className={cn(
                        "block w-full rounded-xl border px-4 py-3 text-left transition",
                        selectedTrigger?.trigger_id === trigger.trigger_id
                          ? "border-labPurple bg-purple-50 dark:bg-purple-950/30"
                          : "border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-950/50",
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {trigger.trigger_id} · {trigger.trigger_timestamp}s
                        </span>
                        <span className="rounded-full bg-white px-3 py-1 text-xs text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                          {state.review_decision || "pending"}
                        </span>
                      </div>
                      <p className="mt-2 line-clamp-2 text-sm text-slate-700 dark:text-slate-300">
                        {state.final_recommendation_1 || trigger.recommendation_1}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                        <span>
                          {formatTriggerLabel(
                            state.final_trigger_timestamp || trigger.trigger_timestamp,
                          )}
                        </span>
                        <span>u1:{state.useful_1 || "-"}</span>
                        <span>u2:{state.useful_2 || "-"}</span>
                        <span>g:{state.grounded || "-"}</span>
                        <span>d:{state.distinct_pair || "-"}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </Panel>
      </main>

      <footer className="sticky bottom-0 border-t border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="text-sm text-slate-500 dark:text-slate-400">
            {exportPreview ? "Review state saved locally." : "Save progress into a local JSON export object."}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={downloadCandidateRankingCsv}
              className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-600"
            >
              Download Candidate CSV
            </button>
            <button
              type="button"
              onClick={downloadReviewCsv}
              className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-600"
            >
              Download Review CSV
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
