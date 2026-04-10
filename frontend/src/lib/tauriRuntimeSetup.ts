import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

export const SETUP_PROGRESS_EVENT_NAME = "runtime://setup-progress";
export const SIDECAR_STATUS_EVENT_NAME = "runtime://sidecar-status";

export interface RuntimeStatus {
  managedRuntimeEnabled: boolean;
  runtimeReady: boolean;
  bundledBackendAvailable: boolean;
  bundledLlmAvailable: boolean;
  backendRunning: boolean;
  backendPid: number | null;
  llmRunning: boolean;
  llmPid: number | null;
  llmBaseUrl: string;
  llmModel: string;
}

export interface RuntimeSetupStatus {
  runtimeRootDir: string;
  runtimeBinDir: string;
  runtimeModelDir: string;
  runtimeDownloadDir: string;
  runtimeConfigPath: string;
  backendBinaryPath: string;
  backendBinaryInstalled: boolean;
  backendSource: string | null;
  llamaServerBinaryPath: string;
  llamaServerBinaryInstalled: boolean;
  llamaServerSource: string | null;
  llmModelPath: string;
  llmModelFilename: string;
  llmModelInstalled: boolean;
  llmModelUrl: string;
  llmModelAlias: string;
  readyForManagedRuntime: boolean;
}

export interface PrepareRuntimeAssetsRequest {
  backendSource?: string;
  llamaServerSource?: string;
  llmModelUrl?: string;
  llmModelFilename?: string;
  forceRedownload?: boolean;
  forceReplaceBinaries?: boolean;
}

export interface SetupProgressPayload {
  asset: string;
  stage: string;
  status: string;
  message: string;
  source: string | null;
  destinationPath: string;
  downloadedBytes: number | null;
  totalBytes: number | null;
}

export interface SidecarStatusPayload {
  sidecar: string;
  status: string;
  pid: number | null;
  detail: string | null;
}

export interface SidecarOutputPayload {
  sidecar: string;
  stream: string;
  line: string;
}

export const SIDECAR_OUTPUT_EVENT_NAME = "runtime://sidecar-output";

export const isTauriRuntime = (): boolean => isTauri();

export const getRuntimeStatus = async (): Promise<RuntimeStatus> =>
  invoke<RuntimeStatus>("get_runtime_status");

export const getRuntimeSetupStatus = async (): Promise<RuntimeSetupStatus> =>
  invoke<RuntimeSetupStatus>("get_runtime_setup_status_command");

export const prepareRuntimeAssets = async (
  request: PrepareRuntimeAssetsRequest
): Promise<RuntimeSetupStatus> =>
  invoke<RuntimeSetupStatus>("prepare_runtime_assets_command", { request });

export const restartManagedRuntime = async (): Promise<RuntimeStatus> =>
  invoke<RuntimeStatus>("restart_managed_runtime_command");

export const listenSetupProgress = async (
  handler: (payload: SetupProgressPayload) => void
) =>
  listen<SetupProgressPayload>(SETUP_PROGRESS_EVENT_NAME, (event) => {
    handler(event.payload);
  });

export const listenSidecarStatus = async (
  handler: (payload: SidecarStatusPayload) => void
) =>
  listen<SidecarStatusPayload>(SIDECAR_STATUS_EVENT_NAME, (event) => {
    handler(event.payload);
  });

export const listenSidecarOutput = async (
  handler: (payload: SidecarOutputPayload) => void
) =>
  listen<SidecarOutputPayload>(SIDECAR_OUTPUT_EVENT_NAME, (event) => {
    handler(event.payload);
  });

export const pickExecutablePath = async (): Promise<string | null> => {
  if (!isTauriRuntime()) return null;

  const selected = await open({
    title: "実行ファイルを選択",
    directory: false,
    multiple: false,
  });

  return typeof selected === "string" ? selected : null;
};

export const pickModelPath = async (): Promise<string | null> => {
  if (!isTauriRuntime()) return null;

  const selected = await open({
    title: "GGUF モデルを選択",
    directory: false,
    multiple: false,
    filters: [
      {
        name: "GGUF Model",
        extensions: ["gguf"],
      },
    ],
  });

  return typeof selected === "string" ? selected : null;
};

export const extractFileName = (value: string): string => {
  const segments = value.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? "";
};

export const isHttpUrl = (value: string): boolean =>
  /^https?:\/\//i.test(value.trim());
