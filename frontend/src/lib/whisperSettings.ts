import type { WhisperModel } from "../api/client";

export const WHISPER_MODELS: WhisperModel[] = [
  "small",
  "medium",
  "large",
  "large-v3-turbo",
];

export const DEFAULT_WHISPER_MODEL: WhisperModel = "medium";
export const WHISPER_MODEL_STORAGE_KEY = "local-minutes.whisper-model";

export function isWhisperModel(value: string): value is WhisperModel {
  return WHISPER_MODELS.includes(value as WhisperModel);
}

export function getStoredWhisperModel(): WhisperModel {
  if (typeof window === "undefined") {
    return DEFAULT_WHISPER_MODEL;
  }

  try {
    const value = window.localStorage.getItem(WHISPER_MODEL_STORAGE_KEY);
    if (value === "turbo") {
      return "large-v3-turbo";
    }
    if (value && isWhisperModel(value)) {
      return value;
    }
  } catch {
    // localStorage が使えない環境ではデフォルトを返す
  }

  return DEFAULT_WHISPER_MODEL;
}

export function setStoredWhisperModel(model: WhisperModel): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(WHISPER_MODEL_STORAGE_KEY, model);
  } catch {
    // 保存できない環境では UI 上の状態のみ反映する
  }
}

export const WHISPER_MODEL_LABELS: Record<WhisperModel, string> = {
  small: "small",
  medium: "medium",
  large: "large",
  "large-v3-turbo": "large-v3-turbo",
};

export const WHISPER_MODEL_DESCRIPTIONS: Record<WhisperModel, string> = {
  small: "軽量で高速。精度より処理時間を優先したい場合向け。",
  medium: "現在の既定値。精度と速度のバランスが良い設定です。",
  large: "精度重視。faster-whisper では `large-v3` 系として扱われます。",
  "large-v3-turbo": "`turbo` の正式名で、高速化された `large-v3` 系モデルです。",
};
