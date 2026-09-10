import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { listen } from "@tauri-apps/api/event";
import {
  beginMicrosoftLogin as beginMicrosoftLoginCommand,
  completeMicrosoftLogin,
  getActiveAccount,
  isTauriRuntime,
  normalizeAuthError,
  refreshActiveAccount as refreshActiveAccountCommand,
  signOut as signOutCommand,
} from "../services/auth";
import {
  authReducer,
  initialAuthState,
  type AuthUiStatus,
} from "../auth/authState";
import { initialDownloads, instances as mockInstances } from "../data/mock";
import type {
  AsterAccount,
  AuthErrorPayload,
  AuthProgress,
  PublicAccount,
} from "../types/auth";
import type {
  DownloadItem,
  GameInstance,
  LauncherNotification,
  ModalKind,
  NewLauncherNotification,
  GameId,
  PageId,
  Toast,
} from "../types/launcher";
import { getLauncherSettings } from "../services/settings";
import {
  claimCosmeticsReleaseGift,
  emptyAsterWallet,
  hasClaimedCosmeticsReleaseGift,
  loadAsterWallet,
} from "../services/asterWallet";
import {
  registerAsterAccount as registerAsterAccountService,
  restoreAsterAccount,
  signInAsterAccount as signInAsterAccountService,
  signOutAsterAccount as signOutAsterAccountService,
} from "../services/social";

const NOTIFICATION_STORAGE_KEY = "aster-launcher.notifications.v1";

function loadNotifications(): LauncherNotification[] {
  if (typeof window === "undefined") return [];

  try {
    const stored = JSON.parse(
      window.localStorage.getItem(NOTIFICATION_STORAGE_KEY) ?? "[]",
    ) as unknown;
    if (!Array.isArray(stored)) return [];

    return stored
      .filter(
        (item): item is LauncherNotification =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as LauncherNotification).id === "string" &&
          typeof (item as LauncherNotification).title === "string" &&
          typeof (item as LauncherNotification).message === "string" &&
          typeof (item as LauncherNotification).createdAt === "string" &&
          typeof (item as LauncherNotification).read === "boolean",
      )
      .slice(0, 50);
  } catch {
    return [];
  }
}

interface AppStoreValue {
  activeGame: GameId;
  setActiveGame: (game: GameId) => void;
  page: PageId;
  setPage: (page: PageId) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  offline: boolean;
  setOffline: (value: boolean) => void;
  account: PublicAccount | null;
  loggedIn: boolean;
  asterAccount: AsterAccount | null;
  asterLoggedIn: boolean;
  asterAuthBusy: boolean;
  asterAuthError: string | null;
  signInAster: (email: string, password: string) => Promise<boolean>;
  registerAster: (username: string, email: string, password: string) => Promise<boolean>;
  signOutAster: () => Promise<void>;
  authStatus: AuthUiStatus;
  authError: AuthErrorPayload | null;
  authProgress: string | null;
  authBusy: boolean;
  beginMicrosoftLogin: () => Promise<void>;
  refreshActiveAccount: () => Promise<void>;
  signOut: () => Promise<void>;
  loading: boolean;
  setLoading: (value: boolean) => void;
  emptyLibrary: boolean;
  setEmptyLibrary: (value: boolean) => void;
  modal: ModalKind;
  openModal: (kind: Exclude<ModalKind, null>) => void;
  closeModal: () => void;
  toasts: Toast[];
  notify: (toast: Omit<Toast, "id">) => void;
  dismissToast: (id: number) => void;
  notifications: LauncherNotification[];
  pushNotification: (notification: NewLauncherNotification) => void;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  dismissNotification: (id: string) => void;
  clearNotifications: () => void;
  creditBalance: number;
  setGiftCreditBalance: (balance: number) => void;
  releaseGiftAvailable: boolean;
  claimReleaseGift: () => boolean;
  instances: GameInstance[];
  updateInstance: (id: string, patch: Partial<GameInstance>) => void;
  downloads: DownloadItem[];
  setDownloads: React.Dispatch<React.SetStateAction<DownloadItem[]>>;
}

const AppStore = createContext<AppStoreValue | null>(null);

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [activeGame, setActiveGameState] = useState<GameId>(() => {
    const saved = window.localStorage.getItem("aster-launcher.active-game");
    return saved === "sprocket" ||
      saved === "btd6" ||
      saved === "battlefront2"
      ? saved
      : "minecraft";
  });
  const [page, setPage] = useState<PageId>("home");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [offline, setOffline] = useState(false);
  const [auth, dispatchAuth] = useReducer(authReducer, initialAuthState);
  const [asterAccount, setAsterAccount] = useState<AsterAccount | null>(null);
  const [asterAuthBusy, setAsterAuthBusy] = useState(true);
  const [asterAuthError, setAsterAuthError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [emptyLibrary, setEmptyLibrary] = useState(false);
  const [modal, setModal] = useState<ModalKind>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [notifications, setNotifications] =
    useState<LauncherNotification[]>(loadNotifications);
  const [launcherInstances, setInstances] =
    useState<GameInstance[]>(mockInstances);
  const [downloads, setDownloads] =
    useState<DownloadItem[]>(initialDownloads);
  const [asterWallet, setAsterWallet] = useState(emptyAsterWallet);
  const [giftCreditBalance, setGiftCreditBalanceState] = useState(0);
  const previousDownloadStatuses = useRef(
    new Map<string, DownloadItem["status"]>(),
  );
  const profileSyncInFlight = useRef(false);
  const lastProfileSyncAt = useRef(0);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let stopListening: (() => void) | undefined;
    void listen<{
      id: string;
      progress: number;
      detail: string;
      speed: string | null;
      remaining: string | null;
    }>("download-progress", ({ payload }) => {
      setDownloads((current) =>
        current.map((item) =>
          item.id === payload.id
            ? {
                ...item,
                progress: payload.progress,
                detail: payload.detail,
                speed: payload.speed ?? undefined,
                remaining: payload.remaining ?? undefined,
                status:
                  payload.progress >= 100 ? "complete" : "downloading",
              }
            : item,
        ),
      );
    }).then((unlisten) => {
      stopListening = unlisten;
    });
    return () => stopListening?.();
  }, []);

  const notify = useCallback((toast: Omit<Toast, "id">) => {
    const id = Date.now() + Math.round(Math.random() * 1000);
    setToasts((current) => [...current.slice(-2), { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4200);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      NOTIFICATION_STORAGE_KEY,
      JSON.stringify(notifications.slice(0, 50)),
    );
  }, [notifications]);

  const pushNotification = useCallback(
    (notification: NewLauncherNotification) => {
      if (!getLauncherSettings().activityNotifications) return;
      const id =
        notification.id ??
        (typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `notification-${Date.now()}-${Math.round(Math.random() * 10_000)}`);
      const item: LauncherNotification = {
        ...notification,
        id,
        createdAt: notification.createdAt ?? new Date().toISOString(),
        read: notification.read ?? false,
      };

      setNotifications((current) => [
        item,
        ...current.filter((existing) => existing.id !== id),
      ].slice(0, 50));
    },
    [],
  );

  const markNotificationRead = useCallback((id: string) => {
    setNotifications((current) =>
      current.map((notification) =>
        notification.id === id
          ? { ...notification, read: true }
          : notification,
      ),
    );
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    setNotifications((current) =>
      current.map((notification) =>
        notification.read ? notification : { ...notification, read: true },
      ),
    );
  }, []);

  const dismissNotification = useCallback((id: string) => {
    setNotifications((current) =>
      current.filter((notification) => notification.id !== id),
    );
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  useEffect(() => {
    const previous = previousDownloadStatuses.current;
    const activeIds = new Set(downloads.map((download) => download.id));

    downloads.forEach((download) => {
      const previousStatus = previous.get(download.id);
      if (
        previousStatus &&
        previousStatus !== download.status &&
        download.status === "complete"
      ) {
        pushNotification({
          id: `download-complete-${download.id}`,
          title: "Download complete",
          message: `${download.title} was installed successfully.`,
          tone: "success",
          source: "download",
        });
      }
      if (
        previousStatus &&
        previousStatus !== download.status &&
        download.status === "failed"
      ) {
        pushNotification({
          id: `download-failed-${download.id}`,
          title: "Download failed",
          message: `${download.title} could not be installed.`,
          tone: "error",
          source: "download",
        });
      }
      previous.set(download.id, download.status);
    });

    [...previous.keys()].forEach((id) => {
      if (!activeIds.has(id)) previous.delete(id);
    });
  }, [downloads, pushNotification]);

  const updateInstance = useCallback(
    (id: string, patch: Partial<GameInstance>) => {
      setInstances((current) =>
        current.map((instance) =>
          instance.id === id ? { ...instance, ...patch } : instance,
        ),
      );
    },
    [],
  );

  const beginMicrosoftLogin = useCallback(async () => {
    if (!isTauriRuntime()) {
      const error = {
        code: "native_required",
        message: "Microsoft sign-in is available in the native launcher.",
      };
      dispatchAuth({ type: "failed", error });
      notify({ title: "Native launcher required", message: error.message, tone: "warning" });
      return;
    }

    dispatchAuth({ type: "authenticationStarted" });
    try {
      const start = await beginMicrosoftLoginCommand();
      const account = await completeMicrosoftLogin(start.requestId);
      dispatchAuth({ type: "authenticated", account });
      setModal(null);
      notify({
        title: "Microsoft account connected",
        message: `${account.username} is ready to use.`,
        tone: "success",
      });
    } catch (error) {
      const normalized = normalizeAuthError(error);
      if (
        normalized.code === "session_expired" ||
        normalized.code === "token_refresh_failed"
      ) {
        dispatchAuth({ type: "expired", error: normalized });
      } else {
        dispatchAuth({ type: "failed", error: normalized });
      }
      notify({
        title:
          normalized.code === "minecraft_not_owned"
            ? "Minecraft Java not owned"
            : "Sign-in failed",
        message: normalized.message,
        tone:
          normalized.code === "login_cancelled" ? "info" : "error",
      });
    }
  }, [notify]);

  const refreshActiveAccount = useCallback(async () => {
    if (!isTauriRuntime()) return;
    dispatchAuth({ type: "authenticationStarted" });
    try {
      const account = await refreshActiveAccountCommand();
      dispatchAuth({ type: "authenticated", account });
      notify({
        title: "Minecraft profile updated",
        message: "Your username and active skin were refreshed.",
        tone: "success",
      });
    } catch (error) {
      const normalized = normalizeAuthError(error);
      dispatchAuth({ type: "expired", error: normalized });
      pushNotification({
        id: "account-session-expired",
        title: "Account session expired",
        message: "Sign in again to continue using Minecraft services.",
        tone: "warning",
        source: "account",
        action: {
          label: "Open accounts",
          modal: "manage-account",
        },
      });
      notify({
        title: "Session refresh failed",
        message: normalized.message,
        tone: "warning",
      });
    }
  }, [notify, pushNotification]);

  const signOut = useCallback(async () => {
    try {
      if (isTauriRuntime()) await signOutCommand();
      dispatchAuth({ type: "signedOut" });
      setModal(null);
      notify({
        title: "Signed out",
        message: "Saved Microsoft and Minecraft credentials were removed.",
        tone: "info",
      });
    } catch (error) {
      const normalized = normalizeAuthError(error);
      notify({
        title: "Sign out failed",
        message: normalized.message,
        tone: "error",
      });
    }
  }, [notify]);

  useEffect(() => {
    let disposed = false;
    const restore = () => {
      setAsterAuthBusy(true);
      void restoreAsterAccount()
        .then((restored) => {
          if (!disposed) setAsterAccount(restored);
        })
        .catch((error) => {
          if (!disposed) {
            setAsterAuthError(error instanceof Error ? error.message : String(error));
          }
        })
        .finally(() => {
          if (!disposed) setAsterAuthBusy(false);
        });
    };
    restore();
    window.addEventListener("focus", restore);
    return () => {
      disposed = true;
      window.removeEventListener("focus", restore);
    };
  }, []);

  const signInAster = useCallback(async (email: string, password: string) => {
    setAsterAuthBusy(true);
    setAsterAuthError(null);
    try {
      const nextAccount = await signInAsterAccountService(email, password);
      setAsterAccount(nextAccount);
      setModal(null);
      notify({
        title: "Welcome back",
        message: `${nextAccount.username} is signed in to Aster.`,
        tone: "success",
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAsterAuthError(message);
      notify({ title: "Aster sign-in failed", message, tone: "error" });
      return false;
    } finally {
      setAsterAuthBusy(false);
    }
  }, [notify]);

  const registerAster = useCallback(async (
    username: string,
    email: string,
    password: string,
  ) => {
    setAsterAuthBusy(true);
    setAsterAuthError(null);
    try {
      const nextAccount = await registerAsterAccountService({ username, email, password });
      setAsterAccount(nextAccount.pendingVerification ? null : nextAccount);
      setModal(null);
      notify({
        title: nextAccount.pendingVerification ? "Verify your email" : "Aster account created",
        message: nextAccount.pendingVerification
          ? `We sent a confirmation link to ${nextAccount.email}. Your existing Social data remains attached to this account.`
          : `Welcome, ${nextAccount.username}. Your existing Social data was preserved.`,
        tone: "success",
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAsterAuthError(message);
      notify({ title: "Registration failed", message, tone: "error" });
      return false;
    } finally {
      setAsterAuthBusy(false);
    }
  }, [notify]);

  const signOutAster = useCallback(async () => {
    setAsterAuthBusy(true);
    setAsterAuthError(null);
    try {
      await signOutAsterAccountService();
      setAsterAccount(null);
      setGiftCreditBalanceState(0);
      setModal(null);
      notify({ title: "Signed out", message: "Your Aster session was removed from this device.", tone: "info" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAsterAuthError(message);
      notify({ title: "Sign out failed", message, tone: "error" });
    } finally {
      setAsterAuthBusy(false);
    }
  }, [notify]);

  useEffect(() => {
    if (
      asterAccount
    ) {
      setAsterWallet(loadAsterWallet(asterAccount.id));
    } else {
      setAsterWallet({ ...emptyAsterWallet });
    }
  }, [asterAccount]);

  useEffect(() => {
    if (
      !isTauriRuntime() ||
      auth.status !== "authenticated" ||
      auth.account?.sessionState !== "active"
    ) {
      return;
    }

    let disposed = false;
    const syncProfile = async (force = false) => {
      const now = Date.now();
      if (
        profileSyncInFlight.current ||
        (!force && now - lastProfileSyncAt.current < 60_000)
      ) {
        return;
      }

      profileSyncInFlight.current = true;
      lastProfileSyncAt.current = now;
      try {
        const account = await getActiveAccount();
        if (!disposed && account) {
          dispatchAuth({ type: "authenticated", account });
        }
      } catch (error) {
        if (disposed) return;
        const normalized = normalizeAuthError(error);
        if (
          normalized.code === "session_expired" ||
          normalized.code === "token_refresh_failed"
        ) {
          dispatchAuth({ type: "expired", error: normalized });
        }
      } finally {
        profileSyncInFlight.current = false;
      }
    };

    const handleFocus = () => {
      if (document.visibilityState === "visible") {
        void syncProfile();
      }
    };
    const interval = window.setInterval(
      () => void syncProfile(true),
      5 * 60_000,
    );
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleFocus);

    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleFocus);
    };
  }, [auth.account?.id, auth.account?.sessionState, auth.status]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      dispatchAuth({ type: "signedOut" });
      return;
    }

    let disposed = false;
    const progressEvents = [
      "auth://browser-opened",
      "auth://callback-received",
      "auth://xbox-authenticating",
      "auth://minecraft-authenticating",
      "auth://profile-loading",
    ];
    const listeners = Promise.all(
      progressEvents.map((eventName) =>
        listen<AuthProgress>(eventName, (event) => {
          if (!disposed) {
            dispatchAuth({ type: "progress", progress: event.payload.stage });
          }
        }),
      ),
    );

    dispatchAuth({ type: "restoreStarted" });
    void getActiveAccount()
      .then((account) => {
        if (disposed) return;
        if (account) dispatchAuth({ type: "authenticated", account });
        else dispatchAuth({ type: "signedOut" });
      })
      .catch((error) => {
        if (disposed) return;
        const normalized = normalizeAuthError(error);
        if (
          normalized.code === "session_expired" ||
          normalized.code === "token_refresh_failed"
        ) {
          dispatchAuth({ type: "expired", error: normalized });
          pushNotification({
            id: "account-session-expired",
            title: "Account session expired",
            message: "Sign in again to continue using Minecraft services.",
            tone: "warning",
            source: "account",
            action: {
              label: "Open accounts",
              modal: "manage-account",
            },
          });
        } else {
          dispatchAuth({ type: "failed", error: normalized });
        }
      });

    return () => {
      disposed = true;
      void listeners.then((unlisten) => {
        unlisten.forEach((dispose) => dispose());
      });
    };
  }, [pushNotification]);

  const loggedIn =
    auth.status === "authenticated" &&
    auth.account?.sessionState === "active";
  const asterLoggedIn = Boolean(asterAccount);
  const releaseGiftAvailable =
    asterLoggedIn && !hasClaimedCosmeticsReleaseGift(asterWallet);

  useEffect(() => {
    setGiftCreditBalanceState(0);
  }, [asterAccount?.id]);

  const setGiftCreditBalance = useCallback((balance: number) => {
    const normalized =
      Number.isFinite(balance) && balance >= 0 ? Math.floor(balance) : 0;
    setGiftCreditBalanceState(normalized);
  }, []);

  const claimReleaseGift = useCallback(() => {
    if (
      !asterAccount
    ) {
      return false;
    }

    const result = claimCosmeticsReleaseGift(asterAccount.id);
    setAsterWallet(result.wallet);
    return result.claimed;
  }, [asterAccount]);

  const value = useMemo<AppStoreValue>(
    () => ({
      activeGame,
      setActiveGame: (game) => {
        setActiveGameState(game);
        window.localStorage.setItem("aster-launcher.active-game", game);
        setPage("home");
      },
      page,
      setPage,
      sidebarCollapsed,
      toggleSidebar: () => setSidebarCollapsed((value) => !value),
      offline,
      setOffline,
      account: auth.account,
      loggedIn,
      asterAccount,
      asterLoggedIn,
      asterAuthBusy,
      asterAuthError,
      signInAster,
      registerAster,
      signOutAster,
      authStatus: auth.status,
      authError: auth.error,
      authProgress: auth.progress,
      authBusy: auth.status === "loading" || auth.status === "authenticating",
      beginMicrosoftLogin,
      refreshActiveAccount,
      signOut,
      loading,
      setLoading,
      emptyLibrary,
      setEmptyLibrary,
      modal,
      openModal: setModal,
      closeModal: () => setModal(null),
      toasts,
      notify,
      dismissToast,
      notifications,
      pushNotification,
      markNotificationRead,
      markAllNotificationsRead,
      dismissNotification,
      clearNotifications,
      creditBalance: asterWallet.balance + giftCreditBalance,
      setGiftCreditBalance,
      releaseGiftAvailable,
      claimReleaseGift,
      instances: launcherInstances,
      updateInstance,
      downloads,
      setDownloads,
    }),
    [
      activeGame,
      page,
      sidebarCollapsed,
      offline,
      auth,
      loggedIn,
      asterAccount,
      asterLoggedIn,
      asterAuthBusy,
      asterAuthError,
      loading,
      emptyLibrary,
      modal,
      toasts,
      notify,
      dismissToast,
      notifications,
      pushNotification,
      markNotificationRead,
      markAllNotificationsRead,
      dismissNotification,
      clearNotifications,
      asterWallet.balance,
      giftCreditBalance,
      setGiftCreditBalance,
      releaseGiftAvailable,
      claimReleaseGift,
      launcherInstances,
      updateInstance,
      downloads,
      beginMicrosoftLogin,
      refreshActiveAccount,
      signOut,
      signInAster,
      registerAster,
      signOutAster,
    ],
  );

  return <AppStore.Provider value={value}>{children}</AppStore.Provider>;
}

export function useAppStore() {
  const store = useContext(AppStore);
  if (!store) {
    throw new Error("useAppStore must be used inside AppStoreProvider");
  }
  return store;
}
