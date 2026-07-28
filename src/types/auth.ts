export type AccountSessionState = "active" | "expired";

export interface PublicAccount {
  id: string;
  username: string;
  skinPath: string | null;
  ownsJava: boolean;
  sessionState: AccountSessionState;
}

export type BackendAuthStatusState =
  | "signedOut"
  | "authenticating"
  | "authenticated"
  | "expired";

export interface BackendAuthStatus {
  state: BackendAuthStatusState;
  account: PublicAccount | null;
}

export interface AuthStart {
  requestId: string;
  expiresAt: number;
}

export interface AuthProgress {
  stage: string;
}

export interface AuthErrorPayload {
  code: string;
  message: string;
}
