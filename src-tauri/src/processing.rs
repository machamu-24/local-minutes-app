use crate::db::*;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;
use tauri::Emitter;
use tauri::Manager;

// ─── 文字起こし開始コマンド ──────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug)]
pub struct WhisperSegment {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct WhisperResult {
    pub text: String,
    pub segments: Vec<WhisperSegment>,
    pub language: String,
}

/// 文字起こしジョブを開始する（非同期バックグラウンド処理）
#[tauri::command]
pub async fn transcripts_start(
    app: tauri::AppHandle,
    state: State<'_, DbState>,
    recording_id: i64,
) -> Result<i64, String> {
    // ジョブ作成
    let job_id = {
        let conn = state.0.lock().unwrap();
        let rec = get_recording(&conn, recording_id)
            .map_err(|e| e.to_string())?;
        if rec.audio_path.is_none() {
            return Err("音声ファイルが見つかりません".to_string());
        }
        let job = create_job(&conn, recording_id, "transcribe")
            .map_err(|e| e.to_string())?;
        update_recording_state(&conn, recording_id, "TRANSCRIBING")
            .map_err(|e| e.to_string())?;
        job.id
    };

    // バックグラウンドで処理
    let app_clone = app.clone();
    tokio::spawn(async move {
        run_transcription(app_clone, recording_id, job_id).await;
    });

    Ok(job_id)
}

async fn run_transcription(app: tauri::AppHandle, recording_id: i64, job_id: i64) {
    let state = app.state::<DbState>();

    // ジョブをrunningに
    {
        let conn = state.0.lock().unwrap();
        let _ = update_job_status(&conn, job_id, "running", None);
    }

    // 音声ファイルパスを取得
    let audio_path = {
        let conn = state.0.lock().unwrap();
        match get_recording(&conn, recording_id) {
            Ok(rec) => rec.audio_path,
            Err(e) => {
                let conn2 = state.0.lock().unwrap();
                let _ = update_job_status(&conn2, job_id, "error", Some(&e.to_string()));
                let _ = update_recording_state(&conn2, recording_id, "IMPORTED");
                let _ = app.emit("job-update", job_id);
                return;
            }
        }
    };

    let Some(path) = audio_path else {
        let conn = state.0.lock().unwrap();
        let _ = update_job_status(&conn, job_id, "error", Some("音声ファイルが見つかりません"));
        let _ = update_recording_state(&conn, recording_id, "IMPORTED");
        let _ = app.emit("job-update", job_id);
        return;
    };

    // faster-whisper Pythonスクリプトを呼び出す
    match call_faster_whisper(&path).await {
        Ok(result) => {
            let segments_json = serde_json::to_string(&result.segments).unwrap_or_default();
            let conn = state.0.lock().unwrap();
            let _ = upsert_transcript(
                &conn,
                recording_id,
                Some(&result.text),
                Some(&segments_json),
                Some(&result.language),
            );
            let _ = update_recording_state(&conn, recording_id, "TRANSCRIBED");
            let _ = update_job_status(&conn, job_id, "done", None);
        }
        Err(e) => {
            let conn = state.0.lock().unwrap();
            let _ = update_job_status(&conn, job_id, "error", Some(&e));
            let _ = update_recording_state(&conn, recording_id, "IMPORTED");
        }
    }
    let _ = app.emit("job-update", job_id);
}

async fn call_faster_whisper(audio_path: &str) -> Result<WhisperResult, String> {
    // Pythonスクリプトを実行してfaster-whisperで文字起こし
    let script_path = get_whisper_script_path();

    let output = tokio::process::Command::new("python3")
        .arg(&script_path)
        .arg(audio_path)
        .output()
        .await
        .map_err(|e| format!("Pythonの実行に失敗しました: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("文字起こし処理に失敗しました: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str::<WhisperResult>(&stdout)
        .map_err(|e| format!("結果の解析に失敗しました: {} / output: {}", e, stdout))
}

fn get_whisper_script_path() -> String {
    // アプリのリソースディレクトリからスクリプトを探す
    let candidates = vec![
        dirs::data_local_dir()
            .unwrap_or_default()
            .join("minutes-app-local")
            .join("scripts")
            .join("whisper_transcribe.py"),
        std::path::PathBuf::from("scripts/whisper_transcribe.py"),
        std::path::PathBuf::from("../scripts/whisper_transcribe.py"),
    ];
    for p in &candidates {
        if p.exists() {
            return p.to_str().unwrap_or("").to_string();
        }
    }
    // フォールバック: アプリデータディレクトリに作成
    let script_dir = dirs::data_local_dir()
        .unwrap_or_default()
        .join("minutes-app-local")
        .join("scripts");
    std::fs::create_dir_all(&script_dir).ok();
    let script_path = script_dir.join("whisper_transcribe.py");
    if !script_path.exists() {
        std::fs::write(&script_path, WHISPER_SCRIPT).ok();
    }
    script_path.to_str().unwrap_or("").to_string()
}

// ─── 議事録生成コマンド ──────────────────────────────────────────────────────

/// 議事録生成ジョブを開始する（非同期バックグラウンド処理）
#[tauri::command]
pub async fn summaries_start(
    app: tauri::AppHandle,
    state: State<'_, DbState>,
    recording_id: i64,
) -> Result<i64, String> {
    let job_id = {
        let conn = state.0.lock().unwrap();
        let rec = get_recording(&conn, recording_id)
            .map_err(|e| e.to_string())?;
        // 文字起こし済みか確認
        if rec.state != "TRANSCRIBED" && rec.state != "DONE" {
            return Err("文字起こしが完了していません".to_string());
        }
        let job = create_job(&conn, recording_id, "summarize")
            .map_err(|e| e.to_string())?;
        update_recording_state(&conn, recording_id, "SUMMARIZING")
            .map_err(|e| e.to_string())?;
        job.id
    };

    let app_clone = app.clone();
    tokio::spawn(async move {
        run_summarization(app_clone, recording_id, job_id).await;
    });

    Ok(job_id)
}

async fn run_summarization(app: tauri::AppHandle, recording_id: i64, job_id: i64) {
    let state = app.state::<DbState>();

    {
        let conn = state.0.lock().unwrap();
        let _ = update_job_status(&conn, job_id, "running", None);
    }

    // テキストと録音情報を取得
    let (text, title, meeting_date) = {
        let conn = state.0.lock().unwrap();
        let rec = match get_recording(&conn, recording_id) {
            Ok(r) => r,
            Err(e) => {
                let _ = update_job_status(&conn, job_id, "error", Some(&e.to_string()));
                let _ = update_recording_state(&conn, recording_id, "TRANSCRIBED");
                let _ = app.emit("job-update", job_id);
                return;
            }
        };
        let transcript = match get_transcript(&conn, recording_id) {
            Ok(t) => t,
            Err(e) => {
                let _ = update_job_status(&conn, job_id, "error", Some(&e.to_string()));
                let _ = update_recording_state(&conn, recording_id, "TRANSCRIBED");
                let _ = app.emit("job-update", job_id);
                return;
            }
        };
        // 編集済みテキストを優先
        let text = transcript.text_edited
            .or(transcript.text_raw)
            .unwrap_or_default();
        (text, rec.title, rec.meeting_date)
    };

    match generate_minutes(&text, &title, meeting_date.as_deref()).await {
        Ok(content_md) => {
            let conn = state.0.lock().unwrap();
            let _ = upsert_summary(&conn, recording_id, &content_md);
            let _ = update_recording_state(&conn, recording_id, "DONE");
            let _ = update_job_status(&conn, job_id, "done", None);
        }
        Err(e) => {
            let conn = state.0.lock().unwrap();
            let _ = update_job_status(&conn, job_id, "error", Some(&e));
            let _ = update_recording_state(&conn, recording_id, "TRANSCRIBED");
        }
    }
    let _ = app.emit("job-update", job_id);
}

/// Ollamaを使った2段階要約
async fn generate_minutes(
    text: &str,
    title: &str,
    meeting_date: Option<&str>,
) -> Result<String, String> {
    let chunks = split_text_into_chunks(text, 1500);

    // Step 1: 各チャンクを個別に要約
    let mut chunk_summaries: Vec<String> = Vec::new();
    for chunk in &chunks {
        let summary = call_ollama(
            "あなたは優秀な議事録作成アシスタントです。与えられた会議の文字起こしテキストを簡潔に要約してください。重要な発言、決定事項、アクションアイテムを抽出してください。日本語で回答してください。",
            &format!("以下の会議テキストを要約してください:\n\n{}", chunk),
        ).await?;
        chunk_summaries.push(summary);
    }

    let combined = chunk_summaries.join("\n\n---\n\n");
    let date_str = meeting_date.unwrap_or("未設定");

    // Step 2: 統合要約 → 議事録フォーマット生成
    let prompt = format!(
        "会議名: {}\n日付: {}\n\n以下の要約内容をもとに議事録を作成してください:\n\n{}\n\n---\n\n以下のMarkdownテンプレートに従って出力してください:\n\n# 議事録\n\n## 基本情報\n- 会議名: {}\n- 日付: {}\n\n## 議題・目的\n\n## 主な議論内容\n\n## 決定事項\n\n## 次のアクション・TODO\n\n## その他・備考",
        title, date_str, combined, title, date_str
    );

    call_ollama(
        "あなたは優秀な議事録作成アシスタントです。以下の要約をもとに、指定のMarkdownテンプレートに従って正式な議事録を作成してください。日本語で回答してください。",
        &prompt,
    ).await
}

#[derive(Serialize, Deserialize)]
struct OllamaRequest {
    model: String,
    messages: Vec<OllamaMessage>,
    stream: bool,
}

#[derive(Serialize, Deserialize)]
struct OllamaMessage {
    role: String,
    content: String,
}

#[derive(Serialize, Deserialize)]
struct OllamaResponse {
    message: Option<OllamaMessage>,
}

async fn call_ollama(system: &str, user: &str) -> Result<String, String> {
    let client = reqwest::Client::new();
    let req = OllamaRequest {
        model: "llama3.2".to_string(),
        messages: vec![
            OllamaMessage { role: "system".to_string(), content: system.to_string() },
            OllamaMessage { role: "user".to_string(), content: user.to_string() },
        ],
        stream: false,
    };

    let resp = client
        .post("http://localhost:11434/api/chat")
        .json(&req)
        .send()
        .await
        .map_err(|e| format!("Ollamaへの接続に失敗しました。Ollamaが起動しているか確認してください: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Ollamaエラー: {}", resp.status()));
    }

    let body: OllamaResponse = resp.json().await
        .map_err(|e| format!("Ollamaレスポンスの解析に失敗: {}", e))?;

    Ok(body.message.map(|m| m.content).unwrap_or_default())
}

fn split_text_into_chunks(text: &str, chunk_size: usize) -> Vec<String> {
    if text.len() <= chunk_size {
        return vec![text.to_string()];
    }
    let mut chunks = Vec::new();
    let mut start = 0;
    while start < text.len() {
        let mut end = (start + chunk_size).min(text.len());
        if end < text.len() {
            // 文末で切る
            let slice = &text[start..end];
            if let Some(pos) = slice.rfind('。') {
                end = start + pos + '。'.len_utf8();
            } else if let Some(pos) = slice.rfind('\n') {
                end = start + pos + 1;
            }
        }
        chunks.push(text[start..end].trim().to_string());
        start = end;
    }
    chunks.into_iter().filter(|c| !c.is_empty()).collect()
}

// ─── Ollamaモデル一覧取得コマンド ────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
pub struct OllamaModel {
    pub name: String,
}

#[derive(Serialize, Deserialize)]
struct OllamaModelsResponse {
    models: Vec<OllamaModel>,
}

#[tauri::command]
pub async fn get_ollama_models() -> Result<Vec<OllamaModel>, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get("http://localhost:11434/api/tags")
        .send()
        .await
        .map_err(|e| format!("Ollamaへの接続に失敗: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Ollamaエラー: {}", resp.status()));
    }

    let body: OllamaModelsResponse = resp.json().await
        .map_err(|e| format!("レスポンス解析エラー: {}", e))?;

    Ok(body.models)
}

/// Ollamaの接続状態確認
#[tauri::command]
pub async fn check_ollama_status() -> Result<bool, String> {
    let client = reqwest::Client::new();
    match client.get("http://localhost:11434/api/tags").send().await {
        Ok(resp) => Ok(resp.status().is_success()),
        Err(_) => Ok(false),
    }
}

/// faster-whisperのインストール状態確認
#[tauri::command]
pub async fn check_whisper_status() -> Result<bool, String> {
    let output = tokio::process::Command::new("python3")
        .arg("-c")
        .arg("import faster_whisper; print('ok')")
        .output()
        .await;
    match output {
        Ok(o) => Ok(o.status.success()),
        Err(_) => Ok(false),
    }
}

// ─── Whisper Pythonスクリプト（埋め込み） ────────────────────────────────────

const WHISPER_SCRIPT: &str = r#"#!/usr/bin/env python3
"""
faster-whisper を使った音声文字起こしスクリプト
使用方法: python3 whisper_transcribe.py <audio_file_path>
出力: JSON形式 { text, segments: [{start, end, text}], language }
"""
import sys
import json

def transcribe(audio_path: str) -> dict:
    from faster_whisper import WhisperModel
    # モデルサイズ: tiny / base / small / medium / large-v3
    # 初回実行時はモデルをダウンロードします（数百MB〜数GB）
    model = WhisperModel("base", device="cpu", compute_type="int8")
    segments, info = model.transcribe(
        audio_path,
        language="ja",
        beam_size=5,
        vad_filter=True,
    )
    result_segments = []
    full_text_parts = []
    for seg in segments:
        result_segments.append({
            "start": round(seg.start, 2),
            "end": round(seg.end, 2),
            "text": seg.text.strip(),
        })
        full_text_parts.append(seg.text.strip())
    return {
        "text": " ".join(full_text_parts),
        "segments": result_segments,
        "language": info.language,
    }

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "音声ファイルパスを指定してください"}))
        sys.exit(1)
    audio_path = sys.argv[1]
    try:
        result = transcribe(audio_path)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)
"#;
