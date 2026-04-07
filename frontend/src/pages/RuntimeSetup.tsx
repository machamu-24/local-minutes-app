import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  healthCheck,
  prepareWhisperModel,
  WhisperModel,
} from "../api/client";
import {
  extractFileName,
  getRuntimeSetupStatus,
  getRuntimeStatus,
  isHttpUrl,
  isTauriRuntime,
  listenSetupProgress,
  pickExecutablePath,
  pickModelPath,
  prepareRuntimeAssets,
  restartManagedRuntime,
  RuntimeSetupStatus,
  RuntimeStatus,
  SetupProgressPayload,
} from "../lib/tauriRuntimeSetup";
import {
  getStoredWhisperModel,
  setStoredWhisperModel,
  WHISPER_MODEL_DESCRIPTIONS,
  WHISPER_MODEL_LABELS,
  WHISPER_MODELS,
} from "../lib/whisperSettings";

type ModelSourceMode = "download" | "local";

const progressToneClass: Record<string, string> = {
  error: "text-red-700 bg-red-50 border-red-200",
  completed: "text-emerald-700 bg-emerald-50 border-emerald-200",
  skipped: "text-amber-700 bg-amber-50 border-amber-200",
  info: "text-gray-700 bg-gray-50 border-gray-200",
};

const installedBadgeClass = (installed: boolean) =>
  installed
    ? "bg-emerald-100 text-emerald-800 border-emerald-200"
    : "bg-amber-100 text-amber-800 border-amber-200";

const formatBytes = (value: number | null) => {
  if (!value || Number.isNaN(value)) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
};

const detectModelSourceMode = (status: RuntimeSetupStatus | null): ModelSourceMode => {
  if (!status?.llmModelUrl) return "download";
  return isHttpUrl(status.llmModelUrl) ? "download" : "local";
};

export default function RuntimeSetup() {
  const navigate = useNavigate();
  const tauriAvailable = isTauriRuntime();

  const [status, setStatus] = useState<RuntimeSetupStatus | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [progressEvents, setProgressEvents] = useState<SetupProgressPayload[]>([]);

  const [backendSource, setBackendSource] = useState("");
  const [llamaServerSource, setLlamaServerSource] = useState("");
  const [modelSourceMode, setModelSourceMode] = useState<ModelSourceMode>("download");
  const [modelDownloadUrl, setModelDownloadUrl] = useState("");
  const [modelLocalPath, setModelLocalPath] = useState("");
  const [modelFilename, setModelFilename] = useState("");
  const [forceReplaceBinaries, setForceReplaceBinaries] = useState(false);
  const [forceRedownload, setForceRedownload] = useState(false);
  const [prepareWhisper, setPrepareWhisper] = useState(true);
  const [whisperModel, setWhisperModel] = useState<WhisperModel>(getStoredWhisperModel);

  const activeModelSource = modelSourceMode === "download" ? modelDownloadUrl : modelLocalPath;
  const modelInstalled = Boolean(status?.llmModelInstalled);
  const setupReady = Boolean(runtimeStatus?.runtimeReady ?? status?.readyForManagedRuntime);
  const backendSourceRequired =
    !status?.backendBinaryInstalled && !runtimeStatus?.bundledBackendAvailable;
  const llamaSourceRequired =
    !status?.llamaServerBinaryInstalled && !runtimeStatus?.bundledLlmAvailable;

  const latestProgress = useMemo(
    () => progressEvents[progressEvents.length - 1] ?? null,
    [progressEvents]
  );

  const applyStatusToForm = (nextStatus: RuntimeSetupStatus) => {
    setBackendSource(nextStatus.backendSource ?? "");
    setLlamaServerSource(nextStatus.llamaServerSource ?? "");
    setModelFilename(nextStatus.llmModelFilename ?? "");

    const nextMode = detectModelSourceMode(nextStatus);
    setModelSourceMode(nextMode);
    if (nextMode === "download") {
      setModelDownloadUrl(nextStatus.llmModelUrl ?? "");
      setModelLocalPath("");
    } else {
      setModelLocalPath(nextStatus.llmModelUrl ?? "");
      setModelDownloadUrl("");
    }
  };

  const loadStatuses = async (syncForm = false) => {
    if (!tauriAvailable) {
      setLoading(false);
      return;
    }

    setError(null);
    try {
      const [setupState, runtimeState] = await Promise.all([
        getRuntimeSetupStatus(),
        getRuntimeStatus(),
      ]);
      setStatus(setupState);
      setRuntimeStatus(runtimeState);
      if (syncForm) {
        applyStatusToForm(setupState);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "ランタイム状態の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStatuses(true);
  }, []);

  useEffect(() => {
    if (!tauriAvailable) return;

    let active = true;
    let unlisten: (() => void) | null = null;

    listenSetupProgress((payload) => {
      if (!active) return;
      setProgressEvents((current) => [...current, payload]);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((e) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : "進捗イベントの購読に失敗しました");
      });

    return () => {
      active = false;
      if (unlisten) {
        void unlisten();
      }
    };
  }, [tauriAvailable]);

  const handleExecutablePick = async (
    setter: (value: string) => void
  ) => {
    try {
      const selected = await pickExecutablePath();
      if (selected) setter(selected);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ファイル選択に失敗しました");
    }
  };

  const handleModelPick = async () => {
    try {
      const selected = await pickModelPath();
      if (!selected) return;
      setModelSourceMode("local");
      setModelLocalPath(selected);
      setModelFilename(extractFileName(selected));
    } catch (e) {
      setError(e instanceof Error ? e.message : "GGUF モデルの選択に失敗しました");
    }
  };

  const waitForBackendReady = async () => {
    const maxAttempts = 90;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        await healthCheck();
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    throw new Error("バックエンド再起動後のヘルスチェックがタイムアウトしました");
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!tauriAvailable) {
      setError("この画面は Tauri デスクトップ版でのみ利用できます");
      return;
    }

    if (backendSourceRequired && !backendSource.trim()) {
      setError("バックエンド EXE のパスを指定してください");
      return;
    }
    if (llamaSourceRequired && !llamaServerSource.trim()) {
      setError("llama-server の実行ファイルを指定してください");
      return;
    }
    if (!activeModelSource.trim()) {
      setError("GGUF モデルのローカルファイルまたはダウンロード URL を指定してください");
      return;
    }

    const resolvedFilename =
      modelFilename.trim() || extractFileName(activeModelSource.trim());
    if (!resolvedFilename) {
      setError("モデルファイル名を指定してください");
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccessMessage(null);
    setProgressEvents([]);

    try {
      const nextStatus = await prepareRuntimeAssets({
        backendSource: backendSource.trim() || undefined,
        llamaServerSource: llamaServerSource.trim() || undefined,
        llmModelUrl: activeModelSource.trim(),
        llmModelFilename: resolvedFilename,
        forceReplaceBinaries,
        forceRedownload,
      });
      setStatus(nextStatus);
      const runtimeReadyAfterSetup =
        nextStatus.llmModelInstalled &&
        (nextStatus.backendBinaryInstalled || Boolean(runtimeStatus?.bundledBackendAvailable)) &&
        (nextStatus.llamaServerBinaryInstalled || Boolean(runtimeStatus?.bundledLlmAvailable));
      let message =
        runtimeReadyAfterSetup
          ? "ランタイムの配置が完了しました。"
          : "ランタイム配置は完了しましたが、必要なファイルがまだ揃っていません。";

      if (runtimeStatus?.managedRuntimeEnabled) {
        const restartedStatus = await restartManagedRuntime();
        setRuntimeStatus(restartedStatus);
        await waitForBackendReady();
        message += " runtime を再起動しました。";

        if (prepareWhisper) {
          await prepareWhisperModel(whisperModel);
          message += ` Whisper(${WHISPER_MODEL_LABELS[whisperModel]}) も事前取得しました。`;
        }
      } else if (prepareWhisper) {
        message += " 開発モードでは runtime 自動再起動をしていないため、Whisper 事前取得はスキップしました。";
      }

      setSuccessMessage(message);
      await loadStatuses(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ランタイムの配置に失敗しました");
    } finally {
      setSubmitting(false);
    }
  };

  if (!tauriAvailable) {
    return (
      <div className="min-h-screen bg-gray-50">
        <main className="max-w-4xl mx-auto px-4 py-12">
          <div className="card max-w-2xl mx-auto">
            <h1 className="text-xl font-bold text-gray-900">初回セットアップ</h1>
            <p className="text-sm text-gray-600 mt-3 leading-6">
              この画面は Tauri デスクトップ版でのみ有効です。ブラウザ表示では
              ファイル選択とランタイム配置コマンドを実行できません。
            </p>
            <button onClick={() => navigate("/")} className="btn-secondary mt-6">
              一覧に戻る
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xs font-semibold tracking-[0.16em] text-primary-700 uppercase">
              Runtime Setup
            </p>
            <h1 className="text-lg font-bold text-gray-900">初回セットアップ</h1>
            <p className="text-sm text-gray-500 mt-1">
              `llama-server` とバックエンド EXE、GGUF モデルを配置します。
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => void loadStatuses(true)} className="btn-secondary">
              状態を再取得
            </button>
            <button onClick={() => navigate("/")} className="btn-primary">
              一覧に戻る
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
            <p className="text-sm font-medium text-red-800">セットアップでエラーが発生しました</p>
            <p className="text-sm text-red-700 mt-1 whitespace-pre-wrap">{error}</p>
          </div>
        )}

        {successMessage && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-6">
            <p className="text-sm font-medium text-emerald-800">{successMessage}</p>
          </div>
        )}

        {loading ? (
          <div className="card">
            <p className="text-sm text-gray-600">ランタイム状態を読み込んでいます...</p>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <form className="space-y-6" onSubmit={handleSubmit}>
              <section className="card">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <h2 className="text-base font-semibold text-gray-900">1. 実行ファイルを指定</h2>
                    <p className="text-sm text-gray-600 mt-1">
                      配布用に使う `llama-server` とバックエンド EXE を選択します。
                      同梱 sidecar がある場合は空欄のまま進められます。
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={forceReplaceBinaries}
                      onChange={(e) => setForceReplaceBinaries(e.target.checked)}
                      className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    既存バイナリを上書き
                  </label>
                </div>

                <div className="mt-5 space-y-5">
                  <div>
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <label className="text-sm font-medium text-gray-800">
                        バックエンド EXE
                      </label>
                      {(status || runtimeStatus) && (
                        <span
                          className={`px-2.5 py-1 rounded-full text-xs font-medium border ${installedBadgeClass(
                            Boolean(
                              status?.backendBinaryInstalled ||
                                runtimeStatus?.bundledBackendAvailable
                            )
                          )}`}
                        >
                          {status?.backendBinaryInstalled
                            ? "配置済み"
                            : runtimeStatus?.bundledBackendAvailable
                              ? "同梱済み"
                              : "未配置"}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <input
                        value={backendSource}
                        onChange={(e) => setBackendSource(e.target.value)}
                        placeholder="backend exe のローカルパス または URL"
                        className="input"
                      />
                      <button
                        type="button"
                        onClick={() => void handleExecutablePick(setBackendSource)}
                        className="btn-secondary shrink-0"
                      >
                        参照
                      </button>
                    </div>
                    {status && (
                      <p className="text-xs text-gray-500 mt-2">
                        配置先: {status.backendBinaryPath}
                      </p>
                    )}
                    {runtimeStatus?.bundledBackendAvailable && !status?.backendBinaryInstalled && (
                      <p className="text-xs text-emerald-700 mt-2">
                        配布版では同梱 backend sidecar をそのまま利用できます。
                      </p>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <label className="text-sm font-medium text-gray-800">
                        llama-server 実行ファイル
                      </label>
                      {(status || runtimeStatus) && (
                        <span
                          className={`px-2.5 py-1 rounded-full text-xs font-medium border ${installedBadgeClass(
                            Boolean(
                              status?.llamaServerBinaryInstalled ||
                                runtimeStatus?.bundledLlmAvailable
                            )
                          )}`}
                        >
                          {status?.llamaServerBinaryInstalled
                            ? "配置済み"
                            : runtimeStatus?.bundledLlmAvailable
                              ? "同梱済み"
                              : "未配置"}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <input
                        value={llamaServerSource}
                        onChange={(e) => setLlamaServerSource(e.target.value)}
                        placeholder="llama-server のローカルパス または URL"
                        className="input"
                      />
                      <button
                        type="button"
                        onClick={() => void handleExecutablePick(setLlamaServerSource)}
                        className="btn-secondary shrink-0"
                      >
                        参照
                      </button>
                    </div>
                    {status && (
                      <p className="text-xs text-gray-500 mt-2">
                        配置先: {status.llamaServerBinaryPath}
                      </p>
                    )}
                    {runtimeStatus?.bundledLlmAvailable && !status?.llamaServerBinaryInstalled && (
                      <p className="text-xs text-emerald-700 mt-2">
                        配布版では同梱 llama-server sidecar をそのまま利用できます。
                      </p>
                    )}
                  </div>
                </div>
              </section>

              <section className="card">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <h2 className="text-base font-semibold text-gray-900">2. GGUF モデルを指定</h2>
                    <p className="text-sm text-gray-600 mt-1">
                      軽量モデルを URL から取得するか、手元の GGUF を配置します。
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={forceRedownload}
                      onChange={(e) => setForceRedownload(e.target.checked)}
                      className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    モデルを再取得
                  </label>
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="radio"
                      name="model-source-mode"
                      checked={modelSourceMode === "download"}
                      onChange={() => setModelSourceMode("download")}
                      className="text-primary-600 focus:ring-primary-500"
                    />
                    URL からダウンロード
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="radio"
                      name="model-source-mode"
                      checked={modelSourceMode === "local"}
                      onChange={() => setModelSourceMode("local")}
                      className="text-primary-600 focus:ring-primary-500"
                    />
                    ローカル GGUF を使う
                  </label>
                </div>

                <div className="mt-5 space-y-5">
                  {modelSourceMode === "download" ? (
                    <div>
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <label className="text-sm font-medium text-gray-800">
                          モデル URL
                        </label>
                        {status && (
                          <span
                            className={`px-2.5 py-1 rounded-full text-xs font-medium border ${installedBadgeClass(
                              status.llmModelInstalled
                            )}`}
                          >
                            {status.llmModelInstalled ? "配置済み" : "未配置"}
                          </span>
                        )}
                      </div>
                      <input
                        value={modelDownloadUrl}
                        onChange={(e) => setModelDownloadUrl(e.target.value)}
                        placeholder="https://.../model.gguf"
                        className="input"
                      />
                      <p className="text-xs text-gray-500 mt-2">
                        初回配布の既定は軽量の Qwen3 4B GGUF を想定しています。
                      </p>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <label className="text-sm font-medium text-gray-800">
                          ローカル GGUF ファイル
                        </label>
                        {status && (
                          <span
                            className={`px-2.5 py-1 rounded-full text-xs font-medium border ${installedBadgeClass(
                              status.llmModelInstalled
                            )}`}
                          >
                            {status.llmModelInstalled ? "配置済み" : "未配置"}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <input
                          value={modelLocalPath}
                          onChange={(e) => setModelLocalPath(e.target.value)}
                          placeholder="/path/to/model.gguf"
                          className="input"
                        />
                        <button
                          type="button"
                          onClick={() => void handleModelPick()}
                          className="btn-secondary shrink-0"
                        >
                          参照
                        </button>
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="text-sm font-medium text-gray-800 block mb-2">
                      配置するモデルファイル名
                    </label>
                    <input
                      value={modelFilename}
                      onChange={(e) => setModelFilename(e.target.value)}
                      placeholder="Qwen3-4B-Q4_K_M.gguf"
                      className="input"
                    />
                    {status && (
                      <p className="text-xs text-gray-500 mt-2">
                        配置先: {status.llmModelPath}
                      </p>
                    )}
                  </div>
                </div>
              </section>

              <section className="card">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <h2 className="text-base font-semibold text-gray-900">3. Whisper を事前取得</h2>
                    <p className="text-sm text-gray-600 mt-1">
                      議事録作成時にオフラインで文字起こしできるよう、Whisper も先に落とします。
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={prepareWhisper}
                      onChange={(e) => setPrepareWhisper(e.target.checked)}
                      className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    初回セットアップで取得
                  </label>
                </div>

                <div className="mt-5 space-y-4">
                  <div>
                    <label className="text-sm font-medium text-gray-800 block mb-2">
                      Whisper モデル
                    </label>
                    <select
                      value={whisperModel}
                      onChange={(e) => {
                        const nextModel = e.target.value as WhisperModel;
                        setWhisperModel(nextModel);
                        setStoredWhisperModel(nextModel);
                      }}
                      className="input"
                    >
                      {WHISPER_MODELS.map((model) => (
                        <option key={model} value={model}>
                          {WHISPER_MODEL_LABELS[model]}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-500 mt-2">
                      {WHISPER_MODEL_DESCRIPTIONS[whisperModel]}
                    </p>
                  </div>
                </div>
              </section>

              <section className="card">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <h2 className="text-base font-semibold text-gray-900">4. 配置を実行</h2>
                    <p className="text-sm text-gray-600 mt-1">
                      選択したファイルのコピー、モデル URL の取得、runtime 再起動まで実行します。
                    </p>
                  </div>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="btn-primary min-w-40"
                  >
                    {submitting ? "配置中..." : "ランタイムを配置する"}
                  </button>
                </div>
              </section>
            </form>

            <aside className="space-y-6">
              <section className="card">
                <h2 className="text-base font-semibold text-gray-900">現在の状態</h2>
                <div className="mt-4 space-y-3 text-sm text-gray-700">
                  <div className="flex items-center justify-between gap-3">
                    <span>バックエンド</span>
                    <span className={`px-2.5 py-1 rounded-full border text-xs font-medium ${installedBadgeClass(
                      Boolean(status?.backendBinaryInstalled || runtimeStatus?.bundledBackendAvailable)
                    )}`}>
                      {status?.backendBinaryInstalled
                        ? "配置済み"
                        : runtimeStatus?.bundledBackendAvailable
                          ? "同梱済み"
                          : "未配置"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>llama-server</span>
                    <span className={`px-2.5 py-1 rounded-full border text-xs font-medium ${installedBadgeClass(
                      Boolean(status?.llamaServerBinaryInstalled || runtimeStatus?.bundledLlmAvailable)
                    )}`}>
                      {status?.llamaServerBinaryInstalled
                        ? "配置済み"
                        : runtimeStatus?.bundledLlmAvailable
                          ? "同梱済み"
                          : "未配置"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>GGUF モデル</span>
                    <span className={`px-2.5 py-1 rounded-full border text-xs font-medium ${installedBadgeClass(modelInstalled)}`}>
                      {modelInstalled ? "配置済み" : "未配置"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Managed runtime</span>
                    <span className={`px-2.5 py-1 rounded-full border text-xs font-medium ${installedBadgeClass(setupReady)}`}>
                      {setupReady ? "準備完了" : "未完了"}
                    </span>
                  </div>
                </div>

                <div className="mt-5 pt-5 border-t border-gray-200 space-y-2 text-sm text-gray-600">
                  <p>LLM モデル: {runtimeStatus?.llmModel ?? status?.llmModelAlias ?? "-"}</p>
                  <p>LLM URL: {runtimeStatus?.llmBaseUrl ?? "-"}</p>
                  <p>バックエンド起動中: {runtimeStatus?.backendRunning ? "はい" : "いいえ"}</p>
                  <p>llama-server 起動中: {runtimeStatus?.llmRunning ? "はい" : "いいえ"}</p>
                </div>
              </section>

              <section className="card">
                <h2 className="text-base font-semibold text-gray-900">配置先</h2>
                <div className="mt-4 space-y-3 text-xs text-gray-600 break-all">
                  <div>
                    <p className="font-medium text-gray-800">Runtime root</p>
                    <p className="mt-1">{status?.runtimeRootDir ?? "-"}</p>
                  </div>
                  <div>
                    <p className="font-medium text-gray-800">Bin</p>
                    <p className="mt-1">{status?.runtimeBinDir ?? "-"}</p>
                  </div>
                  <div>
                    <p className="font-medium text-gray-800">Models</p>
                    <p className="mt-1">{status?.runtimeModelDir ?? "-"}</p>
                  </div>
                  <div>
                    <p className="font-medium text-gray-800">Config</p>
                    <p className="mt-1">{status?.runtimeConfigPath ?? "-"}</p>
                  </div>
                </div>
              </section>

              <section className="card">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-semibold text-gray-900">進捗ログ</h2>
                  {latestProgress && (
                    <span className="text-xs text-gray-500">
                      {latestProgress.asset} / {latestProgress.stage}
                    </span>
                  )}
                </div>

                <div className="mt-4 space-y-3 max-h-[26rem] overflow-y-auto pr-1">
                  {progressEvents.length === 0 ? (
                    <p className="text-sm text-gray-500">
                      まだ進捗イベントはありません。配置を実行するとここに詳細が出ます。
                    </p>
                  ) : (
                    progressEvents.map((item, index) => {
                      const percent =
                        item.totalBytes && item.downloadedBytes
                          ? Math.min(
                              100,
                              Math.round((item.downloadedBytes / item.totalBytes) * 100)
                            )
                          : null;

                      return (
                        <div
                          key={`${item.asset}-${item.stage}-${index}`}
                          className={`rounded-xl border p-3 ${progressToneClass[item.status] ?? progressToneClass.info}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium">
                                {item.asset} / {item.stage}
                              </p>
                              <p className="text-xs mt-1 whitespace-pre-wrap">
                                {item.message}
                              </p>
                            </div>
                            <span className="text-[11px] uppercase tracking-wide">
                              {item.status}
                            </span>
                          </div>

                          {percent !== null && (
                            <div className="mt-3">
                              <div className="h-2 rounded-full bg-white/70 overflow-hidden">
                                <div
                                  className="h-full bg-current opacity-70"
                                  style={{ width: `${percent}%` }}
                                />
                              </div>
                              <p className="text-[11px] mt-1">
                                {formatBytes(item.downloadedBytes)} / {formatBytes(item.totalBytes)} ({percent}%)
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </section>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
