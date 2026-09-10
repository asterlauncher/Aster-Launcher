import { useCallback, useEffect, useState } from "react";
import {
  ExternalLink,
  Gauge,
  Play,
  RefreshCw,
} from "lucide-react";
import { listenToLaunchStatus } from "../services/launcher";
import {
  createSprocketBackup,
  detectSprocket,
  getSprocketSettings,
  launchSprocket,
  listSprocketProfiles,
  openSprocketStore,
  type SprocketInstallation,
  type SprocketProfile,
} from "../services/sprocket";
import { useAppStore } from "../store/AppStore";

const sprocketNews = [
  {
    image: "/assets/sprocket-desert-build.png",
    category: "FIELD TEST",
    title: "Desert Mobility Trials",
  },
  {
    image: "/assets/sprocket-prototype.png",
    category: "PROTOTYPE",
    title: "Early Vehicle Concepts",
  },
  {
    image: "/assets/sprocket-hero.png",
    category: "WORKSHOP",
    title: "Armor Tuning Preview",
  },
  {
    image: "/assets/sprocket-desert-build.png",
    category: "BLUEPRINTS",
    title: "Community Builds Soon",
  },
  {
    image: "/assets/sprocket-prototype.png",
    category: "ENGINEERING",
    title: "New Tools In Development",
  },
] as const;

export function SprocketHomePage() {
  const { notify } = useAppStore();
  const [installation, setInstallation] = useState<SprocketInstallation | null>(null);
  const [profiles, setProfiles] = useState<SprocketProfile[]>([]);
  const [busy, setBusy] = useState(true);
  const [running, setRunning] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const [nextInstallation, nextProfiles] = await Promise.all([
        detectSprocket(),
        listSprocketProfiles(),
      ]);
      setInstallation(nextInstallation);
      setProfiles(nextProfiles);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listenToLaunchStatus((event) => {
      if (event.instanceId !== "sprocket") return;
      setRunning(event.status === "running" || event.status === "preparing");
    }).then((value) => {
      unlisten = value;
    });
    return () => unlisten?.();
  }, []);

  const play = async () => {
    if (!installation?.installed) {
      await openSprocketStore();
      return;
    }

    const settings = getSprocketSettings();
    setRunning(true);
    try {
      if (settings.backupBeforeLaunch && profiles.length > 0) {
        await createSprocketBackup();
      }
      await launchSprocket(settings.safeMode);
      notify({
        title: "Sprocket started",
        message: settings.safeMode
          ? "Started with community mods disabled."
          : "The game process is running.",
        tone: "success",
      });
    } catch (error) {
      setRunning(false);
      notify({
        title: "Sprocket could not start",
        message: String(error),
        tone: "error",
      });
    }
  };

  return (
    <div className="launcher-home sprocket-launcher-home">
      <section className="home-feature-row sprocket-home-feature-row">
        <div className="featured-game sprocket-featured-game">
          <img
            src="/assets/sprocket-hero.png"
            alt=""
            className="featured-background sprocket-featured-background"
          />
          <div className="featured-shade" />
          <div className="featured-content">
            <h1>Sprocket</h1>
            <span className="featured-badge">Engineering Sandbox</span>
            <p>
              Build, tune and manage armored vehicles with local blueprints,
              protected backups and a focused Aster workbench.
            </p>
            <div className="launch-controls">
              <button
                type="button"
                className="launch-button"
                onClick={() => void play()}
                disabled={running || busy}
              >
                {running ? (
                  <>
                    <RefreshCw className="spin" size={17} />
                    RUNNING
                  </>
                ) : (
                  <>
                    <Play size={17} fill="currentColor" />
                    <span>
                      {installation?.installed ? "LAUNCH SPROCKET" : "OPEN IN STEAM"}
                      <small>
                        <Gauge size={10} />
                        {installation?.installed
                          ? `BUILD ${installation.buildId ?? "STEAM"}`
                          : "GAME NOT DETECTED"}
                      </small>
                    </span>
                  </>
                )}
              </button>
              <button
                type="button"
                className="refresh-button"
                onClick={() => void refresh()}
                disabled={busy}
                aria-label="Refresh Sprocket detection"
                title="Refresh Sprocket detection"
              >
                <RefreshCw className={busy ? "spin" : ""} size={19} />
              </button>
            </div>
          </div>
        </div>

      </section>

      <section className="home-news-panel">
        <div className="news-track" aria-label="Featured Sprocket news">
          <div className="news-marquee-track">
            {[...sprocketNews, ...sprocketNews].map((item, index) => (
              <article
                className="compact-news-card"
                key={`${item.title}-${index}`}
                aria-hidden={index >= sprocketNews.length}
              >
                <div className="compact-news-image sprocket-news-image">
                  <img src={item.image} alt="" />
                  <span>{item.category}</span>
                </div>
                <div className="compact-news-copy">
                  <h3>{item.title}</h3>
                  <button
                    type="button"
                    tabIndex={index >= sprocketNews.length ? -1 : 0}
                    aria-label={`Open ${item.title}`}
                    onClick={() =>
                      notify({
                        title: item.title,
                        message: "Sprocket feature details are coming soon.",
                        tone: "info",
                      })
                    }
                  >
                    <ExternalLink size={15} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
