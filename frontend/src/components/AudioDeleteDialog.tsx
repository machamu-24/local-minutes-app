/**
 * AudioDeleteDialog.tsx
 * 音声ファイル削除確認ダイアログ。
 * 要件定義書に基づく3択（削除する / 残す / 後で決める）。
 * デフォルト推奨は「削除する」（視覚的強調）。
 */

import { useState } from "react";

interface AudioDeleteDialogProps {
  isOpen: boolean;
  recordingTitle: string;
  onDelete: () => Promise<void>;
  onRetain: () => Promise<void>;
  onDefer: () => void;
}

export default function AudioDeleteDialog({
  isOpen,
  recordingTitle,
  onDelete,
  onRetain,
  onDefer,
}: AudioDeleteDialogProps) {
  const [loading, setLoading] = useState<"delete" | "retain" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleDelete = async () => {
    setLoading("delete");
    setError(null);
    try {
      await onDelete();
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除に失敗しました");
      setLoading(null);
    }
  };

  const handleRetain = async () => {
    setLoading("retain");
    setError(null);
    try {
      await onRetain();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保持の記録に失敗しました");
      setLoading(null);
    }
  };

  return (
    /* オーバーレイ */
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 背景ブラー */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* ダイアログ本体 */}
      <div className="relative bg-white rounded-2xl shadow-xl max-w-md w-full mx-4 p-6">
        {/* アイコン */}
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-amber-100 mx-auto mb-4">
          <svg
            className="w-6 h-6 text-amber-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>

        {/* タイトル */}
        <h2 className="text-center text-lg font-bold text-gray-900 mb-2">
          音声ファイルの取り扱い
        </h2>

        {/* 説明 */}
        <p className="text-center text-sm text-gray-600 mb-1">
          <span className="font-medium">「{recordingTitle}」</span> の議事録作成が完了しました。
        </p>
        <p className="text-center text-sm text-gray-600 mb-2">
          個人情報保護の観点から、元の音声ファイルの削除を推奨します。
        </p>

        {/* 個人情報保護の注意書き */}
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-5">
          <p className="text-xs text-amber-800 text-center">
            音声ファイルには会話内容が含まれます。<br />
            不要になった場合は速やかに削除することを推奨します。
          </p>
        </div>

        {/* エラー表示 */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* アクションボタン */}
        <div className="space-y-3">
          {/* 削除する（推奨・強調表示） */}
          <button
            onClick={handleDelete}
            disabled={loading !== null}
            className="w-full py-3 px-4 rounded-xl bg-red-600 text-white font-semibold text-sm
                       hover:bg-red-700 active:bg-red-800
                       focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2
                       disabled:opacity-50 disabled:cursor-not-allowed
                       transition-colors duration-150 flex items-center justify-center gap-2"
          >
            {loading === "delete" ? (
              <>
                <Spinner className="w-4 h-4" />
                削除中...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                削除する（推奨）
              </>
            )}
          </button>

          {/* 残す */}
          <button
            onClick={handleRetain}
            disabled={loading !== null}
            className="w-full py-2.5 px-4 rounded-xl bg-white text-gray-700 font-medium text-sm
                       border border-gray-300 hover:bg-gray-50 active:bg-gray-100
                       focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2
                       disabled:opacity-50 disabled:cursor-not-allowed
                       transition-colors duration-150 flex items-center justify-center gap-2"
          >
            {loading === "retain" ? (
              <>
                <Spinner className="w-4 h-4" />
                処理中...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M5 13l4 4L19 7" />
                </svg>
                残す
              </>
            )}
          </button>

          {/* 後で決める */}
          <button
            onClick={onDefer}
            disabled={loading !== null}
            className="w-full py-2 px-4 rounded-xl text-gray-500 font-medium text-sm
                       hover:text-gray-700 hover:bg-gray-50
                       focus:outline-none
                       disabled:opacity-50 disabled:cursor-not-allowed
                       transition-colors duration-150"
          >
            後で決める
          </button>
        </div>
      </div>
    </div>
  );
}

/** スピナーコンポーネント */
function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className ?? "w-5 h-5"}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}
