/**
 * RecordingDetail.tsx
 * 録音詳細画面。
 * ステップ形式で以下の処理を順番に実行する:
 *   1. 文字起こし
 *   2. テキスト編集
 *   3. 要約生成
 *   4. 議事録確認
 *   5. 音声削除
 */

import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  getRecording,
  getTranscript,
  getSummary,
  getSummaryTemplates,
  getLlmStatus,
  startTranscription,
  startSummarization,
  pollJobUntilDone,
  deleteRecording,
  deleteAudio,
  retainAudio,
  LlmStatus,
  Recording,
  Transcript,
  Summary,
  SummaryTemplateOption,
  getStateLabel,
  getStateBadgeClass,
} from "../api/client";
import TranscriptEditor from "../components/TranscriptEditor";
import SummaryViewer from "../components/SummaryViewer";
import AudioDeleteDialog from "../components/AudioDeleteDialog";
import RecordingDeleteDialog from "../components/RecordingDeleteDialog";
import WhisperSettingsDialog from "../components/WhisperSettingsDialog";
import {
  getStoredWhisperModel,
  setStoredWhisperModel,
  WHISPER_MODEL_LABELS,
} from "../lib/whisperSettings";

type Step = "transcribe" | "edit" | "summarize" | "review" | "audio";

const FALLBACK_SUMMARY_TEMPLATES: SummaryTemplateOption[] = [
  {
    name: "general",
    label: "汎用議事録",
    description: "標準的な会議向け。議題、主な議論、決定事項、TODO を整理します。",
  },
  {
    name: "decision_log",
    label: "決定事項重視",
    description: "意思決定とその背景、未決事項を優先して整理します。",
  },
  {
    name: "action_items",
    label: "アクション重視",
    description: "担当・期限・依存関係など、会議後の実務対応を追いやすく整理します。",
  },
];

export default function RecordingDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const recordingId = Number(id);

  const [recording, setRecording] = useState<Recording | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [activeStep, setActiveStep] = useState<Step>("transcribe");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 処理状態
  const [transcribing, setTranscribing] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [jobError, setJobError] = useState<string | null>(null);

  // 音声削除ダイアログ
  const [showAudioDialog, setShowAudioDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showWhisperSettings, setShowWhisperSettings] = useState(false);
  const [whisperModel, setWhisperModel] = useState(getStoredWhisperModel);
  const [summaryTemplates, setSummaryTemplates] = useState<SummaryTemplateOption[]>(
    FALLBACK_SUMMARY_TEMPLATES
  );
  const [llmStatus, setLlmStatus] = useState<LlmStatus | null>(null);
  const [llmStatusError, setLlmStatusError] = useState<string | null>(null);
  const [templateLoadError, setTemplateLoadError] = useState<string | null>(null);
  const [selectedTemplateName, setSelectedTemplateName] = useState<string>(
    FALLBACK_SUMMARY_TEMPLATES[0].name
  );
  const [customPrompt, setCustomPrompt] = useState("");

  // データ取得
  const fetchData = useCallback(async () => {
    let summaryLoaded = false;
    try {
      const rec = await getRecording(recordingId);
      setRecording(rec);
      if (rec.last_summary_template_name) {
        setSelectedTemplateName(rec.last_summary_template_name);
      }

      // 文字起こし結果を取得（存在する場合）
      if (["TRANSCRIBED", "SUMMARIZING", "DONE"].includes(rec.state)) {
        try {
          const t = await getTranscript(recordingId);
          setTranscript(t);
        } catch {
          // まだ存在しない場合は無視
        }
      }

      // 要約結果を取得（存在する場合）
      if (rec.state === "DONE") {
        try {
          const s = await getSummary(recordingId, rec.last_summary_template_name ?? undefined);
          if (!s.content_md?.trim()) {
            throw new Error(
              "要約生成は完了しましたが、議事録本文が空でした。LLM のモデル状態を確認して再生成してください。"
            );
          }
          setSummary(s);
          setSelectedTemplateName(s.template_name);
          summaryLoaded = true;
        } catch (e) {
          setSummary(null);
          setJobError(
            e instanceof Error ? e.message : "議事録の取得に失敗しました"
          );
        }
      } else {
        setSummary(null);
      }

      // 現在の状態に応じてアクティブステップを設定
      if (rec.state === "IMPORTED") setActiveStep("transcribe");
      else if (rec.state === "TRANSCRIBED") setActiveStep("edit");
      else if (rec.state === "DONE") setActiveStep(summaryLoaded ? "review" : "summarize");

    } catch (e) {
      setError(e instanceof Error ? e.message : "データの取得に失敗しました");
    } finally {
      setLoading(false);
    }
    return { summaryLoaded };
  }, [recordingId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const loadSummaryTemplates = async () => {
      try {
        const templates = await getSummaryTemplates();
        if (templates.length > 0) {
          setSummaryTemplates(templates);
        }
        setTemplateLoadError(null);
      } catch (e) {
        setSummaryTemplates(FALLBACK_SUMMARY_TEMPLATES);
        setTemplateLoadError(
          e instanceof Error ? e.message : "テンプレート一覧の取得に失敗しました"
        );
      }
    };

    loadSummaryTemplates();
  }, []);

  const refreshLlmStatus = useCallback(async (): Promise<LlmStatus | null> => {
    try {
      const status = await getLlmStatus();
      setLlmStatus(status);
      setLlmStatusError(null);
      return status;
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "LLM ランタイム状態の取得に失敗しました";
      setLlmStatus(null);
      setLlmStatusError(message);
      return null;
    }
  }, []);

  useEffect(() => {
    refreshLlmStatus();
  }, [refreshLlmStatus]);

  useEffect(() => {
    if (summaryTemplates.length === 0) return;
    if (!summaryTemplates.some((template) => template.name === selectedTemplateName)) {
      setSelectedTemplateName(summaryTemplates[0].name);
    }
  }, [selectedTemplateName, summaryTemplates]);

  // 文字起こし開始
  const handleStartTranscription = async () => {
    setTranscribing(true);
    setJobError(null);
    try {
      const job = await startTranscription(recordingId, whisperModel);
      // ポーリングで完了を待つ
      const completedJob = await pollJobUntilDone(job.id);
      if (completedJob.status === "error") {
        throw new Error(completedJob.log || "文字起こしに失敗しました");
      }
      // データを再取得
      await fetchData();
      setActiveStep("edit");
    } catch (e) {
      setJobError(e instanceof Error ? e.message : "文字起こしに失敗しました");
    } finally {
      setTranscribing(false);
    }
  };

  // 要約生成開始
  const handleStartSummarization = async () => {
    setSummarizing(true);
    setJobError(null);
    try {
      const status = await refreshLlmStatus();
      if (!status) {
        throw new Error("LLM ランタイム状態を確認できませんでした。")
      }
      if (!status.available) {
        throw new Error(
          `${status.message} Ollama を起動してから再実行してください。`
        );
      }
      if (!status.model_loaded) {
        throw new Error(
          `${status.message} 例: ollama pull ${status.configured_model}`
        );
      }

      const job = await startSummarization(recordingId, {
        templateName: selectedTemplateName,
        customPrompt,
      });
      // ポーリングで完了を待つ
      const completedJob = await pollJobUntilDone(job.id, 5000);
      if (completedJob.status === "error") {
        throw new Error(completedJob.log || "要約生成に失敗しました");
      }
      // データを再取得
      const { summaryLoaded } = await fetchData();
      await refreshLlmStatus();
      setCustomPrompt("");
      if (!summaryLoaded) {
        throw new Error(
          "要約生成ジョブは完了しましたが、議事録本文を取得できませんでした。LLM 状態を確認して再生成してください。"
        );
      }
      setActiveStep("review");
      setShowAudioDialog(true);
    } catch (e) {
      setJobError(e instanceof Error ? e.message : "要約生成に失敗しました");
    } finally {
      setSummarizing(false);
    }
  };

  // 音声削除
  const handleDeleteAudio = async () => {
    await deleteAudio(recordingId);
    await fetchData();
    setShowAudioDialog(false);
  };

  // 音声保持
  const handleRetainAudio = async () => {
    await retainAudio(recordingId);
    await fetchData();
    setShowAudioDialog(false);
  };

  const handleDeleteRecording = async () => {
    await deleteRecording(recordingId);
    navigate("/", { replace: true });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Spinner className="w-8 h-8 text-primary-600 mx-auto mb-3" />
          <p className="text-sm text-gray-500">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error || !recording) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-sm">
          <p className="text-red-600 mb-4">{error || "録音が見つかりません"}</p>
          <button onClick={() => navigate("/")} className="btn-secondary">
            一覧に戻る
          </button>
        </div>
      </div>
    );
  }

  const steps: { id: Step; label: string; icon: React.ReactNode }[] = [
    {
      id: "transcribe",
      label: "文字起こし",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
        </svg>
      ),
    },
    {
      id: "edit",
      label: "テキスト編集",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
      ),
    },
    {
      id: "summarize",
      label: "要約生成",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
      ),
    },
    {
      id: "review",
      label: "議事録確認",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
    },
    {
      id: "audio",
      label: "音声管理",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      ),
    },
  ];

  // ステップのアクセス可能性判定
  const isStepAccessible = (step: Step): boolean => {
    const state = recording.state;
    switch (step) {
      case "transcribe": return true;
      case "edit": return ["TRANSCRIBED", "SUMMARIZING", "DONE"].includes(state);
      case "summarize": return ["TRANSCRIBED", "SUMMARIZING", "DONE"].includes(state);
      case "review": return state === "DONE";
      case "audio": return state === "DONE";
      default: return false;
    }
  };

  const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return "日付未設定";
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });
    } catch { return dateStr; }
  };

  const selectedTemplate =
    summaryTemplates.find((template) => template.name === selectedTemplateName) ??
    summaryTemplates[0];
  const currentSummaryTemplate = summaryTemplates.find(
    (template) => template.name === summary?.template_name
  );
  const llmReady = Boolean(llmStatus?.available && llmStatus?.model_loaded);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <button
                onClick={() => navigate("/")}
                className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div className="flex-1 min-w-0">
                <h1 className="text-base font-bold text-gray-900 truncate">{recording.title}</h1>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-gray-500">{formatDate(recording.meeting_date)}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getStateBadgeClass(recording.state)}`}>
                    {getStateLabel(recording.state)}
                  </span>
                </div>
              </div>
            </div>
            <button
              onClick={() => setShowDeleteDialog(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-200
                         text-sm font-medium text-red-700 bg-white hover:bg-red-50
                         focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2
                         transition-colors flex-shrink-0"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              削除
            </button>
          </div>
        </div>
      </header>

      {/* ステップナビゲーション */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-4">
          <div className="flex overflow-x-auto scrollbar-hide">
            {steps.map((step, index) => {
              const accessible = isStepAccessible(step.id);
              const isActive = activeStep === step.id;
              return (
                <button
                  key={step.id}
                  onClick={() => accessible && setActiveStep(step.id)}
                  disabled={!accessible}
                  className={`flex items-center gap-1.5 px-3 py-3 text-xs font-medium whitespace-nowrap
                             border-b-2 transition-colors flex-shrink-0
                             ${isActive
                               ? "border-primary-600 text-primary-700"
                               : accessible
                               ? "border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300"
                               : "border-transparent text-gray-300 cursor-not-allowed"
                             }`}
                >
                  <span className={`${isActive ? "text-primary-600" : accessible ? "text-gray-500" : "text-gray-300"}`}>
                    {step.icon}
                  </span>
                  <span className="hidden sm:inline">{index + 1}. </span>
                  {step.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* メインコンテンツ */}
      <main className="max-w-3xl mx-auto px-4 py-6">
        {/* ジョブエラー表示 */}
        {jobError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <p className="text-sm font-medium text-red-800">処理エラー</p>
                <p className="text-sm text-red-700 mt-1">{jobError}</p>
                <button onClick={() => setJobError(null)} className="text-xs text-red-600 underline mt-1">
                  閉じる
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ステップ 1: 文字起こし */}
        {activeStep === "transcribe" && (
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">文字起こし</h2>
            <p className="text-sm text-gray-600 mb-6">
              faster-whisper（CPU / int8量子化）を使用してローカルで文字起こしを実行します。
              10〜15分の音声で数分〜10分程度かかります。
            </p>

            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 mb-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-900">Whisper モデル設定</p>
                  <p className="text-sm text-gray-600 mt-1">
                    現在の選択: <span className="font-semibold text-gray-900">{WHISPER_MODEL_LABELS[whisperModel]}</span>
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    `large` は精度重視、`large-v3-turbo` は旧 `turbo` と同じ系統です。
                  </p>
                </div>
                <button
                  onClick={() => setShowWhisperSettings(true)}
                  className="btn-secondary flex-shrink-0"
                >
                  設定を変更
                </button>
              </div>
            </div>

            {recording.state === "TRANSCRIBED" || recording.state === "DONE" ? (
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
                <svg className="w-5 h-5 text-green-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <div>
                  <p className="text-sm font-medium text-green-800">文字起こし完了</p>
                  <button
                    onClick={() => setActiveStep("edit")}
                    className="text-sm text-green-700 underline mt-0.5"
                  >
                    テキストを確認・編集する →
                  </button>
                </div>
              </div>
            ) : transcribing ? (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 text-center">
                <Spinner className="w-10 h-10 text-primary-600 mx-auto mb-3" />
                <p className="text-sm font-medium text-blue-800">文字起こし処理中...</p>
                <p className="text-xs text-blue-600 mt-1">
                  音声の長さによって数分〜10分程度かかります
                </p>
                <div className="mt-4 bg-blue-100 rounded-lg p-3">
                  <p className="text-xs text-blue-700">
                    処理中はこの画面を開いたままにしてください
                  </p>
                </div>
              </div>
            ) : (
              <button
                onClick={handleStartTranscription}
                className="btn-primary w-full py-3"
              >
                <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {WHISPER_MODEL_LABELS[whisperModel]} で文字起こしを開始する
              </button>
            )}
          </div>
        )}

        {/* ステップ 2: テキスト編集 */}
        {activeStep === "edit" && (
          <div className="card">
            <TranscriptEditor
              recordingId={recordingId}
              transcript={transcript}
              onSaved={fetchData}
            />
            <div className="mt-6 pt-6 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => setActiveStep("summarize")}
                className="btn-primary"
              >
                要約生成へ進む →
              </button>
            </div>
          </div>
        )}

        {/* ステップ 3: 要約生成 */}
        {activeStep === "summarize" && (
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">要約・議事録生成</h2>
            <p className="text-sm text-gray-600 mb-6">
              Ollama（ローカル LLM）を使用して議事録を生成します。
              長文テキストは分割要約 → 統合要約の2段階で処理します。
            </p>

            {summarizing ? (
              <div className="bg-purple-50 border border-purple-200 rounded-xl p-6 text-center">
                <Spinner className="w-10 h-10 text-purple-600 mx-auto mb-3" />
                <p className="text-sm font-medium text-purple-800">議事録を生成中...</p>
                <p className="text-xs text-purple-600 mt-1">
                  Ollama による処理中です（数分かかる場合があります）
                </p>
                <div className="mt-4 bg-purple-100 rounded-lg p-3">
                  <p className="text-xs text-purple-700">
                    処理中はこの画面を開いたままにしてください
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {recording.state === "DONE" && summary && (
                  <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-start gap-3">
                    <svg className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <div>
                      <p className="text-sm font-medium text-green-800">議事録生成済み</p>
                      <p className="text-xs text-green-700 mt-1">
                        現在の議事録は「{currentSummaryTemplate?.label ?? summary.template_name}」で生成されています。
                        下の条件で再生成できます。
                      </p>
                      <button
                        onClick={() => setActiveStep("review")}
                        className="text-sm text-green-700 underline mt-2"
                      >
                        議事録を確認する →
                      </button>
                    </div>
                  </div>
                )}

                {templateLoadError && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                    <p className="text-sm font-medium text-amber-800">テンプレート一覧の取得に失敗しました</p>
                    <p className="text-xs text-amber-700 mt-1">
                      {templateLoadError}
                    </p>
                    <p className="text-xs text-amber-700 mt-1">
                      代替の既定テンプレートで続行できます。
                    </p>
                  </div>
                )}

                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-2">
                      テンプレート選択
                    </label>
                    <select
                      value={selectedTemplateName}
                      onChange={(e) => setSelectedTemplateName(e.target.value)}
                      className="input"
                    >
                      {summaryTemplates.map((template) => (
                        <option key={template.name} value={template.name}>
                          {template.label}
                        </option>
                      ))}
                    </select>
                    {selectedTemplate && (
                      <p className="text-xs text-gray-600 mt-2">
                        {selectedTemplate.description}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-2">
                      追加指示
                    </label>
                    <textarea
                      value={customPrompt}
                      onChange={(e) => setCustomPrompt(e.target.value)}
                      rows={6}
                      maxLength={4000}
                      className="textarea"
                      placeholder="例: 決定事項は箇条書きで明確に整理し、TODO には担当者と期限を必ず残してください。"
                    />
                    <div className="flex items-center justify-between mt-2 gap-4">
                      <p className="text-xs text-gray-500">
                        今回の生成にだけ適用します。使用した指示文面は再現性確保のため議事録結果に保存されます。
                      </p>
                      <span className="text-xs text-gray-400 flex-shrink-0">
                        {customPrompt.length.toLocaleString()} / 4,000
                      </span>
                    </div>
                  </div>
                </div>

                {/* Ollama 注意書き */}
                <div className={`rounded-xl p-4 border ${
                  llmReady
                    ? "bg-green-50 border-green-200"
                    : "bg-amber-50 border-amber-200"
                }`}>
                  <div className="flex items-start gap-3">
                    <svg className={`w-5 h-5 flex-shrink-0 mt-0.5 ${
                      llmReady ? "text-green-600" : "text-amber-600"
                    }`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                      <p className={`text-sm font-medium ${
                        llmReady ? "text-green-800" : "text-amber-800"
                      }`}>
                        {llmReady ? "LLM ランタイム準備完了" : "LLM ランタイムの確認が必要です"}
                      </p>
                      {llmStatus ? (
                        <>
                          <p className={`text-xs mt-1 ${
                            llmReady ? "text-green-700" : "text-amber-700"
                          }`}>
                            {llmStatus.message}
                          </p>
                          <p className={`text-xs mt-1 ${
                            llmReady ? "text-green-700" : "text-amber-700"
                          }`}>
                            provider: {llmStatus.provider} / model: {llmStatus.configured_model}
                          </p>
                        </>
                      ) : (
                        <p className="text-xs text-amber-700 mt-1">
                          {llmStatusError ?? "LLM 状態を確認できませんでした。"}
                        </p>
                      )}
                      {!llmReady && (
                        <code className="text-xs bg-amber-100 px-2 py-0.5 rounded mt-2 inline-block">
                          ollama pull {llmStatus?.configured_model ?? "qwen3.5:9b"}
                        </code>
                      )}
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleStartSummarization}
                  disabled={!llmReady}
                  className="btn-primary w-full py-3"
                >
                  <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                  {recording.state === "DONE" ? "この条件で議事録を再生成する" : "議事録を生成する"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ステップ 4: 議事録確認 */}
        {activeStep === "review" && (
          <div className="card">
            <SummaryViewer
              summary={summary}
              recordingTitle={recording.title}
            />
            {recording.audio_status === "PENDING" && (
              <div className="mt-6 pt-6 border-t border-gray-100">
                <button
                  onClick={() => setShowAudioDialog(true)}
                  className="btn-secondary w-full"
                >
                  音声ファイルの取り扱いを決定する
                </button>
              </div>
            )}
          </div>
        )}

        {/* ステップ 5: 音声管理 */}
        {activeStep === "audio" && (
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">音声ファイルの管理</h2>
            <p className="text-sm text-gray-600 mb-6">
              個人情報保護の観点から、不要になった音声ファイルは削除することを推奨します。
            </p>

            {recording.audio_status === "DELETED" ? (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 flex items-center gap-3">
                <svg className="w-5 h-5 text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                <p className="text-sm text-gray-700">音声ファイルは削除済みです</p>
              </div>
            ) : recording.audio_status === "RETAINED" ? (
              <div className="space-y-4">
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center gap-3">
                  <svg className="w-5 h-5 text-blue-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <p className="text-sm text-blue-700">音声ファイルを保持しています</p>
                </div>
                <button
                  onClick={() => setShowAudioDialog(true)}
                  className="btn-danger w-full"
                >
                  音声ファイルを削除する
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowAudioDialog(true)}
                className="btn-primary w-full py-3"
              >
                音声ファイルの取り扱いを決定する
              </button>
            )}
          </div>
        )}
      </main>

      {/* 音声削除ダイアログ */}
      <AudioDeleteDialog
        isOpen={showAudioDialog}
        recordingTitle={recording.title}
        onDelete={handleDeleteAudio}
        onRetain={handleRetainAudio}
        onDefer={() => setShowAudioDialog(false)}
      />

      <RecordingDeleteDialog
        isOpen={showDeleteDialog}
        recordingTitle={recording.title}
        processingStateLabel={
          ["TRANSCRIBING", "SUMMARIZING"].includes(recording.state)
            ? getStateLabel(recording.state)
            : null
        }
        onConfirm={handleDeleteRecording}
        onClose={() => setShowDeleteDialog(false)}
      />

      <WhisperSettingsDialog
        isOpen={showWhisperSettings}
        selectedModel={whisperModel}
        onChangeModel={(model) => {
          setWhisperModel(model);
          setStoredWhisperModel(model);
        }}
        onClose={() => setShowWhisperSettings(false)}
      />
    </div>
  );
}

function Spinner({ className }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className ?? "w-5 h-5"}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}
