import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  PUBLIC_SUPABASE_URL,
} from "../config/publicServices";

export type PresenceStatus =
  | "connecting"
  | "online"
  | "offline"
  | "error"
  | "unconfigured";

export interface PresenceSnapshot {
  onlineCount: number | null;
  status: PresenceStatus;
  updatedAt: Date | null;
  message: string;
}

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL?.trim() || PUBLIC_SUPABASE_URL;
const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const isPresenceConfigured = Boolean(
  supabaseUrl && supabasePublishableKey,
);

let presenceClient: SupabaseClient | null = null;
const presenceClientIdKey = "aster-launcher-presence-client-id";

function getPresenceClient() {
  if (!isPresenceConfigured || !supabaseUrl || !supabasePublishableKey) {
    return null;
  }

  if (!presenceClient) {
    presenceClient = createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
  }

  return presenceClient;
}

function getPresenceClientId() {
  const saved = window.localStorage.getItem(presenceClientIdKey);
  if (saved) return saved;

  const clientId = crypto.randomUUID();
  window.localStorage.setItem(presenceClientIdKey, clientId);
  return clientId;
}

function parseCount(value: unknown) {
  const count = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(count) || count < 0) {
    throw new Error("Presence service returned an invalid online count.");
  }
  return count;
}

function describePresenceError(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "The presence service could not be reached.";
}

export async function sendPresenceHeartbeat(): Promise<PresenceSnapshot> {
  const client = getPresenceClient();
  if (!client) {
    return {
      onlineCount: null,
      status: "unconfigured",
      updatedAt: null,
      message: "Presence service is not configured.",
    };
  }

  if (!navigator.onLine) {
    return {
      onlineCount: null,
      status: "offline",
      updatedAt: null,
      message: "This device is offline.",
    };
  }

  try {
    const { data, error } = await client.rpc("launcher_presence_heartbeat", {
      p_client_id: getPresenceClientId(),
      p_launcher_version: "0.5.1",
    });

    if (error) throw error;

    return {
      onlineCount: parseCount(data),
      status: "online",
      updatedAt: new Date(),
      message: "Live launcher presence is connected.",
    };
  } catch (error) {
    return {
      onlineCount: null,
      status: "error",
      updatedAt: null,
      message: describePresenceError(error),
    };
  }
}

export async function leaveLauncherPresence() {
  const client = getPresenceClient();
  if (!client || !navigator.onLine) return;

  try {
    await client.rpc("launcher_presence_leave", {
      p_client_id: getPresenceClientId(),
    });
  } catch {
    // The server expires stale sessions when an app cannot send its final leave.
  }
}
