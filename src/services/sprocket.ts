import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { isTauriRuntime } from "./auth";

export interface SprocketInstallation {
  installed: boolean;
  appId: string;
  installDir: string | null;
  executablePath: string | null;
  steamLibrary: string | null;
  buildId: string | null;
  dataDir: string;
  melonLoaderInstalled: boolean;
  asterRuntimeInstalled: boolean;
  asterRuntimeVersion: string | null;
  securityScannerAvailable: boolean;
}

export interface SprocketProfile {
  id: string;
  name: string;
  faction: string;
  path: string;
  modifiedAt: number;
  sizeBytes: number;
  previewPath: string | null;
}

export interface SprocketModFile {
  fileName: string;
  displayName: string;
  path: string;
  enabled: boolean;
  sizeBytes: number;
}

export interface SprocketBackup {
  id: string;
  createdAt: number;
  sizeBytes: number;
  path: string;
}

export interface SprocketTunableField {
  pointer: string;
  label: string;
  category: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  requiresReload: boolean;
}

export interface SprocketWeapon {
  id: string;
  name: string;
  operatorName: string | null;
  linkageId: string | null;
  fields: SprocketTunableField[];
}

export interface SprocketSettings {
  safeMode: boolean;
  backupBeforeLaunch: boolean;
  closeLauncherOnStart: boolean;
}

const SETTINGS_KEY = "aster-launcher.sprocket.settings.v1";
const defaults: SprocketSettings = {
  safeMode: false,
  backupBeforeLaunch: true,
  closeLauncherOnStart: false,
};

export function getSprocketSettings(): SprocketSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null");
    return { ...defaults, ...(stored && typeof stored === "object" ? stored : {}) };
  } catch {
    return defaults;
  }
}

export function saveSprocketSettings(settings: SprocketSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

const browserInstallation: SprocketInstallation = {
  installed: false,
  appId: "1674170",
  installDir: null,
  executablePath: null,
  steamLibrary: null,
  buildId: null,
  dataDir: "Documents\\My Games\\Sprocket",
  melonLoaderInstalled: false,
  asterRuntimeInstalled: false,
  asterRuntimeVersion: null,
  securityScannerAvailable: false,
};

export const detectSprocket = () =>
  isTauriRuntime()
    ? invoke<SprocketInstallation>("detect_sprocket_installation")
    : Promise.resolve(browserInstallation);
export const listSprocketProfiles = () =>
  isTauriRuntime() ? invoke<SprocketProfile[]>("list_sprocket_profiles") : Promise.resolve([]);
export const listSprocketMods = () =>
  isTauriRuntime() ? invoke<SprocketModFile[]>("list_sprocket_mods") : Promise.resolve([]);
export const listSprocketBackups = () =>
  isTauriRuntime() ? invoke<SprocketBackup[]>("list_sprocket_backups") : Promise.resolve([]);
export const createSprocketBackup = () => invoke<SprocketBackup>("create_sprocket_backup");
export const restoreSprocketBackup = (backupId: string) => invoke<void>("restore_sprocket_backup", { backupId });
export const openSprocketPath = (section: "game" | "blueprints" | "mods" | "backups") =>
  invoke<void>("open_sprocket_path", { section });
export const openSprocketStore = () => invoke<void>("open_sprocket_store");
export const openMelonLoaderDownload = () => invoke<void>("open_melonloader_download");
export const repairSprocketRuntime = () => invoke<void>("repair_sprocket_runtime");
export const removeSprocketRuntime = () => invoke<void>("remove_sprocket_runtime");
export const launchSprocket = (safeMode: boolean) =>
  invoke<{ pid: number; versionId: string; loader: string }>("launch_sprocket", { safeMode });

export async function importSprocketBlueprint() {
  const sourcePath = await open({ multiple: false, filters: [{ name: "Sprocket blueprint", extensions: ["blueprint"] }] });
  if (typeof sourcePath !== "string") return false;
  await invoke("import_sprocket_blueprint", { sourcePath });
  return true;
}

export async function exportSprocketBlueprint(profile: SprocketProfile) {
  const destinationPath = await save({ defaultPath: `${profile.name}.blueprint`, filters: [{ name: "Sprocket blueprint", extensions: ["blueprint"] }] });
  if (!destinationPath) return false;
  await invoke("export_sprocket_blueprint", { profileId: profile.id, destinationPath });
  return true;
}

export async function importSprocketMod() {
  const sourcePath = await open({ multiple: false, filters: [{ name: "Sprocket mod", extensions: ["dll"] }] });
  if (typeof sourcePath !== "string") return false;
  await invoke("import_sprocket_mod", { sourcePath });
  return true;
}

export const setSprocketModEnabled = (fileName: string, enabled: boolean) =>
  invoke<void>("set_sprocket_mod_enabled", { fileName, enabled });
export const removeSprocketMod = (fileName: string) =>
  invoke<void>("remove_sprocket_mod", { fileName });
export const inspectSprocketBlueprint = (profileId: string) =>
  invoke<SprocketTunableField[]>("inspect_sprocket_blueprint", { profileId });
export const inspectSprocketWeapons = (profileId: string) =>
  invoke<SprocketWeapon[]>("inspect_sprocket_weapons", { profileId });
export const updateSprocketBlueprint = (profileId: string, updates: Array<{ pointer: string; value: number }>) =>
  invoke<void>("update_sprocket_blueprint_values", { profileId, updates });
export const sprocketPreviewUrl = (path: string | null) => (path && isTauriRuntime() ? convertFileSrc(path) : null);
