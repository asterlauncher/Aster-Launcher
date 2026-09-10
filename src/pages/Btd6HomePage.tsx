import { useCallback, useEffect, useState } from "react";
import {
  ExternalLink,
  Play,
  RefreshCw,
} from "lucide-react";
import { Btd6RiskDialog } from "../components/Btd6RiskDialog";
import { listenToLaunchStatus } from "../services/launcher";
import {
  detectBtd6,
  launchBtd6,
  listBtd6Mods,
  openBtd6Store,
  requiresBtd6RiskWarning,
  type Btd6Installation,
  type Btd6ModFile,
} from "../services/btd6";
import { useAppStore } from "../store/AppStore";

const btd6Cards = [
  { image: "/assets/btd6-battle.png", category: "MOD SAFETY", title: "Every DLL scanned before launch", page: "store" },
  { image: "/assets/btd6-hero.png", category: "PRIVATE RUNTIME", title: "Loader only activated by Aster", page: "mods" },
  { image: "/assets/btd6-logo.png", category: "VANILLA MODE", title: "Play without the Aster mod runtime", page: "mods" },
] as const;

export function Btd6HomePage() {
  const { notify, setPage } = useAppStore();
  const [installation, setInstallation] = useState<Btd6Installation | null>(null);
  const [mods, setMods] = useState<Btd6ModFile[]>([]);
  const [busy, setBusy] = useState(true);
  const [running, setRunning] = useState(false);
  const [showRisk, setShowRisk] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const [nextInstallation, nextMods] = await Promise.all([
        detectBtd6(),
        listBtd6Mods(),
      ]);
      setInstallation(nextInstallation);
      setMods(nextMods);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listenToLaunchStatus((event) => {
      if (event.instanceId !== "btd6") return;
      setRunning(event.status === "running" || event.status === "preparing");
    }).then((value) => { unlisten = value; });
    return () => unlisten?.();
  }, []);

  const start = async (modded: boolean, acknowledged: boolean) => {
    setRunning(true);
    try {
      const result = await launchBtd6(modded, acknowledged);
      setShowRisk(false);
      notify({
        title: result.modded ? "BTD6 started with mods" : "BTD6 started",
        message: result.modded
          ? "Every enabled mod passed the launch scan. Account risk still remains."
          : "Started without Aster's mod runtime.",
        tone: result.modded ? "warning" : "success",
      });
    } catch (error) {
      setRunning(false);
      notify({ title: "BTD6 could not start", message: String(error), tone: "error" });
    }
  };

  const play = async () => {
    if (!installation?.installed) {
      await openBtd6Store();
      return;
    }
    if (requiresBtd6RiskWarning(mods)) {
      setShowRisk(true);
      return;
    }
    await start(false, false);
  };

  const enabledCount = mods.filter((mod) => mod.enabled).length;

  return (
    <div className="launcher-home btd6-launcher-home">
      <section className="home-feature-row btd6-home-feature-row">
        <div className="featured-game btd6-featured-game">
          <img src="/assets/btd6-hero.png" alt="" className="featured-background btd6-featured-background" />
          <div className="featured-shade" />
          <div className="featured-content">
            <h1>Bloons TD 6</h1>
            <span className="featured-badge">Vanilla + Mods</span>
            <p>
              Launch normally or manage community mods through Aster's isolated,
              scan-first BTD6 workspace.
            </p>
            <div className="launch-controls">
              <button type="button" className="launch-button" onClick={() => void play()} disabled={busy || running}>
                {running ? <><RefreshCw className="spin" size={17} /> RUNNING</> : <><Play size={17} fill="currentColor" /><span>{installation?.installed ? (enabledCount ? "LAUNCH MODDED" : "LAUNCH BTD6") : "OPEN IN STEAM"}<small>{installation?.installed ? `${enabledCount} MODS ENABLED` : "GAME NOT DETECTED"}</small></span></>}
              </button>
              <button type="button" className="refresh-button" onClick={() => void refresh()} disabled={busy} title="Refresh BTD6 detection"><RefreshCw className={busy ? "spin" : ""} size={19} /></button>
              {enabledCount > 0 && <button type="button" className="mc-button" onClick={() => void start(false, false)} disabled={running}>VANILLA</button>}
            </div>
          </div>
        </div>
      </section>

      <section className="home-news-panel btd6-feature-cards">
        <div className="news-track" aria-label="Bloons TD 6 features">
          <div className="news-marquee-track">
            {[...btd6Cards, ...btd6Cards].map((item, index) => {
              return (
                <article className="compact-news-card" key={`${item.category}-${index}`} aria-hidden={index >= btd6Cards.length}>
                  <div className="compact-news-image btd6-card-art">
                    <img src={item.image} alt="" />
                    <span>{item.category}</span>
                  </div>
                  <div className="compact-news-copy">
                    <h3>{item.title}</h3>
                    <button type="button" tabIndex={index >= btd6Cards.length ? -1 : 0} aria-label={`Open ${item.title}`} onClick={() => setPage(item.page)}><ExternalLink size={15} /></button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {showRisk && <Btd6RiskDialog modCount={enabledCount} busy={running} onCancel={() => setShowRisk(false)} onConfirm={() => void start(true, true)} />}
    </div>
  );
}
