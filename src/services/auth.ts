import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type {
  AuthErrorPayload,
  AuthStart,
  BackendAuthStatus,
  PublicAccount,
} from "../types/auth";

export function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

export async function beginMicrosoftLogin(): Promise<AuthStart> {
  return invoke<AuthStart>("begin_microsoft_login");
}

export async function completeMicrosoftLogin(
  requestId: string,
): Promise<PublicAccount> {
  return invoke<PublicAccount>("complete_microsoft_login", { requestId });
}

export async function getActiveAccount(): Promise<PublicAccount | null> {
  return invoke<PublicAccount | null>("get_active_account");
}

export async function refreshActiveAccount(): Promise<PublicAccount> {
  return invoke<PublicAccount>("refresh_active_account");
}

export async function getAuthStatus(): Promise<BackendAuthStatus> {
  return invoke<BackendAuthStatus>("get_auth_status");
}

export async function signOut(): Promise<void> {
  return invoke<void>("sign_out");
}

export function skinSource(skinPath: string | null | undefined) {
  if (!skinPath || !isTauriRuntime()) return "/assets/steve.png";
  return convertFileSrc(skinPath);
}

export function normalizeAuthError(error: unknown): AuthErrorPayload {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    typeof error.code === "string" &&
    typeof error.message === "string"
  ) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "internal",
    message: "Authentication could not be completed.",
  };
}
