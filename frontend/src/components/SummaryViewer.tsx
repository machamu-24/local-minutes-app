/**
 * SummaryViewer.tsx
 * 要約結果（議事録）の表示コンポーネント。
 * Markdown レンダリング、クリップボードコピー、ファイルダウンロード機能付き。
 */

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Summary } from "../api/client";

interface SummaryViewerProps {
  summary: Summary | null;
  recordingTitle: string;
}

export default function SummaryViewer({ summary, recordingTitle }: SummaryViewerProps) {
  const [copied, setCopied] = useState(false);

  if (!summary || !summary.content_md) {
    return (
      <div className="text-center py-8 text-gray-500 text-sm">
        議事録がありません
      </div>
    );
  }

  /** クリップボードにコピー */
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(summary.content_md!);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // フォールバック: テキストエリアを使用
      const textarea = document.createElement("textarea");
      textarea.value = summary.content_md!;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  /** .md ファイルとしてダウンロード */
  const handleDownload = () => {
    const blob = new Blob([summary.content_md!], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    // ファイル名: 会議名_議事録.md
    const safeTitle = recordingTitle.replace(/[\\/:*?"<>|]/g, "_");
    a.href = url;
    a.download = `${safeTitle}_議事録.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* ヘッダー・操作ボタン */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h3 className="text-base font-semibold text-gray-900">議事録（Markdown）</h3>
        <div className="flex items-center gap-2">
          {/* コピーボタン */}
          <button
            onClick={handleCopy}
            className="btn-secondary text-xs py-1.5 px-3"
          >
            {copied ? (
              <span className="flex items-center gap-1.5 text-green-700">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                コピー済み
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                コピー
              </span>
            )}
          </button>

          {/* ダウンロードボタン */}
          <button
            onClick={handleDownload}
            className="btn-primary text-xs py-1.5 px-3"
          >
            <span className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              .md 保存
            </span>
          </button>
        </div>
      </div>

      {/* タブ切り替え（プレビュー / ソース） */}
      <MarkdownTabs content={summary.content_md} />
    </div>
  );
}

/** Markdown プレビュー / ソース切り替えタブ */
function MarkdownTabs({ content }: { content: string }) {
  const [tab, setTab] = useState<"preview" | "source">("preview");

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      {/* タブヘッダー */}
      <div className="flex border-b border-gray-200 bg-gray-50">
        <button
          onClick={() => setTab("preview")}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            tab === "preview"
              ? "text-primary-700 border-b-2 border-primary-600 bg-white"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          プレビュー
        </button>
        <button
          onClick={() => setTab("source")}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            tab === "source"
              ? "text-primary-700 border-b-2 border-primary-600 bg-white"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Markdown ソース
        </button>
      </div>

      {/* コンテンツ */}
      <div className="p-5 max-h-[500px] overflow-y-auto">
        {tab === "preview" ? (
          <div className="markdown-content">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        ) : (
          <pre className="text-xs font-mono text-gray-700 whitespace-pre-wrap leading-relaxed">
            {content}
          </pre>
        )}
      </div>
    </div>
  );
}
