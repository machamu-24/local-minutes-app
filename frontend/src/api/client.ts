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

export const apiClient = axios.create({
  baseURL: "http://127.0.0.1:8000",
  timeout: 600000, // 10分（文字起こし・要約の長時間処理に対応）
  headers: {
    "Content-Type": "application/json",
  },
});

// レスポンスインターセプター（エラーハンドリング）
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      // サーバーエラーレスポンス
      const message =
        error.response.data?.detail ||
        error.response.data?.message ||
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
export const startTranscription = async (recordingId: number): Promise<Job> => {
  const res = await apiClient.post<Job>(
    `/api/recordings/${recordingId}/transcribe`
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

/** 要約生成開始 */
export const startSummarization = async (
  recordingId: number,
  templateName = "general"
): Promise<Job> => {
  const res = await apiClient.post<Job>(
    `/api/recordings/${recordingId}/summarize`,
    { template_name: templateName }
  );
  return res.data;
};

/** 要約結果取得 */
export const getSummary = async (recordingId: number): Promise<Summary> => {
  const res = await apiClient.get<Summary>(
    `/api/recordings/${recordingId}/summary`
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
