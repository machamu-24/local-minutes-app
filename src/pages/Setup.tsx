import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { systemApi, type OllamaModel } from "@/lib/tauri";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  ArrowRight,
} from "lucide-react";

export default function Setup() {
  const [, navigate] = useLocation();
  const [whisperStatus, setWhisperStatus] = useState<"checking" | "ok" | "error">("checking");
  const [ollamaStatus, setOllamaStatus] = useState<"checking" | "ok" | "error">("checking");
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [checking, setChecking] = useState(false);

  const checkAll = async () => {
    setChecking(true);
    setWhisperStatus("checking");
    setOllamaStatus("checking");

    try {
      const [whisper, ollama] = await Promise.all([
        systemApi.checkWhisperStatus(),
        systemApi.checkOllamaStatus(),
      ]);
      setWhisperStatus(whisper ? "ok" : "error");
      setOllamaStatus(ollama ? "ok" : "error");

      if (ollama) {
        try {
          const models = await systemApi.getOllamaModels();
          setOllamaModels(models);
        } catch {}
      }
    } catch (e) {
      setWhisperStatus("error");
      setOllamaStatus("error");
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    checkAll();
  }, []);

  const allOk = whisperStatus === "ok" && ollamaStatus === "ok";

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">AI議事録アプリ セットアップ</h1>
          <p className="text-gray-500 text-sm">
            アプリを使用するには、以下のコンポーネントが必要です
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 mb-6">
          {/* faster-whisper */}
          <div className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-gray-900">faster-whisper</h3>
                  <StatusBadge status={whisperStatus} />
                </div>
                <p className="text-sm text-gray-500">音声文字起こし（ローカルAI）</p>
                {whisperStatus === "error" && (
                  <div className="mt-3 p-3 bg-amber-50 rounded-lg">
                    <p className="text-xs font-medium text-amber-800 mb-1.5">インストール方法</p>
                    <code className="text-xs bg-amber-100 text-amber-900 px-2 py-1 rounded block">
                      pip install faster-whisper
                    </code>
                  </div>
                )}
              </div>
              <StatusIcon status={whisperStatus} />
            </div>
          </div>

          {/* Ollama */}
          <div className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-gray-900">Ollama</h3>
                  <StatusBadge status={ollamaStatus} />
                </div>
                <p className="text-sm text-gray-500">議事録生成（ローカルLLM）</p>
                {ollamaStatus === "ok" && ollamaModels.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {ollamaModels.map((m) => (
                      <span key={m.name} className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">
                        {m.name}
                      </span>
                    ))}
                  </div>
                )}
                {ollamaStatus === "error" && (
                  <div className="mt-3 p-3 bg-amber-50 rounded-lg space-y-2">
                    <p className="text-xs font-medium text-amber-800">セットアップ方法</p>
                    <div className="space-y-1">
                      <p className="text-xs text-amber-700">1. <a href="https://ollama.ai" className="underline">ollama.ai</a> からインストール</p>
                      <p className="text-xs text-amber-700">2. モデルをダウンロード:</p>
                      <code className="text-xs bg-amber-100 text-amber-900 px-2 py-1 rounded block">
                        ollama pull llama3.2
                      </code>
                      <p className="text-xs text-amber-700">3. サーバーを起動:</p>
                      <code className="text-xs bg-amber-100 text-amber-900 px-2 py-1 rounded block">
                        ollama serve
                      </code>
                    </div>
                  </div>
                )}
                {ollamaStatus === "ok" && ollamaModels.length === 0 && (
                  <div className="mt-3 p-3 bg-amber-50 rounded-lg">
                    <p className="text-xs font-medium text-amber-800 mb-1.5">モデルが見つかりません</p>
                    <code className="text-xs bg-amber-100 text-amber-900 px-2 py-1 rounded block">
                      ollama pull llama3.2
                    </code>
                  </div>
                )}
              </div>
              <StatusIcon status={ollamaStatus} />
            </div>
          </div>
        </div>

        {/* アクションボタン */}
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={checkAll}
            disabled={checking}
            className="flex-1"
          >
            {checking ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            再確認
          </Button>
          <Button
            onClick={() => navigate("/")}
            className="flex-1"
            disabled={checking}
          >
            {allOk ? (
              <>
                アプリを開く
                <ArrowRight className="w-4 h-4" />
              </>
            ) : (
              <>
                このまま開く
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </Button>
        </div>

        {!allOk && (
          <p className="text-center text-xs text-gray-400 mt-3">
            セットアップが完了していなくても、アプリを開くことができます
          </p>
        )}
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: "checking" | "ok" | "error" }) {
  if (status === "checking") return <Loader2 className="w-5 h-5 animate-spin text-gray-400 mt-0.5" />;
  if (status === "ok") return <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5" />;
  return <XCircle className="w-5 h-5 text-red-400 mt-0.5" />;
}

function StatusBadge({ status }: { status: "checking" | "ok" | "error" }) {
  if (status === "checking") return <Badge variant="secondary">確認中</Badge>;
  if (status === "ok") return <Badge variant="success">OK</Badge>;
  return <Badge variant="destructive">未インストール</Badge>;
}
