import { useEffect, useMemo, useRef, useState } from "react";

import {
  buildDefaultRecordingTitle,
  buildRecordedFileName,
  formatRecordingDuration,
  getPreferredRecorderFormat,
  getRecorderFileExtension,
} from "../lib/audioRecording";

interface RecordingCaptureDialogProps {
  isOpen: boolean;
  defaultDate: string;
  importing: boolean;
  importError: string | null;
  onSave: (file: File, title: string, meetingDate?: string) => Promise<void>;
  onClose: () => void;
}

export default function RecordingCaptureDialog({
  isOpen,
  defaultDate,
  importing,
  importError,
  onSave,
  onClose,
}: RecordingCaptureDialogProps) {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef<number | null>(null);
  const discardNextStopRef = useRef(false);

  const [title, setTitle] = useState("");
  const [meetingDate, setMeetingDate] = useState(defaultDate);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [recordedFile, setRecordedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isRequestingPermission, setIsRequestingPermission] = useState(false);
  const [recorderFormatLabel, setRecorderFormatLabel] = useState<string | null>(null);

  const recorderFormat = useMemo(() => getPreferredRecorderFormat(), []);
  const combinedError = captureError || importError;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setTitle(buildDefaultRecordingTitle());
    setMeetingDate(defaultDate);
    setCaptureError(null);
    setRecordedFile(null);
    setElapsedSeconds(0);
    setIsRecording(false);
    setIsFinalizing(false);
    setIsRequestingPermission(false);
    setRecorderFormatLabel(recorderFormat?.label ?? null);
    discardNextStopRef.current = false;
    chunksRef.current = [];
  }, [defaultDate, isOpen, recorderFormat]);

  useEffect(() => {
    if (!recordedFile) {
      setPreviewUrl(null);
      return;
    }

    const url = URL.createObjectURL(recordedFile);
    setPreviewUrl(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [recordedFile]);

  useEffect(() => {
    if (!isRecording) {
      return;
    }

    const intervalId = window.setInterval(() => {
      const startedAt = recordingStartedAtRef.current;
      if (!startedAt) return;
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }, 250);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isRecording]);

  useEffect(() => {
    return () => {
      discardNextStopRef.current = true;
      stopStream();
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }
    };
  }, []);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const resetCapturedAudio = () => {
    setRecordedFile(null);
    setPreviewUrl(null);
    setElapsedSeconds(0);
    setCaptureError(null);
    discardNextStopRef.current = false;
    chunksRef.current = [];
  };

  const startRecording = async () => {
    if (!recorderFormat) {
      setCaptureError(
        "この環境ではブラウザ録音を開始できません。音声ファイル取り込みをご利用ください。"
      );
      return;
    }

    try {
      resetCapturedAudio();
      setIsRequestingPermission(true);

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const recorder = new MediaRecorder(stream, {
        mimeType: recorderFormat.mimeType,
      });

      streamRef.current = stream;
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      recordingStartedAtRef.current = Date.now();
      setRecorderFormatLabel(recorderFormat.label);
      setIsRecording(true);
      setIsFinalizing(false);
      setCaptureError(null);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        setCaptureError("録音中にエラーが発生しました。マイク設定を確認してください。");
        setIsRecording(false);
        setIsFinalizing(false);
        stopStream();
      };

      recorder.onstop = () => {
        stopStream();
        setIsRecording(false);

        if (discardNextStopRef.current) {
          discardNextStopRef.current = false;
          setIsFinalizing(false);
          return;
        }

        const chunks = chunksRef.current;
        chunksRef.current = [];

        if (chunks.length === 0) {
          setCaptureError("録音データを取得できませんでした。もう一度お試しください。");
          setIsFinalizing(false);
          return;
        }

        const mimeType =
          recorder.mimeType || recorderFormat.mimeType || chunks[0]?.type || "audio/webm";
        const extension = getRecorderFileExtension(mimeType, recorderFormat.extension);
        const file = new File(chunks, buildRecordedFileName(new Date(), extension), {
          type: mimeType,
          lastModified: Date.now(),
        });

        setRecordedFile(file);
        setElapsedSeconds((prev) =>
          prev > 0
            ? prev
            : Math.max(
                1,
                Math.floor((Date.now() - (recordingStartedAtRef.current ?? Date.now())) / 1000)
              )
        );
        setIsFinalizing(false);
      };

      recorder.start(1000);
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "マイクへのアクセスが許可されていません。macOS の設定またはブラウザ権限を確認してください。"
          : error instanceof DOMException && error.name === "NotFoundError"
            ? "利用できるマイクが見つかりませんでした。"
            : error instanceof Error
              ? error.message
              : "録音開始に失敗しました。";
      setCaptureError(message);
      stopStream();
      setIsRecording(false);
      setIsFinalizing(false);
    } finally {
      setIsRequestingPermission(false);
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;

    setElapsedSeconds((prev) =>
      prev > 0
        ? prev
        : Math.max(
            1,
            Math.floor((Date.now() - (recordingStartedAtRef.current ?? Date.now())) / 1000)
          )
    );
    setIsFinalizing(true);
    recorder.stop();
  };

  const handleClose = () => {
    if (importing || isFinalizing || isRequestingPermission) return;
    if (isRecording) {
      setCaptureError("録音中は停止してから閉じてください。");
      return;
    }

    discardNextStopRef.current = true;
    stopStream();
    setCaptureError(null);
    onClose();
  };

  const handleSave = async () => {
    if (!recordedFile || !title.trim()) {
      setCaptureError("会議名を入力してから保存してください。");
      return;
    }

    setCaptureError(null);
    await onSave(recordedFile, title.trim(), meetingDate || undefined);
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative bg-white rounded-2xl shadow-xl max-w-lg w-full mx-4 p-6">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="text-lg font-bold text-gray-900">その場で録音</h2>
            <p className="text-sm text-gray-600 mt-1">
              マイクで録音した音声を、そのまま議事録作成フローへ取り込みます。
            </p>
          </div>
          <button
            onClick={handleClose}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50"
            aria-label="録音ダイアログを閉じる"
            disabled={importing || isFinalizing || isRequestingPermission}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {!recorderFormat ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-medium text-amber-900">この環境では録音を開始できません</p>
            <p className="text-sm text-amber-800 mt-1">
              `MediaRecorder` またはマイク入力 API が利用できないため、音声ファイル取り込みをご利用ください。
            </p>
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-900">録音ステータス</p>
                  <p className="text-xs text-gray-500 mt-1">
                    形式: {recorderFormatLabel ?? recorderFormat.label}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-semibold text-gray-900 tabular-nums">
                    {formatRecordingDuration(elapsedSeconds)}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {isRecording
                      ? "録音中"
                      : isFinalizing
                        ? "音声を確定中"
                        : recordedFile
                          ? "録音完了"
                          : "待機中"}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                {isRecording ? (
                  <span className="inline-flex items-center gap-2 rounded-full bg-rose-100 px-3 py-1 text-xs font-medium text-rose-700">
                    <span className="h-2.5 w-2.5 rounded-full bg-rose-500 animate-pulse" />
                    マイク入力を記録しています
                  </span>
                ) : recordedFile ? (
                  <span className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                    録音データを保存できます
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-2 rounded-full bg-gray-200 px-3 py-1 text-xs font-medium text-gray-700">
                    <span className="h-2.5 w-2.5 rounded-full bg-gray-400" />
                    録音開始待ち
                  </span>
                )}

                <div className="flex flex-wrap items-center gap-2 ml-auto">
                  {recordedFile && !isRecording && !isFinalizing && (
                    <button
                      onClick={startRecording}
                      disabled={importing}
                      className="btn-secondary"
                    >
                      録り直す
                    </button>
                  )}

                  {!isRecording ? (
                    <button
                      onClick={startRecording}
                      disabled={importing || isFinalizing || isRequestingPermission}
                      className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-rose-600 text-white text-sm font-medium hover:bg-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {isRequestingPermission ? (
                        <>
                          <InlineSpinner className="w-4 h-4" />
                          マイク許可を確認中
                        </>
                      ) : (
                        <>
                          <span className="h-2.5 w-2.5 rounded-full bg-white/90" />
                          録音を開始
                        </>
                      )}
                    </button>
                  ) : (
                    <button onClick={stopRecording} className="btn-secondary">
                      録音を停止
                    </button>
                  )}
                </div>
              </div>
            </div>

            {recordedFile && previewUrl && (
              <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex items-center justify-between gap-4 mb-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{recordedFile.name}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {formatFileSize(recordedFile.size)} / {formatRecordingDuration(elapsedSeconds)}
                    </p>
                  </div>
                </div>
                <audio controls src={previewUrl} className="w-full" />
              </div>
            )}

            <div className="space-y-4 mt-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  会議名 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="例: 外来カンファレンス、朝会"
                  className="input"
                  disabled={importing || isRecording || isFinalizing}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">会議日</label>
                <input
                  type="date"
                  value={meetingDate}
                  onChange={(event) => setMeetingDate(event.target.value)}
                  className="input"
                  disabled={importing || isRecording || isFinalizing}
                />
              </div>
            </div>
          </>
        )}

        {combinedError && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-sm text-red-700">{combinedError}</p>
          </div>
        )}

        <div className="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="text-xs text-gray-600">
            録音後は既存の音声ファイル取り込みと同じ扱いになります。保存後に文字起こしと議事録生成へ進めます。
          </p>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={handleClose}
            disabled={importing || isFinalizing || isRequestingPermission}
            className="btn-secondary flex-1"
          >
            キャンセル
          </button>
          <button
            onClick={handleSave}
            disabled={
              importing ||
              isRecording ||
              isFinalizing ||
              !recordedFile ||
              !title.trim() ||
              !recorderFormat
            }
            className="btn-primary flex-1"
          >
            {importing ? (
              <span className="flex items-center gap-2">
                <InlineSpinner className="w-4 h-4" />
                取り込み中...
              </span>
            ) : (
              "録音を保存する"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function InlineSpinner({ className }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className ?? "w-5 h-5"}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}
