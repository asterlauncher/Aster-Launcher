import { describe, expect, it } from "vitest";
import { authReducer, initialAuthState } from "./authState";
import type { PublicAccount } from "../types/auth";

const account: PublicAccount = {
  id: "8667ba71b85a4004af54457a9734eed7",
  username: "RealPlayer",
  skinPath: "C:\\launcher\\skins\\8667ba71b85a4004af54457a9734eed7.png",
  ownsJava: true,
  sessionState: "active",
};

describe("authReducer", () => {
  it("represents the logged-out state without an account", () => {
    const state = authReducer(initialAuthState, { type: "signedOut" });

    expect(state).toEqual({
      status: "signedOut",
      account: null,
      error: null,
      progress: null,
    });
  });

  it("represents authentication loading and safe progress", () => {
    const started = authReducer(initialAuthState, {
      type: "authenticationStarted",
    });
    const progressed = authReducer(started, {
      type: "progress",
      progress: "xbox-authenticating",
    });

    expect(started.status).toBe("authenticating");
    expect(progressed.progress).toBe("xbox-authenticating");
  });

  it("stores only the safe authenticated account", () => {
    const state = authReducer(initialAuthState, {
      type: "authenticated",
      account,
    });

    expect(state.status).toBe("authenticated");
    expect(state.account).toEqual(account);
    expect(Object.keys(state.account ?? {})).toEqual([
      "id",
      "username",
      "skinPath",
      "ownsJava",
      "sessionState",
    ]);
  });

  it("shows a no-ownership failure in the logged-out state", () => {
    const state = authReducer(initialAuthState, {
      type: "failed",
      error: {
        code: "minecraft_not_owned",
        message: "This Microsoft account does not own Minecraft Java Edition.",
      },
    });

    expect(state.status).toBe("signedOut");
    expect(state.account).toBeNull();
    expect(state.error?.code).toBe("minecraft_not_owned");
  });

  it("preserves the public account when a session expires", () => {
    const authenticated = authReducer(initialAuthState, {
      type: "authenticated",
      account,
    });
    const expired = authReducer(authenticated, {
      type: "expired",
      error: {
        code: "session_expired",
        message: "Your Microsoft session expired. Sign in again.",
      },
    });

    expect(expired.status).toBe("expired");
    expect(expired.account).toEqual(account);
  });

  it("clears account data and errors on sign out", () => {
    const authenticated = authReducer(initialAuthState, {
      type: "authenticated",
      account,
    });
    const signedOut = authReducer(authenticated, { type: "signedOut" });

    expect(signedOut.account).toBeNull();
    expect(signedOut.error).toBeNull();
    expect(signedOut.progress).toBeNull();
    expect(signedOut.status).toBe("signedOut");
  });
});
