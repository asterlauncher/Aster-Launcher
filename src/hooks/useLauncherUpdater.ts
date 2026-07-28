import { getVersion } from "@tauri-apps/api/app";
import { Channel, invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLauncherSettings } from "./useLauncherSettings";

export type LauncherUpdaterStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "installing"
  | "error";

export interface LauncherUpdateInfo {
  currentVersion: string;
  version: string;
  name: string;
  description: string;
  publishedAt?: string;
}

interface NativeLauncherUpdate {
  version: string;
  name: string;
  description: string;
  publishedAt: string;
  url: string;
  sha256: string;
  signature: string;
}

type NativeDownloadEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

const FALLBACK_VERSION = "0.5.3";
const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const MANUAL_DOWNLOAD_URL =
  "https://github.com/asterlauncher/Aster-Launcher/releases";

function isTauriRuntime() {
  return (
    typeof window !== "undefined" &&
    Object.prototype.hasOwnProperty.call(window, "__TAURI_INTERNALS__")
  );
}

function getErrorMessage(reason: unknown, fallback: string) {
  if (typeof reason === "string" && reason.trim()) return reason;
  if (reason instanceof Error && reason.message.trim()) return reason.message;
  return fallback;
}

export function parseUpdateNotes(
  version: string,
  notes?: string,
): Pick<LauncherUpdateInfo, "name" | "description"> {
  const fallbackName = `Aster Launcher ${version}`;
  const normalized = notes?.replace(/\r\n/g, "\n").trim();

  if (!normalized) {
    return {
      name: fallbackName,
      description:
        "A new launcher build is ready with improvements and fixes.",
    };
  }

  const lines = normalized.split("\n");
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
  const firstLine = lines[firstContentIndex]?.trim() ?? "";
  const isHeading = /^#{1,3}\s+/.test(firstLine);

  if (!isHeading) {
    return { name: fallbackName, description: normalized };
  }

  const name = firstLine.replace(/^#{1,3}\s+/, "").trim() || fallbackName;
  const description = lines
    .slice(firstContentIndex + 1)
    .join("\n")
    .trim();

  return {
    name,
    description:
      description ||
      "A new launcher build is ready with improvements and fixes.",
  };
}

function getMockUpdate(currentVersion: string): LauncherUpdateInfo | null {
  if (
    !import.meta.env.DEV ||
    typeof window === "undefined" ||
    !new URLSearchParams(window.location.search).has("mockUpdate")
  ) {
    return null;
  }

  return {
    currentVersion,
    version: "0.2.0",
    name: "Starlight Update",
    description:
      "Faster content downloads, a polished update center, and launcher stability fixes.",
    publishedAt: new Date().toISOString(),
  };
}

export function useLauncherUpdater() {
  const settings = useLauncherSettings();
  const pendingUpdate = useRef<NativeLauncherUpdate | null>(null);
  const checkingRef = useRef(false);
  const statusRef = useRef<LauncherUpdaterStatus>("idle");
  const [currentVersion, setCurrentVersion] = useState(FALLBACK_VERSION);
  const [status, setStatus] = useState<LauncherUpdaterStatus>("idle");
  const [availableUpdate, setAvailableUpdate] =
    useState<LauncherUpdateInfo | null>(null);
  const [progress, setProgress] = useState(0);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkForUpdates = useCallback(
    async (showChecking = true) => {
      if (
        checkingRef.current ||
        statusRef.current === "downloading" ||
        statusRef.current === "installing"
      ) {
        return;
      }

      checkingRef.current = true;
      if (showChecking) setStatus("checking");
      setError(null);

      try {
        const resolvedVersion = isTauriRuntime()
          ? await getVersion()
          : FALLBACK_VERSION;
        setCurrentVersion(resolvedVersion);

        const mockUpdate = getMockUpdate(resolvedVersion);
        if (mockUpdate) {
          setAvailableUpdate(mockUpdate);
          setStatus("available");
          return;
        }

        if (!isTauriRuntime()) {
          setStatus("up-to-date");
          return;
        }

        const update = await invoke<NativeLauncherUpdate | null>(
          "check_launcher_update",
        );
        pendingUpdate.current = update;

        if (!update) {
          setAvailableUpdate(null);
          setStatus("up-to-date");
          return;
        }

        setAvailableUpdate({
          currentVersion: resolvedVersion,
          version: update.version,
          name: update.name,
          description: update.description,
          publishedAt: update.publishedAt,
        });
        setStatus("available");
      } catch (reason) {
        setError(getErrorMessage(reason, "The update check failed."));
        setStatus("error");
      } finally {
        checkingRef.current = false;
      }
    },
    [],
  );

  const installUpdate = useCallback(async () => {
    const update = pendingUpdate.current;
    const mockUpdate = getMockUpdate(currentVersion);

    if (!update) {
      if (mockUpdate) {
        setStatus("downloading");
        setProgress(67);
        setDownloadedBytes(6_700_000);
        setTotalBytes(10_000_000);
        return;
      }

      setError("This update is no longer available. Check again.");
      setStatus("error");
      return;
    }

    setError(null);
    setProgress(0);
    setDownloadedBytes(0);
    setTotalBytes(null);
    setStatus("downloading");

    let downloaded = 0;
    let total: number | null = null;

    const onDownloadEvent = (event: NativeDownloadEvent) => {
      if (event.event === "Started") {
        total = event.data.contentLength ?? null;
        setTotalBytes(total);
        return;
      }

      if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
        setDownloadedBytes(downloaded);
        if (total && total > 0) {
          setProgress(Math.min(100, Math.round((downloaded / total) * 100)));
        }
        return;
      }

      setProgress(100);
      setStatus("installing");
    };

    try {
      const onEvent = new Channel<NativeDownloadEvent>();
      onEvent.onmessage = onDownloadEvent;
      const installerPath = await invoke<string>("download_launcher_update", {
        update,
        onEvent,
      });
      setProgress(100);
      setStatus("installing");
      await invoke("install_launcher_update", { installerPath });
    } catch (reason) {
      setError(
        getErrorMessage(reason, "The update could not be installed."),
      );
      setStatus("error");
    }
  }, [currentVersion]);

  const openManualDownload = useCallback(async () => {
    try {
      if (isTauriRuntime()) {
        await invoke("open_launcher_downloads");
        return;
      }

      window.open(MANUAL_DOWNLOAD_URL, "_blank", "noopener,noreferrer");
    } catch (reason) {
      setError(
        getErrorMessage(reason, "The launcher download page could not be opened."),
      );
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    if (!settings.automaticUpdateChecks) {
      if (isTauriRuntime()) {
        void getVersion().then(setCurrentVersion).catch(() => undefined);
      }
      return;
    }
    void checkForUpdates(false);

    const interval = window.setInterval(() => {
      void checkForUpdates(false);
    }, CHECK_INTERVAL_MS);

    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void checkForUpdates(false);
      }
    };
    document.addEventListener("visibilitychange", checkWhenVisible);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", checkWhenVisible);
    };
  }, [checkForUpdates, settings.automaticUpdateChecks]);

  return {
    status,
    currentVersion,
    availableUpdate,
    progress,
    downloadedBytes,
    totalBytes,
    error,
    checkForUpdates,
    installUpdate,
    openManualDownload,
  };
}
