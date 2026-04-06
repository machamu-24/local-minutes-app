/**
 * RecordingDeleteDialog.tsx
 * 録音データ削除確認ダイアログ。
 * 録音に紐づく文字起こし・議事録・ジョブ・音声ファイルをまとめて削除する。
 */

import { useEffect, useState } from "react";

interface RecordingDeleteDialogProps {
  isOpen: boolean;
  recordingTitle: string;
  processingStateLabel?: string | null;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

export default function RecordingDeleteDialog({
  isOpen,
  recordingTitle,
  processingStateLabel,
  onConfirm,
  onClose,
}: RecordingDeleteDialogProps) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setDeleting(false);
      setError(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    setDeleting(true);
    setError(null);
    try {
      await onConfirm();
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除に失敗しました");
      setDeleting(false);
    }
  };

  const handleClose = () => {
    if (deleting) return;
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={handleClose} />

      <div className="relative bg-white rounded-2xl shadow-xl max-w-md w-full mx-4 p-6">
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mx-auto mb-4">
          <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
        </div>

        <h2 className="text-center text-lg font-bold text-gray-900 mb-2">
          録音データを削除しますか？
        </h2>
        <p className="text-center text-sm text-gray-600 mb-2">
          <span className="font-medium">「{recordingTitle}」</span> と関連する
          文字起こし・議事録・ジョブ情報をまとめて削除します。
        </p>
        <p className="text-center text-sm text-gray-600 mb-5">
          保存済みの音声ファイルも削除対象です。この操作は元に戻せません。
        </p>

        {processingStateLabel && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
            <p className="text-sm text-amber-800">
              現在 {processingStateLabel} です。削除すると一覧から即時に消え、
              進行中ジョブの結果は保存されません。
            </p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={handleClose}
            disabled={deleting}
            className="btn-secondary flex-1"
          >
            キャンセル
          </button>
          <button
            onClick={handleConfirm}
            disabled={deleting}
            className="btn-danger flex-1"
          >
            {deleting ? (
              <span className="flex items-center gap-2">
                <Spinner className="w-4 h-4" />
                削除中...
              </span>
            ) : (
              "削除する"
            )}
          </button>
        </div>
      </div>
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
