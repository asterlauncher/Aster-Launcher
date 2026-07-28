import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  AlertTriangle,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Crown,
  Download,
  Inbox,
  Info,
  LogOut,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Timer,
  UserRound,
  Users,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  useState,
} from "react";
import { useLauncherPresence } from "../hooks/useLauncherPresence";
import { useLauncherUpdater } from "../hooks/useLauncherUpdater";
import { useAppStore } from "../store/AppStore";

function isInteractiveTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest("button, a, input, select, textarea, [data-no-drag]"))
  );
}

function formatBytes(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatNotificationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const notificationIcons = {
  success: CheckCircle2,
  info: Info,
  warning: AlertTriangle,
  error: CircleAlert,
};

export function TopBar() {
  const {
    account,
    setPage,
    openModal,
    downloads,
    setDownloads,
    loggedIn,
    authStatus,
    authBusy,
    beginMicrosoftLogin,
    signOut,
    notifications,
    markNotificationRead,
    markAllNotificationsRead,
    dismissNotification,
    clearNotifications,
  } = useAppStore();
  const presence = useLauncherPresence();
  const updater = useLauncherUpdater();
  const [networkOpen, setNetworkOpen] = useState(false);
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const activeDownloads = downloads.filter((item) =>
    ["downloading", "queued"].includes(item.status),
  ).length;
  const activeDownloadItems = downloads.filter((item) =>
    ["downloading", "queued"].includes(item.status),
  );
  const overallDownloadProgress =
    activeDownloadItems.length > 0
      ? Math.round(
          activeDownloadItems.reduce((total, item) => total + item.progress, 0) /
            activeDownloadItems.length,
        )
      : downloads.some((item) => item.status === "complete")
        ? 100
        : 0;
  const presenceConnected = presence.status === "online";
  const updateInProgress = ["downloading", "installing"].includes(updater.status);
  const hasUpdateNotification =
    updater.status === "available" || updateInProgress;
  const unreadNotifications = notifications.filter(
    (notification) => !notification.read,
  ).length;
  const notificationCount =
    unreadNotifications + (hasUpdateNotification ? 1 : 0);
  const notificationItems =
    notifications.length + (hasUpdateNotification ? 1 : 0);
  const presenceLabel = presenceConnected
    ? `${presence.onlineCount?.toLocaleString() ?? "0"} ${
        presence.onlineCount === 1 ? "player" : "players"
      } online now`
    : presence.status === "connecting"
      ? "Checking launcher network..."
      : presence.status === "unconfigured"
        ? "Presence setup required"
        : "Launcher network unavailable";

  const startWindowDrag = (event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== 0 || isInteractiveTarget(event.target)) return;
    void getCurrentWindow().startDragging().catch(() => {
      // Browser preview does not expose native window movement.
    });
  };

  const toggleWindowMaximize = (event: ReactMouseEvent<HTMLElement>) => {
    if (isInteractiveTarget(event.target)) return;
    void getCurrentWindow().toggleMaximize().catch(() => {
      // Browser preview does not expose native window movement.
    });
  };

  return (
    <header
      className="launcher-titlebar"
      onMouseDown={startWindowDrag}
      onDoubleClick={toggleWindowMaximize}
    >
      <div className="players-online-wrap" data-no-drag>
        <button
          type="button"
          className="players-online"
          onClick={() => {
            setNetworkOpen((value) => !value);
            setDownloadsOpen(false);
            setNotificationsOpen(false);
            setAccountMenuOpen(false);
          }}
          aria-expanded={networkOpen}
          aria-haspopup="dialog"
        >
          <span className={presenceConnected ? "" : "inactive"} />
          {presenceLabel}
          <ChevronDown size={11} className={networkOpen ? "rotated" : ""} />
        </button>

        {networkOpen && (
          <section className="network-popover" aria-label="Launcher network" data-no-drag>
            <header>
              <div>
                <strong>Launcher network</strong>
                <small className={`presence-${presence.status}`}>
                  <i />
                  {presenceConnected
                    ? "Live presence connected"
                    : presence.status === "connecting"
                      ? "Checking active launchers"
                      : presence.status === "unconfigured"
                        ? "Backend setup required"
                        : "Presence service unavailable"}
                </small>
              </div>
              <button
                type="button"
                className="network-refresh"
                onClick={() => void presence.refresh()}
                disabled={
                  presence.refreshing || presence.status === "unconfigured"
                }
                aria-label="Refresh network status"
                title="Refresh"
              >
                <RefreshCw className={presence.refreshing ? "spin" : ""} size={14} />
              </button>
            </header>

            <div className="network-summary">
              <div className={`network-live-total presence-${presence.status}`}>
                <Users size={16} />
                <strong>
                  {presence.onlineCount === null
                    ? "—"
                    : presence.onlineCount.toLocaleString()}
                </strong>
                <span>Launchers open right now</span>
              </div>
              <div>
                <strong>30s</strong>
                <span>Heartbeat interval</span>
              </div>
              <div>
                <strong>90s</strong>
                <span>Offline timeout</span>
              </div>
            </div>

            <p className="network-presence-copy">
              {presenceConnected
                ? "This is the real number of Aster Launcher installations currently sending a heartbeat. This launcher is included."
                : presence.message}
            </p>

            <footer>
              <span>{presenceConnected ? "Live data" : "Not connected"}</span>
              {presence.updatedAt
                ? `Updated ${presence.updatedAt.toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}`
                : "Waiting for presence"}
            </footer>
          </section>
        )}
      </div>

      <button
        type="button"
        className="premium-button"
        onClick={() => openModal("aster-subscription")}
      >
        <Crown size={13} fill="currentColor" />
        Aster Subscription
      </button>

      <div className="titlebar-spacer" />

      <div className="titlebar-downloads" data-no-drag>
        <button
          type="button"
          className={`download-manager-button ${activeDownloads > 0 ? "active" : ""}`}
          onClick={() => {
            setDownloadsOpen((value) => !value);
            setNetworkOpen(false);
            setNotificationsOpen(false);
            setAccountMenuOpen(false);
          }}
          aria-expanded={downloadsOpen}
          aria-haspopup="dialog"
          aria-label={
            activeDownloads > 0
              ? `${activeDownloads} active downloads, ${overallDownloadProgress}% complete`
              : "Downloads"
          }
          title="Download manager"
          style={
            {
              "--download-progress": `${overallDownloadProgress}%`,
            } as CSSProperties
          }
        >
          <i className="download-button-progress" />
          <Download size={16} />
          {activeDownloads > 0 && <span>{activeDownloads}</span>}
        </button>

        {downloadsOpen && (
          <section
            className="download-popover"
            aria-label="Download manager"
            data-no-drag
          >
            <header>
              <div>
                <strong>Downloads</strong>
                <small>
                  {activeDownloads > 0
                    ? `${activeDownloads} active · ${overallDownloadProgress}% overall`
                    : downloads.length > 0
                      ? "No active downloads"
                      : "Queue is empty"}
                </small>
              </div>
              {activeDownloads > 0 && (
                <b>{overallDownloadProgress}%</b>
              )}
            </header>

            <div
              className={`download-popover-list ${
                downloads.length > 3 ? "has-overflow" : ""
              }`}
            >
              {downloads.map((item) => (
                <article
                  key={item.id}
                  className={`download-popover-item status-${item.status}`}
                >
                  <span className="download-popover-icon">
                    {item.status === "complete" ? (
                      <Check size={13} />
                    ) : item.status === "failed" ? (
                      <CircleAlert size={13} />
                    ) : item.status === "queued" ? (
                      <Timer size={13} />
                    ) : (
                      <Download size={13} />
                    )}
                  </span>
                  <div>
                    <header>
                      <strong>{item.title}</strong>
                      <span>
                        {item.status === "complete"
                          ? "DONE"
                          : item.status === "failed"
                            ? "FAILED"
                            : `${item.progress}%`}
                      </span>
                    </header>
                    <small>{item.detail}</small>
                    <div className="download-popover-track">
                      <i style={{ width: `${item.progress}%` }} />
                    </div>
                    <footer>
                      <span>
                        {item.status === "queued"
                          ? "Waiting"
                          : item.status === "complete"
                            ? "Installed"
                            : item.status === "failed"
                              ? "Installation stopped"
                              : item.speed ?? "Downloading"}
                      </span>
                      <span>{item.remaining ?? ""}</span>
                    </footer>
                  </div>
                </article>
              ))}

              {downloads.length === 0 && (
                <div className="download-popover-empty">
                  <Download size={20} />
                  <strong>No downloads yet</strong>
                  <span>Installed mods and modpacks will appear here.</span>
                </div>
              )}
            </div>

            {downloads.some((item) =>
              ["complete", "failed"].includes(item.status),
            ) && (
              <footer className="download-popover-footer">
                <button
                  type="button"
                  onClick={() =>
                    setDownloads((current) =>
                      current.filter((item) =>
                        ["downloading", "queued", "paused"].includes(item.status),
                      ),
                    )
                  }
                >
                  Clear finished
                </button>
              </footer>
            )}
          </section>
        )}
      </div>

      <div className="titlebar-notifications">
        <button
          type="button"
          className={`notification-button ${notificationCount > 0 ? "has-update" : ""}`}
          onClick={() => {
            setNotificationsOpen((value) => !value);
            setNetworkOpen(false);
            setDownloadsOpen(false);
            setAccountMenuOpen(false);
          }}
          aria-label="Notifications"
        >
          <Bell size={18} fill="currentColor" />
          {notificationCount > 0 && <span>{notificationCount}</span>}
        </button>
        {notificationsOpen && (
          <div className="compact-notifications">
            <header className="compact-notifications-header">
              <div>
                <strong>Notifications</strong>
                <small>Aster Launcher {updater.currentVersion}</small>
              </div>
              <button
                type="button"
                className="notification-refresh"
                onClick={() => void updater.checkForUpdates()}
                disabled={
                  updater.status === "checking" || updateInProgress
                }
                aria-label="Check for launcher updates"
                title="Check for updates"
              >
                <RefreshCw
                  size={13}
                  className={updater.status === "checking" ? "spin" : ""}
                />
              </button>
            </header>

            <div
              className={`notification-center-list ${
                notificationItems > 3 ? "has-overflow" : ""
              }`}
            >
            {updater.availableUpdate && hasUpdateNotification && (
              <article className={`launcher-update-card status-${updater.status}`}>
                <header>
                  <span className="launcher-update-icon">
                    <Sparkles size={15} />
                  </span>
                  <div>
                    <small>
                      {updater.status === "available"
                        ? "Launcher update available"
                        : updater.status === "downloading"
                          ? "Downloading update"
                          : "Installing update"}
                    </small>
                    <strong>{updater.availableUpdate.name}</strong>
                  </div>
                  <b>v{updater.availableUpdate.version}</b>
                </header>

                <p>{updater.availableUpdate.description}</p>

                {updateInProgress && (
                  <div className="launcher-update-progress">
                    <div>
                      <i style={{ width: `${updater.progress}%` }} />
                    </div>
                    <footer>
                      <span>
                        {updater.status === "installing"
                          ? "Installing and restarting..."
                          : `${updater.progress}% downloaded`}
                      </span>
                      <span>
                        {updater.totalBytes
                          ? `${formatBytes(updater.downloadedBytes)} / ${formatBytes(
                              updater.totalBytes,
                            )}`
                          : ""}
                      </span>
                    </footer>
                  </div>
                )}

                {updater.status === "available" && (
                  <button
                    type="button"
                    className="launcher-update-button"
                    onClick={() => void updater.installUpdate()}
                  >
                    <Download size={12} />
                    Update now
                  </button>
                )}
              </article>
            )}

            {notifications.map((notification) => {
              const NotificationIcon = notificationIcons[notification.tone];
              return (
                <article
                  key={notification.id}
                  className={`notification-center-item tone-${notification.tone} ${
                    notification.read ? "" : "is-unread"
                  }`}
                  onClick={() => markNotificationRead(notification.id)}
                >
                  <span className="notification-center-icon">
                    <NotificationIcon size={14} />
                  </span>
                  <div>
                    <header>
                      <strong>{notification.title}</strong>
                      <time>{formatNotificationTime(notification.createdAt)}</time>
                    </header>
                    <p>{notification.message}</p>
                    {notification.action && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          markNotificationRead(notification.id);
                          if (notification.action?.page) {
                            setPage(notification.action.page);
                          }
                          if (notification.action?.modal) {
                            openModal(notification.action.modal);
                          }
                          setNotificationsOpen(false);
                        }}
                      >
                        {notification.action.label}
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    className="notification-center-dismiss"
                    onClick={(event) => {
                      event.stopPropagation();
                      dismissNotification(notification.id);
                    }}
                    aria-label={`Dismiss ${notification.title}`}
                  >
                    <X size={11} />
                  </button>
                </article>
              );
            })}

            {notifications.length === 0 && !hasUpdateNotification && (
              <div className="notification-center-empty">
                <Inbox size={22} />
                <strong>You're all caught up</strong>
                <span>
                  {updater.status === "checking"
                    ? "Checking for launcher updates..."
                    : updater.status === "error"
                      ? "No alerts. Update service is currently unavailable."
                      : "Important launcher activity will appear here."}
                </span>
              </div>
            )}
            </div>

            {notifications.length > 0 && (
              <footer className="notification-center-footer">
                {unreadNotifications > 0 && (
                  <button type="button" onClick={markAllNotificationsRead}>
                    Mark all read
                  </button>
                )}
                <button type="button" onClick={clearNotifications}>
                  Clear all
                </button>
              </footer>
            )}
          </div>
        )}
      </div>

      <div className="titlebar-profile">
        <button
          type="button"
          className="profile-menu-trigger"
          onClick={() => {
            setAccountMenuOpen((value) => !value);
            setNetworkOpen(false);
            setDownloadsOpen(false);
            setNotificationsOpen(false);
          }}
          aria-expanded={accountMenuOpen}
          aria-label="Account menu"
        >
          <span>
            <UserRound size={14} />
          </span>
          <strong>{account?.username ?? "Signed out"}</strong>
          <ChevronDown size={12} />
        </button>
        {accountMenuOpen && (
          <div className="profile-dropdown">
            <header>
              <span>
                <UserRound size={16} />
              </span>
              <div>
                <strong>{account?.username ?? "No active account"}</strong>
                <small>
                  <ShieldCheck size={10} />
                  {authStatus === "expired"
                    ? "Session expired"
                    : loggedIn
                      ? "Session active"
                      : authBusy
                        ? "Signing in"
                        : "Signed out"}
                </small>
              </div>
            </header>
            <button
              type="button"
              onClick={() => {
                setAccountMenuOpen(false);
                openModal("manage-account");
              }}
            >
              <UserRound size={13} />
              Accounts
            </button>
            <button
              type="button"
              onClick={() => {
                setAccountMenuOpen(false);
                if (loggedIn) openModal("add-account");
                else void beginMicrosoftLogin();
              }}
            >
              <Plus size={13} />
              {loggedIn ? "Add account" : "Sign in"}
            </button>
            {loggedIn && (
              <button
                type="button"
                onClick={() => {
                  setAccountMenuOpen(false);
                  void signOut();
                }}
              >
                <LogOut size={13} />
                Sign out
              </button>
            )}
          </div>
        )}
      </div>

    </header>
  );
}
