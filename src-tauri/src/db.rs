use rusqlite::{Connection, Result, params};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use chrono::Utc;

// ─── 型定義 ──────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Recording {
    pub id: i64,
    pub title: String,
    pub meeting_date: Option<String>,
    pub audio_path: Option<String>,
    pub audio_filename: Option<String>,
    pub state: String, // IMPORTED | TRANSCRIBING | TRANSCRIBED | SUMMARIZING | DONE
    pub audio_status: String, // PENDING | DELETED | RETAINED
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Transcript {
    pub id: i64,
    pub recording_id: i64,
    pub text_raw: Option<String>,
    pub text_edited: Option<String>,
    pub segments_json: Option<String>,
    pub language: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Summary {
    pub id: i64,
    pub recording_id: i64,
    pub template_name: Option<String>,
    pub content_md: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Job {
    pub id: i64,
    pub recording_id: i64,
    pub job_type: String, // transcribe | summarize
    pub status: String,   // pending | running | done | error
    pub log: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

// ─── DB初期化 ────────────────────────────────────────────────────────────────

pub struct DbState(pub Mutex<Connection>);

pub fn init_db(conn: &Connection) -> Result<()> {
    conn.execute_batch("
        PRAGMA journal_mode=WAL;
        PRAGMA foreign_keys=ON;

        CREATE TABLE IF NOT EXISTS recordings (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            title       TEXT NOT NULL,
            meeting_date TEXT,
            audio_path  TEXT,
            audio_filename TEXT,
            state       TEXT NOT NULL DEFAULT 'IMPORTED',
            audio_status TEXT NOT NULL DEFAULT 'PENDING',
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS transcripts (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            recording_id INTEGER NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
            text_raw     TEXT,
            text_edited  TEXT,
            segments_json TEXT,
            language     TEXT,
            created_at   TEXT NOT NULL,
            updated_at   TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS summaries (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            recording_id INTEGER NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
            template_name TEXT DEFAULT 'general',
            content_md   TEXT,
            created_at   TEXT NOT NULL,
            updated_at   TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS jobs (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            recording_id INTEGER NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
            job_type     TEXT NOT NULL,
            status       TEXT NOT NULL DEFAULT 'pending',
            log          TEXT,
            created_at   TEXT NOT NULL,
            updated_at   TEXT NOT NULL
        );
    ")?;
    Ok(())
}

// ─── Recordings CRUD ─────────────────────────────────────────────────────────

pub fn create_recording(
    conn: &Connection,
    title: &str,
    meeting_date: Option<&str>,
    audio_path: Option<&str>,
    audio_filename: Option<&str>,
) -> Result<Recording> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO recordings (title, meeting_date, audio_path, audio_filename, state, audio_status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'IMPORTED', 'PENDING', ?5, ?6)",
        params![title, meeting_date, audio_path, audio_filename, now, now],
    )?;
    let id = conn.last_insert_rowid();
    get_recording(conn, id)
}

pub fn get_recording(conn: &Connection, id: i64) -> Result<Recording> {
    conn.query_row(
        "SELECT id, title, meeting_date, audio_path, audio_filename, state, audio_status, created_at, updated_at
         FROM recordings WHERE id = ?1",
        params![id],
        |row| Ok(Recording {
            id: row.get(0)?,
            title: row.get(1)?,
            meeting_date: row.get(2)?,
            audio_path: row.get(3)?,
            audio_filename: row.get(4)?,
            state: row.get(5)?,
            audio_status: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        }),
    )
}

pub fn list_recordings(conn: &Connection) -> Result<Vec<Recording>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, meeting_date, audio_path, audio_filename, state, audio_status, created_at, updated_at
         FROM recordings ORDER BY created_at DESC"
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Recording {
            id: row.get(0)?,
            title: row.get(1)?,
            meeting_date: row.get(2)?,
            audio_path: row.get(3)?,
            audio_filename: row.get(4)?,
            state: row.get(5)?,
            audio_status: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        })
    })?;
    rows.collect()
}

pub fn update_recording_state(conn: &Connection, id: i64, state: &str) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE recordings SET state = ?1, updated_at = ?2 WHERE id = ?3",
        params![state, now, id],
    )?;
    Ok(())
}

pub fn update_recording_audio_status(conn: &Connection, id: i64, audio_status: &str) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE recordings SET audio_status = ?1, updated_at = ?2 WHERE id = ?3",
        params![audio_status, now, id],
    )?;
    Ok(())
}

pub fn delete_recording(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM recordings WHERE id = ?1", params![id])?;
    Ok(())
}

// ─── Transcripts CRUD ────────────────────────────────────────────────────────

pub fn upsert_transcript(
    conn: &Connection,
    recording_id: i64,
    text_raw: Option<&str>,
    segments_json: Option<&str>,
    language: Option<&str>,
) -> Result<Transcript> {
    let now = Utc::now().to_rfc3339();
    // 既存チェック
    let existing: Option<i64> = conn.query_row(
        "SELECT id FROM transcripts WHERE recording_id = ?1",
        params![recording_id],
        |row| row.get(0),
    ).ok();

    if let Some(existing_id) = existing {
        conn.execute(
            "UPDATE transcripts SET text_raw = ?1, segments_json = ?2, language = ?3, updated_at = ?4 WHERE id = ?5",
            params![text_raw, segments_json, language, now, existing_id],
        )?;
        get_transcript(conn, recording_id)
    } else {
        conn.execute(
            "INSERT INTO transcripts (recording_id, text_raw, segments_json, language, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![recording_id, text_raw, segments_json, language, now, now],
        )?;
        get_transcript(conn, recording_id)
    }
}

pub fn save_transcript_edited(conn: &Connection, recording_id: i64, text_edited: &str) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE transcripts SET text_edited = ?1, updated_at = ?2 WHERE recording_id = ?3",
        params![text_edited, now, recording_id],
    )?;
    Ok(())
}

pub fn get_transcript(conn: &Connection, recording_id: i64) -> Result<Transcript> {
    conn.query_row(
        "SELECT id, recording_id, text_raw, text_edited, segments_json, language, created_at, updated_at
         FROM transcripts WHERE recording_id = ?1",
        params![recording_id],
        |row| Ok(Transcript {
            id: row.get(0)?,
            recording_id: row.get(1)?,
            text_raw: row.get(2)?,
            text_edited: row.get(3)?,
            segments_json: row.get(4)?,
            language: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        }),
    )
}

// ─── Summaries CRUD ──────────────────────────────────────────────────────────

pub fn upsert_summary(conn: &Connection, recording_id: i64, content_md: &str) -> Result<Summary> {
    let now = Utc::now().to_rfc3339();
    let existing: Option<i64> = conn.query_row(
        "SELECT id FROM summaries WHERE recording_id = ?1",
        params![recording_id],
        |row| row.get(0),
    ).ok();

    if let Some(existing_id) = existing {
        conn.execute(
            "UPDATE summaries SET content_md = ?1, updated_at = ?2 WHERE id = ?3",
            params![content_md, now, existing_id],
        )?;
    } else {
        conn.execute(
            "INSERT INTO summaries (recording_id, template_name, content_md, created_at, updated_at)
             VALUES (?1, 'general', ?2, ?3, ?4)",
            params![recording_id, content_md, now, now],
        )?;
    }
    get_summary(conn, recording_id)
}

pub fn get_summary(conn: &Connection, recording_id: i64) -> Result<Summary> {
    conn.query_row(
        "SELECT id, recording_id, template_name, content_md, created_at, updated_at
         FROM summaries WHERE recording_id = ?1",
        params![recording_id],
        |row| Ok(Summary {
            id: row.get(0)?,
            recording_id: row.get(1)?,
            template_name: row.get(2)?,
            content_md: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
        }),
    )
}

pub fn delete_summary(conn: &Connection, recording_id: i64) -> Result<()> {
    conn.execute("DELETE FROM summaries WHERE recording_id = ?1", params![recording_id])?;
    Ok(())
}

// ─── Jobs CRUD ───────────────────────────────────────────────────────────────

pub fn create_job(conn: &Connection, recording_id: i64, job_type: &str) -> Result<Job> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO jobs (recording_id, job_type, status, created_at, updated_at)
         VALUES (?1, ?2, 'pending', ?3, ?4)",
        params![recording_id, job_type, now, now],
    )?;
    let id = conn.last_insert_rowid();
    get_job(conn, id)
}

pub fn get_job(conn: &Connection, id: i64) -> Result<Job> {
    conn.query_row(
        "SELECT id, recording_id, job_type, status, log, created_at, updated_at
         FROM jobs WHERE id = ?1",
        params![id],
        |row| Ok(Job {
            id: row.get(0)?,
            recording_id: row.get(1)?,
            job_type: row.get(2)?,
            status: row.get(3)?,
            log: row.get(4)?,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        }),
    )
}

pub fn get_latest_job(conn: &Connection, recording_id: i64, job_type: &str) -> Result<Job> {
    conn.query_row(
        "SELECT id, recording_id, job_type, status, log, created_at, updated_at
         FROM jobs WHERE recording_id = ?1 AND job_type = ?2
         ORDER BY created_at DESC LIMIT 1",
        params![recording_id, job_type],
        |row| Ok(Job {
            id: row.get(0)?,
            recording_id: row.get(1)?,
            job_type: row.get(2)?,
            status: row.get(3)?,
            log: row.get(4)?,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        }),
    )
}

pub fn update_job_status(conn: &Connection, id: i64, status: &str, log: Option<&str>) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE jobs SET status = ?1, log = ?2, updated_at = ?3 WHERE id = ?4",
        params![status, log, now, id],
    )?;
    Ok(())
}
