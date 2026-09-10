import { useEffect, useState } from "react";
import { FolderOpen, Gauge, Shield, SlidersHorizontal } from "lucide-react";
import { detectSprocket, getSprocketSettings, openSprocketPath, saveSprocketSettings, type SprocketInstallation, type SprocketSettings } from "../services/sprocket";

export function SprocketSettingsPage() {
  const [settings, setSettings] = useState<SprocketSettings>(getSprocketSettings); const [installation, setInstallation] = useState<SprocketInstallation | null>(null);
  useEffect(() => { void detectSprocket().then(setInstallation); }, []);
  const update = (patch: Partial<SprocketSettings>) => { const next = { ...settings, ...patch }; setSettings(next); saveSprocketSettings(next); };
  return <section className="sprocket-page"><header className="sprocket-page-header"><div><span>SPROCKET</span><h1>Game Settings</h1><p>Launch behavior and local file safety for Sprocket.</p></div></header>
    <div className="sprocket-settings-grid"><section><header><Gauge/><span><h2>Installation</h2><p>Steam App {installation?.appId ?? "1674170"}</p></span></header><dl><div><dt>Status</dt><dd className={installation?.installed ? "good" : "warn"}>{installation?.installed ? "Detected" : "Not installed"}</dd></div><div><dt>Build</dt><dd>{installation?.buildId ?? "Unknown"}</dd></div><div><dt>Mod loader</dt><dd>{installation?.melonLoaderInstalled ? "MelonLoader" : "Vanilla"}</dd></div></dl><button className="mc-button" disabled={!installation?.installed} onClick={() => void openSprocketPath("game")}><FolderOpen size={15}/> Open installation</button></section>
      <section><header><Shield/><span><h2>Safe launch</h2><p>Protect your local builds.</p></span></header><SettingToggle label="Backup before every launch" detail="Copies Sprocket data before the game starts." checked={settings.backupBeforeLaunch} onChange={(value) => update({ backupBeforeLaunch: value })}/><SettingToggle label="Start without community mods" detail="Uses MelonLoader safe mode when available." checked={settings.safeMode} onChange={(value) => update({ safeMode: value })}/></section>
      <section><header><SlidersHorizontal/><span><h2>Launcher behavior</h2><p>Per-game preferences.</p></span></header><SettingToggle label="Close launcher after start" detail="Reserved for a later window lifecycle update." checked={settings.closeLauncherOnStart} onChange={(value) => update({ closeLauncherOnStart: value })}/></section>
    </div>
  </section>;
}
function SettingToggle({ label, detail, checked, onChange }: { label: string; detail: string; checked: boolean; onChange: (value: boolean) => void }) { return <button className="sprocket-setting-toggle" onClick={() => onChange(!checked)}><span><strong>{label}</strong><small>{detail}</small></span><i className={checked ? "on" : ""}><b/></i></button>; }
