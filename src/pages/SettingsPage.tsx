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
  HardDrive,
  Languages,
  LoaderCircle,
  MemoryStick,
  MonitorCog,
  Radio,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  Users,
  WandSparkles,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { useLauncherSettings } from "../hooks/useLauncherSettings";
import { useLauncherUpdater } from "../hooks/useLauncherUpdater";
import { isTauriRuntime } from "../services/auth";
import {
  resetLauncherSettings,
  updateLauncherSettings,
} from "../services/settings";
import { useAppStore } from "../store/AppStore";

type SettingsSection = "launcher" | "minecraft" | "storage" | "privacy";

const sections: {
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

export function SettingsPage() {
  const { notify } = useAppStore();
  const settings = useLauncherSettings();
  const updater = useLauncherUpdater();
  const [section, setSection] = useState<SettingsSection>("launcher");
  const [openingFolder, setOpeningFolder] = useState(false);

  const reset = () => {
    resetLauncherSettings();
    setSection("launcher");
    notify({
      title: "Settings reset",
      message: "Aster defaults were restored and saved.",
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
          <p>Configure the launcher, Minecraft runtime, and your privacy.</p>
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
        </motion.div>
      </div>
    </div>
  );
}
