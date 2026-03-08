/**
 * RecordingList.tsx
 * 録音一覧画面（ホーム画面）。
 * - 録音のカード形式一覧表示
 * - 新規取り込みボタン（ファイル選択ダイアログ）
 * - 各カードに会議名・日付・処理状態バッジを表示
 */

import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  getRecordings,
  importRecording,
  Recording,
  getStateLabel,
  getStateBadgeClass,
} from "../api/client";

export default function RecordingList() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // インポートダイアログ状態
  const [showImportModal, setShowImportModal] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importTitle, setImportTitle] = useState("");
  const [importDate, setImportDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // 録音一覧を取得
  const fetchRecordings = async () => {
    try {
      setError(null);
      const data = await getRecordings();
      setRecordings(data.recordings);
    } catch (e) {
      setError(e instanceof Error ? e.message : "録音一覧の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecordings();
    // 処理中の録音がある場合は定期的に更新
    const interval = setInterval(() => {
      const hasProcessing = recordings.some(
        (r) => r.state === "TRANSCRIBING" || r.state === "SUMMARIZING"
      );
      if (hasProcessing) fetchRecordings();
    }, 5000);
    return () => clearInterval(interval);
  }, [recordings.length]);

  // ファイル選択
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    // ファイル名から会議名を自動入力（拡張子除去）
    const nameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
    setImportTitle(nameWithoutExt);
    setShowImportModal(true);
    setImportError(null);
  };

  // 取り込み実行
  const handleImport = async () => {
    if (!selectedFile || !importTitle.trim()) {
      setImportError("会議名を入力してください");
      return;
    }
    setImporting(true);
    setImportError(null);
    try {
      await importRecording(selectedFile, importTitle.trim(), importDate || undefined);
      setShowImportModal(false);
      setSelectedFile(null);
      setImportTitle("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      await fetchRecordings();
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "取り込みに失敗しました");
    } finally {
      setImporting(false);
    }
  };

  const handleModalClose = () => {
    if (importing) return;
    setShowImportModal(false);
    setSelectedFile(null);
    setImportTitle("");
    setImportError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-bold text-gray-900">AI 議事録</h1>
              <p className="text-xs text-gray-500">完全ローカル動作</p>
            </div>
          </div>

          {/* 新規取り込みボタン */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="btn-primary"
          >
            <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            新規取り込み
          </button>

          {/* 非表示ファイル入力 */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".wav,.mp3,.m4a"
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>
      </header>

      {/* メインコンテンツ */}
      <main className="max-w-3xl mx-auto px-4 py-6">
        {/* エラー表示 */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <p className="text-sm font-medium text-red-800">エラーが発生しました</p>
                <p className="text-sm text-red-700 mt-1">{error}</p>
                <button
                  onClick={fetchRecordings}
                  className="text-sm text-red-600 underline mt-2"
                >
                  再試行
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ローディング */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="text-center">
              <Spinner className="w-8 h-8 text-primary-600 mx-auto mb-3" />
              <p className="text-sm text-gray-500">読み込み中...</p>
            </div>
          </div>
        ) : recordings.length === 0 ? (
          /* 空状態 */
          <EmptyState onImport={() => fileInputRef.current?.click()} />
        ) : (
          /* 録音カード一覧 */
          <div className="space-y-3">
            <p className="text-xs text-gray-500 mb-4">
              {recordings.length} 件の録音
            </p>
            {recordings.map((recording) => (
              <RecordingCard
                key={recording.id}
                recording={recording}
                onClick={() => navigate(`/recordings/${recording.id}`)}
              />
            ))}
          </div>
        )}
      </main>

      {/* 取り込みモーダル */}
      {showImportModal && (
        <ImportModal
          file={selectedFile}
          title={importTitle}
          date={importDate}
          importing={importing}
          error={importError}
          onTitleChange={setImportTitle}
          onDateChange={setImportDate}
          onImport={handleImport}
          onClose={handleModalClose}
        />
      )}
    </div>
  );
}

/** 録音カードコンポーネント */
function RecordingCard({
  recording,
  onClick,
}: {
  recording: Recording;
  onClick: () => void;
}) {
  const isProcessing =
    recording.state === "TRANSCRIBING" || recording.state === "SUMMARIZING";

  const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return "日付未設定";
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString("ja-JP", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  const formatCreatedAt = (dateStr: string): string => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString("ja-JP", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <button
      onClick={onClick}
      className="w-full text-left card hover:shadow-md hover:border-primary-200
                 transition-all duration-150 group"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {/* 会議名 */}
          <h2 className="text-base font-semibold text-gray-900 truncate group-hover:text-primary-700 transition-colors">
            {recording.title}
          </h2>

          {/* 日付・作成日時 */}
          <div className="flex items-center gap-3 mt-1">
            <span className="text-sm text-gray-600">
              {formatDate(recording.meeting_date)}
            </span>
            <span className="text-xs text-gray-400">
              取り込み: {formatCreatedAt(recording.created_at)}
            </span>
          </div>
        </div>

        {/* 状態バッジ */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {isProcessing && (
            <Spinner className="w-4 h-4 text-primary-600" />
          )}
          <span
            className={`text-xs px-2.5 py-1 rounded-full font-medium ${getStateBadgeClass(
              recording.state
            )}`}
          >
            {getStateLabel(recording.state)}
          </span>
        </div>
      </div>

      {/* 音声削除状態 */}
      {recording.audio_status === "DELETED" && (
        <p className="text-xs text-gray-400 mt-2 flex items-center gap-1">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          音声ファイル削除済み
        </p>
      )}
    </button>
  );
}

/** 空状態コンポーネント */
function EmptyState({ onImport }: { onImport: () => void }) {
  return (
    <div className="text-center py-16">
      <div className="w-16 h-16 rounded-2xl bg-primary-50 flex items-center justify-center mx-auto mb-4">
        <svg className="w-8 h-8 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-gray-900 mb-2">
        録音がありません
      </h2>
      <p className="text-sm text-gray-500 mb-6 max-w-xs mx-auto">
        音声ファイル（wav / mp3 / m4a）を取り込んで、<br />
        AI による議事録作成を始めましょう。
      </p>
      <button onClick={onImport} className="btn-primary">
        <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
        音声ファイルを取り込む
      </button>
    </div>
  );
}

/** 取り込みモーダル */
function ImportModal({
  file,
  title,
  date,
  importing,
  error,
  onTitleChange,
  onDateChange,
  onImport,
  onClose,
}: {
  file: File | null;
  title: string;
  date: string;
  importing: boolean;
  error: string | null;
  onTitleChange: (v: string) => void;
  onDateChange: (v: string) => void;
  onImport: () => void;
  onClose: () => void;
}) {
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl max-w-md w-full mx-4 p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-5">音声ファイルの取り込み</h2>

        {/* ファイル情報 */}
        {file && (
          <div className="bg-gray-50 rounded-lg p-3 mb-5 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
              <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
            </div>
          </div>
        )}

        {/* フォーム */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              会議名 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              placeholder="例: 定例ミーティング、カンファレンス"
              className="input"
              disabled={importing}
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              会議日
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => onDateChange(e.target.value)}
              className="input"
              disabled={importing}
            />
          </div>
        </div>

        {/* エラー */}
        {error && (
          <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* ボタン */}
        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            disabled={importing}
            className="btn-secondary flex-1"
          >
            キャンセル
          </button>
          <button
            onClick={onImport}
            disabled={importing || !title.trim()}
            className="btn-primary flex-1"
          >
            {importing ? (
              <span className="flex items-center gap-2">
                <Spinner className="w-4 h-4" />
                変換中...
              </span>
            ) : (
              "取り込む"
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
