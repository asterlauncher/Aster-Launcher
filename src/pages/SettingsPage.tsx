import { invoke } from "@tauri-apps/api/core";
import { motion } from "framer-motion";
import {
  Bell,
  Boxes,
  Check,
  ChevronRight,
  Cpu,
  Database,
  Download,
  FolderOpen,
  Gauge,
  Gift,
  Gavel,
  HardDrive,
  Languages,
  LoaderCircle,
  MemoryStick,
  MonitorCog,
  Puzzle,
  Radio,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Send,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  Users,
  WandSparkles,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { requestAsterGiftRefresh } from "../components/AsterGiftInbox";
import { RamSafetyWarning } from "../components/RamSafetyWarning";
import { useLauncherSettings } from "../hooks/useLauncherSettings";
import { useLauncherUpdater } from "../hooks/useLauncherUpdater";
import { isTauriRuntime } from "../services/auth";
import {
  approveBtd6Submission,
  deleteBtd6Submission,
  loadBtd6ModeratorStatus,
  loadBtd6SubmissionQueue,
  type Btd6CommunityMod,
} from "../services/btd6";
import {
  getSocialAuthRetryDelay,
  loadAsterGiftAdminStatus,
  sendAsterGift,
} from "../services/social";
import {
  DEFAULT_LAUNCHER_SETTINGS,
  resetLauncherSettings,
  updateLauncherSettings,
} from "../services/settings";
import { useAppStore } from "../store/AppStore";

type SettingsSection =
  | "launcher"
  | "minecraft"
  | "storage"
  | "privacy"
  | "gifts"
  | "btd6-moderation";

const baseSections: {
  id: SettingsSection;
  label: string;
  detail: string;
  icon: typeof SlidersHorizontal;
}[] = [
  {
    id: "launcher",
    label: "Launcher",
    detail: "Updates and interface",
    icon: SlidersHorizontal,
  },
  {
    id: "minecraft",
    label: "Minecraft",
    detail: "Memory and runtime",
    icon: Terminal,
  },
  {
    id: "storage",
    label: "Storage",
    detail: "Files and downloads",
    icon: HardDrive,
  },
  {
    id: "privacy",
    label: "Privacy",
    detail: "Presence and social",
    icon: ShieldCheck,
  },
];

function SettingsRow({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="settings-v2-row">
      <span className="settings-v2-row-icon">{icon}</span>
      <div className="settings-v2-row-copy">
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <div className="settings-v2-row-control">{children}</div>
    </div>
  );
}

function PixelToggle({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={label}
      className={`settings-v2-toggle ${value ? "is-on" : ""}`}
      onClick={() => onChange(!value)}
    >
      <span />
      <b>{value ? "ON" : "OFF"}</b>
    </button>
  );
}

function SettingBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "ready" | "purple";
}) {
  return <span className={`settings-v2-badge tone-${tone}`}>{children}</span>;
}

function SettingsGroup({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-v2-group">
      <header>
        <span>{eyebrow}</span>
        <div>
          <strong>{title}</strong>
          <p>{description}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

export function SettingsPage({
  launcherOnly = false,
  btd6Moderation = false,
}: {
  launcherOnly?: boolean;
  btd6Moderation?: boolean;
}) {
  const { asterAccount: account, asterLoggedIn: loggedIn, notify } = useAppStore();
  const settings = useLauncherSettings();
  const updater = useLauncherUpdater();
  const [section, setSection] = useState<SettingsSection>("launcher");
  const [openingFolder, setOpeningFolder] = useState(false);
  const [giftAdminStatus, setGiftAdminStatus] = useState<
    "idle" | "checking" | "allowed" | "denied" | "error"
  >("idle");
  const [giftAdminError, setGiftAdminError] = useState<string | null>(null);
  const [giftRetryKey, setGiftRetryKey] = useState(0);
  const [giftRetrySeconds, setGiftRetrySeconds] = useState(0);
  const [sendingGift, setSendingGift] = useState(false);
  const [giftSentTo, setGiftSentTo] = useState<string | null>(null);
  const [giftDraft, setGiftDraft] = useState({
    recipientName: "",
    amount: 100,
    title: "A gift from Aster",
    message: "Thanks for being part of Aster Launcher!",
  });
  const [btd6ModeratorStatus, setBtd6ModeratorStatus] = useState<
    "idle" | "checking" | "allowed" | "denied" | "error"
  >("idle");
  const [btd6Submissions, setBtd6Submissions] = useState<Btd6CommunityMod[]>([]);
  const [btd6ModerationBusy, setBtd6ModerationBusy] = useState<string | null>(null);
  const [btd6ModerationError, setBtd6ModerationError] = useState<string | null>(null);
  const ownerCandidate = loggedIn && account?.username.toLowerCase() === "synoi";
  const giftOwnerCandidate = !launcherOnly && ownerCandidate;
  const btd6OwnerCandidate = btd6Moderation && ownerCandidate;
  const sections = useMemo(
    () => {
      if (launcherOnly) {
        const launcherSections = baseSections.filter(({ id }) => id === "launcher");
        return btd6OwnerCandidate
          ? [
              ...launcherSections,
              {
                id: "btd6-moderation" as const,
                label: "BTD6 Mods",
                detail: "Review & approval",
                icon: Gavel,
              },
            ]
          : launcherSections;
      }
      return giftOwnerCandidate
        ? [
            ...baseSections,
            {
              id: "gifts" as const,
              label: "Gift Console",
              detail: "Owner access",
              icon: Gift,
            },
          ]
        : baseSections;
    },
    [btd6OwnerCandidate, giftOwnerCandidate, launcherOnly],
  );

  useEffect(() => {
    if (!giftOwnerCandidate || !account) {
      setGiftAdminStatus("idle");
      setGiftAdminError(null);
      setGiftRetrySeconds(0);
      if (section === "gifts") setSection("launcher");
      return;
    }

    let disposed = false;
    setGiftAdminStatus("checking");
    setGiftAdminError(null);
    void loadAsterGiftAdminStatus(account)
      .then((allowed) => {
        if (disposed) return;
        setGiftAdminStatus(allowed ? "allowed" : "denied");
        setGiftRetrySeconds(0);
      })
      .catch((error) => {
        if (disposed) return;
        setGiftAdminStatus("error");
        setGiftRetrySeconds(
          Math.max(0, Math.ceil(getSocialAuthRetryDelay() / 1_000)),
        );
        setGiftAdminError(
          error instanceof Error ? error.message : String(error),
        );
      });
    return () => {
      disposed = true;
    };
  }, [account, giftOwnerCandidate, giftRetryKey, section]);

  useEffect(() => {
    if (!giftOwnerCandidate || giftRetrySeconds <= 0) return;
    const timer = window.setInterval(() => {
      const seconds = Math.max(
        0,
        Math.ceil(getSocialAuthRetryDelay() / 1_000),
      );
      setGiftRetrySeconds(seconds);
      if (seconds === 0) {
        window.clearInterval(timer);
        setGiftRetryKey((value) => value + 1);
      }
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [giftOwnerCandidate, giftRetrySeconds > 0]);

  useEffect(() => {
    if (section === "btd6-moderation" && !btd6OwnerCandidate) setSection("launcher");
  }, [btd6OwnerCandidate, section]);

  const refreshBtd6Moderation = async () => {
    if (!btd6OwnerCandidate || !account) return;
    setBtd6ModeratorStatus("checking");
    setBtd6ModerationError(null);
    try {
      const allowed = await loadBtd6ModeratorStatus(account);
      setBtd6ModeratorStatus(allowed ? "allowed" : "denied");
      setBtd6Submissions(allowed ? await loadBtd6SubmissionQueue(account) : []);
    } catch (error) {
      setBtd6ModeratorStatus("error");
      setBtd6ModerationError(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    if (section !== "btd6-moderation" || !btd6OwnerCandidate) return;
    void refreshBtd6Moderation();
    // The moderation screen refreshes whenever the verified account or section changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, btd6OwnerCandidate, section]);

  const moderateBtd6Submission = async (
    mod: Btd6CommunityMod,
    action: "approve" | "delete",
  ) => {
    if (!account || btd6ModeratorStatus !== "allowed") return;
    setBtd6ModerationBusy(mod.id);
    try {
      if (action === "approve") await approveBtd6Submission(account, mod.id);
      else await deleteBtd6Submission(account, mod);
      notify({
        title: action === "approve" ? "BTD6 mod approved" : "BTD6 mod deleted",
        message: action === "approve"
          ? `${mod.displayName} is now available in the public catalog.`
          : `${mod.displayName} and its uploaded files were removed.`,
        tone: "success",
      });
      await refreshBtd6Moderation();
    } catch (error) {
      notify({ title: "Moderation failed", message: String(error), tone: "error" });
    } finally {
      setBtd6ModerationBusy(null);
    }
  };

  const sendGift = async () => {
    if (!account || giftAdminStatus !== "allowed" || sendingGift) return;
    setSendingGift(true);
    setGiftSentTo(null);
    try {
      await sendAsterGift(account, giftDraft);
      setGiftSentTo(giftDraft.recipientName.trim());
      notify({
        title: "Gift sent",
        message: `${giftDraft.amount.toLocaleString()} AC are waiting for ${giftDraft.recipientName.trim()}.`,
        tone: "success",
      });
      requestAsterGiftRefresh();
      setGiftDraft((current) => ({
        ...current,
        recipientName: "",
      }));
    } catch (error) {
      notify({
        title: "Gift could not be sent",
        message: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    } finally {
      setSendingGift(false);
    }
  };

  const reset = () => {
    if (launcherOnly) {
      updateLauncherSettings({
        automaticUpdateChecks:
          DEFAULT_LAUNCHER_SETTINGS.automaticUpdateChecks,
        activityNotifications:
          DEFAULT_LAUNCHER_SETTINGS.activityNotifications,
        reducedMotion: DEFAULT_LAUNCHER_SETTINGS.reducedMotion,
      });
    } else {
      resetLauncherSettings();
    }
    setSection("launcher");
    notify({
      title: "Settings reset",
      message: launcherOnly
        ? "Launcher defaults were restored and saved."
        : "Aster defaults were restored and saved.",
      tone: "info",
    });
  };

  const openDataFolder = async () => {
    if (!isTauriRuntime()) {
      notify({
        title: "Native launcher required",
        message: "The data folder can only be opened from the installed launcher.",
        tone: "warning",
      });
      return;
    }
    setOpeningFolder(true);
    try {
      await invoke("open_launcher_data_folder");
    } catch (error) {
      notify({
        title: "Folder could not open",
        message: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    } finally {
      setOpeningFolder(false);
    }
  };

  const updateStatus =
    updater.status === "available"
      ? `UPDATE ${updater.availableUpdate?.version ?? ""}`
      : updater.status === "checking"
        ? "CHECKING"
        : updater.status === "error"
          ? "CHECK FAILED"
          : "CURRENT";

  return (
    <div className="settings-v2-page">
      <header className="settings-v2-header">
        <div>
          <span className="settings-v2-kicker">ASTER CONTROL CENTER</span>
          <h1>Settings</h1>
          <p>
            {btd6Moderation
              ? "Configure the launcher and review Bloons TD 6 community mods."
              : launcherOnly
                ? "Configure launcher updates, activity, and interface."
              : "Configure the launcher, Minecraft runtime, and your privacy."}
          </p>
        </div>
        <div className="settings-v2-version">
          <span>
            <Sparkles size={14} />
          </span>
          <div>
            <small>ASTER LAUNCHER</small>
            <strong>v{updater.currentVersion}</strong>
          </div>
          <SettingBadge
            tone={updater.status === "available" ? "purple" : "neutral"}
          >
            {updateStatus}
          </SettingBadge>
        </div>
        <button type="button" className="settings-v2-reset" onClick={reset}>
          <RotateCcw size={13} />
          Reset defaults
        </button>
      </header>

      <div className="settings-v2-layout">
        <aside className="settings-v2-nav">
          <header>
            <strong>SETTINGS</strong>
            <small>Saved automatically</small>
          </header>
          <nav>
            {sections.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={section === item.id ? "is-active" : ""}
                  onClick={() => setSection(item.id)}
                >
                  <span><Icon size={15} /></span>
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.detail}</small>
                  </span>
                  <ChevronRight size={12} />
                </button>
              );
            })}
          </nav>
          <footer>
            <ShieldCheck size={14} />
            <span>
              <strong>Protected settings</strong>
              <small>No passwords are stored here</small>
            </span>
          </footer>
        </aside>

        <motion.div
          key={section}
          className="settings-v2-content"
          initial={{ opacity: 0, x: 7 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: settings.reducedMotion ? 0 : 0.14 }}
        >
          {section === "launcher" && (
            <>
              <SettingsGroup
                eyebrow="LAUNCHER"
                title="Updates & activity"
                description="Control how Aster checks for releases and reports activity."
              >
                <SettingsRow
                  icon={<Download size={16} />}
                  title="Automatic update checks"
                  description="Check the signed stable release when Aster opens and every 15 minutes."
                >
                  <PixelToggle
                    value={settings.automaticUpdateChecks}
                    onChange={(value) =>
                      updateLauncherSettings({ automaticUpdateChecks: value })
                    }
                    label="Automatic update checks"
                  />
                </SettingsRow>
                <SettingsRow
                  icon={<RefreshCw size={16} />}
                  title="Launcher update"
                  description={
                    updater.availableUpdate
                      ? `${updater.availableUpdate.name} is ready to install.`
                      : updater.error ?? "Signed stable channel · GitHub releases"
                  }
                >
                  <button
                    type="button"
                    className={`settings-v2-action ${
                      updater.status === "available" ? "is-primary" : ""
                    }`}
                    disabled={[
                      "checking",
                      "downloading",
                      "installing",
                    ].includes(updater.status)}
                    onClick={() =>
                      void (updater.status === "available"
                        ? updater.installUpdate()
                        : updater.checkForUpdates())
                    }
                  >
                    {["checking", "downloading", "installing"].includes(
                      updater.status,
                    ) ? (
                      <LoaderCircle className="spin" size={13} />
                    ) : updater.status === "available" ? (
                      <Download size={13} />
                    ) : (
                      <RefreshCw size={13} />
                    )}
                    {updater.status === "available"
                      ? "Update now"
                      : updater.status === "downloading"
                        ? `${updater.progress}%`
                        : updater.status === "installing"
                          ? "Installing"
                          : "Check now"}
                  </button>
                </SettingsRow>
                <SettingsRow
                  icon={<Bell size={16} />}
                  title="Activity notifications"
                  description="Keep download, account, and launcher activity in Notifications."
                >
                  <PixelToggle
                    value={settings.activityNotifications}
                    onChange={(value) =>
                      updateLauncherSettings({ activityNotifications: value })
                    }
                    label="Activity notifications"
                  />
                </SettingsRow>
              </SettingsGroup>

              <SettingsGroup
                eyebrow="INTERFACE"
                title="Launcher appearance"
                description="Keep the native launcher fast and readable."
              >
                <SettingsRow
                  icon={<WandSparkles size={16} />}
                  title="Reduced motion"
                  description="Shorten page transitions and disable decorative movement."
                >
                  <PixelToggle
                    value={settings.reducedMotion}
                    onChange={(value) =>
                      updateLauncherSettings({ reducedMotion: value })
                    }
                    label="Reduced motion"
                  />
                </SettingsRow>
                <SettingsRow
                  icon={<Languages size={16} />}
                  title="Interface language"
                  description="English is active. Additional translations are planned."
                >
                  <SettingBadge>ENGLISH · FIXED</SettingBadge>
                </SettingsRow>
              </SettingsGroup>
            </>
          )}

          {section === "minecraft" && (
            <>
              <SettingsGroup
                eyebrow="MINECRAFT"
                title="Game performance"
                description="These values are applied to every instance you launch."
              >
                <SettingsRow
                  icon={<MemoryStick size={16} />}
                  title="Allocated memory"
                  description={`${settings.memoryGb} GB will be passed to Java when Minecraft starts.`}
                >
                  <div className="settings-v2-memory">
                    <input
                      type="range"
                      min="2"
                      max="24"
                      step="1"
                      value={settings.memoryGb}
                      onChange={(event) =>
                        updateLauncherSettings({
                          memoryGb: Number(event.target.value),
                        })
                      }
                      aria-label="Allocated Minecraft memory"
                    />
                    <strong>{settings.memoryGb} GB</strong>
                  </div>
                </SettingsRow>
                <div className="settings-memory-guide">
                  <Gauge size={14} />
                  <span>
                    <b>Recommended:</b> 4 GB for vanilla, 6–8 GB for modpacks.
                    Do not allocate all system memory.
                  </span>
                </div>
                <RamSafetyWarning allocatedGb={settings.memoryGb} />
              </SettingsGroup>

              <SettingsGroup
                eyebrow="RUNTIME"
                title="Java & mod loaders"
                description="Aster selects the required runtime for each Minecraft version."
              >
                <SettingsRow
                  icon={<Cpu size={16} />}
                  title="Managed Java"
                  description="Missing Java runtimes are downloaded from Mojang automatically."
                >
                  <SettingBadge tone="ready"><Check size={10} /> MANAGED</SettingBadge>
                </SettingsRow>
                <SettingsRow
                  icon={<Boxes size={16} />}
                  title="Supported loaders"
                  description="Loader files are prepared per instance before launch."
                >
                  <span className="settings-loader-badges">
                    <b>VANILLA</b><b>FABRIC</b><b>FORGE</b>
                  </span>
                </SettingsRow>
              </SettingsGroup>
            </>
          )}

          {section === "storage" && (
            <>
              <SettingsGroup
                eyebrow="STORAGE"
                title="Launcher files"
                description="Instances, skins, logs, and managed runtimes stay in Aster's data folder."
              >
                <SettingsRow
                  icon={<FolderOpen size={16} />}
                  title="Aster data folder"
                  description="Open the exact folder used by the installed launcher."
                >
                  <button
                    type="button"
                    className="settings-v2-action"
                    disabled={openingFolder}
                    onClick={() => void openDataFolder()}
                  >
                    {openingFolder ? (
                      <LoaderCircle className="spin" size={13} />
                    ) : (
                      <FolderOpen size={13} />
                    )}
                    Open folder
                  </button>
                </SettingsRow>
                <SettingsRow
                  icon={<Database size={16} />}
                  title="Instance separation"
                  description="Every modpack has isolated mods, configs, saves, and logs."
                >
                  <SettingBadge tone="ready"><Check size={10} /> ENABLED</SettingBadge>
                </SettingsRow>
                <SettingsRow
                  icon={<ShieldCheck size={16} />}
                  title="Download verification"
                  description="Launcher updates use a signature and checksum before installation."
                >
                  <SettingBadge tone="ready"><Check size={10} /> REQUIRED</SettingBadge>
                </SettingsRow>
              </SettingsGroup>

              <div className="settings-v2-info-card">
                <HardDrive size={19} />
                <div>
                  <strong>Safe local storage</strong>
                  <p>
                    Removing Aster does not silently delete your Minecraft
                    worlds. Manage instance files from My Modpacks.
                  </p>
                </div>
              </div>
            </>
          )}

          {section === "privacy" && (
            <>
              <SettingsGroup
                eyebrow="PRIVACY"
                title="Presence & social"
                description="Choose what Aster shares with its own launcher services."
              >
                <SettingsRow
                  icon={<Radio size={16} />}
                  title="Online launcher presence"
                  description="Count this installation in the anonymous online-player total."
                >
                  <PixelToggle
                    value={settings.onlinePresence}
                    onChange={(value) =>
                      updateLauncherSettings({ onlinePresence: value })
                    }
                    label="Online launcher presence"
                  />
                </SettingsRow>
                <SettingsRow
                  icon={<Users size={16} />}
                  title="Friend and chat notifications"
                  description="Notify you about incoming requests and new messages."
                >
                  <PixelToggle
                    value={settings.socialNotifications}
                    onChange={(value) =>
                      updateLauncherSettings({ socialNotifications: value })
                    }
                    label="Social notifications"
                  />
                </SettingsRow>
                <SettingsRow
                  icon={<MonitorCog size={16} />}
                  title="Usage telemetry"
                  description="Aster does not send analytics or advertising identifiers."
                >
                  <SettingBadge tone="ready">NOT COLLECTED</SettingBadge>
                </SettingsRow>
              </SettingsGroup>

              <div className="settings-v2-info-card is-purple">
                <ShieldCheck size={19} />
                <div>
                  <strong>Your Microsoft password never enters Aster</strong>
                  <p>
                    Authentication happens in Microsoft's browser. Stored game
                    credentials remain protected by Windows secure storage.
                  </p>
                </div>
              </div>
            </>
          )}

          {section === "gifts" && giftOwnerCandidate && (
            <>
              <SettingsGroup
                eyebrow="OWNER ONLY"
                title="Aster Gift Console"
                description="Send a personal popup and Aster Credits to a player who has opened Aster before."
              >
                <div className="settings-gift-console">
                  <div className="settings-gift-status">
                    <span className="settings-v2-row-icon">
                      <Gift size={16} />
                    </span>
                    <div>
                      <strong>Gift delivery service</strong>
                      <p>
                        {giftAdminStatus === "allowed"
                          ? "Owner identity verified. Gifts are stored securely until claimed."
                          : giftAdminStatus === "checking"
                            ? "Verifying synoi with Aster Social..."
                            : giftRetrySeconds > 0
                              ? `Aster Social is cooling down. Owner verification retries automatically in ${giftRetrySeconds}s.`
                            : giftAdminStatus === "denied"
                              ? "This Aster Social identity is not registered as the owner."
                              : giftAdminError ??
                                "Connect Aster Social to verify owner access."}
                      </p>
                    </div>
                    <SettingBadge
                      tone={
                        giftAdminStatus === "allowed" ? "purple" : "neutral"
                      }
                    >
                      {giftAdminStatus === "allowed"
                        ? "OWNER VERIFIED"
                        : giftAdminStatus === "checking"
                          ? "CHECKING"
                          : giftRetrySeconds > 0
                            ? `WAIT ${giftRetrySeconds}s`
                          : "LOCKED"}
                    </SettingBadge>
                  </div>

                  <form
                    className="settings-gift-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void sendGift();
                    }}
                  >
                    <label className="settings-gift-field">
                      <span>MINECRAFT RECIPIENT</span>
                      <input
                        value={giftDraft.recipientName}
                        onChange={(event) =>
                          setGiftDraft((current) => ({
                            ...current,
                            recipientName: event.target.value,
                          }))
                        }
                        maxLength={16}
                        placeholder="Player name"
                        autoComplete="off"
                      />
                    </label>
                    <label className="settings-gift-field is-amount">
                      <span>ASTER CREDITS</span>
                      <input
                        type="number"
                        min={1}
                        max={100000}
                        step={1}
                        value={giftDraft.amount}
                        onChange={(event) =>
                          setGiftDraft((current) => ({
                            ...current,
                            amount: Number(event.target.value),
                          }))
                        }
                      />
                    </label>
                    <label className="settings-gift-field">
                      <span>POPUP TITLE</span>
                      <input
                        value={giftDraft.title}
                        onChange={(event) =>
                          setGiftDraft((current) => ({
                            ...current,
                            title: event.target.value,
                          }))
                        }
                        maxLength={64}
                        placeholder="A gift from Aster"
                      />
                    </label>
                    <label className="settings-gift-field is-message">
                      <span>PERSONAL MESSAGE</span>
                      <textarea
                        value={giftDraft.message}
                        onChange={(event) =>
                          setGiftDraft((current) => ({
                            ...current,
                            message: event.target.value,
                          }))
                        }
                        maxLength={280}
                        rows={4}
                        placeholder="Write a short message..."
                      />
                      <small>{giftDraft.message.length}/280</small>
                    </label>
                    <div className="settings-gift-submit">
                      <p>
                        {giftSentTo
                          ? `Last gift sent to ${giftSentTo}.`
                          : "The recipient sees the existing animated chest popup on their next inbox refresh."}
                      </p>
                      <button
                        type="submit"
                        className="settings-v2-action is-primary"
                        disabled={
                          sendingGift ||
                          giftAdminStatus !== "allowed" ||
                          !giftDraft.recipientName.trim()
                        }
                      >
                        {sendingGift ? (
                          <LoaderCircle className="spin" size={13} />
                        ) : (
                          <Send size={13} />
                        )}
                        {sendingGift ? "Sending..." : "Send gift"}
                      </button>
                    </div>
                  </form>
                </div>
              </SettingsGroup>

              <div className="settings-v2-info-card is-purple">
                <ShieldCheck size={19} />
                <div>
                  <strong>Hidden UI + server authorization</strong>
                  <p>
                    Only synoi sees this section, and Supabase verifies the
                    registered owner identity again before every delivery.
                  </p>
                </div>
              </div>
            </>
          )}

          {section === "btd6-moderation" && btd6OwnerCandidate && (
            <>
              <SettingsGroup
                eyebrow="OWNER ONLY"
                title="BTD6 Mod Moderation"
                description="Review scanned community uploads before they become downloadable in Aster."
              >
                <div className="settings-btd6-moderation">
                  <div className="settings-gift-status">
                    <span className="settings-v2-row-icon"><Gavel size={16} /></span>
                    <div>
                      <strong>Community catalog moderation</strong>
                      <p>
                        {btd6ModeratorStatus === "allowed"
                          ? `${btd6Submissions.filter((mod) => mod.status === "pending").length} submission(s) waiting for review.`
                          : btd6ModeratorStatus === "checking"
                            ? "Verifying synoi and loading the private queue..."
                            : btd6ModeratorStatus === "denied"
                              ? "This Aster Social identity is not the registered owner."
                              : btd6ModerationError ?? "The moderation service is unavailable."}
                      </p>
                    </div>
                    <button type="button" className="settings-v2-action" onClick={() => void refreshBtd6Moderation()} disabled={btd6ModeratorStatus === "checking"}>
                      <RefreshCw className={btd6ModeratorStatus === "checking" ? "spin" : ""} size={13} /> Refresh
                    </button>
                  </div>

                  <div className="settings-btd6-queue">
                    {btd6Submissions.map((mod) => (
                      <article key={mod.id} className={`status-${mod.status}`}>
                        <span><Puzzle size={20} /></span>
                        <div>
                          <header><strong>{mod.displayName}</strong><b>{mod.status.toUpperCase()}</b></header>
                          <p>{mod.description || mod.fileName}</p>
                          <small>v{mod.version} · {(mod.sizeBytes / 1024 / 1024).toFixed(1)} MB · SHA {mod.sha256.slice(0, 10)}… · {mod.riskSignals.length} warning(s)</small>
                        </div>
                        <div className="settings-btd6-review-actions">
                          {mod.status !== "approved" && (
                            <button type="button" className="approve" disabled={btd6ModerationBusy === mod.id} onClick={() => void moderateBtd6Submission(mod, "approve")}><Check size={13} /> Approve</button>
                          )}
                          <button type="button" className="delete" disabled={btd6ModerationBusy === mod.id} onClick={() => void moderateBtd6Submission(mod, "delete")}><Trash2 size={13} /> Delete</button>
                        </div>
                      </article>
                    ))}
                    {btd6ModeratorStatus === "allowed" && !btd6Submissions.length && (
                      <div className="settings-btd6-empty"><ShieldCheck size={25} /><strong>Queue is empty</strong><span>New uploads will appear here automatically.</span></div>
                    )}
                  </div>
                </div>
              </SettingsGroup>

              <div className="settings-v2-info-card is-purple">
                <ShieldCheck size={19} />
                <div><strong>Hidden UI + server authorization</strong><p>Only synoi sees this button. Supabase verifies the registered owner before approval or deletion.</p></div>
              </div>
            </>
          )}
        </motion.div>
      </div>
    </div>
  );
}

export function LauncherOnlySettingsPage() {
  return <SettingsPage launcherOnly />;
}

export function Btd6SettingsPage() {
  return <SettingsPage launcherOnly btd6Moderation />;
}
