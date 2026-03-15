import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// ─── 型定義 ──────────────────────────────────────────────────────────────────

export interface Recording {
  id: number;
  title: string;
  meeting_date: string | null;
  audio_path: string | null;
  audio_filename: string | null;
  state: "IMPORTED" | "TRANSCRIBING" | "TRANSCRIBED" | "SUMMARIZING" | "DONE";
  audio_status: "PENDING" | "DELETED" | "RETAINED";
  created_at: string;
  updated_at: string;
}

export interface Transcript {
  id: number;
  recording_id: number;
  text_raw: string | null;
  text_edited: string | null;
  segments_json: string | null;
  language: string | null;
  created_at: string;
  updated_at: string;
}

export interface Summary {
  id: number;
  recording_id: number;
  template_name: string | null;
  content_md: string | null;
  created_at: string;
  updated_at: string;
}

export interface Job {
  id: number;
  recording_id: number;
  job_type: "transcribe" | "summarize";
  status: "pending" | "running" | "done" | "error";
  log: string | null;
  created_at: string;
  updated_at: string;
}

export interface OllamaModel {
  name: string;
}

// ─── Recordings API ──────────────────────────────────────────────────────────

export const recordingsApi = {
  list: () => invoke<Recording[]>("recordings_list"),
  get: (id: number) => invoke<Recording>("recordings_get", { id }),
  upload: (input: {
    title: string;
    meeting_date?: string;
    filename: string;
    data_base64: string;
  }) => invoke<Recording>("recordings_upload", { input }),
  uploadFromRecorder: (input: {
    title: string;
    meeting_date?: string;
    mime_type: string;
    data_base64: string;
    duration_seconds?: number;
  }) => invoke<Recording>("recordings_upload_from_recorder", { input }),
  delete: (id: number) => invoke<void>("recordings_delete", { id }),
  deleteAudio: (id: number) => invoke<Recording>("recordings_delete_audio", { id }),
  retainAudio: (id: number) => invoke<Recording>("recordings_retain_audio", { id }),
  resetStuck: (id: number) => invoke<Recording>("recordings_reset_stuck", { id }),
};

// ─── Transcripts API ─────────────────────────────────────────────────────────

export const transcriptsApi = {
  get: (recordingId: number) => invoke<Transcript | null>("transcripts_get", { recording_id: recordingId }),
  start: (recordingId: number) => invoke<number>("transcripts_start", { recording_id: recordingId }),
  save: (recordingId: number, textEdited: string) =>
    invoke<void>("transcripts_save", { recording_id: recordingId, text_edited: textEdited }),
};

// ─── Summaries API ───────────────────────────────────────────────────────────

export const summariesApi = {
  get: (recordingId: number) => invoke<Summary | null>("summaries_get", { recording_id: recordingId }),
  start: (recordingId: number) => invoke<number>("summaries_start", { recording_id: recordingId }),
};

// ─── Jobs API ────────────────────────────────────────────────────────────────

export const jobsApi = {
  get: (id: number) => invoke<Job>("jobs_get", { id }),
  getLatest: (recordingId: number, jobType: "transcribe" | "summarize") =>
    invoke<Job | null>("jobs_get_latest", { recording_id: recordingId, job_type: jobType }),
};

// ─── System API ──────────────────────────────────────────────────────────────

export const systemApi = {
  checkOllamaStatus: () => invoke<boolean>("check_ollama_status"),
  checkWhisperStatus: () => invoke<boolean>("check_whisper_status"),
  getOllamaModels: () => invoke<OllamaModel[]>("get_ollama_models"),
};

// ─── イベントリスナー ─────────────────────────────────────────────────────────

export const onJobUpdate = (callback: (jobId: number) => void) => {
  return listen<number>("job-update", (event) => {
    callback(event.payload);
  });
};
