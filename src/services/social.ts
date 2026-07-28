import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  PUBLIC_SUPABASE_URL,
} from "../config/publicServices";
import type { PublicAccount } from "../types/auth";
import { isTauriRuntime } from "./auth";

export type SocialAttachmentKind = "screenshot" | "modpack";

export interface SocialAttachment {
  kind: SocialAttachmentKind;
  path: string;
  name: string;
  mime: string;
  size: number;
  url: string;
}

export interface ShareableSocialModpack {
  id: string;
  name: string;
  version: string;
  loader: string;
}

export interface InstalledSocialModpack {
  name: string;
  version: string;
  gameVersion: string;
  loader: string;
  installedFiles: number;
}

export interface SocialPlayer {
  userId: string;
  minecraftId: string;
  minecraftName: string;
  lastSeen: string;
  online: boolean;
}

export interface SocialFriend extends SocialPlayer {
  friendshipId: string;
  friendsSince: string;
}

export interface SocialFriendRequest {
  id: string;
  direction: "incoming" | "outgoing";
  player: SocialPlayer;
  createdAt: string;
}

export interface SocialMessage {
  id: string;
  friendshipId: string;
  senderId: string;
  body: string;
  attachment: SocialAttachment | null;
  createdAt: string;
  mine: boolean;
}

export interface SocialMessageActivity extends SocialMessage {
  senderName: string;
}

export interface SocialSnapshot {
  currentUserId: string;
  friends: SocialFriend[];
  requests: SocialFriendRequest[];
}

interface ProfileRow {
  user_id: string;
  minecraft_id: string;
  minecraft_name: string;
  last_seen: string;
}

interface FriendshipRow {
  id: string;
  member_a: string;
  member_b: string;
  created_at: string;
}

interface FriendRequestRow {
  id: string;
  sender_id: string;
  receiver_id: string;
  created_at: string;
}

interface MessageRow {
  id: string;
  friendship_id: string;
  sender_id: string;
  body: string | null;
  attachment_kind: SocialAttachmentKind | null;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
  attachment_size: number | null;
  created_at: string;
}

interface UploadedAttachmentResult {
  fileName: string;
  mimeType: string;
  size: number;
}

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL?.trim() || PUBLIC_SUPABASE_URL;
const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SOCIAL_AUTH_COOLDOWN_KEY = "aster-social.auth-cooldown.v1";
const SOCIAL_AUTH_COOLDOWN_MS = 10 * 60 * 1000;
const PROFILE_SYNC_TTL_MS = 45 * 1000;

export const isSocialConfigured = Boolean(
  supabaseUrl && supabasePublishableKey,
);

let socialClient: SupabaseClient | null = null;
let sessionPromise: Promise<User> | null = null;
let socialAuthCooldownUntil = loadSocialAuthCooldown();
let profileSyncPromise: Promise<User> | null = null;
let profileSyncKey = "";
let profileSyncedAt = 0;
const attachmentUrlCache = new Map<
  string,
  { url: string; expiresAt: number }
>();

function loadSocialAuthCooldown() {
  if (typeof window === "undefined") return 0;
  const stored = Number(window.localStorage.getItem(SOCIAL_AUTH_COOLDOWN_KEY));
  return Number.isFinite(stored) && stored > Date.now() ? stored : 0;
}

function setSocialAuthCooldown(until: number) {
  socialAuthCooldownUntil = until;
  if (typeof window === "undefined") return;
  if (until > Date.now()) {
    window.localStorage.setItem(SOCIAL_AUTH_COOLDOWN_KEY, String(until));
  } else {
    window.localStorage.removeItem(SOCIAL_AUTH_COOLDOWN_KEY);
  }
}

export function isSocialRateLimitError(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as {
    message?: unknown;
    status?: unknown;
    code?: unknown;
  };
  const message =
    typeof candidate.message === "string"
      ? candidate.message.toLowerCase()
      : "";
  return (
    candidate.status === 429 ||
    candidate.code === 429 ||
    candidate.code === "429" ||
    message.includes("rate limit") ||
    message.includes("too many requests")
  );
}

function socialCooldownMessage() {
  const remainingMinutes = Math.max(
    1,
    Math.ceil((socialAuthCooldownUntil - Date.now()) / 60_000),
  );
  return `Aster Social is cooling down after too many sign-in attempts. Aster will retry automatically in about ${remainingMinutes} minute${remainingMinutes === 1 ? "" : "s"}.`;
}

export function normalizeSocialSearchQuery(query: string) {
  return query.trim().replace(/[^a-zA-Z0-9_]/g, "").slice(0, 16);
}

function getSocialClient() {
  if (!isSocialConfigured || !supabaseUrl || !supabasePublishableKey) {
    throw new Error(
      "Aster Social is not configured. Add the Supabase environment values first.",
    );
  }

  if (!socialClient) {
    socialClient = createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        storageKey: "aster-launcher-social-auth",
      },
    });
  }

  return socialClient;
}

function describeSocialError(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    const message = error.message.trim();
    if (!message) {
      return "Aster Social returned an empty error. Check that supabase/social.sql was run completely.";
    }
    if (
      message.includes("social_profiles") ||
      message.includes("social_sync_profile") ||
      message.includes("attachment_kind") ||
      message.includes("schema cache")
    ) {
      return "Aster Social is not installed in Supabase yet. Run supabase/social.sql once.";
    }
    if (
      message.includes("Bad Request") ||
      message.includes("chat-attachments") ||
      message.includes("Bucket not found")
    ) {
      return "Chat storage is not ready yet. Run the updated supabase/social.sql once, then try the upload again.";
    }
    if (isSocialRateLimitError(error)) {
      return socialCooldownMessage();
    }
    return message;
  }
  if (error instanceof Error) return error.message;
  return "Aster Social could not complete this request.";
}

function isMissingSocialSearchFunction(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === "PGRST202" ||
    (typeof candidate.message === "string" &&
      candidate.message.includes("social_search_players"))
  );
}

function cleanAttachmentName(path: string) {
  const fileName = path.split(/[\\/]/).pop()?.trim() || "attachment";
  const sanitized = fileName
    .replace(/[^a-zA-Z0-9._() -]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 160);
  return sanitized || "attachment";
}

async function signedAttachmentUrl(path: string) {
  const cached = attachmentUrlCache.get(path);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  const client = getSocialClient();
  const { data, error } = await client.storage
    .from("chat-attachments")
    .createSignedUrl(path, 900);
  if (error) throw error;
  attachmentUrlCache.set(path, {
    url: data.signedUrl,
    expiresAt: Date.now() + 12 * 60 * 1000,
  });
  return data.signedUrl;
}

async function messageFromRow(
  message: MessageRow,
  currentUserId: string,
): Promise<SocialMessage> {
  const hasAttachment = Boolean(
    message.attachment_kind &&
      message.attachment_path &&
      message.attachment_name &&
      message.attachment_mime &&
      message.attachment_size,
  );
  const attachment = hasAttachment
    ? {
        kind: message.attachment_kind!,
        path: message.attachment_path!,
        name: message.attachment_name!,
        mime: message.attachment_mime!,
        size: Number(message.attachment_size),
        url: await signedAttachmentUrl(message.attachment_path!),
      }
    : null;
  return {
    id: message.id,
    friendshipId: message.friendship_id,
    senderId: message.sender_id,
    body: message.body ?? "",
    attachment,
    createdAt: message.created_at,
    mine: message.sender_id === currentUserId,
  };
}

async function ensureSocialUser() {
  const client = getSocialClient();
  if (sessionPromise) return sessionPromise;

  sessionPromise = (async () => {
    const {
      data: { session },
      error: sessionError,
    } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    if (session?.user) {
      setSocialAuthCooldown(0);
      return session.user;
    }

    // A previous anonymous-signup limit must never block a restored session.
    // Only delay creation when this installation genuinely needs a new user.
    if (socialAuthCooldownUntil > Date.now()) {
      throw new Error(socialCooldownMessage());
    }
    if (socialAuthCooldownUntil > 0) {
      setSocialAuthCooldown(0);
    }

    const { data, error } = await client.auth.signInAnonymously();
    if (error) throw error;
    if (!data.user) throw new Error("Supabase did not create a social session.");
    return data.user;
  })();

  try {
    const user = await sessionPromise;
    setSocialAuthCooldown(0);
    return user;
  } catch (error) {
    sessionPromise = null;
    if (isSocialRateLimitError(error)) {
      setSocialAuthCooldown(Date.now() + SOCIAL_AUTH_COOLDOWN_MS);
    }
    throw new Error(describeSocialError(error));
  }
}

function playerFromProfile(profile: ProfileRow): SocialPlayer {
  const lastSeenTime = new Date(profile.last_seen).getTime();
  return {
    userId: profile.user_id,
    minecraftId: profile.minecraft_id,
    minecraftName: profile.minecraft_name,
    lastSeen: profile.last_seen,
    online:
      Number.isFinite(lastSeenTime) &&
      Date.now() - lastSeenTime < 90_000,
  };
}

async function syncProfile(account: PublicAccount) {
  const client = getSocialClient();
  const user = await ensureSocialUser();
  const nextKey = `${user.id}:${account.id}:${account.username.toLowerCase()}`;
  const cacheIsFresh =
    profileSyncKey === nextKey &&
    profileSyncedAt > 0 &&
    Date.now() - profileSyncedAt < PROFILE_SYNC_TTL_MS;

  if (cacheIsFresh) return user;
  if (profileSyncPromise && profileSyncKey === nextKey) {
    return profileSyncPromise;
  }

  profileSyncKey = nextKey;
  const currentSync = (async () => {
    const { error } = await client.rpc("social_sync_profile", {
      p_minecraft_id: account.id,
      p_minecraft_name: account.username,
    });
    if (error) throw error;
    profileSyncedAt = Date.now();
    return user;
  })();
  profileSyncPromise = currentSync;

  try {
    return await currentSync;
  } catch (error) {
    profileSyncedAt = 0;
    profileSyncKey = "";
    throw error;
  } finally {
    if (profileSyncPromise === currentSync) {
      profileSyncPromise = null;
    }
  }
}

async function loadProfiles(ids: string[]) {
  if (ids.length === 0) return new Map<string, ProfileRow>();
  const client = getSocialClient();
  const { data, error } = await client
    .from("social_profiles")
    .select("user_id,minecraft_id,minecraft_name,last_seen")
    .in("user_id", [...new Set(ids)]);
  if (error) throw error;
  return new Map(
    ((data ?? []) as ProfileRow[]).map((profile) => [profile.user_id, profile]),
  );
}

export async function loadSocialSnapshot(
  account: PublicAccount,
): Promise<SocialSnapshot> {
  try {
    const client = getSocialClient();
    const user = await syncProfile(account);
    const [friendshipsResult, requestsResult] = await Promise.all([
      client
        .from("friendships")
        .select("id,member_a,member_b,created_at")
        .order("created_at", { ascending: false }),
      client
        .from("friend_requests")
        .select("id,sender_id,receiver_id,created_at")
        .order("created_at", { ascending: false }),
    ]);
    if (friendshipsResult.error) throw friendshipsResult.error;
    if (requestsResult.error) throw requestsResult.error;

    const friendships = (friendshipsResult.data ?? []) as FriendshipRow[];
    const requests = (requestsResult.data ?? []) as FriendRequestRow[];
    const relatedIds = [
      ...friendships.flatMap((item) => [item.member_a, item.member_b]),
      ...requests.flatMap((item) => [item.sender_id, item.receiver_id]),
    ].filter((id) => id !== user.id);
    const profiles = await loadProfiles(relatedIds);

    const friends = friendships.flatMap<SocialFriend>((friendship) => {
      const otherId =
        friendship.member_a === user.id
          ? friendship.member_b
          : friendship.member_a;
      const profile = profiles.get(otherId);
      if (!profile) return [];
      return [
        {
          ...playerFromProfile(profile),
          friendshipId: friendship.id,
          friendsSince: friendship.created_at,
        },
      ];
    });

    const mappedRequests = requests.flatMap<SocialFriendRequest>((request) => {
      const incoming = request.receiver_id === user.id;
      const otherId = incoming ? request.sender_id : request.receiver_id;
      const profile = profiles.get(otherId);
      if (!profile) return [];
      return [
        {
          id: request.id,
          direction: incoming ? "incoming" : "outgoing",
          player: playerFromProfile(profile),
          createdAt: request.created_at,
        },
      ];
    });

    return {
      currentUserId: user.id,
      friends: friends.sort(
        (a, b) =>
          Number(b.online) - Number(a.online) ||
          a.minecraftName.localeCompare(b.minecraftName),
      ),
      requests: mappedRequests,
    };
  } catch (error) {
    throw new Error(describeSocialError(error));
  }
}

export async function searchSocialPlayers(
  account: PublicAccount,
  query: string,
): Promise<SocialPlayer[]> {
  const normalized = normalizeSocialSearchQuery(query);
  if (normalized.length < 2) return [];
  try {
    const client = getSocialClient();
    const user = await syncProfile(account);
    const searchResult = await client.rpc("social_search_players", {
      p_query: normalized,
    });
    if (
      searchResult.error &&
      isMissingSocialSearchFunction(searchResult.error)
    ) {
      const fallback = await client
        .from("social_profiles")
        .select("user_id,minecraft_id,minecraft_name,last_seen")
        .ilike("minecraft_name", `${normalized}%`)
        .neq("user_id", user.id)
        .limit(8);
      if (fallback.error) throw fallback.error;
      return ((fallback.data ?? []) as ProfileRow[]).map(playerFromProfile);
    }
    if (searchResult.error) throw searchResult.error;
    return ((searchResult.data ?? []) as ProfileRow[])
      .filter((profile) => profile.user_id !== user.id)
      .map(playerFromProfile);
  } catch (error) {
    throw new Error(describeSocialError(error));
  }
}

export async function sendSocialFriendRequest(
  account: PublicAccount,
  minecraftName: string,
) {
  try {
    const client = getSocialClient();
    await syncProfile(account);
    const { error } = await client.rpc("social_send_friend_request", {
      p_minecraft_name: minecraftName.trim(),
    });
    if (error) throw error;
  } catch (error) {
    throw new Error(describeSocialError(error));
  }
}

export async function respondToSocialFriendRequest(
  account: PublicAccount,
  requestId: string,
  accept: boolean,
) {
  try {
    const client = getSocialClient();
    await syncProfile(account);
    const { error } = await client.rpc("social_respond_friend_request", {
      p_request_id: requestId,
      p_accept: accept,
    });
    if (error) throw error;
  } catch (error) {
    throw new Error(describeSocialError(error));
  }
}

export async function cancelSocialFriendRequest(
  account: PublicAccount,
  requestId: string,
) {
  try {
    const client = getSocialClient();
    await syncProfile(account);
    const { error } = await client.rpc("social_cancel_friend_request", {
      p_request_id: requestId,
    });
    if (error) throw error;
  } catch (error) {
    throw new Error(describeSocialError(error));
  }
}

export async function removeSocialFriend(
  account: PublicAccount,
  friendshipId: string,
) {
  try {
    const client = getSocialClient();
    await syncProfile(account);
    const { error } = await client.rpc("social_remove_friend", {
      p_friendship_id: friendshipId,
    });
    if (error) throw error;
  } catch (error) {
    throw new Error(describeSocialError(error));
  }
}

export async function loadSocialMessages(
  account: PublicAccount,
  friendshipId: string,
): Promise<SocialMessage[]> {
  try {
    const client = getSocialClient();
    const user = await syncProfile(account);
    const { data, error } = await client
      .from("social_messages")
      .select(
        "id,friendship_id,sender_id,body,attachment_kind,attachment_path,attachment_name,attachment_mime,attachment_size,created_at",
      )
      .eq("friendship_id", friendshipId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return Promise.all(
      ((data ?? []) as MessageRow[])
        .reverse()
        .map((message) => messageFromRow(message, user.id)),
    );
  } catch (error) {
    throw new Error(describeSocialError(error));
  }
}

async function uploadSocialAttachment(
  account: PublicAccount,
  friendshipId: string,
  kind: SocialAttachmentKind,
  selected: string,
) {
  let uploadedPath: string | null = null;
  try {
    const client = getSocialClient();
    const user = await syncProfile(account);
    const {
      data: { session },
      error: sessionError,
    } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    if (!session?.access_token) {
      throw new Error("The Aster Social session has expired.");
    }
    const safeName = cleanAttachmentName(selected);
    uploadedPath = `${friendshipId}/${user.id}/${crypto.randomUUID()}-${safeName}`;
    const { data: signedUpload, error: signedUploadError } = await client.storage
      .from("chat-attachments")
      .createSignedUploadUrl(uploadedPath, { upsert: false });
    if (signedUploadError) throw signedUploadError;

    const uploaded = await invoke<UploadedAttachmentResult>(
      "upload_chat_attachment",
      {
        sourcePath: selected,
        kind,
        signedUrl: signedUpload.signedUrl,
        apiKey: supabasePublishableKey,
        accessToken: session.access_token,
      },
    );
    const { error: messageError } = await client.from("social_messages").insert({
      friendship_id: friendshipId,
      sender_id: user.id,
      body: null,
      attachment_kind: kind,
      attachment_path: uploadedPath,
      attachment_name: uploaded.fileName,
      attachment_mime: uploaded.mimeType,
      attachment_size: uploaded.size,
    });
    if (messageError) throw messageError;
    return true;
  } catch (error) {
    if (uploadedPath) {
      await getSocialClient()
        .storage.from("chat-attachments")
        .remove([uploadedPath])
        .catch(() => undefined);
    }
    throw new Error(describeSocialError(error));
  }
}

export async function sendSocialAttachment(
  account: PublicAccount,
  friendshipId: string,
  kind: SocialAttachmentKind,
) {
  if (!isTauriRuntime()) {
    throw new Error("Chat attachments are available in the native launcher.");
  }
  const selected = await open({
    multiple: false,
    directory: false,
    title:
      kind === "screenshot"
        ? "Choose a screenshot"
        : "Choose a modpack archive",
    filters:
      kind === "screenshot"
        ? [{ name: "Screenshots", extensions: ["png", "jpg", "jpeg", "webp"] }]
        : [{ name: "Modpacks", extensions: ["zip", "mrpack"] }],
  });
  if (!selected || Array.isArray(selected)) return false;
  return uploadSocialAttachment(account, friendshipId, kind, selected);
}

export async function sendSocialModpack(
  account: PublicAccount,
  friendshipId: string,
  modpack: ShareableSocialModpack,
) {
  if (!isTauriRuntime()) {
    throw new Error("Modpack sharing is available in the native launcher.");
  }
  const exportedPath = await invoke<string>("export_modpack_for_sharing", {
    instanceId: modpack.id,
    name: modpack.name,
    version: modpack.version,
    gameVersion: modpack.version,
    loader: modpack.loader,
  });
  try {
    return await uploadSocialAttachment(
      account,
      friendshipId,
      "modpack",
      exportedPath,
    );
  } finally {
    await invoke("remove_cached_chat_attachment", {
      sourcePath: exportedPath,
    }).catch(() => undefined);
  }
}

export async function downloadSocialAttachment(
  attachment: SocialAttachment,
) {
  if (!isTauriRuntime()) {
    throw new Error("Attachment downloads are available in the native launcher.");
  }
  const extension = attachment.name.split(".").pop()?.toLowerCase();
  const destination = await save({
    title:
      attachment.kind === "screenshot"
        ? "Save screenshot"
        : "Save modpack archive",
    defaultPath: attachment.name,
    filters:
      attachment.kind === "screenshot"
        ? [{ name: "Image", extensions: [extension || "png"] }]
        : [{ name: "Modpack", extensions: [extension || "zip"] }],
  });
  if (!destination) return false;
  const url = await signedAttachmentUrl(attachment.path);
  await invoke("download_chat_attachment", {
    signedUrl: url,
    destinationPath: destination,
    maxBytes: attachment.kind === "screenshot" ? 12 * 1024 * 1024 : 250 * 1024 * 1024,
  });
  return true;
}

export async function installSocialModpackAttachment(
  attachment: SocialAttachment,
  instanceId: string,
  downloadId: string,
): Promise<InstalledSocialModpack> {
  if (!isTauriRuntime()) {
    throw new Error("Modpack installation is available in the native launcher.");
  }
  if (attachment.kind !== "modpack") {
    throw new Error("This chat attachment is not a modpack.");
  }
  const signedUrl = await signedAttachmentUrl(attachment.path);
  const sourcePath = await invoke<string>("download_chat_modpack_for_import", {
    signedUrl,
    fileName: attachment.name,
  });
  try {
    return await invoke<InstalledSocialModpack>("import_modpack", {
      instanceId,
      sourcePath,
      downloadId,
    });
  } finally {
    await invoke("remove_cached_chat_attachment", {
      sourcePath,
    }).catch(() => undefined);
  }
}

export async function sendSocialMessage(
  account: PublicAccount,
  friendshipId: string,
  body: string,
) {
  const trimmed = body.trim();
  if (!trimmed) return;
  if (trimmed.length > 500) {
    throw new Error("Messages can contain up to 500 characters.");
  }
  try {
    const client = getSocialClient();
    const user = await syncProfile(account);
    const { error } = await client.from("social_messages").insert({
      friendship_id: friendshipId,
      sender_id: user.id,
      body: trimmed,
    });
    if (error) throw error;
  } catch (error) {
    throw new Error(describeSocialError(error));
  }
}

export async function loadRecentSocialMessages(
  account: PublicAccount,
): Promise<SocialMessageActivity[]> {
  try {
    const client = getSocialClient();
    const user = await syncProfile(account);
    const { data, error } = await client
      .from("social_messages")
      .select(
        "id,friendship_id,sender_id,body,attachment_kind,attachment_path,attachment_name,attachment_mime,attachment_size,created_at",
      )
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw error;
    const rows = (data ?? []) as MessageRow[];
    const profiles = await loadProfiles(
      rows.map((message) => message.sender_id).filter((id) => id !== user.id),
    );
    return Promise.all(
      rows.map(async (message) => ({
        ...(await messageFromRow(message, user.id)),
        senderName:
          message.sender_id === user.id
            ? account.username
            : profiles.get(message.sender_id)?.minecraft_name ?? "Aster player",
      })),
    );
  } catch (error) {
    throw new Error(describeSocialError(error));
  }
}
