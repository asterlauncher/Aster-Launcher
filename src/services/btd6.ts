import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { isTauriRuntime } from "./auth";
import { getSocialClient, getSocialStorageConfig, syncProfile } from "./social";
import type { AsterAccount } from "../types/auth";

export interface Btd6Installation {
  installed: boolean;
  appId: string;
  installDir: string | null;
  executablePath: string | null;
  buildId: string | null;
  melonLoaderReady: boolean;
  modHelperInstalled: boolean;
  securityScannerAvailable: boolean;
  enabledModCount: number;
}

export interface Btd6ModFile {
  fileName: string;
  displayName: string;
  path: string;
  enabled: boolean;
  required: boolean;
  sizeBytes: number;
  sha256: string;
  scanStatus: "passed" | "unscanned";
  riskSignals: string[];
}

export interface Btd6UploadInspection {
  stagedPath: string;
  fileName: string;
  displayName: string;
  sizeBytes: number;
  sha256: string;
  riskSignals: string[];
}

export interface Btd6CommunityMod {
  id: string;
  ownerId: string;
  creatorName: string;
  ownedByCurrentUser: boolean;
  displayName: string;
  description: string;
  version: string;
  fileName: string;
  storagePath: string;
  iconStoragePath: string | null;
  iconUrl: string | null;
  sha256: string;
  sizeBytes: number;
  riskSignals: string[];
  status: "pending" | "approved" | "rejected";
  downloadCount: number;
  createdAt: string;
}

export interface Btd6SubmissionInput {
  displayName: string;
  description: string;
  version: string;
  iconPath: string | null;
}

export interface Btd6Modpack {
  id: string;
  name: string;
  iconDataUrl?: string | null;
  modFileNames: string[];
  createdAt: string;
  updatedAt: string;
}

const browserInstallation: Btd6Installation = {
  installed: false,
  appId: "960090",
  installDir: null,
  executablePath: null,
  buildId: null,
  melonLoaderReady: false,
  modHelperInstalled: false,
  securityScannerAvailable: false,
  enabledModCount: 0,
};

export const detectBtd6 = () =>
  isTauriRuntime()
    ? invoke<Btd6Installation>("detect_btd6_installation")
    : Promise.resolve(browserInstallation);

export const listBtd6Mods = () =>
  isTauriRuntime()
    ? invoke<Btd6ModFile[]>("list_btd6_mods")
    : Promise.resolve([]);

export async function importBtd6Mod(enabled = true) {
  const sourcePath = await open({
    multiple: false,
    filters: [{ name: "Bloons TD 6 mod", extensions: ["dll"] }],
  });
  if (typeof sourcePath !== "string") return false;
  return invoke<string>("import_btd6_mod", { sourcePath, enabled });
}

function safeUploadName(value: string) {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 100) || "btd6-mod.dll";
}

function safeIconName(value: string) {
  const fileName = value.replace(/^.*[\\/]/, "");
  const cleaned = fileName.replace(/[^a-zA-Z0-9._-]+/g, "-");
  return cleaned.slice(0, 100) || "mod-icon.png";
}

function communityModFromRow(row: Record<string, unknown>): Btd6CommunityMod {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    creatorName: "Aster creator",
    ownedByCurrentUser: false,
    displayName: String(row.display_name),
    description: String(row.description ?? ""),
    version: String(row.version ?? "1.0.0"),
    fileName: String(row.file_name),
    storagePath: String(row.storage_path),
    iconStoragePath: row.icon_storage_path ? String(row.icon_storage_path) : null,
    iconUrl: null,
    sha256: String(row.sha256),
    sizeBytes: Number(row.size_bytes),
    riskSignals: Array.isArray(row.risk_signals) ? row.risk_signals.map(String) : [],
    status: String(row.status) as Btd6CommunityMod["status"],
    downloadCount: Number(row.download_count ?? 0),
    createdAt: String(row.created_at),
  };
}

function btd6CommunityError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error && "message" in error) {
    return String(error.message);
  }
  return "The BTD6 community service could not complete this request.";
}

export async function chooseBtd6ModIcon() {
  const sourcePath = await open({
    multiple: false,
    filters: [{ name: "Mod icon", extensions: ["png", "jpg", "jpeg", "webp"] }],
  });
  return typeof sourcePath === "string" ? sourcePath : null;
}

export async function submitBtd6Mod(
  account: AsterAccount,
  input: Btd6SubmissionInput = {
    displayName: "",
    description: "",
    version: "1.0.0",
    iconPath: null,
  },
) {
  const sourcePath = await open({
    multiple: false,
    filters: [{ name: "Bloons TD 6 mod", extensions: ["dll"] }],
  });
  if (typeof sourcePath !== "string") return false;

  const inspection = await invoke<Btd6UploadInspection>(
    "prepare_btd6_mod_upload",
    { sourcePath },
  );
  let uploadedPath: string | null = null;
  let iconStoragePath: string | null = null;
  let uploadCompleted = false;
  try {
    const client = getSocialClient();
    const user = await syncProfile(account);
    const { data: { session }, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    if (!session?.access_token) throw new Error("The Aster Social session has expired.");

    uploadedPath = `${user.id}/${crypto.randomUUID()}-${safeUploadName(inspection.fileName)}`;
    if (input.iconPath) {
      iconStoragePath = `${user.id}/${crypto.randomUUID()}-${safeIconName(input.iconPath)}`;
      const { data: iconSigned, error: iconSignedError } = await client.storage
        .from("btd6-mod-submissions")
        .createSignedUploadUrl(iconStoragePath, { upsert: false });
      if (iconSignedError) throw iconSignedError;
      const { publishableKey } = getSocialStorageConfig();
      await invoke<void>("upload_btd6_submission_icon", {
        sourcePath: input.iconPath,
        signedUrl: iconSigned.signedUrl,
        apiKey: publishableKey,
        accessToken: session.access_token,
      });
    }
    const { data: signed, error: signedError } = await client.storage
      .from("btd6-mod-submissions")
      .createSignedUploadUrl(uploadedPath, { upsert: false });
    if (signedError) throw signedError;

    const { publishableKey } = getSocialStorageConfig();
    await invoke<void>("upload_btd6_mod_submission", {
      stagedPath: inspection.stagedPath,
      expectedSha256: inspection.sha256,
      signedUrl: signed.signedUrl,
      apiKey: publishableKey,
      accessToken: session.access_token,
    });
    uploadCompleted = true;

    const { error: insertError } = await client.from("btd6_mod_submissions").insert({
      owner_id: user.id,
      display_name: input.displayName.trim() || inspection.displayName,
      description: input.description.trim(),
      version: input.version.trim() || "1.0.0",
      file_name: inspection.fileName,
      storage_path: uploadedPath,
      icon_storage_path: iconStoragePath,
      sha256: inspection.sha256,
      size_bytes: inspection.sizeBytes,
      risk_signals: inspection.riskSignals,
      status: "pending",
    });
    if (insertError) throw insertError;
    return inspection;
  } catch (error) {
    const cleanupPaths = [uploadedPath, iconStoragePath].filter(
      (path): path is string => Boolean(path),
    );
    if (cleanupPaths.length) {
      await getSocialClient().storage
        .from("btd6-mod-submissions")
        .remove(cleanupPaths)
        .catch(() => undefined);
    }
    if (!uploadCompleted) {
      await invoke<void>("discard_btd6_mod_upload", {
        stagedPath: inspection.stagedPath,
      }).catch(() => undefined);
    }
    throw error;
  }
}

export async function updateBtd6CommunityMod(
  account: AsterAccount,
  mod: Btd6CommunityMod,
  input: Btd6SubmissionInput,
) {
  if (!mod.ownedByCurrentUser) {
    throw new Error("Only the mod creator can submit an update.");
  }
  const sourcePath = await open({
    multiple: false,
    filters: [{ name: "Bloons TD 6 mod", extensions: ["dll"] }],
  });
  if (typeof sourcePath !== "string") return false;

  const inspection = await invoke<Btd6UploadInspection>(
    "prepare_btd6_mod_upload",
    { sourcePath },
  );
  let uploadedPath: string | null = null;
  let uploadedIconPath: string | null = null;
  let uploadCompleted = false;
  try {
    const client = getSocialClient();
    const user = await syncProfile(account);
    if (user.id !== mod.ownerId) {
      throw new Error("Only the mod creator can submit an update.");
    }
    const { data: { session }, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    if (!session?.access_token) throw new Error("The Aster Social session has expired.");

    uploadedPath = `${user.id}/${crypto.randomUUID()}-${safeUploadName(inspection.fileName)}`;
    if (input.iconPath) {
      uploadedIconPath = `${user.id}/${crypto.randomUUID()}-${safeIconName(input.iconPath)}`;
      const { data: iconSigned, error: iconSignedError } = await client.storage
        .from("btd6-mod-submissions")
        .createSignedUploadUrl(uploadedIconPath, { upsert: false });
      if (iconSignedError) throw iconSignedError;
      const { publishableKey } = getSocialStorageConfig();
      await invoke<void>("upload_btd6_submission_icon", {
        sourcePath: input.iconPath,
        signedUrl: iconSigned.signedUrl,
        apiKey: publishableKey,
        accessToken: session.access_token,
      });
    }

    const { data: signed, error: signedError } = await client.storage
      .from("btd6-mod-submissions")
      .createSignedUploadUrl(uploadedPath, { upsert: false });
    if (signedError) throw signedError;
    const { publishableKey } = getSocialStorageConfig();
    await invoke<void>("upload_btd6_mod_submission", {
      stagedPath: inspection.stagedPath,
      expectedSha256: inspection.sha256,
      signedUrl: signed.signedUrl,
      apiKey: publishableKey,
      accessToken: session.access_token,
    });
    uploadCompleted = true;

    const { error: updateError } = await client.rpc("aster_update_btd6_submission", {
      p_submission_id: mod.id,
      p_display_name: input.displayName.trim() || mod.displayName,
      p_description: input.description.trim(),
      p_version: input.version.trim() || mod.version,
      p_file_name: inspection.fileName,
      p_storage_path: uploadedPath,
      p_icon_storage_path: uploadedIconPath ?? mod.iconStoragePath,
      p_sha256: inspection.sha256,
      p_size_bytes: inspection.sizeBytes,
      p_risk_signals: inspection.riskSignals,
    });
    if (updateError) throw updateError;

    const obsoletePaths = [
      mod.storagePath,
      uploadedIconPath ? mod.iconStoragePath : null,
    ].filter((path): path is string => Boolean(path));
    if (obsoletePaths.length) {
      await client.storage
        .from("btd6-mod-submissions")
        .remove(obsoletePaths)
        .catch(() => undefined);
    }
    return inspection;
  } catch (error) {
    const cleanupPaths = [uploadedPath, uploadedIconPath].filter(
      (path): path is string => Boolean(path),
    );
    if (cleanupPaths.length) {
      await getSocialClient().storage
        .from("btd6-mod-submissions")
        .remove(cleanupPaths)
        .catch(() => undefined);
    }
    if (!uploadCompleted) {
      await invoke<void>("discard_btd6_mod_upload", {
        stagedPath: inspection.stagedPath,
      }).catch(() => undefined);
    }
    throw new Error(btd6CommunityError(error));
  }
}

const communitySelect =
  "id,owner_id,display_name,description,version,file_name,storage_path,icon_storage_path,sha256,size_bytes,risk_signals,status,download_count,created_at";

export async function loadBtd6CommunityMods(account: AsterAccount) {
  try {
    const client = getSocialClient();
    const socialUser = await syncProfile(account);
    const { data, error } = await client
      .from("btd6_mod_submissions")
      .select(communitySelect)
      .eq("status", "approved")
      .order("download_count", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    const mods = ((data ?? []) as Record<string, unknown>[]).map(communityModFromRow);
    mods.forEach((mod) => {
      mod.ownedByCurrentUser = mod.ownerId === socialUser.id;
    });
    const ownerIds = [...new Set(mods.map((mod) => mod.ownerId))];
    if (ownerIds.length) {
      const profiles = await client
        .from("social_profiles")
        .select("user_id,minecraft_name")
        .in("user_id", ownerIds);
      if (!profiles.error) {
        const creatorNames = new Map(
          ((profiles.data ?? []) as Array<{ user_id: string; minecraft_name: string }>).map(
            (profile) => [profile.user_id, profile.minecraft_name],
          ),
        );
        mods.forEach((mod) => {
          mod.creatorName = creatorNames.get(mod.ownerId) ?? mod.creatorName;
        });
      }
    }
    await Promise.all(mods.map(async (mod) => {
      if (!mod.iconStoragePath) return;
      const { data: signed } = await client.storage
        .from("btd6-mod-submissions")
        .createSignedUrl(mod.iconStoragePath, 3600);
      mod.iconUrl = signed?.signedUrl ?? null;
    }));
    return mods;
  } catch (error) {
    throw new Error(btd6CommunityError(error));
  }
}

export async function installBtd6CommunityMod(
  account: AsterAccount,
  mod: Btd6CommunityMod,
  enabled = false,
) {
  try {
    const client = getSocialClient();
    await syncProfile(account);
    const { data: signed, error } = await client.storage
      .from("btd6-mod-submissions")
      .createSignedUrl(mod.storagePath, 600);
    if (error) throw error;
    if (!signed?.signedUrl) throw new Error("Aster could not create the protected download link.");
    await invoke<void>("install_btd6_community_mod", {
      signedUrl: signed.signedUrl,
      fileName: mod.fileName,
      expectedSha256: mod.sha256,
      enabled,
    });
    await client.rpc("aster_record_btd6_download", { p_submission_id: mod.id });
  } catch (error) {
    throw new Error(btd6CommunityError(error));
  }
}

export async function loadBtd6ModeratorStatus(account: AsterAccount) {
  try {
    const client = getSocialClient();
    await syncProfile(account);
    const { data, error } = await client.rpc("aster_is_btd6_moderator");
    if (error) throw error;
    return data === true;
  } catch (error) {
    throw new Error(btd6CommunityError(error));
  }
}

export async function loadBtd6SubmissionQueue(account: AsterAccount) {
  const client = getSocialClient();
  await syncProfile(account);
  const { data, error } = await client
    .from("btd6_mod_submissions")
    .select(communitySelect)
    .order("created_at", { ascending: false });
  if (error) throw new Error(btd6CommunityError(error));
  return ((data ?? []) as Record<string, unknown>[]).map(communityModFromRow);
}

export async function approveBtd6Submission(account: AsterAccount, id: string) {
  const client = getSocialClient();
  await syncProfile(account);
  const { error } = await client
    .from("btd6_mod_submissions")
    .update({ status: "approved", reviewed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(btd6CommunityError(error));
}

export async function deleteBtd6Submission(account: AsterAccount, mod: Btd6CommunityMod) {
  const client = getSocialClient();
  await syncProfile(account);
  const storagePaths = [mod.storagePath, mod.iconStoragePath].filter(
    (path): path is string => Boolean(path),
  );
  if (storagePaths.length) {
    const { error: storageError } = await client.storage
      .from("btd6-mod-submissions")
      .remove(storagePaths);
    if (storageError) throw new Error(btd6CommunityError(storageError));
  }
  const { error } = await client.from("btd6_mod_submissions").delete().eq("id", mod.id);
  if (error) throw new Error(btd6CommunityError(error));
}

const BTD6_MODPACKS_KEY = "aster-launcher.btd6-modpacks.v1";

export function loadBtd6Modpacks(): Btd6Modpack[] {
  try {
    const value = JSON.parse(localStorage.getItem(BTD6_MODPACKS_KEY) ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function saveBtd6Modpacks(modpacks: Btd6Modpack[]) {
  localStorage.setItem(BTD6_MODPACKS_KEY, JSON.stringify(modpacks));
}

export const scanBtd6Mod = (fileName: string) =>
  invoke<void>("scan_btd6_mod", { fileName });

export const setBtd6ModEnabled = (fileName: string, enabled: boolean) =>
  invoke<void>("set_btd6_mod_enabled", { fileName, enabled });

export const removeBtd6Mod = (fileName: string) =>
  invoke<void>("remove_btd6_mod", { fileName });

export const repairBtd6Runtime = () => invoke<void>("repair_btd6_runtime");

export const openBtd6Path = (section: "game" | "mods") =>
  invoke<void>("open_btd6_path", { section });

export const openBtd6Store = () => invoke<void>("open_btd6_store");

export const launchBtd6 = (modded: boolean, riskAcknowledged: boolean) =>
  invoke<{ pid: number; modded: boolean; loader: string }>("launch_btd6", {
    modded,
    riskAcknowledged,
  });

export function requiresBtd6RiskWarning(
  mods: Pick<Btd6ModFile, "enabled">[],
) {
  return mods.some((mod) => mod.enabled);
}
