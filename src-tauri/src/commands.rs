use crate::db::*;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::State;
use uuid::Uuid;

// ─── エラー型 ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct AppError {
    pub message: String,
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError { message: e.to_string() }
    }
}

impl From<anyhow::Error> for AppError {
    fn from(e: anyhow::Error) -> Self {
        AppError { message: e.to_string() }
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError { message: e.to_string() }
    }
}

type CmdResult<T> = Result<T, AppError>;

// ─── アプリデータディレクトリ取得 ────────────────────────────────────────────

fn get_audio_dir() -> PathBuf {
    let base = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("minutes-app-local")
        .join("audio");
    std::fs::create_dir_all(&base).ok();
    base
}

// ─── Recordings コマンド ─────────────────────────────────────────────────────

#[tauri::command]
pub fn recordings_list(state: State<DbState>) -> CmdResult<Vec<Recording>> {
    let conn = state.0.lock().unwrap();
    list_recordings(&conn).map_err(Into::into)
}

#[tauri::command]
pub fn recordings_get(state: State<DbState>, id: i64) -> CmdResult<Recording> {
    let conn = state.0.lock().unwrap();
    get_recording(&conn, id).map_err(Into::into)
}

#[derive(Deserialize)]
pub struct UploadInput {
    pub title: String,
    pub meeting_date: Option<String>,
    pub filename: String,
    pub data_base64: String,
}

#[tauri::command]
pub fn recordings_upload(state: State<DbState>, input: UploadInput) -> CmdResult<Recording> {
    // base64デコード
    use std::io::Write;
    let data = base64_decode(&input.data_base64)?;
    // ローカルファイルに保存
    let audio_dir = get_audio_dir();
    let ext = input.filename.split('.').last().unwrap_or("audio");
    let filename = format!("{}.{}", Uuid::new_v4(), ext);
    let path = audio_dir.join(&filename);
    let mut f = std::fs::File::create(&path)?;
    f.write_all(&data)?;

    let conn = state.0.lock().unwrap();
    create_recording(
        &conn,
        &input.title,
        input.meeting_date.as_deref(),
        Some(path.to_str().unwrap_or("")),
        Some(&input.filename),
    ).map_err(Into::into)
}

#[derive(Deserialize)]
pub struct RecorderUploadInput {
    pub title: String,
    pub meeting_date: Option<String>,
    pub mime_type: String,
    pub data_base64: String,
    pub duration_seconds: Option<f64>,
}

#[tauri::command]
pub fn recordings_upload_from_recorder(
    state: State<DbState>,
    input: RecorderUploadInput,
) -> CmdResult<Recording> {
    use std::io::Write;
    let data = base64_decode(&input.data_base64)?;
    let audio_dir = get_audio_dir();
    let ext = if input.mime_type.contains("webm") { "webm" }
              else if input.mime_type.contains("wav") { "wav" }
              else { "audio" };
    let filename = format!("{}.{}", Uuid::new_v4(), ext);
    let path = audio_dir.join(&filename);
    let mut f = std::fs::File::create(&path)?;
    f.write_all(&data)?;

    let conn = state.0.lock().unwrap();
    create_recording(
        &conn,
        &input.title,
        input.meeting_date.as_deref(),
        Some(path.to_str().unwrap_or("")),
        Some(&filename),
    ).map_err(Into::into)
}

#[tauri::command]
pub fn recordings_delete(state: State<DbState>, id: i64) -> CmdResult<()> {
    let conn = state.0.lock().unwrap();
    // 音声ファイルも削除
    if let Ok(rec) = get_recording(&conn, id) {
        if let Some(path) = rec.audio_path {
            std::fs::remove_file(path).ok();
        }
    }
    delete_recording(&conn, id).map_err(Into::into)
}

#[tauri::command]
pub fn recordings_delete_audio(state: State<DbState>, id: i64) -> CmdResult<Recording> {
    let conn = state.0.lock().unwrap();
    let rec = get_recording(&conn, id)?;
    if let Some(path) = &rec.audio_path {
        std::fs::remove_file(path).ok();
    }
    conn.execute(
        "UPDATE recordings SET audio_path = NULL, audio_status = 'DELETED', updated_at = ?1 WHERE id = ?2",
        rusqlite::params![chrono::Utc::now().to_rfc3339(), id],
    )?;
    get_recording(&conn, id).map_err(Into::into)
}

#[tauri::command]
pub fn recordings_retain_audio(state: State<DbState>, id: i64) -> CmdResult<Recording> {
    let conn = state.0.lock().unwrap();
    update_recording_audio_status(&conn, id, "RETAINED")?;
    get_recording(&conn, id).map_err(Into::into)
}

#[tauri::command]
pub fn recordings_reset_stuck(state: State<DbState>, id: i64) -> CmdResult<Recording> {
    let conn = state.0.lock().unwrap();
    let rec = get_recording(&conn, id)?;
    let new_state = match rec.state.as_str() {
        "TRANSCRIBING" => "IMPORTED",
        "SUMMARIZING" => "TRANSCRIBED",
        _ => return Ok(rec),
    };
    update_recording_state(&conn, id, new_state)?;
    get_recording(&conn, id).map_err(Into::into)
}

// ─── Transcripts コマンド ────────────────────────────────────────────────────

#[tauri::command]
pub fn transcripts_get(state: State<DbState>, recording_id: i64) -> CmdResult<Option<Transcript>> {
    let conn = state.0.lock().unwrap();
    match get_transcript(&conn, recording_id) {
        Ok(t) => Ok(Some(t)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

#[tauri::command]
pub fn transcripts_save(
    state: State<DbState>,
    recording_id: i64,
    text_edited: String,
) -> CmdResult<()> {
    let conn = state.0.lock().unwrap();
    save_transcript_edited(&conn, recording_id, &text_edited).map_err(Into::into)
}

// ─── Summaries コマンド ──────────────────────────────────────────────────────

#[tauri::command]
pub fn summaries_get(state: State<DbState>, recording_id: i64) -> CmdResult<Option<Summary>> {
    let conn = state.0.lock().unwrap();
    match get_summary(&conn, recording_id) {
        Ok(s) => Ok(Some(s)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

// ─── Jobs コマンド ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn jobs_get(state: State<DbState>, id: i64) -> CmdResult<Job> {
    let conn = state.0.lock().unwrap();
    get_job(&conn, id).map_err(Into::into)
}

#[tauri::command]
pub fn jobs_get_latest(
    state: State<DbState>,
    recording_id: i64,
    job_type: String,
) -> CmdResult<Option<Job>> {
    let conn = state.0.lock().unwrap();
    match get_latest_job(&conn, recording_id, &job_type) {
        Ok(j) => Ok(Some(j)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

// ─── ユーティリティ ──────────────────────────────────────────────────────────

fn base64_decode(s: &str) -> CmdResult<Vec<u8>> {
    use std::io::Read;
    // データURLのプレフィックスを除去
    let data = if s.contains(',') {
        s.split(',').nth(1).unwrap_or(s)
    } else {
        s
    };
    // base64デコード（標準ライブラリなし → 手動実装 or 依存追加）
    // ここではシンプルにバイト列変換
    base64_simple_decode(data)
}

fn base64_simple_decode(s: &str) -> CmdResult<Vec<u8>> {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut lookup = [255u8; 256];
    for (i, &c) in TABLE.iter().enumerate() {
        lookup[c as usize] = i as u8;
    }
    let s = s.trim().replace('\n', "").replace('\r', "");
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let bytes = s.as_bytes();
    let mut i = 0;
    while i + 3 < bytes.len() {
        let a = lookup[bytes[i] as usize];
        let b = lookup[bytes[i+1] as usize];
        let c = lookup[bytes[i+2] as usize];
        let d = lookup[bytes[i+3] as usize];
        if a == 255 || b == 255 { break; }
        out.push((a << 2) | (b >> 4));
        if bytes[i+2] != b'=' && c != 255 {
            out.push((b << 4) | (c >> 2));
        }
        if bytes[i+3] != b'=' && d != 255 {
            out.push((c << 6) | d);
        }
        i += 4;
    }
    Ok(out)
}
