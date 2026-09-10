import {
  ArchiveRestore,
  Check,
  CloudDownload,
  CloudUpload,
  Crown,
  History,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RefreshCw,
  Server,
  Shield,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createSharedWorld,
  deleteSharedWorld,
  loadSharedWorldRevisions,
  loadSharedWorlds,
  publishSharedWorldRevision,
  readSharedWorldBindings,
  removeSharedWorldMember,
  restoreSharedWorld,
  shareWorldWithFriend,
  type SharedWorld,
  type SharedWorldPermission,
  type SharedWorldRevision,
} from "../services/sharedWorlds";
import { listInstanceContent } from "../services/instances";
import {
  readModpackLibrary,
  subscribeModpackLibrary,
  type InstalledModpack,
} from "../services/modpackLibrary";
import { useAppStore } from "../store/AppStore";

function sizeLabel(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function errorText(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

export function SharedWorldsPanel() {
  const { asterAccount: account, notify, setPage } = useAppStore();
  const [library, setLibrary] =
    useState<InstalledModpack[]>(readModpackLibrary);
  const [worlds, setWorlds] = useState<SharedWorld[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<SharedWorldRevision[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [sourceInstanceId, setSourceInstanceId] = useState("");
  const [sourceWorldName, setSourceWorldName] = useState("");
  const [localWorlds, setLocalWorlds] = useState<string[]>([]);
  const [sharedName, setSharedName] = useState("");
  const [targetInstanceId, setTargetInstanceId] = useState("");
  const [friendName, setFriendName] = useState("");
  const [permission, setPermission] =
    useState<SharedWorldPermission>("host");

  useEffect(
    () =>
      subscribeModpackLibrary(() => {
        setLibrary(readModpackLibrary());
      }),
    [],
  );

  const refresh = useCallback(async () => {
    if (!account) return;
    setLoading(true);
    setError("");
    try {
      const next = await loadSharedWorlds(account);
      setWorlds(next);
      setSelectedId((current) =>
        current && next.some((world) => world.id === current)
          ? current
          : next[0]?.id ?? null,
      );
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!sourceInstanceId) {
      setLocalWorlds([]);
      setSourceWorldName("");
      return;
    }
    void listInstanceContent(sourceInstanceId).then((items) => {
      const names = items
        .filter((item) => item.kind === "worlds")
        .map((item) => item.fileName);
      setLocalWorlds(names);
      setSourceWorldName((current) =>
        names.includes(current) ? current : names[0] ?? "",
      );
    });
  }, [sourceInstanceId]);

  const selected = useMemo(
    () => worlds.find((world) => world.id === selectedId) ?? null,
    [selectedId, worlds],
  );

  const compatibleInstances = useMemo(
    () =>
      selected
        ? library.filter(
            (item) =>
              item.version === selected.minecraftVersion &&
              item.loader.toLowerCase() === selected.loader.toLowerCase(),
          )
        : [],
    [library, selected],
  );

  useEffect(() => {
    if (!selected || !account) {
      setRevisions([]);
      return;
    }
    setTargetInstanceId((current) =>
      compatibleInstances.some((item) => item.id === current)
        ? current
        : compatibleInstances[0]?.id ?? "",
    );
    void loadSharedWorldRevisions(account, selected.id)
      .then(setRevisions)
      .catch((caught) => setError(errorText(caught)));
  }, [account, compatibleInstances, selected]);

  const run = async (key: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    setError("");
    try {
      await action();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy("");
    }
  };

  const handleCreate = () =>
    run("create", async () => {
      if (!account) return;
      const instance = library.find((item) => item.id === sourceInstanceId);
      if (!instance || !sourceWorldName || !sharedName.trim()) {
        throw new Error("Choose an instance, a local world and a shared-world name.");
      }
      await createSharedWorld(account, {
        name: sharedName.trim(),
        instanceId: instance.id,
        instanceName: instance.name,
        worldName: sourceWorldName,
        minecraftVersion: instance.version,
        loader: instance.loader,
      });
      setCreateOpen(false);
      setSharedName("");
      await refresh();
      notify({
        title: "Shared World created",
        message: `${sourceWorldName} is encrypted and ready to share.`,
        tone: "success",
      });
    });

  const handleRestore = (revision?: SharedWorldRevision) =>
    run(`restore-${revision?.id ?? "latest"}`, async () => {
      if (!account || !selected || !targetInstanceId) {
        throw new Error("Create or choose a compatible Minecraft instance first.");
      }
      await restoreSharedWorld(
        account,
        selected,
        targetInstanceId,
        selected.sourceWorldName,
        revision,
      );
      notify({
        title: "Shared World restored",
        message: `${selected.name} is ready in My Modpacks. Its previous local copy was backed up.`,
        tone: "success",
      });
    });

  const binding = selected
    ? readSharedWorldBindings().find((item) => item.worldId === selected.id)
    : null;

  const handlePublish = () =>
    run("publish", async () => {
      if (!account || !selected || !binding) {
        throw new Error("Download this world to a local instance before publishing.");
      }
      const revision = await publishSharedWorldRevision(
        account,
        selected,
        binding,
      );
      await refresh();
      notify({
        title: "World revision published",
        message: `${selected.name} revision ${revision} is ready for your friends.`,
        tone: "success",
      });
    });

  const handleShare = () =>
    run("share", async () => {
      if (!account || !selected || !friendName.trim()) return;
      await shareWorldWithFriend(
        account,
        selected.id,
        friendName.trim(),
        permission,
      );
      setFriendName("");
      await refresh();
      notify({
        title: "World access updated",
        message: `${selected.name} was shared with your friend.`,
        tone: "success",
      });
    });

  return (
    <div className="shared-worlds">
      <aside className="shared-world-list">
        <header>
          <div>
            <strong>Shared Worlds</strong>
            <small>Encrypted friend hosting</small>
          </div>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            aria-label="Create Shared World"
          >
            <Plus size={14} />
          </button>
        </header>
        {loading ? (
          <div className="shared-world-empty">
            <LoaderCircle className="spin" size={22} />
            <span>Loading worlds...</span>
          </div>
        ) : worlds.length === 0 ? (
          <div className="shared-world-empty">
            <Server size={25} />
            <strong>No Shared Worlds</strong>
            <span>Share one of your local worlds with selected friends.</span>
            <button type="button" onClick={() => setCreateOpen(true)}>
              <Plus size={12} /> Create
            </button>
          </div>
        ) : (
          worlds.map((world) => (
            <button
              type="button"
              key={world.id}
              className={selectedId === world.id ? "is-active" : ""}
              onClick={() => setSelectedId(world.id)}
            >
              <span><Server size={15} /></span>
              <div>
                <strong>{world.name}</strong>
                <small>
                  {world.minecraftVersion} · {world.loader} · r{world.currentRevision}
                </small>
              </div>
              {world.activeHost && <i>LIVE</i>}
            </button>
          ))
        )}
      </aside>

      <section className="shared-world-detail">
        {error && (
          <div className="shared-world-error">
            <span>{error}</span>
            <button type="button" onClick={() => setError("")}><X size={12} /></button>
          </div>
        )}
        {!selected ? (
          <div className="shared-world-hero-empty">
            <LockKeyhole size={31} />
            <h3>Aster Shared Worlds</h3>
            <p>One encrypted world, selected friends, and one active host at a time.</p>
          </div>
        ) : (
          <>
            <header className="shared-world-title">
              <span><Server size={22} /></span>
              <div>
                <small>{selected.accessLevel.toUpperCase()} ACCESS</small>
                <h3>{selected.name}</h3>
                <p>
                  Owned by {selected.ownerName} · {selected.minecraftVersion} · {selected.loader}
                </p>
              </div>
              <button type="button" onClick={() => void refresh()} aria-label="Refresh Shared Worlds">
                <RefreshCw className={loading ? "spin" : ""} size={14} />
              </button>
            </header>

            {selected.activeHost && (
              <div className="shared-world-live">
                <Server size={14} />
                <div>
                  <strong>{selected.activeHost.minecraftName} is hosting now</strong>
                  <small>The single-host lock prevents conflicting world saves.</small>
                </div>
                <b>LIVE</b>
              </div>
            )}

            <div className="shared-world-actions">
              <label>
                <span>Compatible instance</span>
                <select
                  value={targetInstanceId}
                  onChange={(event) => setTargetInstanceId(event.target.value)}
                >
                  {compatibleInstances.length === 0 && <option value="">No compatible instance</option>}
                  {compatibleInstances.map((instance) => (
                    <option key={instance.id} value={instance.id}>{instance.name}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={!targetInstanceId || Boolean(busy)}
                onClick={() => void handleRestore()}
              >
                {busy.startsWith("restore") ? <LoaderCircle className="spin" size={14} /> : <CloudDownload size={14} />}
                Get latest
              </button>
              <button
                type="button"
                disabled={!binding || !["owner", "host", "manage"].includes(selected.accessLevel) || Boolean(busy)}
                onClick={() => void handlePublish()}
              >
                {busy === "publish" ? <LoaderCircle className="spin" size={14} /> : <CloudUpload size={14} />}
                Publish save
              </button>
              {binding && (
                <button
                  type="button"
                  onClick={() => setPage("modpacks")}
                >
                  <Server size={14} /> Open & host
                </button>
              )}
            </div>

            <div className="shared-world-columns">
              <section>
                <header><Users size={14} /><strong>Access</strong></header>
                {["owner", "manage"].includes(selected.accessLevel) && (
                  <div className="shared-world-share">
                    <input
                      value={friendName}
                      onChange={(event) => setFriendName(event.target.value.replace(/[^a-zA-Z0-9_]/g, ""))}
                      placeholder="Friend's Minecraft name"
                      maxLength={16}
                    />
                    <select
                      value={permission}
                      onChange={(event) => setPermission(event.target.value as SharedWorldPermission)}
                    >
                      <option value="play">Can play</option>
                      <option value="host">Can host</option>
                      <option value="manage">Can manage</option>
                    </select>
                    <button type="button" disabled={!friendName.trim() || Boolean(busy)} onClick={() => void handleShare()}>
                      <UserPlus size={13} /> Share
                    </button>
                  </div>
                )}
                <article className="shared-world-member">
                  <span><Crown size={14} /></span>
                  <div><strong>{selected.ownerName}</strong><small>Owner</small></div>
                </article>
                {selected.members.map((member) => (
                  <article className="shared-world-member" key={member.userId}>
                    <span><Shield size={14} /></span>
                    <div><strong>{member.minecraftName}</strong><small>{member.permission}</small></div>
                    {["owner", "manage"].includes(selected.accessLevel) && (
                      <button
                        type="button"
                        aria-label={`Remove ${member.minecraftName}`}
                        onClick={() =>
                          void run(`remove-${member.userId}`, async () => {
                            if (!account) return;
                            await removeSharedWorldMember(account, selected.id, member.userId);
                            await refresh();
                          })
                        }
                      >
                        <UserMinus size={12} />
                      </button>
                    )}
                  </article>
                ))}
              </section>

              <section>
                <header><History size={14} /><strong>Revision history</strong></header>
                {revisions.map((revision) => (
                  <article className="shared-world-revision" key={revision.id}>
                    <span><ArchiveRestore size={14} /></span>
                    <div>
                      <strong>Revision {revision.number}</strong>
                      <small>{revision.uploaderName} · {dateLabel(revision.createdAt)} · {sizeLabel(revision.size)}</small>
                    </div>
                    <button
                      type="button"
                      disabled={!targetInstanceId || Boolean(busy)}
                      onClick={() => void handleRestore(revision)}
                    >
                      Restore
                    </button>
                  </article>
                ))}
              </section>
            </div>

            {selected.accessLevel === "owner" && (
              <footer className="shared-world-danger">
                <div>
                  <strong>Delete Shared World</strong>
                  <small>Deletes cloud revisions and removes access for every friend.</small>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    void run("delete", async () => {
                      if (!account || !window.confirm(`Delete ${selected.name}?`)) return;
                      await deleteSharedWorld(account, selected.id);
                      await refresh();
                    })
                  }
                >
                  <Trash2 size={12} /> Delete
                </button>
              </footer>
            )}
          </>
        )}
      </section>

      {createOpen && (
        <div className="shared-world-create-backdrop">
          <form
            className="shared-world-create"
            onSubmit={(event) => {
              event.preventDefault();
              void handleCreate();
            }}
          >
            <header>
              <span><Server size={18} /></span>
              <div><small>ASTER SHARED WORLDS</small><h3>Share a local world</h3></div>
              <button type="button" onClick={() => setCreateOpen(false)}><X size={13} /></button>
            </header>
            <label>
              <span>Shared-world name</span>
              <input
                autoFocus
                value={sharedName}
                maxLength={80}
                onChange={(event) => setSharedName(event.target.value)}
                placeholder="Survival with friends"
              />
            </label>
            <label>
              <span>Minecraft instance</span>
              <select
                value={sourceInstanceId}
                onChange={(event) => setSourceInstanceId(event.target.value)}
              >
                <option value="">Choose an instance</option>
                {library.map((instance) => (
                  <option key={instance.id} value={instance.id}>
                    {instance.name} · {instance.version} · {instance.loader}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Local world</span>
              <select
                value={sourceWorldName}
                onChange={(event) => setSourceWorldName(event.target.value)}
              >
                {localWorlds.length === 0 && <option value="">No local worlds found</option>}
                {localWorlds.map((world) => <option key={world} value={world}>{world}</option>)}
              </select>
            </label>
            <div className="shared-world-create-note">
              <LockKeyhole size={15} />
              <span>The snapshot is encrypted before it leaves this PC. Only selected Aster friends can download it.</span>
            </div>
            <footer>
              <button type="button" onClick={() => setCreateOpen(false)}>Cancel</button>
              <button
                type="submit"
                className="is-primary"
                disabled={!sharedName.trim() || !sourceInstanceId || !sourceWorldName || Boolean(busy)}
              >
                {busy === "create" ? <LoaderCircle className="spin" size={13} /> : <Check size={13} />}
                Encrypt & create
              </button>
            </footer>
          </form>
        </div>
      )}
    </div>
  );
}
