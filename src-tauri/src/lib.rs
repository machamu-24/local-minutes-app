mod runtime_assets;

use std::{
    io::{BufRead, BufReader, Read},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

use crate::runtime_assets::{
    bundled_sidecar_available, configured_llm_model_alias, installed_backend_path,
    installed_llama_server_path, installed_model_path, prepare_runtime_assets, runtime_paths,
    runtime_setup_status, PrepareRuntimeAssetsRequest, RuntimeSetupStatus, BACKEND_SIDECAR_NAME,
    LLAMA_SIDECAR_NAME,
};

const BACKEND_HOST: &str = "127.0.0.1";
const BACKEND_PORT: &str = "8000";
const LLAMA_HOST: &str = "127.0.0.1";
const LLAMA_PORT: &str = "8080";
const DEFAULT_LLAMA_CONTEXT_SIZE: &str = "8192";
const RUNTIME_EVENT_NAME: &str = "runtime://sidecar-status";
const RUNTIME_OUTPUT_EVENT_NAME: &str = "runtime://sidecar-output";

#[derive(Clone, Copy)]
enum ManagedSidecar {
    Backend,
    Llm,
}

impl ManagedSidecar {
    fn name(self) -> &'static str {
        match self {
            Self::Backend => BACKEND_SIDECAR_NAME,
            Self::Llm => LLAMA_SIDECAR_NAME,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Backend => "backend",
            Self::Llm => "llm",
        }
    }
}

enum ManagedProcess {
    Sidecar(CommandChild),
    Native(Arc<Mutex<Child>>),
}

struct ManagedChild {
    pid: u32,
    process: ManagedProcess,
}

impl ManagedChild {
    fn kill(self) -> Result<(), String> {
        match self.process {
            ManagedProcess::Sidecar(child) => child
                .kill()
                .map_err(|err| format!("failed to stop sidecar {}: {err}", self.pid)),
            ManagedProcess::Native(child) => child
                .lock()
                .map_err(|_| format!("native process state poisoned for {}", self.pid))?
                .kill()
                .map_err(|err| format!("failed to stop native process {}: {err}", self.pid)),
        }
    }
}

#[derive(Default)]
struct RuntimeSidecarState {
    children: Mutex<RuntimeSidecarChildren>,
}

#[derive(Default)]
struct RuntimeSidecarChildren {
    backend: Option<ManagedChild>,
    llm: Option<ManagedChild>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeStatusPayload {
    managed_runtime_enabled: bool,
    runtime_ready: bool,
    bundled_backend_available: bool,
    bundled_llm_available: bool,
    backend_running: bool,
    backend_pid: Option<u32>,
    llm_running: bool,
    llm_pid: Option<u32>,
    llm_base_url: String,
    llm_model: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SidecarEventPayload {
    sidecar: String,
    status: String,
    pid: Option<u32>,
    detail: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SidecarOutputPayload {
    sidecar: String,
    stream: String,
    line: String,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(RuntimeSidecarState::default())
        .invoke_handler(tauri::generate_handler![
            get_runtime_status,
            get_runtime_setup_status_command,
            prepare_runtime_assets_command,
            restart_managed_runtime_command
        ]);

    if cfg!(debug_assertions) {
        builder = builder.plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        );
    }

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    if should_manage_sidecars() {
        if let Err(err) = start_managed_sidecars(&app.handle().clone()) {
            log::error!("managed runtime startup failed: {err}");
        }
    } else {
        log::info!(
            "managed runtime is disabled in this mode; set LOCAL_MINUTES_TAURI_MANAGED_RUNTIME=1 to enable it during development"
        );
    }

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            stop_managed_sidecars(app_handle);
        }
    });
}

#[tauri::command]
fn get_runtime_status(
    app: AppHandle,
    state: State<'_, RuntimeSidecarState>,
) -> RuntimeStatusPayload {
    build_runtime_status_payload(&app, &state)
}

#[tauri::command]
fn get_runtime_setup_status_command(
    app: AppHandle,
) -> Result<runtime_assets::RuntimeSetupStatus, String> {
    runtime_setup_status(&app)
}

#[tauri::command]
async fn prepare_runtime_assets_command(
    app: AppHandle,
    request: PrepareRuntimeAssetsRequest,
) -> Result<runtime_assets::RuntimeSetupStatus, String> {
    prepare_runtime_assets(app, request).await
}

#[tauri::command]
fn restart_managed_runtime_command(
    app: AppHandle,
    state: State<'_, RuntimeSidecarState>,
) -> Result<RuntimeStatusPayload, String> {
    stop_managed_sidecars(&app);

    if should_manage_sidecars() {
        start_managed_sidecars(&app)?;
    }

    Ok(build_runtime_status_payload(&app, &state))
}

fn should_manage_sidecars() -> bool {
    if let Some(value) = bool_env("LOCAL_MINUTES_TAURI_MANAGED_RUNTIME") {
        return value;
    }

    !cfg!(debug_assertions)
}

fn bool_env(name: &str) -> Option<bool> {
    let value = std::env::var(name).ok()?;
    match value.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Some(true),
        "0" | "false" | "no" | "off" => Some(false),
        _ => None,
    }
}

fn env_or_default(name: &str, default: &str) -> String {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| default.to_string())
}

fn llm_base_url() -> String {
    env_or_default(
        "LOCAL_MINUTES_LLM_BASE_URL",
        &format!("http://{LLAMA_HOST}:{LLAMA_PORT}/v1"),
    )
}

fn build_runtime_status_payload(
    app: &AppHandle,
    state: &State<'_, RuntimeSidecarState>,
) -> RuntimeStatusPayload {
    let children = state
        .children
        .lock()
        .expect("runtime sidecar state poisoned");
    let setup_status = runtime_setup_status(app).ok();
    let bundled_backend = bundled_sidecar_available(app, BACKEND_SIDECAR_NAME);
    let bundled_llm = bundled_sidecar_available(app, LLAMA_SIDECAR_NAME);
    let runtime_ready = setup_status
        .as_ref()
        .map(|status| runtime_ready_for_app(app, status))
        .unwrap_or(false);

    RuntimeStatusPayload {
        managed_runtime_enabled: should_manage_sidecars(),
        runtime_ready,
        bundled_backend_available: bundled_backend,
        bundled_llm_available: bundled_llm,
        backend_running: children.backend.is_some(),
        backend_pid: children.backend.as_ref().map(|child| child.pid),
        llm_running: children.llm.is_some(),
        llm_pid: children.llm.as_ref().map(|child| child.pid),
        llm_base_url: llm_base_url(),
        llm_model: configured_llm_model_alias(),
    }
}

fn runtime_ready_for_app(app: &AppHandle, status: &RuntimeSetupStatus) -> bool {
    status.llm_model_installed
        && (status.backend_binary_installed || bundled_sidecar_available(app, BACKEND_SIDECAR_NAME))
        && (status.llama_server_binary_installed || bundled_sidecar_available(app, LLAMA_SIDECAR_NAME))
}

fn start_managed_sidecars(app: &AppHandle) -> Result<(), String> {
    let mut errors = Vec::new();

    if let Err(err) = spawn_llama_runtime(app) {
        errors.push(format!("llama-server: {err}"));
    }

    if let Err(err) = spawn_backend_runtime(app) {
        errors.push(format!("backend: {err}"));
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join(" | "))
    }
}

fn spawn_llama_runtime(app: &AppHandle) -> Result<(), String> {
    if sidecar_running(app, ManagedSidecar::Llm) {
        return Ok(());
    }

    if let Some(llama_server_path) = installed_llama_server_path(app)? {
        if let Some(model_path) = installed_model_path(app)? {
            return spawn_native_llama_process(app, llama_server_path, model_path);
        }
    }

    spawn_llama_sidecar_fallback(app)
}

fn spawn_backend_runtime(app: &AppHandle) -> Result<(), String> {
    if sidecar_running(app, ManagedSidecar::Backend) {
        return Ok(());
    }

    if let Some(backend_path) = installed_backend_path(app)? {
        return spawn_native_backend_process(app, backend_path);
    }

    spawn_backend_sidecar_fallback(app)
}

fn spawn_native_llama_process(
    app: &AppHandle,
    executable_path: std::path::PathBuf,
    model_path: std::path::PathBuf,
) -> Result<(), String> {
    let model_alias = configured_llm_model_alias();
    let context_size = env_or_default(
        "LOCAL_MINUTES_LLAMA_CONTEXT_SIZE",
        DEFAULT_LLAMA_CONTEXT_SIZE,
    );

    let args = vec![
        "--host".to_string(),
        LLAMA_HOST.to_string(),
        "--port".to_string(),
        LLAMA_PORT.to_string(),
        "--alias".to_string(),
        model_alias,
        "-m".to_string(),
        model_path.to_string_lossy().to_string(),
        "-c".to_string(),
        context_size,
    ];

    spawn_native_process(app, ManagedSidecar::Llm, executable_path, &args, &[])
}

fn spawn_native_backend_process(
    app: &AppHandle,
    executable_path: std::path::PathBuf,
) -> Result<(), String> {
    let envs = backend_environment(app)?;

    spawn_native_process(app, ManagedSidecar::Backend, executable_path, &[], &envs)
}

fn spawn_native_process(
    app: &AppHandle,
    sidecar: ManagedSidecar,
    executable_path: std::path::PathBuf,
    args: &[String],
    envs: &[(String, String)],
) -> Result<(), String> {
    let mut command = Command::new(&executable_path);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .args(args);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    for (key, value) in envs {
        command.env(key, value);
    }

    let mut child = command.spawn().map_err(|err| {
        format!(
            "failed to spawn native {} process {}: {err}",
            sidecar.name(),
            executable_path.display()
        )
    })?;
    let pid = child.id();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let child = Arc::new(Mutex::new(child));

    store_sidecar_child(app, sidecar, pid, ManagedProcess::Native(child.clone()));
    emit_sidecar_event(
        app,
        sidecar,
        "started",
        Some(pid),
        Some(format!("native process {}", executable_path.display())),
    );

    if let Some(stdout) = stdout {
        spawn_output_reader_thread(app.clone(), sidecar, stdout, false);
    }
    if let Some(stderr) = stderr {
        spawn_output_reader_thread(app.clone(), sidecar, stderr, true);
    }
    spawn_native_wait_thread(app.clone(), sidecar, pid, child);

    Ok(())
}

fn spawn_output_reader_thread<R>(
    app: AppHandle,
    sidecar: ManagedSidecar,
    reader: R,
    stderr: bool,
) where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let prefix = if stderr { "stderr" } else { "stdout" };
        let buffered = BufReader::new(reader);
        for line in buffered.lines() {
            match line {
                Ok(line) if !line.trim().is_empty() => {
                    if stderr {
                        log::warn!("{} {}: {}", sidecar.name(), prefix, line);
                    } else {
                        log::info!("{} {}: {}", sidecar.name(), prefix, line);
                    }
                    emit_sidecar_output(&app, sidecar, prefix, &line);
                }
                Ok(_) => {}
                Err(err) => {
                    log::debug!("{} {} read failed: {err}", sidecar.name(), prefix);
                    break;
                }
            }
        }
    });
}

fn spawn_native_wait_thread(
    app: AppHandle,
    sidecar: ManagedSidecar,
    pid: u32,
    child: Arc<Mutex<Child>>,
) {
    thread::spawn(move || loop {
        let result = {
            let mut child = match child.lock() {
                Ok(child) => child,
                Err(_) => {
                    emit_sidecar_event(
                        &app,
                        sidecar,
                        "error",
                        Some(pid),
                        Some("native child state poisoned".to_string()),
                    );
                    clear_sidecar_child(&app, sidecar, pid);
                    return;
                }
            };

            child
                .try_wait()
                .map_err(|err| err.to_string())
                .map(|status| status.map(|status| status.to_string()))
        };

        match result {
            Ok(Some(status)) => {
                clear_sidecar_child(&app, sidecar, pid);
                emit_sidecar_event(&app, sidecar, "stopped", Some(pid), Some(status));
                return;
            }
            Ok(None) => thread::sleep(Duration::from_secs(1)),
            Err(err) => {
                clear_sidecar_child(&app, sidecar, pid);
                emit_sidecar_event(&app, sidecar, "error", Some(pid), Some(err));
                return;
            }
        }
    });
}

fn spawn_llama_sidecar_fallback(app: &AppHandle) -> Result<(), String> {
    let model_path = resolve_llama_model_path(app).ok().flatten();
    let model_path = match model_path {
        Some(value) => value.to_string_lossy().to_string(),
        None => {
            let detail = "no GGUF model is installed yet; skipping llama-server startup".to_string();
            log::warn!("{detail}");
            emit_sidecar_event(app, ManagedSidecar::Llm, "skipped", None, Some(detail));
            return Ok(());
        }
    };

    let model_alias = configured_llm_model_alias();
    let context_size = env_or_default(
        "LOCAL_MINUTES_LLAMA_CONTEXT_SIZE",
        DEFAULT_LLAMA_CONTEXT_SIZE,
    );

    let command = app
        .shell()
        .sidecar(LLAMA_SIDECAR_NAME)
        .map_err(|err| format!("failed to resolve sidecar: {err}"))?
        .args([
            "--host",
            LLAMA_HOST,
            "--port",
            LLAMA_PORT,
            "--alias",
            &model_alias,
            "-m",
            &model_path,
            "-c",
            &context_size,
        ]);

    let (mut rx, child) = command
        .spawn()
        .map_err(|err| format!("failed to spawn sidecar: {err}"))?;
    let pid = child.pid();

    store_sidecar_child(
        app,
        ManagedSidecar::Llm,
        pid,
        ManagedProcess::Sidecar(child),
    );
    emit_sidecar_event(app, ManagedSidecar::Llm, "started", Some(pid), None);

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let text = String::from_utf8_lossy(&line).trim_end().to_string();
                    if !text.is_empty() {
                        log::info!("llama-server stdout: {}", text);
                        emit_sidecar_output(&app_handle, ManagedSidecar::Llm, "stdout", &text);
                    }
                }
                CommandEvent::Stderr(line) => {
                    let text = String::from_utf8_lossy(&line).trim_end().to_string();
                    if !text.is_empty() {
                        log::warn!("llama-server stderr: {}", text);
                        emit_sidecar_output(&app_handle, ManagedSidecar::Llm, "stderr", &text);
                    }
                }
                CommandEvent::Error(error) => {
                    log::error!("llama-server error: {error}");
                    emit_sidecar_event(
                        &app_handle,
                        ManagedSidecar::Llm,
                        "error",
                        Some(pid),
                        Some(error),
                    );
                }
                CommandEvent::Terminated(payload) => {
                    clear_sidecar_child(&app_handle, ManagedSidecar::Llm, pid);
                    emit_sidecar_event(
                        &app_handle,
                        ManagedSidecar::Llm,
                        "stopped",
                        Some(pid),
                        Some(format!(
                            "code={:?}, signal={:?}",
                            payload.code, payload.signal
                        )),
                    );
                }
                _ => {}
            }
        }
    });

    Ok(())
}

fn spawn_backend_sidecar_fallback(app: &AppHandle) -> Result<(), String> {
    let mut command = app
        .shell()
        .sidecar(BACKEND_SIDECAR_NAME)
        .map_err(|err| format!("failed to resolve sidecar: {err}"))?;

    for (key, value) in backend_environment(app)? {
        command = command.env(key, value);
    }

    let (mut rx, child) = command
        .spawn()
        .map_err(|err| format!("failed to spawn sidecar: {err}"))?;
    let pid = child.pid();

    store_sidecar_child(
        app,
        ManagedSidecar::Backend,
        pid,
        ManagedProcess::Sidecar(child),
    );
    emit_sidecar_event(app, ManagedSidecar::Backend, "started", Some(pid), None);

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let text = String::from_utf8_lossy(&line).trim_end().to_string();
                    if !text.is_empty() {
                        log::info!("backend stdout: {}", text);
                        emit_sidecar_output(&app_handle, ManagedSidecar::Backend, "stdout", &text);
                    }
                }
                CommandEvent::Stderr(line) => {
                    let text = String::from_utf8_lossy(&line).trim_end().to_string();
                    if !text.is_empty() {
                        log::warn!("backend stderr: {}", text);
                        emit_sidecar_output(&app_handle, ManagedSidecar::Backend, "stderr", &text);
                    }
                }
                CommandEvent::Error(error) => {
                    log::error!("backend error: {error}");
                    emit_sidecar_event(
                        &app_handle,
                        ManagedSidecar::Backend,
                        "error",
                        Some(pid),
                        Some(error),
                    );
                }
                CommandEvent::Terminated(payload) => {
                    clear_sidecar_child(&app_handle, ManagedSidecar::Backend, pid);
                    emit_sidecar_event(
                        &app_handle,
                        ManagedSidecar::Backend,
                        "stopped",
                        Some(pid),
                        Some(format!(
                            "code={:?}, signal={:?}",
                            payload.code, payload.signal
                        )),
                    );
                }
                _ => {}
            }
        }
    });

    Ok(())
}

fn stop_managed_sidecars(app: &AppHandle) {
    let state = app.state::<RuntimeSidecarState>();
    let mut children = state
        .children
        .lock()
        .expect("runtime sidecar state poisoned");

    if let Some(managed) = children.backend.take() {
        if let Err(err) = managed.kill() {
            log::warn!("{err}");
        }
    }

    if let Some(managed) = children.llm.take() {
        if let Err(err) = managed.kill() {
            log::warn!("{err}");
        }
    }
}

fn resolve_llama_model_path(app: &AppHandle) -> Result<Option<std::path::PathBuf>, String> {
    if let Some(model_path) = installed_model_path(app)? {
        return Ok(Some(model_path));
    }

    Ok(std::env::var("LOCAL_MINUTES_LLAMA_MODEL_PATH")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(std::path::PathBuf::from))
}

fn backend_environment(app: &AppHandle) -> Result<Vec<(String, String)>, String> {
    let app_data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|err| format!("failed to resolve app local data dir: {err}"))?;
    std::fs::create_dir_all(&app_data_dir).map_err(|err| {
        format!(
            "failed to create app local data directory {}: {err}",
            app_data_dir.display()
        )
    })?;

    let audio_dir = app_data_dir.join("audio");
    let whisper_models_dir = app_data_dir.join("models").join("whisper");
    let runtime_paths = runtime_paths(app)?;
    std::fs::create_dir_all(&audio_dir)
        .map_err(|err| format!("failed to create audio directory {}: {err}", audio_dir.display()))?;
    std::fs::create_dir_all(&whisper_models_dir).map_err(|err| {
        format!(
            "failed to create whisper models directory {}: {err}",
            whisper_models_dir.display()
        )
    })?;

    Ok(vec![
        (
            "LOCAL_MINUTES_LLM_PROVIDER".to_string(),
            "openai_compatible".to_string(),
        ),
        ("LOCAL_MINUTES_LLM_BASE_URL".to_string(), llm_base_url()),
        (
            "LOCAL_MINUTES_LLM_MODEL".to_string(),
            configured_llm_model_alias(),
        ),
        (
            "LOCAL_MINUTES_API_HOST".to_string(),
            env_or_default("LOCAL_MINUTES_API_HOST", BACKEND_HOST),
        ),
        (
            "LOCAL_MINUTES_API_PORT".to_string(),
            env_or_default("LOCAL_MINUTES_API_PORT", BACKEND_PORT),
        ),
        (
            "LOCAL_MINUTES_APP_DATA_DIR".to_string(),
            app_data_dir.to_string_lossy().to_string(),
        ),
        (
            "LOCAL_MINUTES_AUDIO_DIR".to_string(),
            audio_dir.to_string_lossy().to_string(),
        ),
        (
            "LOCAL_MINUTES_WHISPER_MODELS_DIR".to_string(),
            whisper_models_dir.to_string_lossy().to_string(),
        ),
        (
            "LOCAL_MINUTES_RUNTIME_BIN_DIR".to_string(),
            runtime_paths.bin_dir.to_string_lossy().to_string(),
        ),
    ])
}

fn sidecar_running(app: &AppHandle, sidecar: ManagedSidecar) -> bool {
    let state = app.state::<RuntimeSidecarState>();
    let children = state
        .children
        .lock()
        .expect("runtime sidecar state poisoned");
    match sidecar {
        ManagedSidecar::Backend => children.backend.is_some(),
        ManagedSidecar::Llm => children.llm.is_some(),
    }
}

fn store_sidecar_child(
    app: &AppHandle,
    sidecar: ManagedSidecar,
    pid: u32,
    process: ManagedProcess,
) {
    let state = app.state::<RuntimeSidecarState>();
    let mut children = state
        .children
        .lock()
        .expect("runtime sidecar state poisoned");
    let managed = ManagedChild { pid, process };

    match sidecar {
        ManagedSidecar::Backend => children.backend = Some(managed),
        ManagedSidecar::Llm => children.llm = Some(managed),
    }
}

fn clear_sidecar_child(app: &AppHandle, sidecar: ManagedSidecar, pid: u32) {
    let state = app.state::<RuntimeSidecarState>();
    let mut children = state
        .children
        .lock()
        .expect("runtime sidecar state poisoned");

    let slot = match sidecar {
        ManagedSidecar::Backend => &mut children.backend,
        ManagedSidecar::Llm => &mut children.llm,
    };

    if slot.as_ref().is_some_and(|managed| managed.pid == pid) {
        slot.take();
    }
}

fn emit_sidecar_event(
    app: &AppHandle,
    sidecar: ManagedSidecar,
    status: &str,
    pid: Option<u32>,
    detail: Option<String>,
) {
    let payload = SidecarEventPayload {
        sidecar: sidecar.label().to_string(),
        status: status.to_string(),
        pid,
        detail,
    };

    if let Err(err) = app.emit(RUNTIME_EVENT_NAME, payload) {
        log::debug!(
            "failed to emit runtime sidecar event for {}: {err}",
            sidecar.name()
        );
    }
}

fn emit_sidecar_output(
    app: &AppHandle,
    sidecar: ManagedSidecar,
    stream: &str,
    line: &str,
) {
    let payload = SidecarOutputPayload {
        sidecar: sidecar.label().to_string(),
        stream: stream.to_string(),
        line: line.to_string(),
    };

    if let Err(err) = app.emit(RUNTIME_OUTPUT_EVENT_NAME, payload) {
        log::debug!(
            "failed to emit sidecar output event for {}: {err}",
            sidecar.name()
        );
    }
}
