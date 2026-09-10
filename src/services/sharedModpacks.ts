import { invoke } from "@tauri-apps/api/core";
import type { AsterAccount } from "../types/auth";
import { isTauriRuntime } from "./auth";
import {
  addInstalledModpack,
  readModpackLibrary,
  updateInstalledModpack,
  type InstalledModpack,
} from "./modpackLibrary";
import {
  getSocialClient,
  getSocialStorageConfig,
  syncProfile,
} from "./social";

export type SharedModpackStatus = "pending" | "accepted" | "declined" | "owner";

export interface SharedModpack {
  id: string;
  friendshipId: string;
  ownerId: string;
  ownerName: string;
  recipientId: string;
  recipientName: string;
  sourceKey: string;
  name: string;
  gameVersion: string;
  loader: string;
  status: SharedModpackStatus;
  currentRevision: number;
  attachmentPath: string | null;
  attachmentName: string | null;
  attachmentSize: number;
  updatedAt: string;
}

interface Reservation {
  share_id: string;
  revision_id: string;
  revision_number: number;
  storage_path: string;
}

interface ExportedAttachment {
  fileName: string;
  mimeType: string;
  size: number;
}

interface ImportedModpack {
  name: string;
  version: string;
  gameVersion: string;
  loader: string;
  installedFiles: number;
}

async function sessionFor(account: AsterAccount) {
  const client = getSocialClient();
  await syncProfile(account);
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  if (!data.session?.access_token) {
    throw new Error("The Aster Social session has expired.");
  }
  return { client, accessToken: data.session.access_token };
}

function fromRow(row: Record<string, unknown>): SharedModpack {
  return {
    id: String(row.id),
    friendshipId: String(row.friendship_id),
    ownerId: String(row.owner_id),
    ownerName: String(row.owner_name),
    recipientId: String(row.recipient_id),
    recipientName: String(row.recipient_name),
    sourceKey: String(row.source_key),
    name: String(row.name),
    gameVersion: String(row.game_version),
    loader: String(row.loader),
    status: String(row.access_status) as SharedModpackStatus,
    currentRevision: Number(row.current_revision),
    attachmentPath: row.attachment_path ? String(row.attachment_path) : null,
    attachmentName: row.attachment_name ? String(row.attachment_name) : null,
    attachmentSize: Number(row.attachment_size ?? 0),
    updatedAt: String(row.updated_at),
  };
}

export async function loadSharedModpacks(account: AsterAccount) {
  const { client } = await sessionFor(account);
  const { data, error } = await client.rpc("shared_modpack_list");
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(fromRow);
}

export async function publishSharedModpack(
  account: AsterAccount,
  friendshipId: string,
  modpack: InstalledModpack,
) {
  if (!isTauriRuntime()) {
    throw new Error("Shared modpacks are available in the native launcher.");
  }
  const { client, accessToken } = await sessionFor(account);
  const archive = await invoke<string>("export_modpack_for_sharing", {
    instanceId: modpack.id,
    name: modpack.name,
    version: modpack.version,
    gameVersion: modpack.version,
    loader: modpack.loader,
  });
  let reservation: Reservation | null = null;
  try {
    const { data, error } = await client
      .rpc("shared_modpack_reserve_revision", {
        p_friendship_id: friendshipId,
        p_source_key: modpack.id,
        p_name: modpack.name,
        p_game_version: modpack.version,
        p_loader: modpack.loader,
      })
      .single();
    if (error) throw error;
    reservation = data as Reservation;
    const { data: signed, error: signedError } = await client.storage
      .from("chat-attachments")
      .createSignedUploadUrl(reservation.storage_path, { upsert: false });
    if (signedError) throw signedError;
    const apiKey = getSocialStorageConfig().publishableKey;
    const uploaded = await invoke<ExportedAttachment>("upload_chat_attachment", {
      sourcePath: archive,
      kind: "modpack",
      signedUrl: signed.signedUrl,
      apiKey,
      accessToken,
    });
    const { error: commitError } = await client.rpc("shared_modpack_commit_revision", {
      p_revision_id: reservation.revision_id,
      p_attachment_name: uploaded.fileName,
      p_attachment_size: uploaded.size,
    });
    if (commitError) throw commitError;
    updateInstalledModpack(modpack.id, {
      sharedModpackId: reservation.share_id,
      sharedRevision: reservation.revision_number,
      sharedLatestRevision: reservation.revision_number,
      sharedOwnerName: account.username,
    });
    return reservation.revision_number;
  } catch (error) {
    if (reservation) {
      try {
        await client.storage
          .from("chat-attachments")
          .remove([reservation.storage_path]);
      } catch {
        // The reserved database revision is aborted below even if cleanup fails.
      }
      try {
        await client.rpc("shared_modpack_abort_revision", {
          p_revision_id: reservation.revision_id,
        });
      } catch {
        // Keep the original publishing error as the actionable failure.
      }
    }
    throw error;
  } finally {
    await invoke("remove_cached_chat_attachment", { sourcePath: archive }).catch(
      () => undefined,
    );
  }
}

export async function respondToSharedModpack(
  account: AsterAccount,
  shareId: string,
  accept: boolean,
) {
  const { client } = await sessionFor(account);
  const { error } = await client.rpc("shared_modpack_respond", {
    p_share_id: shareId,
    p_accept: accept,
  });
  if (error) throw error;
}

export async function installSharedModpack(
  account: AsterAccount,
  share: SharedModpack,
  downloadId: string,
) {
  if (!isTauriRuntime() || !share.attachmentPath || !share.attachmentName) {
    throw new Error("This shared modpack revision is not ready.");
  }
  if (share.status !== "accepted") {
    throw new Error("Accept this shared modpack before installing it.");
  }
  const { client } = await sessionFor(account);
  const { data, error } = await client.storage
    .from("chat-attachments")
    .createSignedUrl(share.attachmentPath, 600);
  if (error) throw error;
  const sourcePath = await invoke<string>("download_chat_modpack_for_import", {
    signedUrl: data.signedUrl,
    fileName: share.attachmentName,
  });
  const existing = readModpackLibrary().find(
    (item) => item.sharedModpackId === share.id,
  );
  const instanceId = existing?.id ?? `shared-${crypto.randomUUID()}`;
  try {
    const result = await invoke<ImportedModpack>(
      existing ? "update_imported_modpack" : "import_modpack",
      { instanceId, sourcePath, downloadId },
    );
    const next: InstalledModpack = {
      ...(existing ?? {
        id: instanceId,
        lastPlayed: "Never played",
        status: "ready" as const,
        favorite: false,
        icon: "archive" as const,
        tone: "violet",
        provider: "Local" as const,
      }),
      name: result.name || share.name,
      version: result.gameVersion || share.gameVersion,
      loader: result.loader || share.loader,
      sharedModpackId: share.id,
      sharedRevision: share.currentRevision,
      sharedLatestRevision: share.currentRevision,
      sharedOwnerName: share.ownerName,
    };
    addInstalledModpack(next);
    return { instance: next, installedFiles: result.installedFiles };
  } finally {
    await invoke("remove_cached_chat_attachment", { sourcePath }).catch(
      () => undefined,
    );
  }
}

export async function syncSharedModpackUpdates(account: AsterAccount) {
  const shares = await loadSharedModpacks(account);
  const accepted = new Map(
    shares
      .filter((share) => share.status === "accepted")
      .map((share) => [share.id, share]),
  );
  const library = readModpackLibrary();
  for (const item of library) {
    if (!item.sharedModpackId) continue;
    const share = accepted.get(item.sharedModpackId);
    if (!share) continue;
    updateInstalledModpack(item.id, {
      sharedLatestRevision: share.currentRevision,
      sharedOwnerName: share.ownerName,
    });
  }
  return shares;
}
