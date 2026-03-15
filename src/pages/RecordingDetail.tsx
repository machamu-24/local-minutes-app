import { useState, useEffect, useCallback } from "react";
import { useLocation, useParams } from "wouter";
import {
  recordingsApi,
  transcriptsApi,
  summariesApi,
  jobsApi,
  onJobUpdate,
  type Recording,
  type Transcript,
  type Summary,
  type Job,
} from "@/lib/tauri";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import {
  ArrowLeft,
  Mic,
  FileText,
  Edit3,
  Sparkles,
  Eye,
  Trash2,
  Loader2,
  Check,
  Copy,
  Download,
  ShieldAlert,
  Lock,
  Archive,
  AlertCircle,
  RefreshCw,
} from "lucide-react";

// ─── 型定義 ──────────────────────────────────────────────────────────────────

type Step = "transcribe" | "edit" | "summarize" | "review" | "audio";

const STEPS: { id: Step; label: string; icon: React.ElementType }[] = [
  { id: "transcribe", label: "文字起こし", icon: Mic },
  { id: "edit", label: "テキスト編集", icon: Edit3 },
  { id: "summarize", label: "要約生成", icon: Sparkles },
  { id: "review", label: "議事録確認", icon: Eye },
  { id: "audio", label: "音声管理", icon: Trash2 },
];

// ─── ジョブポーリングフック ──────────────────────────────────────────────────

function useJobPolling(
  jobId: number | null,
  onDone: () => void,
  onError: (msg: string) => void
) {
  const [job, setJob] = useState<Job | null>(null);

  useEffect(() => {
    if (jobId === null) return;

    let cancelled = false;

    // Tauriイベントでジョブ更新を受け取る
    const unlistenPromise = onJobUpdate(async (updatedJobId) => {
      if (updatedJobId !== jobId || cancelled) return;
      try {
        const j = await jobsApi.get(jobId);
        if (!cancelled) {
          setJob(j);
          if (j.status === "done") onDone();
          else if (j.status === "error") onError(j.log ?? "処理中にエラーが発生しました");
        }
      } catch {}
    });

    // 初回ポーリング（イベントが来ない場合のフォールバック）
    const poll = async () => {
      if (cancelled) return;
      try {
        const j = await jobsApi.get(jobId);
        if (!cancelled) {
          setJob(j);
          if (j.status === "done") { onDone(); return; }
          if (j.status === "error") { onError(j.log ?? "エラー"); return; }
          setTimeout(poll, 2000);
        }
      } catch {
        if (!cancelled) setTimeout(poll, 3000);
      }
    };
    poll();

    return () => {
      cancelled = true;
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [jobId]);

  return job;
}

// ─── メインコンポーネント ─────────────────────────────────────────────────────

export default function RecordingDetail() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id ?? "0", 10);
  const [, navigate] = useLocation();

  const [recording, setRecording] = useState<Recording | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [activeStep, setActiveStep] = useState<Step>("transcribe");
  const [transcribeJobId, setTranscribeJobId] = useState<number | null>(null);
  const [summarizeJobId, setSummarizeJobId] = useState<number | null>(null);
  const [editedText, setEditedText] = useState("");
  const [editSaved, setEditSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [loading, setLoading] = useState(true);

  // データ読み込み
  const loadData = useCallback(async () => {
    try {
      const [rec, tr, sm] = await Promise.all([
        recordingsApi.get(id),
        transcriptsApi.get(id),
        summariesApi.get(id),
      ]);
      setRecording(rec);
      setTranscript(tr);
      setSummary(sm);
      if (tr?.text_edited) setEditedText(tr.text_edited);
      else if (tr?.text_raw) setEditedText(tr.text_raw);
    } catch (e: any) {
      toast.error("データの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 文字起こしジョブポーリング
  useJobPolling(
    transcribeJobId,
    async () => {
      toast.success("文字起こしが完了しました");
      setTranscribeJobId(null);
      await loadData();
      setActiveStep("edit");
    },
    (msg) => {
      toast.error(`文字起こしエラー: ${msg}`);
      setTranscribeJobId(null);
      loadData();
    }
  );

  // 議事録生成ジョブポーリング
  useJobPolling(
    summarizeJobId,
    async () => {
      toast.success("議事録の生成が完了しました");
      setSummarizeJobId(null);
      await loadData();
      setActiveStep("review");
    },
    (msg) => {
      toast.error(`議事録生成エラー: ${msg}`);
      setSummarizeJobId(null);
      loadData();
    }
  );

  // 文字起こし開始
  const handleStartTranscribe = async () => {
    try {
      const jobId = await transcriptsApi.start(id);
      setTranscribeJobId(jobId);
      await loadData();
      toast.info("文字起こしを開始しました");
    } catch (e: any) {
      toast.error(e?.message ?? "文字起こしの開始に失敗しました");
    }
  };

  // テキスト編集保存
  const handleSaveEdit = async () => {
    try {
      await transcriptsApi.save(id, editedText);
      setEditSaved(true);
      toast.success("テキストを保存しました");
      setTimeout(() => setEditSaved(false), 2000);
    } catch (e: any) {
      toast.error(e?.message ?? "保存に失敗しました");
    }
  };

  // 議事録生成開始
  const handleStartSummarize = async () => {
    try {
      const jobId = await summariesApi.start(id);
      setSummarizeJobId(jobId);
      await loadData();
      toast.info("議事録の生成を開始しました");
    } catch (e: any) {
      toast.error(e?.message ?? "議事録生成の開始に失敗しました");
    }
  };

  // 議事録コピー
  const handleCopy = async () => {
    if (!summary?.content_md) return;
    await navigator.clipboard.writeText(summary.content_md);
    setCopied(true);
    toast.success("コピーしました");
    setTimeout(() => setCopied(false), 2000);
  };

  // 議事録ダウンロード
  const handleDownload = () => {
    if (!summary?.content_md || !recording) return;
    const blob = new Blob([summary.content_md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${recording.title}_議事録.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // スタックリセット
  const handleResetStuck = async () => {
    try {
      await recordingsApi.resetStuck(id);
      await loadData();
      toast.success("状態をリセットしました");
    } catch (e: any) {
      toast.error(e?.message ?? "リセットに失敗しました");
    }
  };

  // 音声ファイル削除
  const handleDeleteAudio = async () => {
    try {
      await recordingsApi.deleteAudio(id);
      await loadData();
      toast.success("音声ファイルを削除しました");
    } catch (e: any) {
      toast.error(e?.message ?? "削除に失敗しました");
    }
  };

  // 音声ファイル保持
  const handleRetainAudio = async () => {
    try {
      await recordingsApi.retainAudio(id);
      await loadData();
      toast.success("音声ファイルを保持します");
    } catch (e: any) {
      toast.error(e?.message ?? "操作に失敗しました");
    }
  };

  // 録音削除
  const handleDeleteRecording = async () => {
    try {
      await recordingsApi.delete(id);
      toast.success("削除しました");
      navigate("/");
    } catch (e: any) {
      toast.error(e?.message ?? "削除に失敗しました");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!recording) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <AlertCircle className="w-12 h-12 text-gray-300" />
        <p className="text-gray-500">録音が見つかりません</p>
        <Button variant="outline" onClick={() => navigate("/")}>
          <ArrowLeft className="w-4 h-4" />
          一覧に戻る
        </Button>
      </div>
    );
  }

  const isProcessing = recording.state === "TRANSCRIBING" || recording.state === "SUMMARIZING";

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors mb-3"
          >
            <ArrowLeft className="w-4 h-4" />
            録音一覧
          </button>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold text-gray-900">{recording.title}</h1>
              {recording.meeting_date && (
                <p className="text-sm text-gray-500 mt-0.5">{recording.meeting_date}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {isProcessing && (
                <Button variant="outline" size="sm" onClick={handleResetStuck}>
                  <RefreshCw className="w-3.5 h-3.5" />
                  リセット
                </Button>
              )}
              <button
                onClick={() => setShowDeleteDialog(true)}
                className="p-2 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* ステップナビゲーション */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-6">
          <div className="flex overflow-x-auto">
            {STEPS.map((step) => {
              const Icon = step.icon;
              const isActive = activeStep === step.id;
              const isDone = getStepDone(step.id, recording);
              return (
                <button
                  key={step.id}
                  onClick={() => setActiveStep(step.id)}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                    isActive
                      ? "border-blue-600 text-blue-600"
                      : isDone
                      ? "border-transparent text-green-600 hover:text-gray-700"
                      : "border-transparent text-gray-400 hover:text-gray-600"
                  }`}
                >
                  {isDone && !isActive ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : (
                    <Icon className="w-4 h-4" />
                  )}
                  {step.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ステップコンテンツ */}
      <main className="max-w-4xl mx-auto px-6 py-6">
        {/* Step 1: 文字起こし */}
        {activeStep === "transcribe" && (
          <StepTranscribe
            recording={recording}
            transcript={transcript}
            isProcessing={recording.state === "TRANSCRIBING"}
            onStart={handleStartTranscribe}
            onNext={() => setActiveStep("edit")}
          />
        )}

        {/* Step 2: テキスト編集 */}
        {activeStep === "edit" && (
          <StepEdit
            transcript={transcript}
            editedText={editedText}
            editSaved={editSaved}
            onTextChange={setEditedText}
            onSave={handleSaveEdit}
            onNext={() => setActiveStep("summarize")}
          />
        )}

        {/* Step 3: 議事録生成 */}
        {activeStep === "summarize" && (
          <StepSummarize
            recording={recording}
            isProcessing={recording.state === "SUMMARIZING"}
            onStart={handleStartSummarize}
            onNext={() => setActiveStep("review")}
          />
        )}

        {/* Step 4: 議事録確認 */}
        {activeStep === "review" && (
          <StepReview
            summary={summary}
            copied={copied}
            onCopy={handleCopy}
            onDownload={handleDownload}
            onNext={() => setActiveStep("audio")}
          />
        )}

        {/* Step 5: 音声管理 */}
        {activeStep === "audio" && (
          <StepAudio
            recording={recording}
            onDeleteAudio={handleDeleteAudio}
            onRetainAudio={handleRetainAudio}
          />
        )}
      </main>

      {/* 削除確認ダイアログ */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>録音を削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              「{recording.title}」を完全に削除します。文字起こし・議事録・音声ファイルを含むすべてのデータが削除されます。この操作は取り消せません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteRecording}
              className="bg-red-500 text-white hover:bg-red-600"
            >
              削除する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── ステップ完了判定 ─────────────────────────────────────────────────────────

function getStepDone(step: Step, recording: Recording): boolean {
  const stateOrder = ["IMPORTED", "TRANSCRIBING", "TRANSCRIBED", "SUMMARIZING", "DONE"];
  const idx = stateOrder.indexOf(recording.state);
  switch (step) {
    case "transcribe": return idx >= 2; // TRANSCRIBED以降
    case "edit": return idx >= 2;
    case "summarize": return idx >= 4; // DONE
    case "review": return idx >= 4;
    case "audio": return recording.audio_status !== "PENDING";
    default: return false;
  }
}

// ─── Step 1: 文字起こし ──────────────────────────────────────────────────────

function StepTranscribe({
  recording,
  transcript,
  isProcessing,
  onStart,
  onNext,
}: {
  recording: Recording;
  transcript: Transcript | null;
  isProcessing: boolean;
  onStart: () => void;
  onNext: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <Mic className="w-5 h-5 text-blue-600" />
          音声文字起こし
        </h2>
        <p className="text-sm text-gray-500 mb-4">
          faster-whisperを使用してローカルで文字起こしを行います。初回実行時はモデルのダウンロードが発生します。
        </p>

        {isProcessing ? (
          <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-lg">
            <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
            <div>
              <p className="font-medium text-blue-800">文字起こし処理中...</p>
              <p className="text-sm text-blue-600">音声の長さによって数分かかる場合があります</p>
            </div>
          </div>
        ) : transcript?.text_raw ? (
          <div className="space-y-3">
            <div className="p-4 bg-green-50 rounded-lg flex items-center gap-2">
              <Check className="w-5 h-5 text-green-600" />
              <p className="text-green-800 font-medium">文字起こし完了</p>
            </div>
            <div className="p-4 bg-gray-50 rounded-lg max-h-48 overflow-y-auto">
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{transcript.text_raw}</p>
            </div>
            <Button onClick={onNext} className="w-full">
              テキスト編集へ進む
              <Edit3 className="w-4 h-4" />
            </Button>
          </div>
        ) : (
          <Button onClick={onStart} className="w-full" disabled={isProcessing}>
            <Mic className="w-4 h-4" />
            文字起こしを開始する
          </Button>
        )}
      </div>

      {recording.audio_filename && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-sm text-gray-500">
            <span className="font-medium text-gray-700">音声ファイル：</span>
            {recording.audio_filename}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Step 2: テキスト編集 ────────────────────────────────────────────────────

function StepEdit({
  transcript,
  editedText,
  editSaved,
  onTextChange,
  onSave,
  onNext,
}: {
  transcript: Transcript | null;
  editedText: string;
  editSaved: boolean;
  onTextChange: (text: string) => void;
  onSave: () => void;
  onNext: () => void;
}) {
  if (!transcript?.text_raw) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-5 text-center">
        <p className="text-gray-500">先に文字起こしを完了してください</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <Edit3 className="w-5 h-5 text-blue-600" />
          文字起こしテキストの編集
        </h2>
        <p className="text-sm text-gray-500 mb-4">
          文字起こし結果を確認・修正してください。修正済みテキストが議事録生成に使用されます。
        </p>
        <Textarea
          value={editedText}
          onChange={(e) => onTextChange(e.target.value)}
          className="min-h-64 font-mono text-sm"
          placeholder="文字起こしテキストを編集..."
        />
        <div className="flex gap-2 mt-3">
          <Button variant="outline" onClick={onSave} className="flex-1">
            {editSaved ? (
              <>
                <Check className="w-4 h-4 text-green-500" />
                保存済み
              </>
            ) : (
              <>
                <FileText className="w-4 h-4" />
                保存する
              </>
            )}
          </Button>
          <Button onClick={onNext} className="flex-1">
            議事録生成へ進む
            <Sparkles className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Step 3: 議事録生成 ──────────────────────────────────────────────────────

function StepSummarize({
  recording,
  isProcessing,
  onStart,
  onNext,
}: {
  recording: Recording;
  isProcessing: boolean;
  onStart: () => void;
  onNext: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-blue-600" />
          AI議事録生成
        </h2>
        <p className="text-sm text-gray-500 mb-4">
          Ollamaを使用してローカルLLMで議事録を生成します。Ollamaが起動していることを確認してください。
        </p>

        {isProcessing ? (
          <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-lg">
            <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
            <div>
              <p className="font-medium text-blue-800">議事録生成中...</p>
              <p className="text-sm text-blue-600">LLMによる処理中です。しばらくお待ちください</p>
            </div>
          </div>
        ) : recording.state === "DONE" ? (
          <div className="space-y-3">
            <div className="p-4 bg-green-50 rounded-lg flex items-center gap-2">
              <Check className="w-5 h-5 text-green-600" />
              <p className="text-green-800 font-medium">議事録生成完了</p>
            </div>
            <Button onClick={onNext} className="w-full">
              議事録を確認する
              <Eye className="w-4 h-4" />
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="p-4 bg-amber-50 rounded-lg text-sm text-amber-800">
              <p className="font-medium mb-1">事前確認</p>
              <ul className="list-disc pl-4 space-y-1">
                <li>Ollamaが起動していること（<code>ollama serve</code>）</li>
                <li>llama3.2またはqwen2.5モデルがダウンロード済みであること</li>
              </ul>
            </div>
            <Button
              onClick={onStart}
              className="w-full"
              disabled={recording.state !== "TRANSCRIBED"}
            >
              <Sparkles className="w-4 h-4" />
              議事録を生成する
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Step 4: 議事録確認 ──────────────────────────────────────────────────────

function StepReview({
  summary,
  copied,
  onCopy,
  onDownload,
  onNext,
}: {
  summary: Summary | null;
  copied: boolean;
  onCopy: () => void;
  onDownload: () => void;
  onNext: () => void;
}) {
  if (!summary?.content_md) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-5 text-center">
        <p className="text-gray-500">先に議事録を生成してください</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button variant="outline" onClick={onCopy} className="flex-1">
          {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
          {copied ? "コピー済み" : "コピー"}
        </Button>
        <Button variant="outline" onClick={onDownload} className="flex-1">
          <Download className="w-4 h-4" />
          .mdダウンロード
        </Button>
        <Button onClick={onNext} className="flex-1">
          音声管理へ
          <Archive className="w-4 h-4" />
        </Button>
      </div>
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="prose max-w-none">
          <ReactMarkdown>{summary.content_md}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

// ─── Step 5: 音声管理 ────────────────────────────────────────────────────────

function StepAudio({
  recording,
  onDeleteAudio,
  onRetainAudio,
}: {
  recording: Recording;
  onDeleteAudio: () => void;
  onRetainAudio: () => void;
}) {
  if (recording.audio_status === "DELETED") {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex items-center gap-3 p-4 bg-green-50 rounded-lg">
          <Lock className="w-5 h-5 text-green-600" />
          <div>
            <p className="font-medium text-green-800">音声ファイルは削除済みです</p>
            <p className="text-sm text-green-600">個人情報のリスクが最小化されています</p>
          </div>
        </div>
      </div>
    );
  }

  if (recording.audio_status === "RETAINED") {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-lg">
          <Archive className="w-5 h-5 text-blue-600" />
          <div>
            <p className="font-medium text-blue-800">音声ファイルは保持されています</p>
            <p className="text-sm text-blue-600">端末内に音声ファイルが保存されています</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-amber-500" />
          音声ファイルの取り扱い
        </h2>
        <p className="text-sm text-gray-500 mb-4">
          議事録の生成が完了しました。音声ファイルの取り扱いを選択してください。
        </p>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={onDeleteAudio}
            className="p-4 rounded-lg border-2 border-red-200 hover:border-red-400 hover:bg-red-50 transition-all text-left"
          >
            <Trash2 className="w-5 h-5 text-red-500 mb-2" />
            <p className="font-medium text-gray-900 text-sm">削除する（推奨）</p>
            <p className="text-xs text-gray-500 mt-1">個人情報リスクを最小化</p>
          </button>
          <button
            onClick={onRetainAudio}
            className="p-4 rounded-lg border-2 border-gray-200 hover:border-gray-400 hover:bg-gray-50 transition-all text-left"
          >
            <Archive className="w-5 h-5 text-gray-500 mb-2" />
            <p className="font-medium text-gray-900 text-sm">保持する</p>
            <p className="text-xs text-gray-500 mt-1">端末内に保存し続ける</p>
          </button>
        </div>
      </div>
    </div>
  );
}
