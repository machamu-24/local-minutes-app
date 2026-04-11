use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};

use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::ShellExt;

pub const SETUP_PROGRESS_EVENT_NAME: &str = "runtime://setup-progress";
pub const DEFAULT_LLM_MODEL_ALIAS: &str = "qwen3-4b";
pub const BACKEND_SIDECAR_NAME: &str = "local-minutes-backend";
pub const LLAMA_SIDECAR_NAME: &str = "llama-server";

const DEFAULT_MODEL_FILENAME: &str = "Qwen3-4B-Q4_K_M.gguf";
const DEFAULT_MODEL_URL: &str =
    "https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf";
const RUNTIME_ROOT_DIR_NAME: &str = "runtime";
const RUNTIME_BIN_DIR_NAME: &str = "bin";
const RUNTIME_MODEL_DIR_NAME: &str = "models";
const RUNTIME_DOWNLOAD_DIR_NAME: &str = "downloads";
const RUNTIME_CONFIG_FILE_NAME: &str = "runtime-config.json";
const DEFAULT_DOWNLOAD_CHUNK_SIZE: usize = 1024 * 1024;
const DEFAULT_PROGRESS_EMIT_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Clone, Debug)]
pub struct RuntimePaths {
    pub root_dir: PathBuf,
    pub bin_dir: PathBuf,
    pub model_dir: PathBuf,
    pub download_dir: PathBuf,
    pub config_path: PathBuf,
    pub backend_binary_path: PathBuf,
    pub llama_server_binary_path: PathBuf,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeConfig {
    backend_source: Option<String>,
    llama_server_source: Option<String>,
    llm_model_url: Option<String>,
    llm_model_filename: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareRuntimeAssetsRequest {
    pub backend_source: Option<String>,
    pub llama_server_source: Option<String>,
    pub llm_model_url: Option<String>,
    pub llm_model_filename: Option<String>,
    pub force_redownload: Option<bool>,
    pub force_replace_binaries: Option<bool>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSetupStatus {
    pub runtime_root_dir: String,
    pub runtime_bin_dir: String,
    pub runtime_model_dir: String,
    pub runtime_download_dir: String,
    pub runtime_config_path: String,
    pub backend_binary_path: String,
    pub backend_binary_installed: bool,
    pub backend_source: Option<String>,
    pub llama_server_binary_path: String,
    pub llama_server_binary_installed: bool,
    pub llama_server_source: Option<String>,
    pub llm_model_path: String,
    pub llm_model_filename: String,
    pub llm_model_installed: bool,
    pub llm_model_url: String,
    pub llm_model_alias: String,
    pub ready_for_managed_runtime: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SetupProgressPayload {
    asset: String,
    stage: String,
    status: String,
    message: String,
    source: Option<String>,
    destination_path: String,
    downloaded_bytes: Option<u64>,
    total_bytes: Option<u64>,
}

pub fn configured_llm_model_alias() -> String {
    env_or_default("LOCAL_MINUTES_LLM_MODEL", DEFAULT_LLM_MODEL_ALIAS)
}

pub fn bundled_sidecar_available(app: &AppHandle, sidecar_name: &str) -> bool {
    if cfg!(debug_assertions) {
        return false;
    }

    app.shell().sidecar(sidecar_name).is_ok()
}

/// バンドルされたサイドカーバイナリ（インストールディレクトリ）のパスを返す。
/// Tauri v2 の externalBin はインストールルートに `{name}.exe` として配置される。
pub fn bundled_sidecar_path(app: &AppHandle, sidecar_name: &str) -> Option<PathBuf> {
    if cfg!(debug_assertions) {
        return None;
    }

    // Tauri v2 の resource_dir() はインストールディレクトリの `resources/` を返す。
    // externalBin バイナリはインストールルート（resource_dir の親）に配置される。
    let install_dir = app
        .path()
        .resource_dir()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))?;

    let binary_name = executable_file_name(sidecar_name);
    let path = install_dir.join(&binary_name);
    if path.exists() {
        Some(path)
    } else {
        None
    }
}

/// バンドルされたバイナリを runtime/bin ディレクトリに強制コピーする。
/// 旧バージョンの残留バイナリを確実に最新版で上書きするために使用する。
pub fn sync_bundled_binaries_to_runtime(app: &AppHandle) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Ok(());
    }

    let paths = runtime_paths(app)?;
    ensure_runtime_dirs(&paths)?;

    for (sidecar_name, dest_path) in [
        (BACKEND_SIDECAR_NAME, &paths.backend_binary_path),
        (LLAMA_SIDECAR_NAME, &paths.llama_server_binary_path),
    ] {
        if let Some(src_path) = bundled_sidecar_path(app, sidecar_name) {
            // 既存ファイルを削除してから新しいバイナリをコピーする
            if dest_path.exists() {
                fs::remove_file(dest_path).map_err(|err| {
                    format!(
                        "failed to remove stale binary {}: {err}",
                        dest_path.display()
                    )
                })?;
            }
            fs::copy(&src_path, dest_path).map_err(|err| {
                format!(
                    "failed to copy bundled binary {} -> {}: {err}",
                    src_path.display(),
                    dest_path.display()
                )
            })?;
            finalize_asset_permissions(dest_path, true)?;
            log::info!(
                "synced bundled binary {} -> {}",
                src_path.display(),
                dest_path.display()
            );
        } else {
            log::debug!(
                "bundled binary for {} not found in install directory; skipping sync",
                sidecar_name
            );
        }
    }

    Ok(())
}

pub fn runtime_paths(app: &AppHandle) -> Result<RuntimePaths, String> {
    let root_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|err| format!("failed to resolve app local data dir: {err}"))?
        .join(RUNTIME_ROOT_DIR_NAME);
    let bin_dir = root_dir.join(RUNTIME_BIN_DIR_NAME);
    let model_dir = root_dir.join(RUNTIME_MODEL_DIR_NAME);
    let download_dir = root_dir.join(RUNTIME_DOWNLOAD_DIR_NAME);

    Ok(RuntimePaths {
        config_path: root_dir.join(RUNTIME_CONFIG_FILE_NAME),
        backend_binary_path: bin_dir.join(executable_file_name("local-minutes-backend")),
        llama_server_binary_path: bin_dir.join(executable_file_name("llama-server")),
        root_dir,
        bin_dir,
        model_dir,
        download_dir,
    })
}

pub fn runtime_setup_status(app: &AppHandle) -> Result<RuntimeSetupStatus, String> {
    let paths = runtime_paths(app)?;
    let config = read_runtime_config(&paths.config_path)?;
    let llm_model_filename = configured_model_filename(&config);
    let llm_model_url = configured_model_url(&config);
    let llm_model_path = paths.model_dir.join(&llm_model_filename);

    let backend_installed = paths.backend_binary_path.exists();
    let llama_server_installed = paths.llama_server_binary_path.exists();
    let llm_model_installed = llm_model_path.exists();

    Ok(RuntimeSetupStatus {
        runtime_root_dir: path_to_string(&paths.root_dir),
        runtime_bin_dir: path_to_string(&paths.bin_dir),
        runtime_model_dir: path_to_string(&paths.model_dir),
        runtime_download_dir: path_to_string(&paths.download_dir),
        runtime_config_path: path_to_string(&paths.config_path),
        backend_binary_path: path_to_string(&paths.backend_binary_path),
        backend_binary_installed: backend_installed,
        backend_source: config.backend_source,
        llama_server_binary_path: path_to_string(&paths.llama_server_binary_path),
        llama_server_binary_installed: llama_server_installed,
        llama_server_source: config.llama_server_source,
        llm_model_path: path_to_string(&llm_model_path),
        llm_model_filename,
        llm_model_installed,
        llm_model_url,
        llm_model_alias: configured_llm_model_alias(),
        ready_for_managed_runtime: llm_model_installed
            && (backend_installed || bundled_sidecar_available(app, BACKEND_SIDECAR_NAME))
            && (llama_server_installed || bundled_sidecar_available(app, LLAMA_SIDECAR_NAME)),
    })
}

pub fn installed_backend_path(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    let status = runtime_setup_status(app)?;
    if status.backend_binary_installed {
        Ok(Some(PathBuf::from(status.backend_binary_path)))
    } else {
        Ok(None)
    }
}

pub fn installed_llama_server_path(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    let status = runtime_setup_status(app)?;
    if status.llama_server_binary_installed {
        Ok(Some(PathBuf::from(status.llama_server_binary_path)))
    } else {
        Ok(None)
    }
}

pub fn installed_model_path(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    let status = runtime_setup_status(app)?;
    if status.llm_model_installed {
        Ok(Some(PathBuf::from(status.llm_model_path)))
    } else {
        Ok(None)
    }
}

pub fn external_backend_source_configured(app: &AppHandle) -> Result<bool, String> {
    let paths = runtime_paths(app)?;
    let config = read_runtime_config(&paths.config_path)?;
    Ok(resolve_source(None, config.backend_source, "LOCAL_MINUTES_BACKEND_SOURCE").is_some())
}

pub fn external_llama_server_source_configured(app: &AppHandle) -> Result<bool, String> {
    let paths = runtime_paths(app)?;
    let config = read_runtime_config(&paths.config_path)?;
    Ok(resolve_source(None, config.llama_server_source, "LOCAL_MINUTES_LLAMA_SERVER_SOURCE").is_some())
}

pub async fn prepare_runtime_assets(
    app: AppHandle,
    request: PrepareRuntimeAssetsRequest,
) -> Result<RuntimeSetupStatus, String> {
    let worker_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        prepare_runtime_assets_blocking(&worker_app, request)
    })
    .await
    .map_err(|err| format!("runtime asset preparation task failed: {err}"))??;

    runtime_setup_status(&app)
}

fn prepare_runtime_assets_blocking(
    app: &AppHandle,
    request: PrepareRuntimeAssetsRequest,
) -> Result<(), String> {
    let paths = runtime_paths(app)?;
    ensure_runtime_dirs(&paths)?;

    let mut config = read_runtime_config(&paths.config_path)?;
    let force_replace_binaries = request.force_replace_binaries.unwrap_or(false);
    let force_redownload = request.force_redownload.unwrap_or(false);

    let clear_llama_server_source = request
        .llama_server_source
        .as_deref()
        .is_some_and(|value| value.trim().is_empty());
    let llama_server_source = if clear_llama_server_source {
        None
    } else {
        resolve_source(
            request.llama_server_source,
            config.llama_server_source.clone(),
            "LOCAL_MINUTES_LLAMA_SERVER_SOURCE",
        )
    };
    install_binary_if_needed(
        app,
        "llama-server",
        llama_server_source.as_deref(),
        &paths.llama_server_binary_path,
        force_replace_binaries,
        Some(LLAMA_SIDECAR_NAME),
    )?;
    config.llama_server_source = llama_server_source;

    let clear_backend_source = request
        .backend_source
        .as_deref()
        .is_some_and(|value| value.trim().is_empty());
    let backend_source = if clear_backend_source {
        None
    } else {
        resolve_source(
            request.backend_source,
            config.backend_source.clone(),
            "LOCAL_MINUTES_BACKEND_SOURCE",
        )
    };
    install_binary_if_needed(
        app,
        "backend-exe",
        backend_source.as_deref(),
        &paths.backend_binary_path,
        force_replace_binaries,
        Some(BACKEND_SIDECAR_NAME),
    )?;
    config.backend_source = backend_source;

    let llm_model_url = resolve_value(
        request.llm_model_url,
        config.llm_model_url.clone(),
        "LOCAL_MINUTES_DEFAULT_MODEL_URL",
        DEFAULT_MODEL_URL,
    );
    let llm_model_filename = sanitize_filename(
        request
            .llm_model_filename
            .or(config.llm_model_filename.clone())
            .or_else(|| std::env::var("LOCAL_MINUTES_DEFAULT_MODEL_FILENAME").ok()),
        DEFAULT_MODEL_FILENAME,
    );
    let llm_model_path = paths.model_dir.join(&llm_model_filename);

    emit_setup_progress(
        app,
        "llm-model",
        "resolve",
        "info",
        format!("preparing model destination {}", llm_model_path.display()),
        Some(llm_model_url.clone()),
        &llm_model_path,
        None,
        None,
    );
    materialize_asset(
        app,
        "llm-model",
        &llm_model_url,
        &llm_model_path,
        force_redownload,
        false,
        &paths.download_dir,
    )?;
    config.llm_model_url = Some(llm_model_url);
    config.llm_model_filename = Some(llm_model_filename);

    write_runtime_config(&paths.config_path, &config)
}

fn ensure_runtime_dirs(paths: &RuntimePaths) -> Result<(), String> {
    for dir in [
        &paths.root_dir,
        &paths.bin_dir,
        &paths.model_dir,
        &paths.download_dir,
    ] {
        fs::create_dir_all(dir).map_err(|err| {
            format!(
                "failed to create runtime directory {}: {err}",
                dir.display()
            )
        })?;
    }
    Ok(())
}

fn install_binary_if_needed(
    app: &AppHandle,
    asset_name: &str,
    source: Option<&str>,
    destination: &Path,
    force_replace: bool,
    bundled_sidecar_name: Option<&str>,
) -> Result<(), String> {
    if source.is_none()
        && bundled_sidecar_name
            .filter(|name| bundled_sidecar_available(app, name))
            .is_some()
    {
        emit_setup_progress(
            app,
            asset_name,
            "install",
            "skipped",
            format!("{asset_name} will use the bundled sidecar binary"),
            None,
            destination,
            None,
            None,
        );
        return Ok(());
    }

    if destination.exists() && !force_replace {
        emit_setup_progress(
            app,
            asset_name,
            "install",
            "skipped",
            format!("{} already exists", destination.display()),
            source.map(ToString::to_string),
            destination,
            None,
            None,
        );
        return Ok(());
    }

    let source = source.ok_or_else(|| {
        format!(
            "missing source for {asset_name}. pass a source path/url or set the related environment variable"
        )
    })?;

    let download_dir = destination.parent().ok_or_else(|| {
        format!(
            "destination has no parent directory: {}",
            destination.display()
        )
    })?;
    materialize_asset(
        app,
        asset_name,
        source,
        destination,
        force_replace,
        true,
        download_dir,
    )
}

fn materialize_asset(
    app: &AppHandle,
    asset_name: &str,
    source: &str,
    destination: &Path,
    force_replace: bool,
    executable: bool,
    download_dir: &Path,
) -> Result<(), String> {
    if destination.exists() && !force_replace {
        return Ok(());
    }

    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|err| {
            format!(
                "failed to create destination directory {}: {err}",
                parent.display()
            )
        })?;
    }

    if is_http_url(source) {
        download_asset(
            app,
            asset_name,
            source,
            destination,
            force_replace,
            executable,
            download_dir,
        )
    } else {
        copy_asset(
            app,
            asset_name,
            source,
            destination,
            force_replace,
            executable,
        )
    }
}

fn copy_asset(
    app: &AppHandle,
    asset_name: &str,
    source: &str,
    destination: &Path,
    force_replace: bool,
    executable: bool,
) -> Result<(), String> {
    let source_path = PathBuf::from(source);
    if !source_path.exists() {
        return Err(format!(
            "source path does not exist: {}",
            source_path.display()
        ));
    }

    emit_setup_progress(
        app,
        asset_name,
        "copy",
        "started",
        format!(
            "copying {} -> {}",
            source_path.display(),
            destination.display()
        ),
        Some(source.to_string()),
        destination,
        None,
        None,
    );

    if destination.exists() && force_replace {
        fs::remove_file(destination)
            .map_err(|err| format!("failed to replace {}: {err}", destination.display()))?;
    }

    fs::copy(&source_path, destination).map_err(|err| {
        format!(
            "failed to copy {} -> {}: {err}",
            source_path.display(),
            destination.display()
        )
    })?;
    finalize_asset_permissions(destination, executable)?;

    emit_setup_progress(
        app,
        asset_name,
        "copy",
        "completed",
        format!(
            "copied {} -> {}",
            source_path.display(),
            destination.display()
        ),
        Some(source.to_string()),
        destination,
        None,
        None,
    );
    Ok(())
}

fn download_asset(
    app: &AppHandle,
    asset_name: &str,
    source_url: &str,
    destination: &Path,
    force_replace: bool,
    executable: bool,
    download_dir: &Path,
) -> Result<(), String> {
    fs::create_dir_all(download_dir).map_err(|err| {
        format!(
            "failed to create download directory {}: {err}",
            download_dir.display()
        )
    })?;

    let tmp_path = download_dir.join(format!(
        "{}.part",
        destination
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(asset_name)
    ));

    emit_setup_progress(
        app,
        asset_name,
        "download",
        "started",
        format!("downloading {} -> {}", source_url, destination.display()),
        Some(source_url.to_string()),
        destination,
        Some(0),
        None,
    );

    let client = Client::builder()
        .build()
        .map_err(|err| format!("failed to build HTTP client: {err}"))?;
    let mut response = client
        .get(source_url)
        .send()
        .and_then(|response| response.error_for_status())
        .map_err(|err| format!("failed to download {source_url}: {err}"))?;

    let total_bytes = response.content_length();
    let mut file = File::create(&tmp_path).map_err(|err| {
        format!(
            "failed to create temporary download {}: {err}",
            tmp_path.display()
        )
    })?;

    let mut buffer = vec![0u8; DEFAULT_DOWNLOAD_CHUNK_SIZE];
    let mut downloaded_bytes = 0_u64;
    let mut last_emitted_bytes = 0_u64;

    loop {
        let bytes_read = response
            .read(&mut buffer)
            .map_err(|err| format!("failed while downloading {source_url}: {err}"))?;
        if bytes_read == 0 {
            break;
        }

        file.write_all(&buffer[..bytes_read]).map_err(|err| {
            format!(
                "failed to write download chunk to {}: {err}",
                tmp_path.display()
            )
        })?;

        downloaded_bytes += bytes_read as u64;
        if downloaded_bytes == bytes_read as u64
            || downloaded_bytes.saturating_sub(last_emitted_bytes) >= DEFAULT_PROGRESS_EMIT_BYTES
        {
            last_emitted_bytes = downloaded_bytes;
            emit_setup_progress(
                app,
                asset_name,
                "download",
                "progress",
                format!("downloading {} bytes", downloaded_bytes),
                Some(source_url.to_string()),
                destination,
                Some(downloaded_bytes),
                total_bytes,
            );
        }
    }

    file.flush().map_err(|err| {
        format!(
            "failed to flush temporary download {}: {err}",
            tmp_path.display()
        )
    })?;

    if destination.exists() && force_replace {
        fs::remove_file(destination)
            .map_err(|err| format!("failed to replace {}: {err}", destination.display()))?;
    }

    fs::rename(&tmp_path, destination).map_err(|err| {
        format!(
            "failed to move downloaded file {} -> {}: {err}",
            tmp_path.display(),
            destination.display()
        )
    })?;
    finalize_asset_permissions(destination, executable)?;

    emit_setup_progress(
        app,
        asset_name,
        "download",
        "completed",
        format!("downloaded {} bytes", downloaded_bytes),
        Some(source_url.to_string()),
        destination,
        Some(downloaded_bytes),
        total_bytes,
    );

    Ok(())
}

fn finalize_asset_permissions(path: &Path, executable: bool) -> Result<(), String> {
    if !executable {
        return Ok(());
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let metadata = fs::metadata(path)
            .map_err(|err| format!("failed to read metadata for {}: {err}", path.display()))?;
        let mut permissions = metadata.permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).map_err(|err| {
            format!(
                "failed to set executable permissions on {}: {err}",
                path.display()
            )
        })?;
    }

    Ok(())
}

fn read_runtime_config(path: &Path) -> Result<RuntimeConfig, String> {
    if !path.exists() {
        return Ok(RuntimeConfig::default());
    }

    let contents = fs::read_to_string(path)
        .map_err(|err| format!("failed to read runtime config {}: {err}", path.display()))?;
    serde_json::from_str(&contents)
        .map_err(|err| format!("failed to parse runtime config {}: {err}", path.display()))
}

fn write_runtime_config(path: &Path, config: &RuntimeConfig) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| {
            format!(
                "failed to create config directory {}: {err}",
                parent.display()
            )
        })?;
    }

    let contents = serde_json::to_string_pretty(config)
        .map_err(|err| format!("failed to serialize runtime config: {err}"))?;
    fs::write(path, contents)
        .map_err(|err| format!("failed to write runtime config {}: {err}", path.display()))
}

fn configured_model_filename(config: &RuntimeConfig) -> String {
    sanitize_filename(
        config
            .llm_model_filename
            .clone()
            .or_else(|| std::env::var("LOCAL_MINUTES_DEFAULT_MODEL_FILENAME").ok()),
        DEFAULT_MODEL_FILENAME,
    )
}

fn configured_model_url(config: &RuntimeConfig) -> String {
    resolve_value(
        None,
        config.llm_model_url.clone(),
        "LOCAL_MINUTES_DEFAULT_MODEL_URL",
        DEFAULT_MODEL_URL,
    )
}

fn sanitize_filename(value: Option<String>, default: &str) -> String {
    value
        .as_deref()
        .and_then(|value| Path::new(value).file_name())
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(default)
        .to_string()
}

fn resolve_source(
    request_value: Option<String>,
    config_value: Option<String>,
    env_name: &str,
) -> Option<String> {
    request_value
        .or_else(|| std::env::var(env_name).ok())
        .or(config_value)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn resolve_value(
    request_value: Option<String>,
    config_value: Option<String>,
    env_name: &str,
    default: &str,
) -> String {
    request_value
        .or_else(|| std::env::var(env_name).ok())
        .or(config_value)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| default.to_string())
}

fn env_or_default(name: &str, default: &str) -> String {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| default.to_string())
}

fn executable_file_name(base_name: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("{base_name}.exe")
    } else {
        base_name.to_string()
    }
}

fn is_http_url(value: &str) -> bool {
    value.starts_with("http://") || value.starts_with("https://")
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn emit_setup_progress(
    app: &AppHandle,
    asset: &str,
    stage: &str,
    status: &str,
    message: String,
    source: Option<String>,
    destination_path: &Path,
    downloaded_bytes: Option<u64>,
    total_bytes: Option<u64>,
) {
    let payload = SetupProgressPayload {
        asset: asset.to_string(),
        stage: stage.to_string(),
        status: status.to_string(),
        message,
        source,
        destination_path: path_to_string(destination_path),
        downloaded_bytes,
        total_bytes,
    };

    if let Err(err) = app.emit(SETUP_PROGRESS_EVENT_NAME, payload) {
        log::debug!("failed to emit setup progress event: {err}");
    }
}
