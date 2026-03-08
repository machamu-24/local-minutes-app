/**
 * TranscriptEditor.tsx
 * 文字起こし結果の表示・編集コンポーネント。
 * テキストエリアで修正可能、「保存」ボタン付き。
 */

import { useState, useEffect } from "react";
import { Transcript, updateTranscript } from "../api/client";

interface TranscriptEditorProps {
  recordingId: number;
  transcript: Transcript | null;
  onSaved?: () => void;
}

export default function TranscriptEditor({
  recordingId,
  transcript,
  onSaved,
}: TranscriptEditorProps) {
  // 編集中テキスト（修正済みを優先、なければ生テキスト）
  const [editText, setEditText] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  // transcript が更新されたら編集テキストを初期化
  useEffect(() => {
    if (transcript) {
      const initialText = transcript.text_edited ?? transcript.text_raw ?? "";
      setEditText(initialText);
      setIsDirty(false);
    }
  }, [transcript]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditText(e.target.value);
    setIsDirty(true);
    setSaveSuccess(false);
  };

  const handleSave = async () => {
    if (!editText.trim()) {
      setError("テキストが空です");
      return;
    }
    setSaving(true);
    setError(null);
    setSaveSuccess(false);
    try {
      await updateTranscript(recordingId, editText);
      setSaveSuccess(true);
      setIsDirty(false);
      onSaved?.();
      // 3秒後に成功メッセージを消す
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  if (!transcript) {
    return (
      <div className="text-center py-8 text-gray-500 text-sm">
        文字起こし結果がありません
      </div>
    );
  }

  const charCount = editText.length;
  const hasEdited = transcript.text_edited !== null;

  return (
    <div className="space-y-4">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold text-gray-900">文字起こしテキスト</h3>
          {hasEdited && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-medium">
              編集済み
            </span>
          )}
        </div>
        <span className="text-xs text-gray-400">{charCount.toLocaleString()} 文字</span>
      </div>

      {/* 編集エリア */}
      <textarea
        value={editText}
        onChange={handleChange}
        rows={16}
        className="textarea font-mono text-xs leading-relaxed"
        placeholder="文字起こしテキストがここに表示されます..."
      />

      {/* エラー表示 */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* 成功メッセージ */}
      {saveSuccess && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2">
          <svg className="w-4 h-4 text-green-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <p className="text-sm text-green-700">テキストを保存しました</p>
        </div>
      )}

      {/* 操作ボタン */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">
          ※ 修正後のテキストが要約処理に使用されます
        </p>
        <button
          onClick={handleSave}
          disabled={saving || !isDirty}
          className="btn-primary"
        >
          {saving ? (
            <span className="flex items-center gap-2">
              <Spinner className="w-4 h-4" />
              保存中...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
              </svg>
              保存
            </span>
          )}
        </button>
      </div>

      {/* タイムスタンプ付きセグメント（折りたたみ） */}
      {transcript.segments_json && (
        <SegmentsViewer segmentsJson={transcript.segments_json} />
      )}
    </div>
  );
}

/** タイムスタンプ付きセグメント表示 */
function SegmentsViewer({ segmentsJson }: { segmentsJson: string }) {
  const [isOpen, setIsOpen] = useState(false);

  let segments: Array<{ id: number; start: number; end: number; text: string }> = [];
  try {
    segments = JSON.parse(segmentsJson);
  } catch {
    return null;
  }

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <span className="text-sm font-medium text-gray-700">
          タイムスタンプ付きセグメント（{segments.length} 件）
        </span>
        <svg
          className={`w-4 h-4 text-gray-500 transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="max-h-64 overflow-y-auto divide-y divide-gray-100">
          {segments.map((seg) => (
            <div key={seg.id} className="flex gap-3 px-4 py-2 hover:bg-gray-50">
              <span className="text-xs text-primary-600 font-mono whitespace-nowrap pt-0.5">
                {formatTime(seg.start)} - {formatTime(seg.end)}
              </span>
              <span className="text-xs text-gray-700 leading-relaxed">{seg.text}</span>
            </div>
          ))}
        </div>
      )}
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
