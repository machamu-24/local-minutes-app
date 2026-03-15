import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { recordingsApi, type Recording } from "@/lib/tauri";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { RecorderDialog } from "@/components/RecorderDialog";
import {
  Mic,
  Upload,
  FileAudio,
  Loader2,
  Trash2,
  ChevronRight,
  Calendar,
  Clock,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { formatDate, formatDateTime } from "@/lib/utils";

// ─── 状態バッジ ──────────────────────────────────────────────────────────────

function StateBadge({ state }: { state: Recording["state"] }) {
  const config: Record<Recording["state"], { label: string; variant: "default" | "secondary" | "success" | "warning" | "destructive" | "outline" }> = {
    IMPORTED: { label: "取り込み済み", variant: "secondary" },
    TRANSCRIBING: { label: "文字起こし中", variant: "warning" },
    TRANSCRIBED: { label: "文字起こし完了", variant: "default" },
    SUMMARIZING: { label: "議事録生成中", variant: "warning" },
    DONE: { label: "完了", variant: "success" },
  };
  const { label, variant } = config[state] ?? { label: state, variant: "secondary" };
  return <Badge variant={variant}>{label}</Badge>;
}

// ─── メインコンポーネント ─────────────────────────────────────────────────────

export default function RecordingList() {
  const [, navigate] = useLocation();
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [showRecorder, setShowRecorder] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadDate, setUploadDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [uploading, setUploading] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);
  const [deleteTargetTitle, setDeleteTargetTitle] = useState("");
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadRecordings = useCallback(async () => {
    try {
      const list = await recordingsApi.list();
      setRecordings(list);
    } catch (e) {
      toast.error("録音一覧の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRecordings();
  }, [loadRecordings]);

  // ファイル選択時に会議名を自動補完
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
    if (file && !uploadTitle) {
      const name = file.name.replace(/\.[^.]+$/, "");
      setUploadTitle(name);
    }
  };

  // ファイルをbase64に変換
  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // data:...;base64, の部分を除去
        const base64 = result.split(",")[1] ?? result;
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleUpload = async () => {
    if (!selectedFile || !uploadTitle.trim()) return;
    setUploading(true);
    try {
      const data_base64 = await fileToBase64(selectedFile);
      await recordingsApi.upload({
        title: uploadTitle.trim(),
        meeting_date: uploadDate || undefined,
        filename: selectedFile.name,
        data_base64,
      });
      toast.success("音声ファイルを取り込みました");
      setShowUpload(false);
      setSelectedFile(null);
      setUploadTitle("");
      await loadRecordings();
    } catch (e: any) {
      toast.error(e?.message ?? "アップロードに失敗しました");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async () => {
    if (deleteTargetId === null) return;
    setDeleting(true);
    try {
      await recordingsApi.delete(deleteTargetId);
      toast.success("削除しました");
      setDeleteTargetId(null);
      await loadRecordings();
    } catch (e: any) {
      toast.error(e?.message ?? "削除に失敗しました");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">AI議事録アプリ</h1>
            <p className="text-sm text-gray-500 mt-0.5">ローカル版 — 音声データは端末内で処理されます</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowRecorder(true)}>
              <Mic className="w-4 h-4" />
              録音
            </Button>
            <Button size="sm" onClick={() => setShowUpload(true)}>
              <Upload className="w-4 h-4" />
              ファイル取り込み
            </Button>
          </div>
        </div>
      </header>

      {/* コンテンツ */}
      <main className="max-w-4xl mx-auto px-6 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        ) : recordings.length === 0 ? (
          <div className="text-center py-20">
            <FileAudio className="w-16 h-16 mx-auto text-gray-300 mb-4" />
            <h2 className="text-lg font-medium text-gray-600 mb-2">録音がありません</h2>
            <p className="text-sm text-gray-400 mb-6">
              音声ファイルを取り込むか、アプリ内で録音してください
            </p>
            <div className="flex gap-3 justify-center">
              <Button variant="outline" onClick={() => setShowRecorder(true)}>
                <Mic className="w-4 h-4" />
                録音する
              </Button>
              <Button onClick={() => setShowUpload(true)}>
                <Upload className="w-4 h-4" />
                ファイルを取り込む
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {recordings.map((rec) => (
              <div
                key={rec.id}
                className="bg-white rounded-lg border border-gray-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all cursor-pointer group"
                onClick={() => navigate(`/recordings/${rec.id}`)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <StateBadge state={rec.state} />
                      {rec.state === "TRANSCRIBING" || rec.state === "SUMMARIZING" ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-yellow-500" />
                      ) : rec.state === "DONE" ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                      ) : null}
                    </div>
                    <h3 className="font-medium text-gray-900 truncate">{rec.title}</h3>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400">
                      {rec.meeting_date && (
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {formatDate(rec.meeting_date)}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDateTime(rec.created_at)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className="p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTargetId(rec.id);
                        setDeleteTargetTitle(rec.title);
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* 削除確認ダイアログ */}
      <AlertDialog open={deleteTargetId !== null} onOpenChange={(open) => !open && setDeleteTargetId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-red-500" />
              議事録を削除しますか？
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                「<strong>{deleteTargetTitle}</strong>」を完全に削除します。
              </span>
              <span className="block text-sm">
                文字起こし・議事録・音声ファイルを含むすべてのデータが削除されます。この操作は取り消せません。
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-500 text-white hover:bg-red-600"
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
              削除する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ファイルアップロードダイアログ */}
      <Dialog open={showUpload} onOpenChange={setShowUpload}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>音声ファイルの取り込み</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="mb-1.5 block">音声ファイル</Label>
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 transition-all"
              >
                {selectedFile ? (
                  <div className="flex items-center justify-center gap-2 text-sm">
                    <FileAudio className="w-5 h-5 text-blue-600" />
                    <span className="font-medium text-gray-900">{selectedFile.name}</span>
                    <span className="text-gray-400">
                      ({(selectedFile.size / 1024 / 1024).toFixed(1)} MB)
                    </span>
                  </div>
                ) : (
                  <div className="text-gray-400">
                    <Upload className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm font-medium">クリックしてファイルを選択</p>
                    <p className="text-xs mt-1">wav / mp3 / m4a（サイズ制限なし）</p>
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".wav,.mp3,.m4a,audio/wav,audio/mpeg,audio/mp4"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
            <div>
              <Label htmlFor="upload-title" className="mb-1.5 block">
                会議名 <span className="text-red-500">*</span>
              </Label>
              <Input
                id="upload-title"
                value={uploadTitle}
                onChange={(e) => setUploadTitle(e.target.value)}
                placeholder="例: 週次定例ミーティング"
              />
            </div>
            <div>
              <Label htmlFor="upload-date" className="mb-1.5 block">会議日</Label>
              <Input
                id="upload-date"
                type="date"
                value={uploadDate}
                onChange={(e) => setUploadDate(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowUpload(false);
                setSelectedFile(null);
                setUploadTitle("");
              }}
            >
              キャンセル
            </Button>
            <Button
              onClick={handleUpload}
              disabled={!selectedFile || !uploadTitle.trim() || uploading}
            >
              {uploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  取り込み中...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  取り込む
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 録音ダイアログ */}
      <RecorderDialog
        open={showRecorder}
        onOpenChange={setShowRecorder}
        onSuccess={loadRecordings}
      />
    </div>
  );
}
