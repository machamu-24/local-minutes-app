import type { WhisperModel } from "../api/client";
import {
  WHISPER_MODELS,
  WHISPER_MODEL_DESCRIPTIONS,
  WHISPER_MODEL_LABELS,
} from "../lib/whisperSettings";

interface WhisperSettingsDialogProps {
  isOpen: boolean;
  selectedModel: WhisperModel;
  onChangeModel: (model: WhisperModel) => void;
  onClose: () => void;
}

export default function WhisperSettingsDialog({
  isOpen,
  selectedModel,
  onChangeModel,
  onClose,
}: WhisperSettingsDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl max-w-lg w-full mx-4 p-6">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Whisper モデル設定</h2>
            <p className="text-sm text-gray-600 mt-1">
              選択したモデルはこの端末に保存され、次回以降の文字起こしにも使われます。
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            aria-label="設定を閉じる"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-3">
          {WHISPER_MODELS.map((model) => {
            const checked = selectedModel === model;
            return (
              <label
                key={model}
                className={`block rounded-xl border p-4 cursor-pointer transition-colors ${
                  checked
                    ? "border-primary-500 bg-primary-50"
                    : "border-gray-200 hover:border-gray-300 bg-white"
                }`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="radio"
                    name="whisper-model"
                    value={model}
                    checked={checked}
                    onChange={() => onChangeModel(model)}
                    className="mt-1 h-4 w-4 text-primary-600 border-gray-300 focus:ring-primary-500"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900">
                        {WHISPER_MODEL_LABELS[model]}
                      </span>
                      {model === "medium" && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                          既定値
                        </span>
                      )}
                      {model === "large-v3-turbo" && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                          高速化版
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600 mt-1">
                      {WHISPER_MODEL_DESCRIPTIONS[model]}
                    </p>
                  </div>
                </div>
              </label>
            );
          })}
        </div>

        <div className="mt-5 rounded-lg bg-amber-50 border border-amber-200 p-3">
          <p className="text-xs text-amber-800">
            `large` は `small` / `medium` より重く、`large-v3-turbo` は旧 `turbo` と同じ系統の高速化モデルです。
            初回使用時はモデルのダウンロードに時間がかかることがあります。
          </p>
        </div>

        <div className="flex justify-end mt-6">
          <button onClick={onClose} className="btn-primary">
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
