import {
  ExternalLink,
  Gamepad2,
  LogOut,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { StevePreview } from "../components/StevePreview";
import {
  launchInstance,
  listenToLaunchStatus,
} from "../services/launcher";
import { useAppStore } from "../store/AppStore";

const homeNews = [
  {
    title: "Launcher Closed Alpha",
    category: "Limited Access",
    image: "/assets/closed-alpha-news.png",
  },
  {
    title: "Cosmetics Update Soon",
    category: "Preview",
    image: "/assets/news-cosmetics.png",
  },
  {
    title: "Community Playtests Opening",
    category: "Community",
    image: "/assets/news-community.png",
  },
  {
    title: "New Worlds Coming Soon",
    category: "World Update",
    image: "/assets/news-worlds.png",
  },
  {
    title: "Combat Features Preview",
    category: "Gameplay",
    image: "/assets/news-combat.png",
  },
  {
    title: "Experimental Content Testing",
    category: "Experiments",
    image: "/assets/news-experiments.png",
  },
];

export function HomePage() {
  const {
    account,
    instances,
    offline,
    updateInstance,
    notify,
    openModal,
    pushNotification,
    setDownloads,
    loggedIn,
    authBusy,
    beginMicrosoftLogin,
    signOut,
  } = useAppStore();
  const featured = instances[0];
  const [checkingForUpdates, setCheckingForUpdates] = useState(false);

  useEffect(() => {
    let stopListening: (() => void) | undefined;
    let disposed = false;

    void listenToLaunchStatus((event) => {
      if (disposed || event.instanceId !== featured.id) return;
      if (event.status === "preparing") {
        updateInstance(featured.id, {
          status: "launching",
          progress: undefined,
        });
      } else if (event.status === "running") {
        updateInstance(featured.id, { status: "launching" });
      } else if (event.status === "exited") {
        updateInstance(featured.id, { status: "ready" });
        const crashed = event.exitCode !== null && event.exitCode !== 0;
        notify({
          title: crashed ? "Minecraft stopped" : "Minecraft closed",
          message: event.detail,
          tone: crashed ? "error" : "info",
        });
        if (crashed) {
          pushNotification({
            id: `launch-failed-${featured.id}-${Date.now()}`,
            title: "Minecraft stopped unexpectedly",
            message: "The complete output is saved in the instance launch log.",
            tone: "error",
            source: "system",
          });
        }
      }
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stopListening = unlisten;
    });

    return () => {
      disposed = true;
      stopListening?.();
    };
  }, [featured.id, notify, pushNotification, updateInstance]);

  const launch = async () => {
    if (!loggedIn) {
      openModal("add-account");
      notify({
        title: "Microsoft account required",
        message: "Sign in with the account that owns Minecraft Java Edition.",
        tone: "warning",
      });
      return;
    }
    const downloadId = `launch-${featured.id}`;
    updateInstance(featured.id, { status: "launching" });
    setDownloads((current) => [
      {
        id: downloadId,
        title: `Preparing ${featured.name}`,
        detail: "Checking account session",
        status: "downloading",
        progress: 1,
      },
      ...current.filter((download) => download.id !== downloadId),
    ]);
    try {
      const started = await launchInstance(
        featured.id,
        featured.version,
        featured.loader,
      );
      notify({
        title: "Minecraft started",
        message: `Minecraft ${started.versionId} is running.`,
        tone: "success",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateInstance(featured.id, {
        status: /requires Java|Java \d+|Java runtime/i.test(message)
          ? "missing-java"
          : "ready",
      });
      setDownloads((current) =>
        current.map((download) =>
          download.id === downloadId
            ? { ...download, status: "failed", detail: message }
            : download,
        ),
      );
      if (/requires Java|Java \d+|Java runtime/i.test(message)) {
        openModal("missing-java");
      }
      notify({
        title: "Minecraft could not start",
        message,
        tone: "error",
      });
    }
  };

  const refresh = async () => {
    if (checkingForUpdates) return;
    setCheckingForUpdates(true);
    await new Promise((resolve) => window.setTimeout(resolve, 650));
    setCheckingForUpdates(false);
    notify({
      title: "Instance checked",
      message: "Minecraft 1.21.1 is up to date.",
      tone: "success",
    });
  };

  return (
    <div className="launcher-home">
      <section className="home-feature-row">
        <div className="featured-game">
          <img
            src="/assets/featured-modpack.png"
            alt=""
            className="featured-background"
          />
          <div className="featured-shade" />
          <div className="featured-content">
            <h1>Minecraft 1.21.1</h1>
            <span className="featured-badge">Custom Modpack</span>
            <p>
              A curated Minecraft profile with performance improvements,
              quality-of-life features and multiplayer-ready settings.
            </p>
            <div className="launch-controls">
              <button
                type="button"
                className="launch-button"
                onClick={launch}
                disabled={
                  featured.status === "launching" ||
                  featured.status === "updating"
                }
              >
                {featured.status === "launching" ? (
                  <>
                    <RefreshCw className="spin" size={17} />
                    LAUNCHING
                  </>
                ) : featured.status === "updating" ? (
                  <>
                    <RefreshCw className="spin" size={17} />
                    UPDATING {featured.progress}%
                  </>
                ) : (
                  <>
                    <Play size={17} fill="currentColor" />
                    <span>
                      LAUNCH 1.21.1
                      <small>
                        <Gamepad2 size={10} /> READY TO LAUNCH
                      </small>
                    </span>
                  </>
                )}
              </button>
              <button
                type="button"
                className="refresh-button"
                onClick={() => void refresh()}
                disabled={checkingForUpdates}
                aria-label="Check for updates"
                title="Check for updates"
              >
                <RefreshCw className={checkingForUpdates ? "spin" : ""} size={19} />
              </button>
            </div>
            {offline && (
              <span className="home-offline-note">
                Offline mode · local play only
              </span>
            )}
          </div>
        </div>

        <aside
          className={`home-account-card ${loggedIn ? "is-logged-in" : "is-logged-out"}`}
        >
          <StevePreview
            className="home-steve-preview"
            grayscale={!loggedIn}
            skinPath={account?.skinPath}
          />
          <span className="account-accent-line" />
          <h2>{account?.username ?? "Not signed in"}</h2>
          {!loggedIn && (
            <div className="account-signin-context">
              <span>
                <ShieldCheck size={11} />
                MICROSOFT ACCOUNT
              </span>
            </div>
          )}
          <div className="account-action-row">
            <button
              type="button"
              className="manage-account-button"
              disabled={authBusy}
              onClick={() => {
                if (loggedIn) openModal("manage-account");
                else void beginMicrosoftLogin();
              }}
            >
              {authBusy
                ? "Signing in..."
                : loggedIn
                  ? "Manage Account"
                  : "Sign In"}
            </button>
            <button
              type="button"
              className="add-account-button"
              disabled={authBusy}
              onClick={() => {
                if (loggedIn) openModal("add-account");
                else void beginMicrosoftLogin();
              }}
              aria-label="Add account"
              title="Add account"
            >
              <Plus size={15} />
            </button>
          </div>
          {!loggedIn && (
            <p className="account-signin-hint">
              Connect your profile, skin and game ownership
            </p>
          )}
          {loggedIn && (
            <>
              <button
                type="button"
                className="friends-button"
                onClick={() =>
                  notify({
                    title: "Friends",
                    message: "No friends are online right now.",
                    tone: "info",
                  })
                }
              >
                <Users size={14} />
                Your Friends
              </button>
              <button
                type="button"
                className="account-logout-link"
                onClick={() => void signOut()}
              >
                <LogOut size={10} />
                Log out...
              </button>
            </>
          )}
        </aside>
      </section>

      <section className="home-news-panel">
        <div className="news-track" aria-label="Featured launcher news">
          <div className="news-marquee-track">
            {[...homeNews, ...homeNews].map((item, index) => (
              <article
                className="compact-news-card"
                key={`${item.title}-${index}`}
                aria-hidden={index >= homeNews.length}
              >
                <div
                  className={`compact-news-image ${item.image.includes("closed-alpha") ? "is-closed-alpha" : ""}`}
                >
                  <img src={item.image} alt="" />
                  <span>{item.category}</span>
                </div>
                <div className="compact-news-copy">
                  <h3>{item.title}</h3>
                  <button
                    type="button"
                    tabIndex={index >= homeNews.length ? -1 : 0}
                    aria-label={`Open ${item.title}`}
                    onClick={() =>
                      notify({
                        title: item.title,
                        message:
                          "News detail view is ready for backend content.",
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
