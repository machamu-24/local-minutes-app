export interface RecorderFormatOption {
  mimeType: string;
  extension: string;
  label: string;
}

const RECORDER_FORMAT_OPTIONS: RecorderFormatOption[] = [
  {
    mimeType: "audio/webm;codecs=opus",
    extension: "webm",
    label: "WebM / Opus",
  },
  {
    mimeType: "audio/webm",
    extension: "webm",
    label: "WebM",
  },
  {
    mimeType: "audio/mp4",
    extension: "mp4",
    label: "MP4 / AAC",
  },
  {
    mimeType: "audio/ogg;codecs=opus",
    extension: "ogg",
    label: "Ogg / Opus",
  },
  {
    mimeType: "audio/ogg",
    extension: "ogg",
    label: "Ogg",
  },
];

export function getPreferredRecorderFormat(): RecorderFormatOption | null {
  if (
    typeof window === "undefined" ||
    typeof navigator === "undefined" ||
    !navigator.mediaDevices?.getUserMedia ||
    typeof MediaRecorder === "undefined"
  ) {
    return null;
  }

  if (typeof MediaRecorder.isTypeSupported !== "function") {
    return RECORDER_FORMAT_OPTIONS[0] ?? null;
  }

  return (
    RECORDER_FORMAT_OPTIONS.find((option) =>
      MediaRecorder.isTypeSupported(option.mimeType)
    ) ?? null
  );
}

export function isInAppRecordingSupported(): boolean {
  return getPreferredRecorderFormat() !== null;
}

export function getRecorderFileExtension(
  mimeType: string,
  fallbackExtension = "webm"
): string {
  const normalizedMimeType = mimeType.toLowerCase();

  if (normalizedMimeType.includes("mp4")) return "mp4";
  if (normalizedMimeType.includes("ogg")) return "ogg";
  if (normalizedMimeType.includes("mpeg")) return "mp3";
  if (normalizedMimeType.includes("wav")) return "wav";
  if (normalizedMimeType.includes("webm")) return "webm";

  return fallbackExtension;
}

export function buildDefaultRecordingTitle(date = new Date()): string {
  const formatted = date.toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `その場録音 ${formatted}`;
}

export function buildRecordedFileName(
  date = new Date(),
  extension = "webm"
): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const timestamp = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("");
  const time = [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join("");
  return `live-recording-${timestamp}-${time}.${extension}`;
}

export function formatRecordingDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
