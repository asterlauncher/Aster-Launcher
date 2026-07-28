import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface LaunchStarted {
  pid: number;
  versionId: string;
  loader: string;
  logPath: string;
}

export interface LaunchStatusEvent {
  instanceId: string;
  status: "preparing" | "running" | "exited" | "failed";
  detail: string;
  exitCode: number | null;
}

export function launchInstance(
  instanceId: string,
  gameVersion: string,
  loader: string,
) {
  return invoke<LaunchStarted>("launch_instance", {
    instanceId,
    gameVersion,
    loader,
  });
}

export function listMinecraftVersions() {
  return invoke<string[]>("list_minecraft_versions");
}

export function listenToLaunchStatus(
  handler: (event: LaunchStatusEvent) => void,
): Promise<UnlistenFn> {
  return listen<LaunchStatusEvent>("launch-status", ({ payload }) => {
    handler(payload);
  });
}
