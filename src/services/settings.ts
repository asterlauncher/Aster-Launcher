export interface LauncherSettings {
  automaticUpdateChecks: boolean;
  activityNotifications: boolean;
  socialNotifications: boolean;
  onlinePresence: boolean;
  reducedMotion: boolean;
  memoryGb: number;
}

export const DEFAULT_LAUNCHER_SETTINGS: LauncherSettings = {
  automaticUpdateChecks: true,
  activityNotifications: true,
  socialNotifications: true,
  onlinePresence: true,
  reducedMotion: false,
  memoryGb: 6,
};

const SETTINGS_STORAGE_KEY = "aster-launcher.settings.v2";
const listeners = new Set<() => void>();

function parseSettings(value: unknown): LauncherSettings {
  if (!value || typeof value !== "object") {
    return DEFAULT_LAUNCHER_SETTINGS;
  }
  const candidate = value as Partial<LauncherSettings>;
  const memory = Number(candidate.memoryGb);
  return {
    automaticUpdateChecks:
      candidate.automaticUpdateChecks ??
      DEFAULT_LAUNCHER_SETTINGS.automaticUpdateChecks,
    activityNotifications:
      candidate.activityNotifications ??
      DEFAULT_LAUNCHER_SETTINGS.activityNotifications,
    socialNotifications:
      candidate.socialNotifications ??
      DEFAULT_LAUNCHER_SETTINGS.socialNotifications,
    onlinePresence:
      candidate.onlinePresence ?? DEFAULT_LAUNCHER_SETTINGS.onlinePresence,
    reducedMotion:
      candidate.reducedMotion ?? DEFAULT_LAUNCHER_SETTINGS.reducedMotion,
    memoryGb: Number.isFinite(memory)
      ? Math.max(2, Math.min(24, Math.round(memory)))
      : DEFAULT_LAUNCHER_SETTINGS.memoryGb,
  };
}

function loadInitialSettings() {
  if (typeof window === "undefined") return DEFAULT_LAUNCHER_SETTINGS;
  try {
    return parseSettings(
      JSON.parse(window.localStorage.getItem(SETTINGS_STORAGE_KEY) ?? "null"),
    );
  } catch {
    return DEFAULT_LAUNCHER_SETTINGS;
  }
}

let settingsSnapshot = loadInitialSettings();

function publishSettings(next: LauncherSettings) {
  settingsSnapshot = next;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
    document.documentElement.dataset.asterMotion = next.reducedMotion
      ? "reduced"
      : "full";
  }
  listeners.forEach((listener) => listener());
}

export function getLauncherSettings() {
  return settingsSnapshot;
}

export function updateLauncherSettings(patch: Partial<LauncherSettings>) {
  publishSettings(parseSettings({ ...settingsSnapshot, ...patch }));
}

export function resetLauncherSettings() {
  publishSettings(DEFAULT_LAUNCHER_SETTINGS);
}

export function subscribeLauncherSettings(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

if (typeof document !== "undefined") {
  document.documentElement.dataset.asterMotion = settingsSnapshot.reducedMotion
    ? "reduced"
    : "full";
}
