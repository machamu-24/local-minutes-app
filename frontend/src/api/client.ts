/**
 * client.ts
 * axios ラッパー。
 * baseURL は localhost:8000 のみ（外部通信なし）。
 * API 型定義と各エンドポイント呼び出し関数を提供する。
 */

import axios from "axios";

// ─────────────────────────────────────────────
// axios インスタンス設定
// ─────────────────────────────────────────────

const DEV_BACKEND_BASE_URL = "http://127.0.0.1:8000";
const DEV_FRONTEND_PORTS = new Set(["1420", "5173"]);

const resolveApiBaseUrl = (): string => {
  if (typeof window === "undefined") {
    return DEV_BACKEND_BASE_URL;
  }

  const { protocol, hostname, port, origin } = window.location;
  const isLocalBrowserOrigin = hostname === "127.0.0.1" || hostname === "localhost";
  const isHttpOrigin = protocol === "http:" || protocol === "https:";

  if (isHttpOrigin && isLocalBrowserOrigin && port && !DEV_FRONTEND_PORTS.has(port)) {
    return origin;
  }

  return DEV_BACKEND_BASE_URL;
};

export const apiClient = axios.create({
  baseURL: resolveApiBaseUrl(),
  timeout: 600000, // 10分（文字起こし・要約の長時間処理に対応）
  headers: {
    "Content-Type": "application/json",
  },
});

const formatApiErrorMessage = (detail: unknown): string | null => {
  if (typeof detail === "string" && detail.trim()) {
    return detail;
  }

  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "msg" in item) {
          const message = item.msg;
          return typeof message === "string" ? message : null;
        }
        return null;
      })
      .filter((message): message is string => Boolean(message));

    if (messages.length > 0) {
      return messages.join(" / ");
    }
  }

  if (detail && typeof detail === "object") {
    if ("message" in detail && typeof detail.message === "string") {
      return detail.message;
    }

    try {
      return JSON.stringify(detail);
    } catch {
      return null;
    }
  }

  return null;
};

// レスポンスインターセプター（エラーハンドリング）
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      // サーバーエラーレスポンス
      const message =
        formatApiErrorMessage(error.response.data?.detail) ||
        formatApiErrorMessage(error.response.data?.message) ||
        `エラー: ${error.response.status}`;
      return Promise.reject(new Error(message));
    } else if (error.request) {
      // ネットワークエラー（バックエンド未起動等）
      return Promise.reject(
        new Error(
          "バックエンドサーバーに接続できません。" +
          "アプリが正しく起動しているか確認してください。"
        )
      );
    }
    return Promise.reject(error);
  }
);

// ─────────────────────────────────────────────
// 型定義
// ─────────────────────────────────────────────

export interface Recording {
  id: number;
  title: string;
  meeting_date: string | null;
  audio_path: string | null;
  wav_path: string | null;
  state: "IMPORTED" | "TRANSCRIBING" | "TRANSCRIBED" | "SUMMARIZING" | "DONE";
  audio_status: "PENDING" | "DELETED" | "RETAINED";
  last_summary_template_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecordingListResponse {
  recordings: Recording[];
  total: number;
}

export interface Transcript {
  id: number;
  recording_id: number;
  text_raw: string | null;
  text_edited: string | null;
  segments_json: string | null;
}

export interface Summary {
  id: number;
  recording_id: number;
  template_name: string;
  content_md: string | null;
  prompt_snapshot: string | null;
}

export interface SummaryTemplateOption {
  name: string;
  label: string;
  description: string;
}

export interface StartSummarizationParams {
  templateName?: string;
  customPrompt?: string;
}

export interface Job {
  id: number;
  recording_id: number;
  job_type: "transcribe" | "summarize";
  status: "pending" | "running" | "done" | "error";
  log: string | null;
  created_at: string;
}

export interface MessageResponse {
  message: string;
  detail?: string;
}

export interface LlmStatus {
  provider: "ollama" | "openai_compatible";
  base_url: string;
  configured_model: string;
  available: boolean;
  model_loaded: boolean;
  available_models: string[];
  message: string;
}

export interface RuntimeEnvironment {
  app_data_dir: string;
  audio_dir: string;
  whisper_models_dir: string;
  ffmpeg_path: string;
  ffprobe_path: string | null;
  default_whisper_model: WhisperModel;
  supported_whisper_models: WhisperModel[];
}

export type WhisperModel =
  | "small"
  | "medium"
  | "large"
  | "large-v3-turbo";

// ─────────────────────────────────────────────
// API 関数
// ─────────────────────────────────────────────

/** 録音一覧取得 */
export const getRecordings = async (): Promise<RecordingListResponse> => {
  const res = await apiClient.get<RecordingListResponse>("/api/recordings");
  return res.data;
};

/** 録音詳細取得 */
export const getRecording = async (id: number): Promise<Recording> => {
  const res = await apiClient.get<Recording>(`/api/recordings/${id}`);
  return res.data;
};

/** 録音削除 */
export const deleteRecording = async (
  recordingId: number
): Promise<MessageResponse> => {
  const res = await apiClient.delete<MessageResponse>(
    `/api/recordings/${recordingId}`
  );
  return res.data;
};

/** 音声ファイル取り込み */
export const importRecording = async (
  file: File,
  title: string,
  meetingDate?: string
): Promise<Recording> => {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("title", title);
  if (meetingDate) formData.append("meeting_date", meetingDate);

  const res = await apiClient.post<Recording>("/api/recordings/import", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
};

/** 文字起こし開始 */
export const startTranscription = async (
  recordingId: number,
  model: WhisperModel
): Promise<Job> => {
  const res = await apiClient.post<Job>(
    `/api/recordings/${recordingId}/transcribe`,
    { model }
  );
  return res.data;
};

/** 文字起こし結果取得 */
export const getTranscript = async (recordingId: number): Promise<Transcript> => {
  const res = await apiClient.get<Transcript>(
    `/api/recordings/${recordingId}/transcript`
  );
  return res.data;
};

/** 文字起こし修正保存 */
export const updateTranscript = async (
  recordingId: number,
  textEdited: string
): Promise<Transcript> => {
  const res = await apiClient.put<Transcript>(
    `/api/recordings/${recordingId}/transcript`,
    { text_edited: textEdited }
  );
  return res.data;
};

/** 要約テンプレート一覧取得 */
export const getSummaryTemplates = async (): Promise<SummaryTemplateOption[]> => {
  const res = await apiClient.get<SummaryTemplateOption[]>(
    "/api/recordings/summary-templates"
  );
  return res.data;
};

/** 要約生成開始 */
export const startSummarization = async (
  recordingId: number,
  params: StartSummarizationParams = {}
): Promise<Job> => {
  const payload = {
    template_name: params.templateName ?? "general",
    custom_prompt: params.customPrompt?.trim() || undefined,
  };
  const res = await apiClient.post<Job>(
    `/api/recordings/${recordingId}/summarize`,
    payload
  );
  return res.data;
};

/** 要約結果取得 */
export const getSummary = async (
  recordingId: number,
  templateName?: string
): Promise<Summary> => {
  const res = await apiClient.get<Summary>(
    `/api/recordings/${recordingId}/summary`,
    {
      params: templateName ? { template_name: templateName } : undefined,
    }
  );
  return res.data;
};

/** 音声ファイル削除 */
export const deleteAudio = async (
  recordingId: number
): Promise<MessageResponse> => {
  const res = await apiClient.post<MessageResponse>(
    `/api/recordings/${recordingId}/audio/delete`,
    { confirmed: true }
  );
  return res.data;
};

/** 音声ファイル保持 */
export const retainAudio = async (
  recordingId: number
): Promise<MessageResponse> => {
  const res = await apiClient.post<MessageResponse>(
    `/api/recordings/${recordingId}/audio/retain`,
    {}
  );
  return res.data;
};

/** ジョブ状態取得 */
export const getJob = async (jobId: number): Promise<Job> => {
  const res = await apiClient.get<Job>(`/api/jobs/${jobId}`);
  return res.data;
};

/** ヘルスチェック */
export const healthCheck = async (): Promise<{ status: string }> => {
  const res = await apiClient.get("/api/health");
  return res.data;
};

/** Ollama 稼働状況確認 */
export const getOllamaStatus = async () => {
  const res = await apiClient.get("/api/ollama/status");
  return res.data;
};

/** LLM ランタイム稼働状況確認 */
export const getLlmStatus = async (): Promise<LlmStatus> => {
  const res = await apiClient.get<LlmStatus>("/api/llm/status");
  return res.data;
};

/** Runtime 環境取得 */
export const getRuntimeEnvironment = async (): Promise<RuntimeEnvironment> => {
  const res = await apiClient.get<RuntimeEnvironment>("/api/runtime/status");
  return res.data;
};

/** Whisper モデルの事前ダウンロード */
export const prepareWhisperModel = async (
  model: WhisperModel
): Promise<MessageResponse> => {
  const normalizedModel = model === "large-v3-turbo" ? "large-v3-turbo" : model;
  const res = await apiClient.post<MessageResponse>("/api/runtime/whisper/prepare", {
    model: normalizedModel,
  });
  return res.data;
};

// ─────────────────────────────────────────────
// ユーティリティ
// ─────────────────────────────────────────────

/**
 * ジョブ完了までポーリングする。
 * @param jobId ジョブ ID
 * @param intervalMs ポーリング間隔（ミリ秒）
 * @param maxRetries 最大リトライ回数
 * @returns 完了したジョブ情報
 */
export const pollJobUntilDone = async (
  jobId: number,
  intervalMs = 3000,
  maxRetries = 200
): Promise<Job> => {
  for (let i = 0; i < maxRetries; i++) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const job = await getJob(jobId);
    if (job.status === "done" || job.status === "error") {
      return job;
    }
  }
  throw new Error("ジョブのタイムアウト（処理が完了しませんでした）");
};

/**
 * 処理状態の日本語ラベルを返す。
 */
export const getStateLabel = (state: Recording["state"]): string => {
  const labels: Record<Recording["state"], string> = {
    IMPORTED: "取り込み済み",
    TRANSCRIBING: "文字起こし中",
    TRANSCRIBED: "文字起こし完了",
    SUMMARIZING: "要約中",
    DONE: "完了",
  };
  return labels[state] ?? state;
};

/**
 * 処理状態のバッジカラークラスを返す。
 */
export const getStateBadgeClass = (state: Recording["state"]): string => {
  const classes: Record<Recording["state"], string> = {
    IMPORTED: "bg-gray-100 text-gray-700",
    TRANSCRIBING: "bg-blue-100 text-blue-700",
    TRANSCRIBED: "bg-indigo-100 text-indigo-700",
    SUMMARIZING: "bg-purple-100 text-purple-700",
    DONE: "bg-green-100 text-green-700",
  };
  return classes[state] ?? "bg-gray-100 text-gray-700";
};
