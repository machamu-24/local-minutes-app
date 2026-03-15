import { useState, useRef, useEffect, useCallback } from "react";
import { recordingsApi } from "@/lib/tauri";
import { Button } from "@/components/ui/button";
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
  Mic,
  Square,
  Pause,
  Play,
  Loader2,
  Save,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";

interface RecorderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

type RecorderState = "idle" | "recording" | "paused" | "stopped";

export function RecorderDialog({ open, onOpenChange, onSuccess }: RecorderDialogProps) {
  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [meetingDate, setMeetingDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [saving, setSaving] = useState(false);
  const [mimeType, setMimeType] = useState("audio/webm");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const pausedTimeRef = useRef<number>(0);

  // タイマー
  const startTimer = useCallback(() => {
    startTimeRef.current = Date.now() - pausedTimeRef.current * 1000;
    timerRef.current = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 500);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // ダイアログが閉じたときにリセット
  useEffect(() => {
    if (!open) {
      stopTimer();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setRecorderState("idle");
      setElapsedSeconds(0);
      setAudioBlob(null);
      setAudioUrl(null);
      setTitle("");
      chunksRef.current = [];
      pausedTimeRef.current = 0;
    }
  }, [open]);

  // 録音開始
  const handleStart = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // サポートするMIMEタイプを選択
      const supportedMime = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/mp4",
      ].find((m) => MediaRecorder.isTypeSupported(m)) ?? "audio/webm";
      setMimeType(supportedMime);

      const recorder = new MediaRecorder(stream, { mimeType: supportedMime });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: supportedMime });
        setAudioBlob(blob);
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        setRecorderState("stopped");
      };

      recorder.start(1000); // 1秒ごとにデータを収集
      setRecorderState("recording");
      pausedTimeRef.current = 0;
      startTimer();
    } catch (e: any) {
      toast.error("マイクへのアクセスに失敗しました: " + (e?.message ?? ""));
    }
  };

  // 一時停止
  const handlePause = () => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.pause();
      stopTimer();
      pausedTimeRef.current = elapsedSeconds;
      setRecorderState("paused");
    }
  };

  // 再開
  const handleResume = () => {
    if (mediaRecorderRef.current?.state === "paused") {
      mediaRecorderRef.current.resume();
      startTimer();
      setRecorderState("recording");
    }
  };

  // 停止
  const handleStop = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
      stopTimer();
    }
  };

  // 再録音
  const handleReset = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioBlob(null);
    setAudioUrl(null);
    setRecorderState("idle");
    setElapsedSeconds(0);
    pausedTimeRef.current = 0;
    chunksRef.current = [];
  };

  // 保存
  const handleSave = async () => {
    if (!audioBlob || !title.trim()) return;
    setSaving(true);
    try {
      // BlobをArrayBufferに変換してbase64エンコード
      const arrayBuffer = await audioBlob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      const base64 = btoa(
        Array.from(uint8Array)
          .map((b) => String.fromCharCode(b))
          .join("")
      );

      await recordingsApi.uploadFromRecorder({
        title: title.trim(),
        meeting_date: meetingDate || undefined,
        mime_type: mimeType,
        data_base64: base64,
        duration_seconds: elapsedSeconds,
      });

      toast.success("録音を保存しました");
      onSuccess();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  // 時間フォーマット
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>アプリ内録音</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* 録音コントロール */}
          {recorderState !== "stopped" ? (
            <div className="flex flex-col items-center gap-4">
              {/* タイマー表示 */}
              <div className={`text-4xl font-mono font-bold tabular-nums ${
                recorderState === "recording" ? "text-red-500" : "text-gray-400"
              }`}>
                {formatTime(elapsedSeconds)}
              </div>

              {/* 録音状態インジケーター */}
              {recorderState === "recording" && (
                <div className="flex items-center gap-2 text-sm text-red-500">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  録音中
                </div>
              )}
              {recorderState === "paused" && (
                <div className="flex items-center gap-2 text-sm text-yellow-600">
                  <span className="w-2 h-2 rounded-full bg-yellow-500" />
                  一時停止中
                </div>
              )}

              {/* コントロールボタン */}
              <div className="flex items-center gap-3">
                {recorderState === "idle" && (
                  <Button onClick={handleStart} size="lg" className="rounded-full w-16 h-16 bg-red-500 hover:bg-red-600">
                    <Mic className="w-6 h-6" />
                  </Button>
                )}
                {recorderState === "recording" && (
                  <>
                    <Button onClick={handlePause} variant="outline" size="icon" className="rounded-full w-12 h-12">
                      <Pause className="w-5 h-5" />
                    </Button>
                    <Button onClick={handleStop} size="lg" className="rounded-full w-16 h-16 bg-gray-800 hover:bg-gray-900">
                      <Square className="w-6 h-6" />
                    </Button>
                  </>
                )}
                {recorderState === "paused" && (
                  <>
                    <Button onClick={handleResume} variant="outline" size="icon" className="rounded-full w-12 h-12">
                      <Play className="w-5 h-5" />
                    </Button>
                    <Button onClick={handleStop} size="lg" className="rounded-full w-16 h-16 bg-gray-800 hover:bg-gray-900">
                      <Square className="w-6 h-6" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          ) : (
            /* 録音完了後 */
            <div className="space-y-4">
              {/* プレビュー再生 */}
              {audioUrl && (
                <div>
                  <Label className="mb-1.5 block text-sm">録音プレビュー（{formatTime(elapsedSeconds)}）</Label>
                  <audio src={audioUrl} controls className="w-full h-10" />
                </div>
              )}

              {/* 会議名 */}
              <div>
                <Label htmlFor="rec-title" className="mb-1.5 block">
                  会議名 <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="rec-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="例: 週次定例ミーティング"
                />
              </div>

              {/* 会議日 */}
              <div>
                <Label htmlFor="rec-date" className="mb-1.5 block">会議日</Label>
                <Input
                  id="rec-date"
                  type="date"
                  value={meetingDate}
                  onChange={(e) => setMeetingDate(e.target.value)}
                />
              </div>

              {/* 再録音ボタン */}
              <Button variant="outline" onClick={handleReset} className="w-full">
                <RotateCcw className="w-4 h-4" />
                録り直す
              </Button>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            キャンセル
          </Button>
          {recorderState === "stopped" && (
            <Button
              onClick={handleSave}
              disabled={!title.trim() || saving}
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  保存中...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  保存する
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
