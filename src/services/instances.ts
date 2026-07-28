import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { isTauriRuntime } from "./auth";

export type InstanceContentSection =
  | "mods"
  | "resourcepacks"
  | "shaders"
  | "datapacks"
  | "worlds"
  | "screenshots";

export interface InstanceContentFile {
  id: string;
  kind: InstanceContentSection;
  name: string;
  fileName: string;
  version: string;
  source: "Modrinth" | "CurseForge" | "Local";
  projectId: string | null;
  releaseId: string | null;
  iconUrl: string | null;
  enabled: boolean;
  size: string;
}

export interface InstalledModpackResult {
  name: string;
  version: string;
  gameVersion: string;
  loader: string;
  installedFiles: number;
}

export interface InstanceSecurityScanResult {
  status: "clean" | "attention" | "unavailable" | "failed" | "no-files";
  scannedFiles: number;
  durationMs: number;
  message: string;
}

export async function openInstanceFolder(instanceId: string): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("Instance folders are available in the native launcher.");
  }
  return invoke<void>("open_instance_folder", { instanceId });
}

export async function createInstanceStructure(instanceId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  return invoke<void>("create_instance_structure", { instanceId });
}

export async function listInstanceContent(
  instanceId: string,
): Promise<InstanceContentFile[]> {
  if (!isTauriRuntime()) return [];
  return invoke<InstanceContentFile[]>("list_instance_content", { instanceId });
}

export async function scanInstanceMods(
  instanceId: string,
): Promise<InstanceSecurityScanResult> {
  if (!isTauriRuntime()) {
    return {
      status: "unavailable",
      scannedFiles: 0,
      durationMs: 0,
      message: "Microsoft Defender scanning is available in the native launcher.",
    };
  }
  return invoke<InstanceSecurityScanResult>("scan_instance_mods", { instanceId });
}

export async function openInstanceContentFolder(
  instanceId: string,
  section: InstanceContentSection,
): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("Instance folders are available in the native launcher.");
  }
  return invoke<void>("open_instance_content_folder", { instanceId, section });
}

function filtersForSection(section: InstanceContentSection) {
  if (section === "mods") return [{ name: "Minecraft mods", extensions: ["jar"] }];
  if (section === "screenshots") {
    return [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }];
  }
  return [{ name: "Minecraft content", extensions: ["zip"] }];
}

export async function pickAndImportInstanceContent(
  instanceId: string,
  section: InstanceContentSection,
): Promise<boolean> {
  if (!isTauriRuntime()) {
    throw new Error("Adding local files is available in the native launcher.");
  }
  if (section === "worlds") {
    await openInstanceContentFolder(instanceId, section);
    return false;
  }
  const sourcePath = await open({
    multiple: false,
    directory: false,
    filters: filtersForSection(section),
  });
  if (!sourcePath) return false;
  await invoke<void>("import_instance_content", {
    instanceId,
    section,
    sourcePath,
  });
  return true;
}

export async function setInstanceContentEnabled(
  instanceId: string,
  section: InstanceContentSection,
  fileName: string,
  enabled: boolean,
): Promise<void> {
  return invoke<void>("set_instance_content_enabled", {
    instanceId,
    section,
    fileName,
    enabled,
  });
}

export async function removeInstanceContent(
  instanceId: string,
  section: InstanceContentSection,
  fileName: string,
): Promise<void> {
  return invoke<void>("remove_instance_content", {
    instanceId,
    section,
    fileName,
  });
}

export async function downloadInstanceContent(
  instanceId: string,
  section: InstanceContentSection,
  downloadUrl: string,
  fileName: string,
  metadata: {
    name: string;
    version: string;
    source: "Modrinth" | "CurseForge";
    projectId: string;
    releaseId: string;
    iconUrl: string | null;
  },
  downloadId: string,
): Promise<void> {
  return invoke<void>("download_instance_content", {
    instanceId,
    section,
    downloadUrl,
    fileName,
    ...metadata,
    downloadId,
  });
}

export async function pickAndSetInstanceIcon(
  instanceId: string,
): Promise<string | null> {
  if (!isTauriRuntime()) {
    throw new Error("Custom modpack icons are available in the native launcher.");
  }
  const sourcePath = await open({
    multiple: false,
    directory: false,
    filters: [
      { name: "Modpack icons", extensions: ["png", "jpg", "jpeg", "webp"] },
    ],
  });
  if (!sourcePath) return null;
  const savedPath = await invoke<string>("set_instance_icon", {
    instanceId,
    sourcePath,
  });
  return convertFileSrc(savedPath);
}

export async function installModpack(
  instanceId: string,
  provider: "Modrinth" | "CurseForge",
  downloadUrl: string,
  downloadId: string,
): Promise<InstalledModpackResult> {
  if (!isTauriRuntime()) {
    throw new Error("Modpack installation is available in the native launcher.");
  }
  return invoke<InstalledModpackResult>("install_modpack", {
    instanceId,
    provider,
    downloadUrl,
    downloadId,
  });
}

export async function pickAndImportModpack(
  instanceId: string,
  downloadId: string,
): Promise<InstalledModpackResult | null> {
  if (!isTauriRuntime()) {
    throw new Error("Modpack import is available in the native launcher.");
  }
  const sourcePath = await open({
    multiple: false,
    directory: false,
    filters: [
      { name: "Minecraft modpacks", extensions: ["mrpack", "zip"] },
    ],
  });
  if (!sourcePath) return null;
  return invoke<InstalledModpackResult>("import_modpack", {
    instanceId,
    sourcePath,
    downloadId,
  });
}

export async function exportModpack(
  instanceId: string,
  metadata: {
    name: string;
    version: string;
    gameVersion: string;
    loader: string;
  },
): Promise<string | null> {
  if (!isTauriRuntime()) {
    throw new Error("Modpack export is available in the native launcher.");
  }
  const safeName =
    metadata.name
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .replace(/\s+/g, " ")
      .trim() || "Aster Modpack";
  const destinationPath = await save({
    defaultPath: `${safeName}.zip`,
    filters: [{ name: "Shareable Aster modpack", extensions: ["zip"] }],
  });
  if (!destinationPath) return null;
  return invoke<string>("export_modpack", {
    instanceId,
    ...metadata,
    destinationPath,
  });
}
