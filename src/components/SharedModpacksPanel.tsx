import { motion } from "framer-motion";
import {
  Archive,
  Check,
  Download,
  LoaderCircle,
  RefreshCw,
  Send,
  ShieldCheck,
  UploadCloud,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  readModpackLibrary,
  subscribeModpackLibrary,
  type InstalledModpack,
} from "../services/modpackLibrary";
import {
  installSharedModpack,
  loadSharedModpacks,
  publishSharedModpack,
  respondToSharedModpack,
  type SharedModpack,
} from "../services/sharedModpacks";
import { useAppStore } from "../store/AppStore";

function sharedModpackError(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (typeof error === "object" && error !== null) {
    const details = error as {
      message?: unknown;
      details?: unknown;
      hint?: unknown;
      code?: unknown;
    };
    const parts = [details.message, details.details, details.hint]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .map((part) => part.trim());
    if (parts.length > 0) return [...new Set(parts)].join(" ");
    if (typeof details.code === "string" && details.code.trim()) {
      return `Shared Modpacks request failed (${details.code}).`;
    }
  }
  return "Shared Modpacks could not connect to Aster Social.";
}

export function SharedModpacksPanel() {
  const { asterAccount: account, notify, setDownloads } = useAppStore();
  const [shares, setShares] = useState<SharedModpack[]>([]);
  const [library, setLibrary] = useState<InstalledModpack[]>(readModpackLibrary);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => subscribeModpackLibrary(() => setLibrary(readModpackLibrary())),
    [],
  );

  const refresh = useCallback(async () => {
    if (!account) return;
    setLoading(true);
    try {
      const next = await loadSharedModpacks(account);
      setShares(next);
      setSelectedId((current) =>
        current && next.some((share) => share.id === current)
          ? current
          : next[0]?.id ?? null,
      );
      setError(null);
    } catch (caught) {
      setError(sharedModpackError(caught));
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selected = shares.find((share) => share.id === selectedId) ?? null;
  const installed = useMemo(
    () =>
      selected
        ? library.find((item) => item.sharedModpackId === selected.id) ?? null
        : null,
    [library, selected],
  );
  const ownerInstance = useMemo(
    () =>
      selected?.status === "owner"
        ? library.find((item) => item.id === selected.sourceKey) ?? null
        : null,
    [library, selected],
  );
  const updateAvailable = Boolean(
    selected &&
      installed &&
      selected.currentRevision > (installed.sharedRevision ?? 0),
  );

  const respond = async (share: SharedModpack, accept: boolean) => {
    if (!account) return;
    setBusy(`respond-${share.id}`);
    try {
      await respondToSharedModpack(account, share.id, accept);
      notify({
        title: accept ? "Modpack accepted" : "Modpack declined",
        message: accept
          ? `${share.name} is ready to install.`
          : `${share.name} was removed from your incoming packs.`,
        tone: accept ? "success" : "info",
      });
      await refresh();
    } catch (caught) {
      setError(sharedModpackError(caught));
    } finally {
      setBusy(null);
    }
  };

  const install = async (share: SharedModpack) => {
    if (!account) return;
    const downloadId = `shared-pack-${share.id}-${Date.now()}`;
    setBusy(`install-${share.id}`);
    setDownloads((current) => [
      {
        id: downloadId,
        title: share.name,
        detail: installed ? "Applying owner update" : "Installing shared modpack",
        status: "downloading",
        progress: 1,
      },
      ...current,
    ]);
    try {
      const result = await installSharedModpack(account, share, downloadId);
      notify({
        title: installed ? `${share.name} updated` : `${share.name} installed`,
        message: `Revision ${share.currentRevision} is ready with ${result.installedFiles} pack files.`,
        tone: "success",
      });
      setLibrary(readModpackLibrary());
      await refresh();
    } catch (caught) {
      const message = sharedModpackError(caught);
      setDownloads((current) =>
        current.map((item) =>
          item.id === downloadId ? { ...item, status: "failed", detail: message } : item,
        ),
      );
      setError(message);
    } finally {
      setBusy(null);
    }
  };

  const publish = async (share: SharedModpack, modpack: InstalledModpack) => {
    if (!account) return;
    const recipients = shares.filter(
      (candidate) =>
        candidate.status === "owner" &&
        candidate.sourceKey === share.sourceKey,
    );
    setBusy(`publish-${share.sourceKey}`);
    try {
      const revisions = await Promise.all(
        recipients.map(async (recipient) => ({
          recipient: recipient.recipientName,
          revision: await publishSharedModpack(
            account,
            recipient.friendshipId,
            modpack,
          ),
        })),
      );
      notify({
        title: "Modpack update published",
        message: `${revisions.length} friend${revisions.length === 1 ? "" : "s"} will now see an Update button.`,
        tone: "success",
      });
      await refresh();
    } catch (caught) {
      setError(sharedModpackError(caught));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="shared-modpacks">
      <aside className="shared-modpack-list">
        <header>
          <div>
            <h3>Shared Modpacks</h3>
            <p>{shares.filter((share) => share.status === "pending").length} awaiting you</p>
          </div>
          <button type="button" onClick={() => void refresh()} aria-label="Refresh shared modpacks">
            <RefreshCw size={13} className={loading ? "spin" : ""} />
          </button>
        </header>
        {loading && shares.length === 0 ? (
          <div className="shared-modpack-empty"><LoaderCircle className="spin" size={19} /> Syncing packs...</div>
        ) : shares.length === 0 ? (
          <div className="shared-modpack-empty"><Archive size={22} /><strong>No shared modpacks</strong><span>Share one from a friend's chat.</span></div>
        ) : (
          shares.map((share) => {
            const localPack = library.find(
              (item) => item.sharedModpackId === share.id,
            );
            const hasUpdate = Boolean(
              share.status === "accepted" &&
                localPack &&
                share.currentRevision > (localPack.sharedRevision ?? 0),
            );
            return <button
              type="button"
              key={share.id}
              className={selectedId === share.id ? "is-selected" : ""}
              onClick={() => setSelectedId(share.id)}
            >
              <span><Archive size={15} /></span>
              <span><strong>{share.name}</strong><small>{share.gameVersion} · {share.loader}</small></span>
              {share.status === "pending" && <b>NEW</b>}
              {hasUpdate && <b>UPDATE</b>}
            </button>;
          })
        )}
      </aside>

      <section className="shared-modpack-detail">
        {error && <div className="shared-modpack-error"><span>{error}</span><button type="button" onClick={() => setError(null)}><X size={12} /></button></div>}
        {!selected ? (
          <div className="shared-modpack-empty large"><Archive size={26} /><strong>Select a shared pack</strong><span>Invitations and owner updates appear here.</span></div>
        ) : (
          <motion.div key={selected.id} initial={{ opacity: 0, x: 7 }} animate={{ opacity: 1, x: 0 }}>
            <header className="shared-modpack-hero">
              <span><Archive size={24} /></span>
              <div>
                <small>{selected.status === "owner" ? "YOU SHARED" : `FROM ${selected.ownerName}`}</small>
                <h2>{selected.name}</h2>
                <p>{selected.gameVersion} · {selected.loader} · revision {selected.currentRevision}</p>
              </div>
              {selected.status === "accepted" && <em><ShieldCheck size={12} /> ACCEPTED</em>}
            </header>

            {selected.status === "pending" && (
              <div className="shared-modpack-invite">
                <div><Send size={20} /><strong>{selected.ownerName} shared this modpack</strong><span>Accept it before Aster downloads any files.</span></div>
                <button type="button" disabled={Boolean(busy)} onClick={() => void respond(selected, true)}><Check size={13} /> Accept</button>
                <button type="button" disabled={Boolean(busy)} onClick={() => void respond(selected, false)}><X size={13} /> Decline</button>
              </div>
            )}

            {selected.status === "accepted" && (
              <div className="shared-modpack-action-card">
                <div>
                  <strong>{installed ? (updateAvailable ? "Owner update available" : "Installed and current") : "Ready to install"}</strong>
                  <span>{installed ? `Local revision ${installed.sharedRevision ?? 0} · latest ${selected.currentRevision}` : "Aster will install the exact loader, mods and included dependencies."}</span>
                </div>
                {(!installed || updateAvailable) && (
                  <button type="button" disabled={Boolean(busy)} onClick={() => void install(selected)}>
                    {busy === `install-${selected.id}` ? <LoaderCircle className="spin" size={13} /> : <Download size={13} />}
                    {installed ? "Update" : "Install"}
                  </button>
                )}
              </div>
            )}

            {selected.status === "owner" && (
              <div className="shared-modpack-action-card owner">
                <div><strong>Shared with {selected.recipientName}</strong><span>Publish after changing mods. Every friend using this pack will receive an Update button.</span></div>
                <button type="button" disabled={!ownerInstance || Boolean(busy)} onClick={() => ownerInstance && void publish(selected, ownerInstance)}>
                  {busy === `publish-${selected.sourceKey}` ? <LoaderCircle className="spin" size={13} /> : <UploadCloud size={13} />}
                  Publish to all
                </button>
              </div>
            )}
          </motion.div>
        )}
      </section>
    </div>
  );
}
