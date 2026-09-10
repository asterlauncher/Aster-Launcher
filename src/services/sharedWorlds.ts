import { invoke } from "@tauri-apps/api/core";
import type { AsterAccount } from "../types/auth";
import { isTauriRuntime } from "./auth";
import {
  getSocialClient,
  getSocialStorageConfig,
  syncProfile,
} from "./social";

export type SharedWorldPermission = "play" | "host" | "manage";
export type SharedWorldAccess = SharedWorldPermission | "owner";

export interface SharedWorldRevision {
  id: string;
  number: number;
  storagePath: string;
  sha256: string;
  encryptionKey: string;
  size: number;
  modpackManifest: Record<string, unknown>;
  serverSettings: Record<string, unknown>;
  createdAt: string;
  uploaderName?: string;
}

export interface SharedWorldMember {
  userId: string;
  minecraftName: string;
  permission: SharedWorldPermission;
}

export interface SharedWorld {
  id: string;
  name: string;
  minecraftVersion: string;
  loader: string;
  sourceInstanceName: string;
  sourceWorldName: string;
  accessLevel: SharedWorldAccess;
  ownerName: string;
  currentRevision: number;
  latestRevision: SharedWorldRevision | null;
  members: SharedWorldMember[];
  activeHost: { minecraftName: string; expiresAt: string } | null;
  updatedAt: string;
}

export interface SharedWorldBinding {
  worldId: string;
  instanceId: string;
  worldName: string;
  revision: number;
}

interface SnapshotResult {
  sourcePath: string;
  sha256: string;
  size: number;
  encryptionKey: string;
}

interface RevisionReservation {
  revision_id: string;
  revision_number: number;
  storage_path: string;
}

const bindingsKey = "aster.shared-world-bindings.v1";

function requireNative() {
  if (!isTauriRuntime()) {
    throw new Error("Aster Shared Worlds is available in the native launcher.");
  }
}

function rowToSharedWorld(row: Record<string, unknown>): SharedWorld {
  return {
    id: String(row.id),
    name: String(row.name),
    minecraftVersion: String(row.minecraft_version),
    loader: String(row.loader),
    sourceInstanceName: String(row.source_instance_name),
    sourceWorldName: String(row.source_world_name),
    accessLevel: String(row.access_level) as SharedWorldAccess,
    ownerName: String(row.owner_name),
    currentRevision: Number(row.current_revision),
    latestRevision: (row.latest_revision as SharedWorldRevision | null) ?? null,
    members: Array.isArray(row.members)
      ? (row.members as SharedWorldMember[])
      : [],
    activeHost:
      row.active_host && typeof row.active_host === "object"
        ? (row.active_host as SharedWorld["activeHost"])
        : null,
    updatedAt: String(row.updated_at),
  };
}

async function sessionFor(account: AsterAccount) {
  const client = getSocialClient();
  await syncProfile(account);
  const {
    data: { session },
    error,
  } = await client.auth.getSession();
  if (error) throw error;
  if (!session?.access_token) {
    throw new Error("The Aster Social session has expired.");
  }
  return { client, accessToken: session.access_token };
}

export async function loadSharedWorlds(
  account: AsterAccount,
): Promise<SharedWorld[]> {
  const { client } = await sessionFor(account);
  const { data, error } = await client.rpc("shared_world_list");
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(rowToSharedWorld);
}

export async function loadSharedWorldRevisions(
  account: AsterAccount,
  worldId: string,
): Promise<SharedWorldRevision[]> {
  const { client } = await sessionFor(account);
  const { data, error } = await client.rpc("shared_world_revision_history", {
    p_world_id: worldId,
  });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    number: Number(row.number),
    storagePath: String(row.storage_path),
    sha256: String(row.sha256),
    encryptionKey: String(row.encryption_key),
    size: Number(row.size),
    modpackManifest: (row.modpack_manifest ?? {}) as Record<string, unknown>,
    serverSettings: (row.server_settings ?? {}) as Record<string, unknown>,
    createdAt: String(row.created_at),
    uploaderName: String(row.uploader_name),
  }));
}

async function uploadRevision(
  account: AsterAccount,
  worldId: string,
  instanceId: string,
  worldName: string,
  manifest: Record<string, unknown>,
  serverSettings: Record<string, unknown> = {},
) {
  requireNative();
  const { client, accessToken } = await sessionFor(account);
  const snapshot = await invoke<SnapshotResult>("create_shared_world_snapshot", {
    instanceId,
    worldName,
  });
  let reservation: RevisionReservation | null = null;
  try {
    const { data, error } = await client
      .rpc("shared_world_reserve_revision", {
        p_world_id: worldId,
        p_sha256: snapshot.sha256,
        p_encrypted_key: snapshot.encryptionKey,
        p_byte_size: snapshot.size,
        p_modpack_manifest: manifest,
        p_server_settings: serverSettings,
      })
      .single();
    if (error) throw error;
    reservation = data as RevisionReservation;
    const { data: signed, error: signedError } = await client.storage
      .from("shared-worlds")
      .createSignedUploadUrl(reservation.storage_path, { upsert: false });
    if (signedError) throw signedError;
    const supabaseKey = getSocialStorageConfig().publishableKey;
    if (!supabaseKey) throw new Error("The Supabase publishable key is missing.");
    await invoke("upload_shared_world_snapshot", {
      sourcePath: snapshot.sourcePath,
      signedUrl: signed.signedUrl,
      apiKey: supabaseKey,
      accessToken,
    });
    const { error: commitError } = await client.rpc(
      "shared_world_commit_revision",
      { p_revision_id: reservation.revision_id },
    );
    if (commitError) throw commitError;
    return reservation.revision_number;
  } catch (error) {
    if (reservation) {
      await client.storage
        .from("shared-worlds")
        .remove([reservation.storage_path])
        .catch(() => undefined);
      try {
        await client.rpc("shared_world_abort_revision", {
          p_revision_id: reservation.revision_id,
        });
      } catch {
        // The abandoned revision is harmless and can be cleaned up later.
      }
    }
    throw error;
  } finally {
    await invoke("remove_cached_shared_world_snapshot", {
      sourcePath: snapshot.sourcePath,
    }).catch(() => undefined);
  }
}

export async function createSharedWorld(
  account: AsterAccount,
  input: {
    name: string;
    instanceId: string;
    instanceName: string;
    worldName: string;
    minecraftVersion: string;
    loader: string;
  },
) {
  const { client } = await sessionFor(account);
  const { data, error } = await client.rpc("shared_world_create", {
    p_name: input.name,
    p_minecraft_version: input.minecraftVersion,
    p_loader: input.loader,
    p_instance_name: input.instanceName,
    p_world_name: input.worldName,
  });
  if (error) throw error;
  const worldId = String(data);
  try {
    await uploadRevision(
      account,
      worldId,
      input.instanceId,
      input.worldName,
      {
        instanceName: input.instanceName,
        minecraftVersion: input.minecraftVersion,
        loader: input.loader,
      },
    );
    saveSharedWorldBinding({
      worldId,
      instanceId: input.instanceId,
      worldName: input.worldName,
      revision: 1,
    });
    return worldId;
  } catch (caught) {
    try {
      await client.rpc("shared_world_delete", { p_world_id: worldId });
    } catch {
      // Preserve the original snapshot/upload error for the user.
    }
    throw caught;
  }
}

export async function publishSharedWorldRevision(
  account: AsterAccount,
  world: SharedWorld,
  binding: SharedWorldBinding,
  serverSettings: Record<string, unknown> = {},
) {
  const revision = await uploadRevision(
    account,
    world.id,
    binding.instanceId,
    binding.worldName,
    world.latestRevision?.modpackManifest ?? {
      instanceName: world.sourceInstanceName,
      minecraftVersion: world.minecraftVersion,
      loader: world.loader,
    },
    serverSettings,
  );
  saveSharedWorldBinding({ ...binding, revision });
  return revision;
}

export async function restoreSharedWorld(
  account: AsterAccount,
  world: SharedWorld,
  instanceId: string,
  worldName = world.sourceWorldName,
  selectedRevision?: SharedWorldRevision,
) {
  requireNative();
  const revision = selectedRevision ?? world.latestRevision;
  if (!revision) throw new Error("This shared world has no ready revision.");
  const { client } = await sessionFor(account);
  const { data, error } = await client.storage
    .from("shared-worlds")
    .createSignedUrl(revision.storagePath, 600);
  if (error) throw error;
  const sourcePath = await invoke<string>("download_shared_world_snapshot", {
    signedUrl: data.signedUrl,
    expectedSha256: revision.sha256,
    expectedSize: revision.size,
  });
  try {
    await invoke("restore_shared_world_snapshot", {
      instanceId,
      worldName,
      sourcePath,
      encryptionKey: revision.encryptionKey,
    });
    const binding = {
      worldId: world.id,
      instanceId,
      worldName,
      revision: revision.number,
    };
    saveSharedWorldBinding(binding);
    return binding;
  } finally {
    await invoke("remove_cached_shared_world_snapshot", {
      sourcePath,
    }).catch(() => undefined);
  }
}

export async function shareWorldWithFriend(
  account: AsterAccount,
  worldId: string,
  minecraftName: string,
  permission: SharedWorldPermission,
) {
  const { client } = await sessionFor(account);
  const { error } = await client.rpc("shared_world_share", {
    p_world_id: worldId,
    p_minecraft_name: minecraftName,
    p_permission: permission,
  });
  if (error) throw error;
}

export async function removeSharedWorldMember(
  account: AsterAccount,
  worldId: string,
  userId: string,
) {
  const { client } = await sessionFor(account);
  const { error } = await client.rpc("shared_world_remove_member", {
    p_world_id: worldId,
    p_user_id: userId,
  });
  if (error) throw error;
}

export async function deleteSharedWorld(
  account: AsterAccount,
  worldId: string,
) {
  const { client } = await sessionFor(account);
  const { error } = await client.rpc("shared_world_delete", {
    p_world_id: worldId,
  });
  if (error) throw error;
  removeSharedWorldBinding(worldId);
}

export async function acquireSharedWorldHost(
  account: AsterAccount,
  worldId: string,
): Promise<{ leaseToken: string; expiresAt: string }> {
  const { client } = await sessionFor(account);
  const { data, error } = await client
    .rpc("shared_world_acquire_host", { p_world_id: worldId })
    .single();
  if (error) throw error;
  const row = data as { lease_token: string; expires_at: string };
  return { leaseToken: row.lease_token, expiresAt: row.expires_at };
}

export async function heartbeatSharedWorldHost(
  account: AsterAccount,
  worldId: string,
  leaseToken: string,
) {
  const { client } = await sessionFor(account);
  const { error } = await client.rpc("shared_world_heartbeat", {
    p_world_id: worldId,
    p_lease_token: leaseToken,
  });
  if (error) throw error;
}

export async function releaseSharedWorldHost(
  account: AsterAccount,
  worldId: string,
  leaseToken: string,
) {
  const { client } = await sessionFor(account);
  const { error } = await client.rpc("shared_world_release_host", {
    p_world_id: worldId,
    p_lease_token: leaseToken,
  });
  if (error) throw error;
}

export function readSharedWorldBindings(): SharedWorldBinding[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(bindingsKey) ?? "[]");
    return Array.isArray(parsed) ? (parsed as SharedWorldBinding[]) : [];
  } catch {
    return [];
  }
}

export function saveSharedWorldBinding(binding: SharedWorldBinding) {
  const next = readSharedWorldBindings().filter(
    (item) =>
      item.worldId !== binding.worldId &&
      !(item.instanceId === binding.instanceId && item.worldName === binding.worldName),
  );
  next.push(binding);
  localStorage.setItem(bindingsKey, JSON.stringify(next));
}

export function removeSharedWorldBinding(worldId: string) {
  localStorage.setItem(
    bindingsKey,
    JSON.stringify(
      readSharedWorldBindings().filter((binding) => binding.worldId !== worldId),
    ),
  );
}

export function findSharedWorldBinding(
  instanceId: string,
  worldName: string,
) {
  return (
    readSharedWorldBindings().find(
      (binding) =>
        binding.instanceId === instanceId && binding.worldName === worldName,
    ) ?? null
  );
}
