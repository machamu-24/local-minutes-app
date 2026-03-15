mod commands;
mod db;
mod processing;

use db::{DbState, init_db};
use rusqlite::Connection;
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let db_path = dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("minutes-app-local")
        .join("minutes.db");

    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }

    let conn = Connection::open(&db_path)
        .expect("DB init failed");
    init_db(&conn).expect("Schema init failed");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(DbState(Mutex::new(conn)))
        .invoke_handler(tauri::generate_handler![
            commands::recordings_list,
            commands::recordings_get,
            commands::recordings_upload,
            commands::recordings_upload_from_recorder,
            commands::recordings_delete,
            commands::recordings_delete_audio,
            commands::recordings_retain_audio,
            commands::recordings_reset_stuck,
            commands::transcripts_get,
            commands::transcripts_save,
            commands::summaries_get,
            commands::jobs_get,
            commands::jobs_get_latest,
            processing::transcripts_start,
            processing::summaries_start,
            processing::get_ollama_models,
            processing::check_ollama_status,
            processing::check_whisper_status,
        ])
        .run(tauri::generate_context!())
        .expect("app run failed");
}
