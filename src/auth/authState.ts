import type { AuthErrorPayload, PublicAccount } from "../types/auth";

export type AuthUiStatus =
  | "loading"
  | "signedOut"
  | "authenticating"
  | "authenticated"
  | "expired";

export interface AuthUiState {
  status: AuthUiStatus;
  account: PublicAccount | null;
  error: AuthErrorPayload | null;
  progress: string | null;
}

export type AuthUiAction =
  | { type: "restoreStarted" }
  | { type: "authenticationStarted" }
  | { type: "progress"; progress: string }
  | { type: "authenticated"; account: PublicAccount }
  | { type: "expired"; account?: PublicAccount | null; error: AuthErrorPayload }
  | { type: "failed"; error: AuthErrorPayload }
  | { type: "signedOut" };

export const initialAuthState: AuthUiState = {
  status: "loading",
  account: null,
  error: null,
  progress: null,
};

export function authReducer(
  state: AuthUiState,
  action: AuthUiAction,
): AuthUiState {
  switch (action.type) {
    case "restoreStarted":
      return { ...state, status: "loading", error: null, progress: null };
    case "authenticationStarted":
      return {
        ...state,
        status: "authenticating",
        error: null,
        progress: "browser-opening",
      };
    case "progress":
      return { ...state, progress: action.progress };
    case "authenticated":
      return {
        status: "authenticated",
        account: action.account,
        error: null,
        progress: null,
      };
    case "expired":
      return {
        status: "expired",
        account: action.account ?? state.account,
        error: action.error,
        progress: null,
      };
    case "failed":
      return {
        status: "signedOut",
        account: null,
        error: action.error,
        progress: null,
      };
    case "signedOut":
      return {
        status: "signedOut",
        account: null,
        error: null,
        progress: null,
      };
  }
}
