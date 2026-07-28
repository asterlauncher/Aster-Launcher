import {
  Bell,
  Download,
  FolderOpen,
  HardDrive,
  Languages,
  Monitor,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { useAppStore } from "../store/AppStore";

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
    <div className="native-setting-row">
      <span className="native-setting-icon">{icon}</span>
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <div>{children}</div>
    </div>
  );
}

function SmallToggle({
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
      className={`native-toggle ${value ? "active" : ""}`}
      onClick={() => onChange(!value)}
    >
      <span />
    </button>
  );
}

export function SettingsPage() {
  const { openModal, notify } = useAppStore();
  const [updates, setUpdates] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [memory, setMemory] = useState(6);

  return (
    <div className="compact-page">
      <header className="compact-page-header">
        <div>
          <h1>Settings</h1>
          <p>Launcher and game preferences</p>
        </div>
        <button
          type="button"
          className="quiet-action"
          onClick={() =>
            notify({
              title: "Settings reset",
              message: "Default launcher settings were restored.",
              tone: "info",
            })
          }
        >
          <RotateCcw size={15} />
          Reset
        </button>
      </header>

      <div className="native-settings-layout">
        <nav className="settings-section-list">
          <button type="button" className="active">
            <SlidersHorizontal size={16} /> General
          </button>
          <button type="button">
            <Terminal size={16} /> Minecraft
          </button>
          <button type="button">
            <HardDrive size={16} /> Storage
          </button>
          <button type="button">
            <ShieldCheck size={16} /> Privacy
          </button>
        </nav>

        <div className="settings-groups">
          <section className="native-settings-group">
            <header>
              <strong>General</strong>
              <span>Launcher behavior</span>
            </header>
            <SettingsRow
              icon={<Download size={16} />}
              title="Automatic updates"
              description="Keep the launcher and installed profiles current."
            >
              <SmallToggle
                value={updates}
                onChange={setUpdates}
                label="Automatic updates"
              />
            </SettingsRow>
            <SettingsRow
              icon={<Bell size={16} />}
              title="Desktop notifications"
              description="Show completion and error notifications."
            >
              <SmallToggle
                value={notifications}
                onChange={setNotifications}
                label="Desktop notifications"
              />
            </SettingsRow>
            <SettingsRow
              icon={<Languages size={16} />}
              title="Language"
              description="Launcher interface language."
            >
              <select defaultValue="English">
                <option>English</option>
                <option>Deutsch</option>
              </select>
            </SettingsRow>
          </section>

          <section className="native-settings-group">
            <header>
              <strong>Minecraft</strong>
              <span>Runtime and memory</span>
            </header>
            <SettingsRow
              icon={<Monitor size={16} />}
              title="Allocated memory"
              description={`${memory} GB assigned to modded profiles.`}
            >
              <div className="native-memory-control">
                <input
                  type="range"
                  min="2"
                  max="16"
                  value={memory}
                  onChange={(event) => setMemory(Number(event.target.value))}
                />
                <span>{memory} GB</span>
              </div>
            </SettingsRow>
            <SettingsRow
              icon={<FolderOpen size={16} />}
              title="Java runtime"
              description="Java 21 · managed automatically."
            >
              <button
                type="button"
                className="settings-secondary-button"
                onClick={() => openModal("missing-java")}
              >
                Change
              </button>
            </SettingsRow>
          </section>
        </div>
      </div>
    </div>
  );
}
