import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isTauriRuntime } from "./auth";

export interface HostedWorldStatus {
  instanceId: string;
  worldName: string;
  pid: number;
  port: number;
  lanAddress: string;
  running: boolean;
}

export interface HostStatusEvent {
  instanceId: string;
  status: "preparing" | "running" | "stopping" | "stopped";
  detail: string;
  exitCode: number | null;
  port: number | null;
  lanAddress: string | null;
}

export interface StartHostedWorldOptions {
  instanceId: string;
  gameVersion: string;
  loader: string;
  worldName: string;
  port: number;
  maxPlayers: number;
  memoryGb: number;
  acceptedEula: boolean;
}

export interface HostServerSettings {
  motd: string;
  gameMode: "survival" | "creative" | "adventure" | "spectator";
  difficulty: "peaceful" | "easy" | "normal" | "hard";
  maxPlayers: number;
  port: number;
  memoryGb: number;
  pvp: boolean;
  allowFlight: boolean;
  whitelist: boolean;
  viewDistance: number;
  simulationDistance: number;
  spawnProtection: number;
}

export interface HostSettingsSaveResult {
  settings: HostServerSettings;
  restartRequired: boolean;
}

export interface HostConsoleLine {
  id: number;
  stream: "aster" | "server" | "error" | "command";
  text: string;
}

export interface HostConsoleSnapshot {
  lines: HostConsoleLine[];
  nextCursor: number;
  running: boolean;
}

export const defaultHostServerSettings: HostServerSettings = {
  motd: "Aster Host",
  gameMode: "survival",
  difficulty: "normal",
  maxPlayers: 8,
  port: 25565,
  memoryGb: 4,
  pvp: true,
  allowFlight: true,
  whitelist: false,
  viewDistance: 10,
  simulationDistance: 8,
  spawnProtection: 0,
};

export async function getHostedWorldStatus(): Promise<HostedWorldStatus | null> {
  if (!isTauriRuntime()) return null;
  return invoke<HostedWorldStatus | null>("get_hosted_world_status");
}

export async function startHostedWorld(
  options: StartHostedWorldOptions,
): Promise<HostedWorldStatus> {
  if (!isTauriRuntime()) {
    throw new Error("Aster Host is available in the native launcher.");
  }
  return invoke<HostedWorldStatus>("start_hosted_world", { ...options });
}

export async function stopHostedWorld(instanceId: string): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("Aster Host is available in the native launcher.");
  }
  return invoke<void>("stop_hosted_world", { instanceId });
}

export async function getHostServerSettings(
  instanceId: string,
  worldName: string,
): Promise<HostServerSettings> {
  if (!isTauriRuntime()) return defaultHostServerSettings;
  return invoke<HostServerSettings>("get_host_server_settings", {
    instanceId,
    worldName,
  });
}

export async function saveHostServerSettings(
  instanceId: string,
  worldName: string,
  settings: HostServerSettings,
): Promise<HostSettingsSaveResult> {
  if (!isTauriRuntime()) return { settings, restartRequired: false };
  return invoke<HostSettingsSaveResult>("save_host_server_settings", {
    instanceId,
    worldName,
    settings,
  });
}

export async function getHostConsole(
  instanceId: string,
  afterId?: number,
): Promise<HostConsoleSnapshot> {
  if (!isTauriRuntime()) {
    return { lines: [], nextCursor: afterId ?? 0, running: false };
  }
  return invoke<HostConsoleSnapshot>("get_host_console", {
    instanceId,
    afterId,
  });
}

export async function sendHostConsoleCommand(
  instanceId: string,
  command: string,
): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("Aster Host is available in the native launcher.");
  }
  return invoke<void>("send_host_console_command", { instanceId, command });
}

export async function openHostingTunnelSetup(): Promise<void> {
  if (!isTauriRuntime()) {
    window.open("https://playit.gg/setup/agent", "_blank", "noopener,noreferrer");
    return;
  }
  return invoke<void>("open_hosting_tunnel_setup");
}

export function listenToHostStatus(
  handler: (event: HostStatusEvent) => void,
): Promise<UnlistenFn> {
  return listen<HostStatusEvent>("host-status", ({ payload }) => {
    handler(payload);
  });
}
