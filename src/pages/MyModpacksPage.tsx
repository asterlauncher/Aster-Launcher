import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  ArrowDownUp,
  Boxes,
  Check,
  ChevronRight,
  CircleDashed,
  Copy,
  Database,
  Download,
  FileArchive,
  FolderOpen,
  Gauge,
  Gamepad2,
  Globe2,
  Image,
  Layers3,
  ListChecks,
  MapPin,
  MoreHorizontal,
  Mountain,
  Navigation,
  PackageOpen,
  Palette,
  Pickaxe,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Send,
  Server,
  SlidersHorizontal,
  Terminal,
  Settings,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Sparkles,
  Star,
  Timer,
  Trash2,
  TreePine,
  Users,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createInstanceStructure,
  defaultAsterClientSettings,
  exportModpack,
  getAsterClientSettings,
  listInstanceContent,
  openInstanceContentFolder,
  openInstanceFolder,
  pickAndImportInstanceContent,
  pickAndImportModpack,
  pickAndSetInstanceIcon,
  provisionAsterProfile,
  removeInstanceContent,
  scanInstanceMods,
  setAsterClientSettings,
  setInstanceContentEnabled,
  type AsterClientSettings,
  type InstanceContentFile,
  type InstanceContentSection,
  type InstanceSecurityScanResult,
} from "../services/instances";
import { useAppStore } from "../store/AppStore";
import { RamSafetyWarning } from "../components/RamSafetyWarning";
import type { ContentType } from "../services/content";
import {
  hasSharedModpackUpdate,
  readModpackLibrary,
  subscribeModpackLibrary,
  writeModpackLibrary,
  type InstalledModpack,
  type ModpackIcon,
  type ModpackStatus,
} from "../services/modpackLibrary";
import { isOfficialAsterProfile } from "../services/asterProfiles";
import {
  launchInstance,
  listMinecraftVersions,
  listenToLaunchStatus,
} from "../services/launcher";
import {
  defaultHostServerSettings,
  getHostConsole,
  getHostServerSettings,
  getHostedWorldStatus,
  listenToHostStatus,
  openHostingTunnelSetup,
  saveHostServerSettings,
  sendHostConsoleCommand,
  startHostedWorld,
  stopHostedWorld,
  type HostConsoleLine,
  type HostServerSettings,
  type HostedWorldStatus,
} from "../services/hosting";
import {
  acquireSharedWorldHost,
  findSharedWorldBinding,
  heartbeatSharedWorldHost,
  loadSharedWorlds,
  publishSharedWorldRevision,
  releaseSharedWorldHost,
  type SharedWorld,
  type SharedWorldBinding,
} from "../services/sharedWorlds";
import {
  installSharedModpack,
  syncSharedModpackUpdates,
  type SharedModpack,
} from "../services/sharedModpacks";

type ModpackSort = "recent" | "name";
type InstanceSection = InstanceContentSection;
type SecurityScanState =
  | { phase: "idle" }
  | { phase: "scanning" }
  | { phase: InstanceSecurityScanResult["status"]; result: InstanceSecurityScanResult };

interface ModpackDraft {
  name: string;
  version: string;
  loader: string;
  iconUrl?: string;
}

interface SectionDefinition {
  id: InstanceSection;
  label: string;
  icon: LucideIcon;
}

type InstanceManagerView = "content" | "aster-settings";
type AsterSettingKey = keyof AsterClientSettings;

interface AsterSettingDefinition {
  id: AsterSettingKey;
  label: string;
  description: string;
  icon: LucideIcon;
}

const asterSettingDefinitions: AsterSettingDefinition[] = [
  {
    id: "coordinates",
    label: "Coordinates",
    description: "LIVE • Show your current position while playing.",
    icon: MapPin,
  },
  {
    id: "fpsCounter",
    label: "FPS Counter",
    description: "LIVE • Display the current frame rate in the HUD.",
    icon: Gauge,
  },
  {
    id: "clock",
    label: "Clock",
    description: "LIVE • Keep your local time visible in game.",
    icon: Timer,
  },
  {
    id: "sprintStatus",
    label: "Sprint Status",
    description: "LIVE • Show when sprinting is currently active.",
    icon: Zap,
  },
  {
    id: "direction",
    label: "Direction HUD",
    description: "LIVE • Display the direction your player is facing.",
    icon: Navigation,
  },
  {
    id: "minimap",
    label: "Xaero's Minimap",
    description: "LIVE • Nearby terrain, entities and waypoints.",
    icon: MapPin,
  },
  {
    id: "worldMap",
    label: "Xaero's World Map",
    description: "LIVE • A full-screen map of explored terrain.",
    icon: Globe2,
  },
  {
    id: "zoom",
    label: "Zoom",
    description: "LIVE • A configurable smooth camera zoom.",
    icon: Search,
  },
  {
    id: "betterF3",
    label: "Better Debug HUD",
    description: "LIVE • A cleaner, customizable F3 screen.",
    icon: ListChecks,
  },
  {
    id: "appleSkin",
    label: "Food Preview",
    description: "LIVE • Shows food and saturation information.",
    icon: Gauge,
  },
  {
    id: "dynamicLights",
    label: "Dynamic Lights",
    description: "LIVE • Held light sources illuminate the world.",
    icon: Zap,
  },
];

const DISCOVERY_TAB_KEY = "aster.discovery-tab";
const DISCOVERY_TARGET_KEY = "aster.discovery-target";
const SECURITY_BLOCKS_KEY = "aster.security-blocked-instances.v1";

function readSecurityBlocks(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(SECURITY_BLOCKS_KEY) ?? "[]");
    return Array.isArray(saved)
      ? saved.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

const fallbackMinecraftVersions = [
  "26.2",
  "26.1.2",
  "26.1.1",
  "26.1",
  "1.21.8",
  "1.21.7",
  "1.21.6",
  "1.21.5",
  "1.21.4",
  "1.21.3",
  "1.21.2",
  "1.21.1",
  "1.21",
  "1.20.6",
  "1.20.5",
  "1.20.4",
  "1.20.3",
  "1.20.2",
  "1.20.1",
  "1.20",
  "1.19.4",
  "1.19.3",
  "1.19.2",
  "1.19.1",
  "1.19",
  "1.18.2",
  "1.18.1",
  "1.18",
  "1.17.1",
  "1.17",
  "1.16.5",
  "1.16.4",
  "1.16.3",
  "1.16.2",
  "1.16.1",
  "1.16",
  "1.15.2",
  "1.15.1",
  "1.15",
  "1.14.4",
  "1.14.3",
  "1.14.2",
  "1.14.1",
  "1.14",
  "1.13.2",
  "1.13.1",
  "1.13",
  "1.12.2",
  "1.12.1",
  "1.12",
  "1.11.2",
  "1.11.1",
  "1.11",
  "1.10.2",
  "1.10",
  "1.9.4",
  "1.9.2",
  "1.9.1",
  "1.9",
  "1.8.9",
  "1.8.8",
  "1.8",
  "1.7.10",
  "1.7.9",
  "1.7.5",
  "1.7.2",
  "1.6.4",
  "1.6.2",
  "1.6.1",
  "1.5.2",
  "1.5.1",
  "1.5",
  "1.4.7",
  "1.4.6",
  "1.4.5",
  "1.4.2",
  "1.3.2",
  "1.3.1",
  "1.2.5",
  "1.2.4",
  "1.2.3",
  "1.2.2",
  "1.2.1",
  "1.1",
  "1.0",
];

const modLoaders = ["Fabric", "NeoForge", "Forge", "Quilt", "Vanilla"];
const tones = ["violet", "forest", "copper", "ocean", "berry", "storm", "slate"];

const iconMap: Record<ModpackIcon, LucideIcon> = {
  tree: TreePine,
  zap: Zap,
  sparkles: Sparkles,
  pickaxe: Pickaxe,
  package: PackageOpen,
  game: Gamepad2,
  archive: Archive,
};

const sections: SectionDefinition[] = [
  { id: "mods", label: "Mods", icon: Zap },
  { id: "resourcepacks", label: "Resource Packs", icon: Image },
  { id: "shaders", label: "Shaders", icon: Sparkles },
  { id: "datapacks", label: "Data Packs", icon: Database },
  { id: "worlds", label: "Worlds", icon: Globe2 },
  { id: "screenshots", label: "Screenshots", icon: Mountain },
];

const statusCopy: Record<ModpackStatus, string> = {
  ready: "Ready",
  updating: "Updating",
  broken: "Installation broken",
  "missing-loader": "Loader missing",
  running: "Running",
};

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function StatusIcon({ status }: { status: ModpackStatus }) {
  if (status === "ready") return <Check size={11} />;
  if (status === "updating") return <RefreshCw className="spin" size={11} />;
  if (status === "broken") return <AlertTriangle size={11} />;
  if (status === "missing-loader") return <CircleDashed size={11} />;
  return <Gamepad2 size={11} />;
}

function sectionToDiscovery(section: InstanceSection): ContentType | null {
  if (section === "mods") return "Mods";
  if (section === "resourcepacks") return "Resourcepacks";
  if (section === "shaders") return "Shaders";
  if (section === "datapacks") return "Datapacks";
  return null;
}

function AsterInstanceSettings({
  settings,
  loading,
  saving,
  onChange,
}: {
  settings: AsterClientSettings;
  loading: boolean;
  saving: boolean;
  onChange: (key: AsterSettingKey, enabled: boolean) => void;
}) {
  const [settingsQuery, setSettingsQuery] = useState("");
  const normalizedQuery = settingsQuery.trim().toLowerCase();
  const visibleSettings = asterSettingDefinitions.filter(
    (definition) =>
      !normalizedQuery ||
      definition.label.toLowerCase().includes(normalizedQuery) ||
      definition.description.toLowerCase().includes(normalizedQuery),
  );

  return (
    <section className="aster-instance-settings">
      <div className="aster-settings-search">
        <Search size={16} />
        <input
          value={settingsQuery}
          onChange={(event) => setSettingsQuery(event.target.value)}
          placeholder="Search Aster settings..."
          aria-label="Search Aster settings"
        />
        <span className={saving ? "is-saving" : ""}>
          {loading ? "Loading..." : saving ? "Saving..." : "Saved"}
        </span>
      </div>

      {loading ? (
        <div className="aster-settings-loading">
          <RefreshCw size={18} className="spin" />
          Reading Aster Client settings...
        </div>
      ) : (
        <div className="aster-settings-grid">
          {visibleSettings.map((definition) => {
            const Icon = definition.icon;
            const enabled = settings[definition.id];
            return (
              <motion.button
                layout
                type="button"
                role="switch"
                aria-checked={enabled}
                key={definition.id}
                className={enabled ? "is-enabled" : ""}
                onClick={() => onChange(definition.id, !enabled)}
                whileTap={{ scale: 0.992 }}
              >
                <span className="aster-setting-icon">
                  <Icon size={19} />
                </span>
                <span>
                  <strong>{definition.label}</strong>
                  <small>{definition.description}</small>
                </span>
                <i aria-hidden="true">
                  <b />
                </i>
              </motion.button>
            );
          })}
          {visibleSettings.length === 0 && (
            <div className="aster-settings-empty">
              <Search size={22} />
              <strong>No setting found</strong>
              <span>Try another search.</span>
            </div>
          )}
        </div>
      )}

      <footer>
        <span>
          <ShieldCheck size={15} />
          Every Aster setting is applied live while Minecraft is running.
        </span>
        <span className="aster-module-credits">
          Maps by Xaero96:
          <a
            href="https://modrinth.com/mod/xaeros-minimap"
            target="_blank"
            rel="noreferrer"
          >
            Minimap
          </a>
          <a
            href="https://modrinth.com/mod/xaeros-world-map"
            target="_blank"
            rel="noreferrer"
          >
            World Map
          </a>
        </span>
      </footer>
    </section>
  );
}

export function MyModpacksPage() {
  const {
    asterAccount,
    asterLoggedIn,
    dismissNotification,
    loggedIn,
    notify,
    openModal,
    pushNotification,
    setPage,
    setDownloads,
  } = useAppStore();
  const [library, setLibrary] =
    useState<InstalledModpack[]>(readModpackLibrary);
  const [sharedModpacks, setSharedModpacks] = useState<SharedModpack[]>([]);
  const [contentFiles, setContentFiles] = useState<InstanceContentFile[]>([]);
  const [contentLoading, setContentLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ModpackSort>("recent");
  const [minecraftVersions, setMinecraftVersions] =
    useState(fallbackMinecraftVersions);
  const [activeInstanceId, setActiveInstanceId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<InstanceSection>("mods");
  const [managerView, setManagerView] =
    useState<InstanceManagerView>("content");
  const [asterSettings, setAsterSettingsState] =
    useState<AsterClientSettings>(defaultAsterClientSettings);
  const [asterSettingsLoading, setAsterSettingsLoading] = useState(false);
  const [asterSettingsSaving, setAsterSettingsSaving] = useState(false);
  const asterSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const asterSaveVersion = useRef(0);
  const [contentQuery, setContentQuery] = useState("");
  const [selectedContent, setSelectedContent] = useState<string[]>([]);
  const [contentMenuId, setContentMenuId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [hostDialogOpen, setHostDialogOpen] = useState(false);
  const [hostStatus, setHostStatus] = useState<HostedWorldStatus | null>(null);
  const [hostBusy, setHostBusy] = useState(false);
  const [hostDetail, setHostDetail] = useState("");
  const activeSharedHost = useRef<{
    world: SharedWorld;
    binding: SharedWorldBinding;
    leaseToken: string;
    heartbeat: ReturnType<typeof setInterval>;
  } | null>(null);
  const [securityScan, setSecurityScan] = useState<SecurityScanState>({ phase: "idle" });
  const [securityBlocks, setSecurityBlocks] = useState<string[]>(readSecurityBlocks);
  const [editorId, setEditorId] = useState<string | null | undefined>(undefined);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [removeContentId, setRemoveContentId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ModpackDraft>({
    name: "",
    version: "1.21.1",
    loader: "Fabric",
    iconUrl: undefined,
  });

  useEffect(() => {
    writeModpackLibrary(library);
  }, [library]);

  useEffect(() => {
    let disposed = false;
    void listMinecraftVersions()
      .then((versions) => {
        if (!disposed && versions.length > 0) {
          setMinecraftVersions([
            ...new Set([...fallbackMinecraftVersions, ...versions]),
          ]);
        }
      })
      .catch(() => {
        // Browser previews and offline sessions keep the bundled release list.
      });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(SECURITY_BLOCKS_KEY, JSON.stringify(securityBlocks));
  }, [securityBlocks]);

  useEffect(
    () =>
      subscribeModpackLibrary(() => {
        setLibrary(readModpackLibrary());
      }),
    [],
  );

  useEffect(() => {
    if (!asterLoggedIn || !asterAccount) {
      setSharedModpacks([]);
      return;
    }
    let disposed = false;
    const sync = () => {
      void syncSharedModpackUpdates(asterAccount)
        .then((shares) => {
          if (disposed) return;
          setSharedModpacks(shares);
          setLibrary(readModpackLibrary());
        })
        .catch(() => {
          // Social can be offline; local instances remain fully usable.
        });
    };
    const syncOnFocus = () => sync();
    sync();
    const interval = window.setInterval(sync, 60_000);
    window.addEventListener("focus", syncOnFocus);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", syncOnFocus);
    };
  }, [asterAccount, asterLoggedIn]);

  const finalizeSharedWorldHost = useCallback(async () => {
    const active = activeSharedHost.current;
    if (!active || !asterAccount) return;
    activeSharedHost.current = null;
    clearInterval(active.heartbeat);
    try {
      const settings = await getHostServerSettings(
        active.binding.instanceId,
        active.binding.worldName,
      );
      const revision = await publishSharedWorldRevision(
        asterAccount,
        active.world,
        active.binding,
        settings as unknown as Record<string, unknown>,
      );
      notify({
        title: "Shared World synchronized",
        message: `${active.world.name} revision ${revision} is ready for your friends.`,
        tone: "success",
      });
    } catch (error) {
      notify({
        title: "Shared World sync failed",
        message:
          error instanceof Error
            ? error.message
            : "The local save is safe, but its cloud revision was not updated.",
        tone: "error",
      });
    } finally {
      await releaseSharedWorldHost(
        asterAccount,
        active.world.id,
        active.leaseToken,
      ).catch(() => undefined);
    }
  }, [asterAccount, notify]);

  useEffect(() => {
    let disposed = false;
    let stopListening: (() => void) | undefined;
    void getHostedWorldStatus().then((status) => {
      if (!disposed) setHostStatus(status);
    });
    void listenToHostStatus((event) => {
      if (disposed) return;
      setHostDetail(event.detail);
      if (event.status === "stopped") {
        setHostStatus(null);
        setHostBusy(false);
        void finalizeSharedWorldHost();
        notify({
          title:
            event.exitCode === null || event.exitCode === 0
              ? "Aster Host stopped"
              : "Aster Host stopped unexpectedly",
          message: event.detail,
          tone:
            event.exitCode === null || event.exitCode === 0 ? "info" : "error",
        });
      }
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stopListening = unlisten;
    });
    return () => {
      disposed = true;
      stopListening?.();
    };
  }, [finalizeSharedWorldHost, notify]);

  const refreshContentFiles = useCallback(
    async (instanceId: string, announce = false) => {
      setContentLoading(true);
      try {
        const files = await listInstanceContent(instanceId);
        setContentFiles(files);
        if (announce) {
          notify({
            title: "Content refreshed",
            message: `${files.length} installed item${files.length === 1 ? "" : "s"} found.`,
            tone: "success",
          });
        }
      } catch (error) {
        notify({
          title: "Content unavailable",
          message: error instanceof Error ? error.message : String(error),
          tone: "error",
        });
      } finally {
        setContentLoading(false);
      }
    },
    [notify],
  );

  useEffect(() => {
    setManagerView("content");
    setAsterSettingsState(defaultAsterClientSettings);
    if (!activeInstanceId) {
      setContentFiles([]);
      setSecurityScan({ phase: "idle" });
      return;
    }
    setSecurityScan({ phase: "idle" });
    void refreshContentFiles(activeInstanceId);
  }, [activeInstanceId, refreshContentFiles]);

  const modpacks = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const items = library.filter((item) => {
      return (
        !normalized ||
        `${item.name} ${item.version} ${item.loader}`
          .toLowerCase()
          .includes(normalized)
      );
    });
    return sort === "name"
      ? [...items].sort((a, b) => a.name.localeCompare(b.name))
      : [...items].sort((a, b) => Number(b.favorite) - Number(a.favorite));
  }, [library, query, sort]);

  const activeInstance =
    library.find((item) => item.id === activeInstanceId) ?? null;

  const openAsterSettings = () => {
    if (!activeInstance || !isOfficialAsterProfile(activeInstance)) return;
    setManagerView("aster-settings");
    setAsterSettingsLoading(true);
    void getAsterClientSettings(activeInstance.id)
      .then(setAsterSettingsState)
      .catch((error: unknown) => {
        notify({
          title: "Aster settings unavailable",
          message: error instanceof Error ? error.message : String(error),
          tone: "error",
        });
      })
      .finally(() => setAsterSettingsLoading(false));
  };

  const persistAsterSettings = (
    instanceId: string,
    settings: AsterClientSettings,
  ) => {
    const saveVersion = ++asterSaveVersion.current;
    setAsterSettingsSaving(true);
    asterSaveQueue.current = asterSaveQueue.current
      .catch(() => undefined)
      .then(() => setAsterClientSettings(instanceId, settings))
      .catch((error: unknown) => {
        notify({
          title: "Aster settings could not be saved",
          message: error instanceof Error ? error.message : String(error),
          tone: "error",
        });
      })
      .finally(() => {
        if (asterSaveVersion.current === saveVersion) {
          setAsterSettingsSaving(false);
        }
      });
  };

  const changeAsterSetting = (key: AsterSettingKey, enabled: boolean) => {
    if (!activeInstance || !isOfficialAsterProfile(activeInstance)) return;
    setAsterSettingsState((current) => {
      const next = { ...current, [key]: enabled };
      persistAsterSettings(activeInstance.id, next);
      return next;
    });
  };

  const activeItems = activeInstance ? contentFiles : [];
  const visibleContent = activeItems.filter(
    (item) =>
      item.kind === activeSection &&
      (!contentQuery.trim() ||
        `${item.name} ${item.fileName} ${item.version}`
          .toLowerCase()
          .includes(contentQuery.trim().toLowerCase())),
  );
  const allVisibleSelected =
    visibleContent.length > 0 &&
    visibleContent.every((item) => selectedContent.includes(item.id));

  const patchModpack = (id: string, patch: Partial<InstalledModpack>) => {
    setLibrary((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  };

  const updateSharedModpack = async (item: InstalledModpack) => {
    if (!asterAccount || !item.sharedModpackId) return;
    const share = sharedModpacks.find(
      (candidate) =>
        candidate.id === item.sharedModpackId &&
        candidate.status === "accepted",
    );
    if (!share) {
      notify({
        title: "Shared update unavailable",
        message: "Open Friends > Shared Modpacks and refresh the invitation first.",
        tone: "warning",
      });
      return;
    }
    const downloadId = `shared-pack-${share.id}-${Date.now()}`;
    setDownloads((current) => [
      {
        id: downloadId,
        title: share.name,
        detail: `Installing owner revision ${share.currentRevision}`,
        status: "downloading",
        progress: 1,
      },
      ...current,
    ]);
    try {
      await installSharedModpack(asterAccount, share, downloadId);
      setDownloads((current) =>
        current.map((download) =>
          download.id === downloadId
            ? {
                ...download,
                detail: `Revision ${share.currentRevision} installed`,
                status: "complete",
                progress: 100,
              }
            : download,
        ),
      );
      setLibrary(readModpackLibrary());
      notify({
        title: `${share.name} updated`,
        message: `Owner revision ${share.currentRevision} is ready to play. Your worlds and local settings were preserved.`,
        tone: "success",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDownloads((current) =>
        current.map((download) =>
          download.id === downloadId
            ? { ...download, detail: message, status: "failed" }
            : download,
        ),
      );
      notify({
        title: "Modpack update failed",
        message,
        tone: "error",
      });
    }
  };

  useEffect(() => {
    let disposed = false;
    let stopListening: (() => void) | undefined;

    void listenToLaunchStatus((event) => {
      if (disposed) return;
      if (event.status === "preparing" || event.status === "running") {
        setLibrary((current) =>
          current.map((item) =>
            item.id === event.instanceId
              ? {
                  ...item,
                  status:
                    event.status === "running" ? "running" : "updating",
                  ...(event.status === "running"
                    ? { lastPlayed: "Now" }
                    : {}),
                }
              : item,
          ),
        );
        return;
      }

      let instanceName = "Minecraft";
      setLibrary((current) =>
        current.map((item) => {
          if (item.id !== event.instanceId) return item;
          instanceName = item.name;
          return { ...item, status: "ready" };
        }),
      );

      if (event.status === "exited") {
        const crashed = event.exitCode !== null && event.exitCode !== 0;
        notify({
          title: crashed ? `${instanceName} stopped` : `${instanceName} closed`,
          message: event.detail,
          tone: crashed ? "error" : "info",
        });
        if (crashed) {
          pushNotification({
            id: `launch-failed-${event.instanceId}-${Date.now()}`,
            title: `${instanceName} stopped unexpectedly`,
            message: "Open the instance folder to inspect the latest launch log.",
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
  }, [notify, pushNotification]);

  const launch = async (item: InstalledModpack) => {
    if (securityBlocks.includes(item.id) || securityScan.phase === "scanning") {
      notify({
        title:
          securityScan.phase === "scanning"
            ? "Security scan still running"
            : "Launch blocked for safety",
        message:
          securityScan.phase === "scanning"
            ? "Wait for Microsoft Defender to finish checking the installed mods."
            : "Review this instance in Windows Security before launching it.",
        tone: "warning",
      });
      return;
    }
    if (!loggedIn) {
      openModal("add-account");
      notify({
        title: "Microsoft account required",
        message: "Sign in with the account that owns Minecraft Java Edition.",
        tone: "warning",
      });
      return;
    }
    if (item.status === "broken") {
      openModal("installation-failure");
      return;
    }
    if (item.status === "missing-loader") {
      openModal("missing-java");
      return;
    }
    if (item.status === "updating" || item.status === "running") {
      notify({
        title:
          item.status === "running"
            ? "Already running"
            : "Preparation still running",
        message:
          item.status === "running"
            ? `${item.name} is already open.`
            : `${item.name} will start when its files are ready.`,
        tone: "info",
      });
      return;
    }
    const downloadId = `launch-${item.id}`;
    patchModpack(item.id, { status: "updating" });
    setDownloads((current) => [
      {
        id: downloadId,
        title: `Preparing ${item.name}`,
        detail: "Checking account session",
        status: "downloading",
        progress: 1,
      },
      ...current.filter((download) => download.id !== downloadId),
    ]);

    try {
      if (isOfficialAsterProfile(item)) {
        setDownloads((current) =>
          current.map((download) =>
            download.id === downloadId
              ? {
                  ...download,
                  detail: "Preparing protected performance and shader components",
                  progress: 2,
                }
              : download,
          ),
        );
        await provisionAsterProfile(item.id, downloadId);
      }
      const started = await launchInstance(item.id, item.version, item.loader);
      patchModpack(item.id, { status: "running", lastPlayed: "Now" });
      notify({
        title: `${item.name} started`,
        message: `Minecraft ${started.versionId} is running.`,
        tone: "success",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const missingJava = /requires Java|Java \d+|Java runtime/i.test(message);
      patchModpack(item.id, {
        status: missingJava ? "missing-loader" : "ready",
      });
      setDownloads((current) =>
        current.map((download) =>
          download.id === downloadId
            ? { ...download, status: "failed", detail: message }
            : download,
        ),
      );
      if (missingJava) openModal("missing-java");
      notify({
        title: `${item.name} could not start`,
        message,
        tone: "error",
      });
    }
  };

  const openCreate = () => {
    setDraft({
      name: "",
      version: "1.21.1",
      loader: "Fabric",
      iconUrl: undefined,
    });
    setEditorId(null);
  };

  const openEdit = (item: InstalledModpack) => {
    if (isOfficialAsterProfile(item)) {
      notify({
        title: "Official Aster profile",
        message: "Aster 1.20.1 keeps its Minecraft version and loader locked so the tested system stack stays compatible.",
        tone: "info",
      });
      return;
    }
    setDraft({
      name: item.name,
      version: item.version,
      loader: item.loader,
      iconUrl: item.iconUrl,
    });
    setEditorId(item.id);
  };

  const saveDraft = () => {
    const name = draft.name.trim();
    if (!name) return;
    if (editorId) {
      patchModpack(editorId, {
        name,
        version: draft.version,
        loader: draft.loader,
        iconUrl: draft.iconUrl,
      });
      notify({ title: "Modpack updated", message: `${name} was saved.`, tone: "success" });
    } else {
      const item: InstalledModpack = {
        id: createId("custom"),
        name,
        version: draft.version,
        loader: draft.loader,
        lastPlayed: "Never played",
        status: "ready",
        favorite: false,
        icon: "archive",
        tone: tones[library.length % tones.length],
      };
      setLibrary((current) => [item, ...current]);
      void createInstanceStructure(item.id).catch((error: unknown) => {
        notify({
          title: "Instance folder unavailable",
          message: error instanceof Error ? error.message : String(error),
          tone: "error",
        });
      });
      notify({ title: "Modpack created", message: `${name} is ready.`, tone: "success" });
    }
    setEditorId(undefined);
  };

  const chooseModpackIcon = () => {
    if (!editorId) return;
    void pickAndSetInstanceIcon(editorId)
      .then((iconUrl) => {
        if (!iconUrl) return;
        setDraft((current) => ({ ...current, iconUrl }));
        patchModpack(editorId, { iconUrl });
        notify({
          title: "Modpack icon updated",
          message: "The custom image was saved to this instance.",
          tone: "success",
        });
      })
      .catch((error: unknown) => {
        notify({
          title: "Icon could not be changed",
          message: error instanceof Error ? error.message : String(error),
          tone: "error",
        });
      });
  };

  const importArchive = () => {
    const instanceId = createId("import");
    const downloadId = createId("import-download");
    notify({
      title: "Choose a modpack archive",
      message: "Aster supports Modrinth .mrpack and CurseForge .zip files.",
      tone: "info",
    });
    setDownloads((current) => [
      {
        id: downloadId,
        title: "Local modpack import",
        detail: "Waiting for archive selection",
        status: "queued",
        progress: 0,
      },
      ...current,
    ]);
    void pickAndImportModpack(instanceId, downloadId)
      .then((result) => {
        if (!result) {
          setDownloads((current) =>
            current.filter((item) => item.id !== downloadId),
          );
          return;
        }
        const item: InstalledModpack = {
          id: instanceId,
          name: result.name,
          version: result.gameVersion,
          loader: result.loader,
          lastPlayed: "Never played",
          status: "ready",
          favorite: false,
          icon: "archive",
          tone: tones[library.length % tones.length],
          provider: "Local",
        };
        setLibrary((current) => [item, ...current]);
        notify({
          title: `${result.name} imported`,
          message: `${result.installedFiles} files are ready to use.`,
          tone: "success",
        });
      })
      .catch((error: unknown) => {
        setDownloads((current) =>
          current.map((item) =>
            item.id === downloadId
              ? {
                  ...item,
                  status: "failed",
                  detail:
                    error instanceof Error ? error.message : String(error),
                }
              : item,
          ),
        );
        notify({
          title: "Modpack import failed",
          message: error instanceof Error ? error.message : String(error),
          tone: "error",
        });
      });
  };

  const duplicate = (item: InstalledModpack) => {
    const copy: InstalledModpack = {
      ...item,
      id: createId("copy"),
      name: `${item.name} Copy`,
      lastPlayed: "Never played",
      status: "ready",
      favorite: false,
      official: false,
      systemProfile: undefined,
    };
    setLibrary((current) => [copy, ...current]);
    void createInstanceStructure(copy.id);
    notify({ title: "Modpack duplicated", message: copy.name, tone: "success" });
  };

  const openFolder = (item: InstalledModpack) => {
    void openInstanceFolder(item.id).catch((error: unknown) => {
      notify({
        title: "Folder unavailable",
        message: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    });
  };

  const browseContent = () => {
    const contentType = sectionToDiscovery(activeSection);
    if (!contentType) {
      if (activeInstance) openFolder(activeInstance);
      return;
    }
    localStorage.setItem(DISCOVERY_TAB_KEY, contentType);
    localStorage.setItem(
      DISCOVERY_TARGET_KEY,
      JSON.stringify({
        instanceId: activeInstance?.id,
        instanceName: activeInstance?.name,
        gameVersion: activeInstance?.version,
        loader: activeInstance?.loader,
        contentType,
        systemProfile: activeInstance?.systemProfile,
      }),
    );
    setPage("mods");
  };

  const refreshContent = async () => {
    if (!activeInstance) return;
    setRefreshing(true);
    setSecurityScan({ phase: "scanning" });
    try {
      await refreshContentFiles(activeInstance.id);
      const result = await scanInstanceMods(activeInstance.id);
      setSecurityScan({ phase: result.status, result });

      if (result.status === "clean") {
        setSecurityBlocks((current) => current.filter((id) => id !== activeInstance.id));
        dismissNotification(`mod-security-${activeInstance.id}`);
        notify({
          title: "Mods checked",
          message: `${result.scannedFiles} mod file${result.scannedFiles === 1 ? "" : "s"} scanned — no threats found.`,
          tone: "success",
        });
      } else if (result.status === "no-files") {
        setSecurityBlocks((current) => current.filter((id) => id !== activeInstance.id));
        dismissNotification(`mod-security-${activeInstance.id}`);
        notify({
          title: "Content refreshed",
          message: "No installed mod files need a security scan.",
          tone: "info",
        });
      } else if (result.status === "attention") {
        setSecurityBlocks((current) =>
          current.includes(activeInstance.id) ? current : [...current, activeInstance.id],
        );
        notify({
          title: "Security attention required",
          message: result.message,
          tone: "error",
        });
        pushNotification({
          id: `mod-security-${activeInstance.id}`,
          title: `Check ${activeInstance.name} before launching`,
          message: result.message,
          tone: "error",
          source: "system",
          action: { label: "Review instance", page: "modpacks" },
        });
      } else {
        notify({
          title:
            result.status === "unavailable"
              ? "Defender scan unavailable"
              : "Security scan failed",
          message: result.message,
          tone: "warning",
        });
      }
    } catch (error) {
      setSecurityScan({
        phase: "failed",
        result: {
          status: "failed",
          scannedFiles: 0,
          durationMs: 0,
          message: error instanceof Error ? error.message : String(error),
        },
      });
      notify({
        title: "Security scan failed",
        message: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    } finally {
      setRefreshing(false);
    }
  };

  const addLocalContent = () => {
    if (!activeInstance) return;
    setContentMenuId(null);
    void pickAndImportInstanceContent(activeInstance.id, activeSection)
      .then((added) => {
        if (!added) return;
        notify({
          title: "Content added",
          message: "The selected file was copied into this instance.",
          tone: "success",
        });
        return refreshContentFiles(activeInstance.id);
      })
      .catch((error: unknown) => {
        notify({
          title: "Could not add content",
          message: error instanceof Error ? error.message : String(error),
          tone: "error",
        });
      });
  };

  const exportActiveModpack = () => {
    if (!activeInstance || exporting) return;
    setExporting(true);
    void exportModpack(activeInstance.id, {
      name: activeInstance.name,
      version: activeInstance.version,
      gameVersion: activeInstance.version,
      loader: activeInstance.loader,
    })
      .then((path) => {
        if (!path) return;
        notify({
          title: "Shareable modpack created",
          message: `${activeInstance.name} was exported. Friends can import this ZIP in My Modpacks.`,
          tone: "success",
        });
      })
      .catch((error: unknown) => {
        notify({
          title: "Modpack export failed",
          message: error instanceof Error ? error.message : String(error),
          tone: "error",
        });
      })
      .finally(() => setExporting(false));
  };

  const startHosting = async (options: {
    worldName: string;
    port: number;
    maxPlayers: number;
    memoryGb: number;
    acceptedEula: boolean;
  }) => {
    if (!activeInstance || hostBusy) return;
    setHostBusy(true);
    setHostDetail("Preparing a private server on this PC...");
    let preparedSharedHost:
      | {
          world: SharedWorld;
          binding: SharedWorldBinding;
          leaseToken: string;
          heartbeat: ReturnType<typeof setInterval>;
        }
      | undefined;
    try {
      const binding = findSharedWorldBinding(
        activeInstance.id,
        options.worldName,
      );
      if (binding) {
        if (!asterAccount) {
          throw new Error(
            "Sign in to Aster before hosting a Shared World.",
          );
        }
        const sharedWorld = (await loadSharedWorlds(asterAccount)).find(
          (world) => world.id === binding.worldId,
        );
        if (!sharedWorld) {
          throw new Error(
            "This Shared World is no longer available to your account.",
          );
        }
        if (!["owner", "host", "manage"].includes(sharedWorld.accessLevel)) {
          throw new Error(
            "The owner gave you play access, but not permission to host this world.",
          );
        }
        if (
          sharedWorld.latestRevision &&
          binding.revision < sharedWorld.latestRevision.number
        ) {
          throw new Error(
            `Revision ${sharedWorld.latestRevision.number} is newer. Open Friends → Shared Worlds and choose Get latest before hosting.`,
          );
        }
        const lease = await acquireSharedWorldHost(asterAccount, sharedWorld.id);
        const heartbeat = setInterval(() => {
          void heartbeatSharedWorldHost(
            asterAccount,
            sharedWorld.id,
            lease.leaseToken,
          ).catch((error: unknown) => {
            notify({
              title: "Shared World host lock lost",
              message:
                error instanceof Error
                  ? error.message
                  : "Stop the server before another friend hosts this world.",
              tone: "error",
            });
          });
        }, 45_000);
        preparedSharedHost = {
          world: sharedWorld,
          binding,
          leaseToken: lease.leaseToken,
          heartbeat,
        };
        activeSharedHost.current = preparedSharedHost;
      }
      const status = await startHostedWorld({
        instanceId: activeInstance.id,
        gameVersion: activeInstance.version,
        loader: activeInstance.loader,
        ...options,
      });
      setHostStatus(status);
      setHostDetail("The world is running. LAN friends can join now.");
      notify({
        title: "Aster Host is running",
        message: `${options.worldName} is available at ${status.lanAddress}.`,
        tone: "success",
      });
    } catch (error) {
      if (preparedSharedHost && asterAccount) {
        clearInterval(preparedSharedHost.heartbeat);
        activeSharedHost.current = null;
        await releaseSharedWorldHost(
          asterAccount,
          preparedSharedHost.world.id,
          preparedSharedHost.leaseToken,
        ).catch(() => undefined);
      }
      setHostDetail("");
      notify({
        title: "World hosting failed",
        message: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    } finally {
      setHostBusy(false);
    }
  };

  const stopHosting = async () => {
    if (!activeInstance || hostBusy) return;
    setHostBusy(true);
    try {
      await stopHostedWorld(activeInstance.id);
      setHostDetail("Stopping the hosted world safely...");
    } catch (error) {
      setHostBusy(false);
      notify({
        title: "Aster Host could not stop",
        message: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    }
  };

  const changeContentState = (
    items: InstanceContentFile[],
    enabled: boolean,
  ) => {
    if (!activeInstance) return;
    void Promise.all(
      items
        .filter((item) => item.kind !== "worlds" && item.kind !== "screenshots")
        .map((item) =>
          setInstanceContentEnabled(
            activeInstance.id,
            item.kind,
            item.fileName,
            enabled,
          ),
        ),
    )
      .then(() => {
        setSelectedContent([]);
        return refreshContentFiles(activeInstance.id);
      })
      .catch((error: unknown) => {
        notify({
          title: "Content state could not be changed",
          message: error instanceof Error ? error.message : String(error),
          tone: "error",
        });
      });
  };

  const confirmDelete = () => {
    if (!deleteId) return;
    const item = library.find((candidate) => candidate.id === deleteId);
    if (isOfficialAsterProfile(item)) {
      setDeleteId(null);
      notify({
        title: "Official Aster profile",
        message: "Aster 1.20.1 is part of the launcher and cannot be removed.",
        tone: "warning",
      });
      return;
    }
    setLibrary((current) => current.filter((candidate) => candidate.id !== deleteId));
    setSecurityBlocks((current) => current.filter((id) => id !== deleteId));
    if (activeInstanceId === deleteId) setActiveInstanceId(null);
    setDeleteId(null);
    notify({
      title: "Modpack removed",
      message: item ? `${item.name} was removed from this library.` : "The modpack was removed.",
      tone: "info",
    });
  };

  const confirmRemoveContent = () => {
    if (!activeInstance || !removeContentId) return;
    const item = activeItems.find((candidate) => candidate.id === removeContentId);
    if (!item) return;
    void removeInstanceContent(activeInstance.id, item.kind, item.fileName)
      .then(() => {
        setSelectedContent((current) => current.filter((id) => id !== removeContentId));
        setRemoveContentId(null);
        notify({
          title: "Content removed",
          message: `${item.name} was removed from the instance.`,
          tone: "info",
        });
        return refreshContentFiles(activeInstance.id);
      })
      .catch((error: unknown) => {
        notify({
          title: "Could not remove content",
          message: error instanceof Error ? error.message : String(error),
          tone: "error",
        });
      });
  };

  const setSection = (section: InstanceSection) => {
    setManagerView("content");
    setActiveSection(section);
    setContentQuery("");
    setSelectedContent([]);
    setContentMenuId(null);
  };

  if (activeInstance) {
    const ActiveIcon = iconMap[activeInstance.icon] ?? Boxes;
    const selectedCount = selectedContent.length;

    return (
      <motion.div
        className="instance-manager"
        initial={{ opacity: 0, x: 8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
      >
        <main className="instance-manager-main">
          {managerView === "aster-settings" &&
          isOfficialAsterProfile(activeInstance) ? (
            <AsterInstanceSettings
              settings={asterSettings}
              loading={asterSettingsLoading}
              saving={asterSettingsSaving}
              onChange={changeAsterSetting}
            />
          ) : (
            <>
          <header className="instance-content-toolbar">
            <label>
              <Search size={14} />
              <input
                value={contentQuery}
                onChange={(event) => setContentQuery(event.target.value)}
                placeholder={`Search ${sections
                  .find((section) => section.id === activeSection)
                  ?.label.toLowerCase()}...`}
              />
            </label>
            <button type="button" className="instance-browse-button" onClick={browseContent}>
              {sectionToDiscovery(activeSection) ? "Browse" : "Open folder"}
            </button>
            <button type="button" className="instance-add-file-button" onClick={addLocalContent}>
              <Plus size={13} />
              {activeSection === "worlds" ? "Add world" : "Add file"}
            </button>
            <button
              type="button"
              className="instance-refresh-button instance-export-button"
              onClick={exportActiveModpack}
              disabled={exporting}
              aria-label="Export modpack for sharing"
              title="Export modpack"
            >
              {exporting ? (
                <CircleDashed size={14} className="spin" />
              ) : (
                <Download size={14} />
              )}
            </button>
          </header>

          <AnimatePresence initial={false}>
            {securityScan.phase !== "idle" && (
              <motion.div
                className={`instance-security-status is-${securityScan.phase}`}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 38 }}
                exit={{ opacity: 0, height: 0 }}
                role={securityScan.phase === "attention" ? "alert" : "status"}
              >
                {securityScan.phase === "scanning" ? (
                  <RefreshCw size={15} className="spin" />
                ) : securityScan.phase === "clean" ||
                  securityScan.phase === "no-files" ? (
                  <ShieldCheck size={16} />
                ) : securityScan.phase === "attention" ? (
                  <ShieldAlert size={16} />
                ) : (
                  <ShieldQuestion size={16} />
                )}
                <div>
                  <strong>
                    {securityScan.phase === "scanning"
                      ? "Scanning installed mods..."
                      : securityScan.phase === "clean"
                        ? "No threats found"
                        : securityScan.phase === "no-files"
                          ? "No mods to scan"
                          : securityScan.phase === "attention"
                            ? "Security attention required"
                            : securityScan.phase === "unavailable"
                              ? "Microsoft Defender unavailable"
                              : "Security scan failed"}
                  </strong>
                  <span>
                    {securityScan.phase === "scanning"
                      ? "Refreshing content and running Microsoft Defender."
                      : securityScan.result.message}
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="instance-selection-bar">
            <label>
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={() =>
                  setSelectedContent(
                    allVisibleSelected ? [] : visibleContent.map((item) => item.id),
                  )
                }
              />
              <span>Select all</span>
            </label>
            {selectedCount > 0 && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <span>{selectedCount} selected</span>
                <button
                  type="button"
                  onClick={() => {
                    changeContentState(
                      activeItems.filter((item) => selectedContent.includes(item.id)),
                      true,
                    );
                  }}
                >
                  Enable
                </button>
                <button
                  type="button"
                  onClick={() => {
                    changeContentState(
                      activeItems.filter((item) => selectedContent.includes(item.id)),
                      false,
                    );
                  }}
                >
                  Disable
                </button>
              </motion.div>
            )}
          </div>

          <section className="instance-content-list">
            {contentLoading && (
              <div className="instance-content-loading">
                <RefreshCw className="spin" size={18} />
                Reading instance files...
              </div>
            )}
            <AnimatePresence initial={false} mode="popLayout">
              {!contentLoading && visibleContent.map((item) => (
                <motion.article
                  layout
                  key={item.id}
                  className={`instance-content-row ${item.enabled ? "" : "disabled"}`}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <input
                    type="checkbox"
                    checked={selectedContent.includes(item.id)}
                    onChange={() =>
                      setSelectedContent((current) =>
                        current.includes(item.id)
                          ? current.filter((id) => id !== item.id)
                          : [...current, item.id],
                      )
                    }
                    aria-label={`Select ${item.name}`}
                  />
                  <div className="instance-content-icon">
                    {item.iconUrl ? (
                      <img src={item.iconUrl} alt="" />
                    ) : (
                      <>
                        {item.kind === "mods" && <FileArchive size={21} />}
                        {item.kind === "resourcepacks" && <Palette size={21} />}
                        {item.kind === "shaders" && <Sparkles size={21} />}
                        {item.kind === "datapacks" && <Database size={21} />}
                        {item.kind === "worlds" && <Globe2 size={21} />}
                        {item.kind === "screenshots" && <Mountain size={21} />}
                      </>
                    )}
                  </div>
                  <div className="instance-content-copy">
                    <h2>{item.name}</h2>
                    <p>{item.fileName}</p>
                    <div>
                      <span className={item.enabled ? "enabled" : "disabled"}>
                        {item.enabled ? "Enabled" : "Disabled"}
                      </span>
                      <span>{item.source}</span>
                      <span>{item.version}</span>
                      <span>{item.size}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="instance-toggle-button"
                    onClick={() => changeContentState([item], !item.enabled)}
                    disabled={item.kind === "worlds" || item.kind === "screenshots"}
                  >
                    {item.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    type="button"
                    className="instance-remove-button"
                    onClick={() => setRemoveContentId(item.id)}
                    aria-label={`Remove ${item.name}`}
                  >
                    <Trash2 size={13} />
                  </button>
                  <button
                    type="button"
                    className="instance-more-button"
                    aria-label={`More actions for ${item.name}`}
                    onClick={() =>
                      setContentMenuId((current) => (current === item.id ? null : item.id))
                    }
                  >
                    <MoreHorizontal size={14} />
                  </button>
                  <AnimatePresence>
                    {contentMenuId === item.id && (
                      <motion.div
                        className="instance-content-actions-menu"
                        initial={{ opacity: 0, scale: 0.97, y: -3 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.98, y: -2 }}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            notify({
                              title: item.fileName,
                              message: `${item.source} · ${item.size} · version ${item.version}`,
                              tone: "info",
                            });
                            setContentMenuId(null);
                          }}
                        >
                          <ListChecks size={12} />
                          File details
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void openInstanceContentFolder(activeInstance.id, item.kind);
                            setContentMenuId(null);
                          }}
                        >
                          <FolderOpen size={12} />
                          Open folder
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.article>
              ))}
            </AnimatePresence>

            {!contentLoading && visibleContent.length === 0 && (
              <div className="instance-content-empty">
                <PackageOpen size={25} />
                <strong>
                  {contentQuery ? "No matching content" : `No ${activeSection} installed`}
                </strong>
                <span>
                  {sectionToDiscovery(activeSection)
                    ? "Browse community projects and add them to this instance."
                    : "This local folder does not contain anything yet."}
                </span>
                <div>
                  <button type="button" onClick={browseContent}>
                    {sectionToDiscovery(activeSection) ? "Browse content" : "Open folder"}
                  </button>
                  <button type="button" className="secondary" onClick={addLocalContent}>
                    <Plus size={12} />
                    {activeSection === "worlds" ? "Add world" : "Add local file"}
                  </button>
                </div>
              </div>
            )}
          </section>
            </>
          )}
        </main>

        <aside className="instance-manager-sidebar">
          <header>
            <button
              type="button"
              className="instance-back-button"
              onClick={() => setActiveInstanceId(null)}
            >
              <ArrowLeft size={13} />
              Back
            </button>
            <button
              type="button"
              className="instance-sidebar-action"
              onClick={() => openEdit(activeInstance)}
              aria-label="Edit instance"
            >
              <Settings size={14} />
            </button>
            <button
              type="button"
              className="instance-sidebar-action"
              onClick={() => void refreshContent()}
              disabled={refreshing}
              aria-label="Refresh instance"
            >
              <RefreshCw size={14} className={refreshing ? "spin" : ""} />
            </button>
          </header>

          <div className="instance-sidebar-scroll">
          <div className="instance-sidebar-profile">
            <div className={`modpack-entry-icon icon-${activeInstance.tone}`}>
              {activeInstance.iconUrl ? (
                <img src={activeInstance.iconUrl} alt="" />
              ) : (
                <ActiveIcon size={24} />
              )}
            </div>
            <div>
              <h1>{activeInstance.name}</h1>
              <p>{activeInstance.version} · {activeInstance.loader}</p>
              {isOfficialAsterProfile(activeInstance) && (
                <small className="aster-profile-badge">ASTER CLIENT</small>
              )}
            </div>
          </div>

          <div className="instance-sidebar-heading">
            <span>Instance</span>
            <button type="button" onClick={() => openEdit(activeInstance)}>
              <Plus size={12} />
            </button>
          </div>

          <button
            type="button"
            className={`instance-content-root ${
              managerView === "content" ? "active" : ""
            }`}
            onClick={() => setManagerView("content")}
          >
            <Layers3 size={14} />
            Content
          </button>

          <nav className="instance-content-nav" aria-label="Instance content">
            {sections.slice(0, 4).map((section) => {
              const Icon = section.icon;
              const count = activeItems.filter((item) => item.kind === section.id).length;
              return (
                <button
                  type="button"
                  key={section.id}
                  className={
                    managerView === "content" && activeSection === section.id
                      ? "active"
                      : ""
                  }
                  onClick={() => setSection(section.id)}
                >
                  <i />
                  <Icon size={12} />
                  <span>{section.label}</span>
                  {count > 0 && <small>{count}</small>}
                </button>
              );
            })}
          </nav>

          {isOfficialAsterProfile(activeInstance) && (
            <button
              type="button"
              className={`instance-sidebar-link aster-settings-link ${
                managerView === "aster-settings" ? "active" : ""
              }`}
              onClick={openAsterSettings}
            >
              <Sparkles size={14} />
              <span>Aster Settings</span>
            </button>
          )}

          <div className="instance-sidebar-separator" />

          {sections.slice(4).map((section) => {
            const Icon = section.icon;
            const count = activeItems.filter((item) => item.kind === section.id).length;
            return (
              <button
                type="button"
                key={section.id}
                className={`instance-sidebar-link ${
                  managerView === "content" && activeSection === section.id
                    ? "active"
                    : ""
                }`}
                onClick={() => setSection(section.id)}
              >
                <Icon size={14} />
                <span>{section.label}</span>
                {count > 0 && <small>{count}</small>}
              </button>
            );
          })}

          <button
            type="button"
            className={`instance-sidebar-link aster-host-link ${
              hostStatus?.instanceId === activeInstance.id ? "is-running" : ""
            }`}
            onClick={() => setHostDialogOpen(true)}
          >
            <Radio size={14} />
            <span>
              {hostStatus?.instanceId === activeInstance.id
                ? "Hosting world"
                : "Host a world"}
            </span>
            {hostStatus?.instanceId === activeInstance.id && <small>LIVE</small>}
          </button>

          <button
            type="button"
            className="instance-sidebar-link"
            onClick={() => openFolder(activeInstance)}
          >
            <FolderOpen size={14} />
            <span>Instance folder</span>
          </button>
          </div>

          <div className="instance-sidebar-footer">
          <div className="instance-sidebar-utilities">
            <button type="button" onClick={() => duplicate(activeInstance)}>
              <Copy size={12} />
              Duplicate
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => setDeleteId(activeInstance.id)}
              disabled={isOfficialAsterProfile(activeInstance)}
              title={
                isOfficialAsterProfile(activeInstance)
                  ? "Official Aster profiles cannot be removed"
                  : "Remove instance"
              }
            >
              <Trash2 size={12} />
              Delete
            </button>
          </div>

          <button
            type="button"
            className="instance-sidebar-launch"
            onClick={() => launch(activeInstance)}
            disabled={
              securityScan.phase === "scanning" ||
              securityBlocks.includes(activeInstance.id) ||
              activeInstance.status === "updating" ||
              activeInstance.status === "running"
            }
          >
            <span className="instance-launch-icon">
              <Play size={17} fill="currentColor" />
            </span>
            <span>
              <strong>Launch game</strong>
              <small>
                {securityScan.phase === "scanning"
                  ? "Checking mods..."
                  : securityBlocks.includes(activeInstance.id)
                    ? "Blocked — review security"
                    : activeInstance.status === "ready"
                  ? "Instance ready"
                  : statusCopy[activeInstance.status]}
              </small>
            </span>
            <ChevronRight size={16} />
          </button>
          </div>
        </aside>

        <ModpackEditor
          editorId={editorId}
          draft={draft}
          minecraftVersions={minecraftVersions}
          setDraft={setDraft}
          close={() => setEditorId(undefined)}
          save={saveDraft}
          chooseIcon={chooseModpackIcon}
        />

        <ConfirmDialog
          open={Boolean(removeContentId)}
          title="Remove content?"
          message="The selected file will be removed from this instance."
          confirmLabel="Remove"
          onCancel={() => setRemoveContentId(null)}
          onConfirm={confirmRemoveContent}
        />

        <ConfirmDialog
          open={Boolean(deleteId)}
          title="Remove modpack?"
          message="This removes it from the launcher library."
          confirmLabel="Remove"
          onCancel={() => setDeleteId(null)}
          onConfirm={confirmDelete}
        />

        <AsterHostDialog
          open={hostDialogOpen}
          instanceId={activeInstance.id}
          instanceName={activeInstance.name}
          loader={activeInstance.loader}
          worlds={activeItems.filter((item) => item.kind === "worlds")}
          status={hostStatus}
          busy={hostBusy}
          detail={hostDetail}
          exporting={exporting}
          onClose={() => setHostDialogOpen(false)}
          onStart={startHosting}
          onStop={stopHosting}
          onExport={exportActiveModpack}
          onOpenTunnel={() => {
            void openHostingTunnelSetup().catch((error: unknown) => {
              notify({
                title: "Tunnel setup unavailable",
                message: error instanceof Error ? error.message : String(error),
                tone: "error",
              });
            });
          }}
          onCopy={(value) => {
            void navigator.clipboard.writeText(value);
            notify({
              title: "Server address copied",
              message: value,
              tone: "success",
            });
          }}
        />
      </motion.div>
    );
  }

  return (
    <div className="my-modpacks">
      <header className="modpacks-toolbar">
        <div className="modpacks-title">
          <h1>My Modpacks</h1>
          <span>{library.length} instances</span>
        </div>
        <label className="modpacks-search">
          <Search size={14} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search instances..."
            aria-label="Search instances"
          />
        </label>
        <button
          type="button"
          className="modpacks-tool-control"
          onClick={() => setSort(sort === "recent" ? "name" : "recent")}
          aria-label={`Sort by ${sort === "recent" ? "name" : "recent activity"}`}
          title="Click to change sorting"
        >
          <ArrowDownUp size={12} />
          {sort === "recent" ? "Recent" : "Name"}
        </button>
        <span className="modpacks-toolbar-spacer" />
        <button
          type="button"
          className="modpacks-import-button"
          onClick={importArchive}
        >
          <Download size={13} />
          Import
        </button>
        <button type="button" className="modpacks-create-button" onClick={openCreate}>
          <Plus size={14} />
          Create
        </button>
      </header>

      <motion.section layout className="modpack-entry-grid" aria-label="Installed modpacks">
        <AnimatePresence initial={false} mode="popLayout">
          {modpacks.map((item) => {
            const Icon = iconMap[item.icon] ?? Boxes;
            const sharedUpdate = hasSharedModpackUpdate(item);
            return (
              <motion.article
                layout
                initial={{ opacity: 0, scale: 0.985, y: -5 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, y: -4 }}
                transition={{ duration: 0.17, ease: [0.22, 1, 0.36, 1] }}
                className={`modpack-entry ${sharedUpdate ? "has-shared-update" : ""}`}
                key={item.id}
                role="button"
                tabIndex={0}
                onClick={() => setActiveInstanceId(item.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setActiveInstanceId(item.id);
                  }
                }}
              >
                <div className={`modpack-entry-icon icon-${item.tone}`}>
                  {item.favorite && <Star size={11} fill="currentColor" />}
                  {item.iconUrl ? (
                    <img src={item.iconUrl} alt="" />
                  ) : (
                    <Icon size={25} strokeWidth={1.65} />
                  )}
                </div>
                <div className="modpack-entry-copy">
                  <h2>
                    {item.name}
                    {isOfficialAsterProfile(item) && (
                      <span className="aster-profile-badge">ASTER</span>
                    )}
                  </h2>
                  <p>
                    <span>{item.version}</span>
                    <i />
                    <span>{item.loader}</span>
                    <i />
                    <span>{item.lastPlayed}</span>
                  </p>
                  <small className={`instance-state state-${item.status}`}>
                    <StatusIcon status={item.status} />
                    {statusCopy[item.status]}
                    <b>·</b>
                    <span>
                      {isOfficialAsterProfile(item)
                        ? "Protected performance build"
                        : "Open to manage content"}
                    </span>
                  </small>
                </div>
                {sharedUpdate && (
                  <button
                    type="button"
                    className="modpack-shared-update"
                    onClick={(event) => {
                      event.stopPropagation();
                      void updateSharedModpack(item);
                    }}
                  >
                    <Download size={11} /> Update
                  </button>
                )}
                <div className="modpack-quick-actions">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setActiveInstanceId(item.id);
                    }}
                    aria-label={`Open ${item.name}`}
                  >
                    <Settings size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      launch(item);
                    }}
                    aria-label={`Launch ${item.name}`}
                  >
                    <Play size={12} fill="currentColor" />
                  </button>
                </div>
              </motion.article>
            );
          })}
        </AnimatePresence>
      </motion.section>

      {modpacks.length === 0 && (
        <div className="modpacks-empty">
          <PackageOpen size={22} />
          <strong>{library.length === 0 ? "No modpacks installed" : "No matching modpacks"}</strong>
          <span>
            {library.length === 0
              ? "Create a local profile or import a modpack archive."
              : "Clear the search to show your instances again."}
          </span>
          {library.length === 0 && (
            <button type="button" className="modpacks-create-button" onClick={openCreate}>
              <Plus size={13} />
              Create Modpack
            </button>
          )}
        </div>
      )}

      <ModpackEditor
        editorId={editorId}
        draft={draft}
        minecraftVersions={minecraftVersions}
        setDraft={setDraft}
        close={() => setEditorId(undefined)}
        save={saveDraft}
        chooseIcon={chooseModpackIcon}
      />

      <ConfirmDialog
        open={Boolean(deleteId)}
        title="Remove modpack?"
        message="This removes it from the launcher library."
        confirmLabel="Remove"
        onCancel={() => setDeleteId(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

interface AsterHostDialogProps {
  open: boolean;
  instanceId: string;
  instanceName: string;
  loader: string;
  worlds: InstanceContentFile[];
  status: HostedWorldStatus | null;
  busy: boolean;
  detail: string;
  exporting: boolean;
  onClose: () => void;
  onStart: (options: {
    worldName: string;
    port: number;
    maxPlayers: number;
    memoryGb: number;
    acceptedEula: boolean;
  }) => void;
  onStop: () => void;
  onExport: () => void;
  onOpenTunnel: () => void;
  onCopy: (value: string) => void;
}

type AsterHostView = "overview" | "console" | "settings";

function AsterHostDialog({
  open,
  instanceId,
  instanceName,
  loader,
  worlds,
  status,
  busy,
  detail,
  exporting,
  onClose,
  onStart,
  onStop,
  onExport,
  onOpenTunnel,
  onCopy,
}: AsterHostDialogProps) {
  const [worldName, setWorldName] = useState("");
  const [acceptedEula, setAcceptedEula] = useState(false);
  const [view, setView] = useState<AsterHostView>("overview");
  const [settings, setSettings] = useState<HostServerSettings>(
    defaultHostServerSettings,
  );
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState("");
  const [consoleLines, setConsoleLines] = useState<HostConsoleLine[]>([]);
  const [consoleCursor, setConsoleCursor] = useState(0);
  const [consoleCommand, setConsoleCommand] = useState("");
  const [consoleError, setConsoleError] = useState("");
  const consoleEndRef = useRef<HTMLDivElement | null>(null);
  const ownSession = status?.instanceId === instanceId;
  const supported = loader === "Fabric" || loader === "Vanilla";
  const selectedWorld = ownSession && status ? status.worldName : worldName;

  useEffect(() => {
    if (!open) return;
    if (ownSession && status) {
      setWorldName(status.worldName);
    } else if (!worlds.some((world) => world.fileName === worldName)) {
      setWorldName(worlds[0]?.fileName ?? "");
    }
  }, [open, ownSession, status, worldName, worlds]);

  useEffect(() => {
    if (!open || !selectedWorld) return;
    let disposed = false;
    setSettingsLoading(true);
    setSettingsMessage("");
    void getHostServerSettings(instanceId, selectedWorld)
      .then((saved) => {
        if (!disposed) setSettings(saved);
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setSettings(defaultHostServerSettings);
          setSettingsMessage(
            error instanceof Error ? error.message : String(error),
          );
        }
      })
      .finally(() => {
        if (!disposed) setSettingsLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [instanceId, open, selectedWorld]);

  useEffect(() => {
    if (!open || !ownSession) {
      setConsoleLines([]);
      setConsoleCursor(0);
      return;
    }
    let disposed = false;
    let cursor = 0;
    const poll = async () => {
      try {
        const snapshot = await getHostConsole(instanceId, cursor);
        if (disposed) return;
        cursor = snapshot.nextCursor;
        setConsoleCursor(cursor);
        if (snapshot.lines.length > 0) {
          setConsoleLines((current) =>
            [...current, ...snapshot.lines].slice(-600),
          );
        }
        setConsoleError("");
      } catch (error) {
        if (!disposed) {
          setConsoleError(error instanceof Error ? error.message : String(error));
        }
      }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), 900);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [instanceId, open, ownSession]);

  useEffect(() => {
    if (view === "console") {
      consoleEndRef.current?.scrollIntoView({ block: "end" });
    }
  }, [consoleCursor, view]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  const updateSetting = <Key extends keyof HostServerSettings>(
    key: Key,
    value: HostServerSettings[Key],
  ) => {
    setSettings((current) => ({ ...current, [key]: value }));
    setSettingsMessage("");
  };

  const persistSettings = async () => {
    if (!selectedWorld || settingsSaving) return null;
    setSettingsSaving(true);
    setSettingsMessage("");
    try {
      const result = await saveHostServerSettings(
        instanceId,
        selectedWorld,
        settings,
      );
      setSettings(result.settings);
      setSettingsMessage(
        result.restartRequired
          ? "Saved for this world. Restart the host to apply the changes."
          : "Saved for this world.",
      );
      return result.settings;
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setSettingsSaving(false);
    }
  };

  const startWithSettings = async () => {
    const saved = await persistSettings();
    if (!saved) return;
    onStart({
      worldName,
      port: saved.port,
      maxPlayers: saved.maxPlayers,
      memoryGb: saved.memoryGb,
      acceptedEula,
    });
  };

  const submitConsoleCommand = async () => {
    const command = consoleCommand.trim();
    if (!command) return;
    setConsoleCommand("");
    try {
      await sendHostConsoleCommand(instanceId, command);
      setConsoleError("");
    } catch (error) {
      setConsoleError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modpack-dialog-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) onClose();
          }}
        >
          <motion.section
            className="aster-host-dialog"
            initial={{ opacity: 0, scale: 0.97, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.985, y: 6 }}
            transition={{ duration: 0.17 }}
          >
            <button
              type="button"
              className="modpack-dialog-close aster-host-close"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={onClose}
              aria-label="Close Aster Host"
            >
              <X size={15} />
            </button>
            <header>
              <span className={ownSession ? "is-live" : ""}>
                <Server size={20} />
              </span>
              <div>
                <small>ASTER HOST</small>
                <h2>{ownSession ? "Your world is live" : "Play together from your PC"}</h2>
                <p>{instanceName} · {loader}</p>
              </div>
              {ownSession && <b className="aster-host-live"><i /> LIVE</b>}
            </header>

            <nav className="aster-host-tabs" aria-label="Aster Host panels">
              <button
                type="button"
                className={view === "overview" ? "active" : ""}
                onClick={() => setView("overview")}
              >
                <Server size={13} />
                Overview
              </button>
              <button
                type="button"
                className={view === "console" ? "active" : ""}
                onClick={() => setView("console")}
                disabled={!ownSession}
              >
                <Terminal size={13} />
                Console
              </button>
              <button
                type="button"
                className={view === "settings" ? "active" : ""}
                onClick={() => setView("settings")}
                disabled={!selectedWorld}
              >
                <SlidersHorizontal size={13} />
                Settings
              </button>
            </nav>

            {view === "overview" && ownSession && status && (
              <div className="aster-host-running">
                <div className="aster-host-address">
                  <Radio size={18} />
                  <span>
                    <small>LOCAL SERVER ADDRESS</small>
                    <strong>{status.lanAddress}</strong>
                  </span>
                  <button type="button" onClick={() => onCopy(status.lanAddress)}>
                    <Copy size={13} />
                    Copy
                  </button>
                </div>
                <div className="aster-host-facts">
                  <span><small>WORLD</small><b>{status.worldName}</b></span>
                  <span><small>PORT</small><b>{status.port}</b></span>
                  <span><small>PROCESS</small><b>#{status.pid}</b></span>
                </div>
                <p>
                  This is a real dedicated Minecraft server on your computer.
                  Keep Aster open while friends are playing.
                </p>
                <div className="aster-host-actions">
                  <button type="button" onClick={onOpenTunnel}>
                    <Globe2 size={14} />
                    Internet access
                  </button>
                  <button type="button" onClick={onExport} disabled={exporting}>
                    <Archive size={14} />
                    {exporting ? "Exporting..." : "Share modpack"}
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={onStop}
                    disabled={busy}
                  >
                    <X size={14} />
                    {busy ? "Stopping..." : "Stop hosting"}
                  </button>
                </div>
              </div>
            )}

            {view === "overview" && !ownSession && (
              <div className="aster-host-setup">
                <div className="aster-host-callout">
                  <Users size={18} />
                  <div>
                    <strong>No paid server required</strong>
                    <span>
                      Aster starts a hidden dedicated server using this instance
                      and its enabled mods.
                    </span>
                  </div>
                </div>

                {!supported && (
                  <div className="aster-host-warning">
                    <AlertTriangle size={16} />
                    Aster Host currently supports Fabric and Vanilla. Forge
                    hosting needs a separate server installer.
                  </div>
                )}

                {status && !ownSession && (
                  <div className="aster-host-warning">
                    <Radio size={16} />
                    Another instance is already hosting {status.worldName}.
                  </div>
                )}

                <div className="aster-host-fields">
                  <label className="wide">
                    <span>World</span>
                    <select
                      value={worldName}
                      onChange={(event) => setWorldName(event.target.value)}
                    >
                      {worlds.map((world) => (
                        <option value={world.fileName} key={world.id}>
                          {world.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Player slots</span>
                    <input
                      type="number"
                      min={2}
                      max={100}
                      value={settings.maxPlayers}
                      onChange={(event) =>
                        updateSetting("maxPlayers", event.currentTarget.valueAsNumber)
                      }
                    />
                  </label>
                  <label>
                    <span>Server RAM</span>
                    <select
                      value={settings.memoryGb}
                      onChange={(event) =>
                        updateSetting("memoryGb", Number(event.target.value))
                      }
                    >
                      {[2, 3, 4, 6, 8, 12, 16].map((amount) => (
                        <option value={amount} key={amount}>
                          {amount} GB
                        </option>
                      ))}
                    </select>
                  </label>
                  <RamSafetyWarning allocatedGb={settings.memoryGb} />
                  <label>
                    <span>Local port</span>
                    <input
                      type="number"
                      min={1024}
                      max={65535}
                      value={settings.port}
                      onChange={(event) =>
                        updateSetting("port", event.currentTarget.valueAsNumber)
                      }
                    />
                  </label>
                </div>

                {worlds.length === 0 && (
                  <div className="aster-host-empty">
                    <Globe2 size={18} />
                    Add or create a world in this instance before hosting.
                  </div>
                )}

                <label className="aster-host-eula">
                  <input
                    type="checkbox"
                    checked={acceptedEula}
                    onChange={(event) => setAcceptedEula(event.target.checked)}
                  />
                  <span>
                    I accept the{" "}
                    <a
                      href="https://aka.ms/MinecraftEULA"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Minecraft EULA
                    </a>{" "}
                    for this local server.
                  </span>
                </label>

                <footer className="aster-host-footer">
                  <span>{detail || "The first start downloads the official server runtime."}</span>
                  <button type="button" onClick={onClose} disabled={busy}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="primary"
                    disabled={
                      busy ||
                      !supported ||
                      Boolean(status) ||
                      !worldName ||
                      !acceptedEula ||
                      !Number.isFinite(settings.port) ||
                      !Number.isFinite(settings.maxPlayers) ||
                      settingsLoading ||
                      settingsSaving
                    }
                    onClick={() => void startWithSettings()}
                  >
                    {busy ? (
                      <RefreshCw size={14} className="spin" />
                    ) : (
                      <Play size={14} fill="currentColor" />
                    )}
                    {busy ? "Preparing..." : "Host world"}
                  </button>
                </footer>
              </div>
            )}

            {view === "console" && (
              <div className="aster-host-console-panel">
                <div className="aster-host-console">
                  {consoleLines.length === 0 ? (
                    <div className="aster-host-console-empty">
                      <Terminal size={20} />
                      Waiting for server output...
                    </div>
                  ) : (
                    consoleLines.map((line) => (
                      <div className={`is-${line.stream}`} key={line.id}>
                        <span>{line.stream === "command" ? "CMD" : line.stream.toUpperCase()}</span>
                        <code>{line.text}</code>
                      </div>
                    ))
                  )}
                  <div ref={consoleEndRef} />
                </div>
                {consoleError && (
                  <p className="aster-host-console-error">{consoleError}</p>
                )}
                <form
                  className="aster-host-command"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitConsoleCommand();
                  }}
                >
                  <span>&gt;</span>
                  <input
                    value={consoleCommand}
                    onChange={(event) => setConsoleCommand(event.target.value)}
                    placeholder="Enter a Minecraft server command..."
                    maxLength={256}
                    autoComplete="off"
                  />
                  <button type="submit" disabled={!consoleCommand.trim() || !ownSession}>
                    <Send size={13} />
                    Send
                  </button>
                </form>
              </div>
            )}

            {view === "settings" && (
              <div className="aster-host-settings">
                <div className="aster-host-settings-note">
                  <ShieldCheck size={16} />
                  <span>
                    <strong>Saved per world</strong>
                    Online mode and remote console access stay protected.
                  </span>
                </div>
                <div className="aster-host-settings-grid">
                  <label className="wide">
                    <span>Server name</span>
                    <input
                      value={settings.motd}
                      maxLength={80}
                      onChange={(event) => updateSetting("motd", event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Default game mode</span>
                    <select
                      value={settings.gameMode}
                      onChange={(event) =>
                        updateSetting(
                          "gameMode",
                          event.target.value as HostServerSettings["gameMode"],
                        )
                      }
                    >
                      <option value="survival">Survival</option>
                      <option value="creative">Creative</option>
                      <option value="adventure">Adventure</option>
                      <option value="spectator">Spectator</option>
                    </select>
                  </label>
                  <label>
                    <span>Difficulty</span>
                    <select
                      value={settings.difficulty}
                      onChange={(event) =>
                        updateSetting(
                          "difficulty",
                          event.target.value as HostServerSettings["difficulty"],
                        )
                      }
                    >
                      <option value="peaceful">Peaceful</option>
                      <option value="easy">Easy</option>
                      <option value="normal">Normal</option>
                      <option value="hard">Hard</option>
                    </select>
                  </label>
                  <label>
                    <span>Player slots</span>
                    <input
                      type="number"
                      min={2}
                      max={100}
                      value={settings.maxPlayers}
                      onChange={(event) =>
                        updateSetting("maxPlayers", event.currentTarget.valueAsNumber)
                      }
                    />
                  </label>
                  <label>
                    <span>Server RAM</span>
                    <select
                      value={settings.memoryGb}
                      onChange={(event) =>
                        updateSetting("memoryGb", Number(event.target.value))
                      }
                    >
                      {[2, 3, 4, 6, 8, 12, 16].map((amount) => (
                        <option value={amount} key={amount}>{amount} GB</option>
                      ))}
                    </select>
                  </label>
                  <RamSafetyWarning allocatedGb={settings.memoryGb} />
                  <label>
                    <span>View distance</span>
                    <input
                      type="number"
                      min={2}
                      max={32}
                      value={settings.viewDistance}
                      onChange={(event) =>
                        updateSetting("viewDistance", event.currentTarget.valueAsNumber)
                      }
                    />
                  </label>
                  <label>
                    <span>Simulation distance</span>
                    <input
                      type="number"
                      min={2}
                      max={32}
                      value={settings.simulationDistance}
                      onChange={(event) =>
                        updateSetting(
                          "simulationDistance",
                          event.currentTarget.valueAsNumber,
                        )
                      }
                    />
                  </label>
                  <label>
                    <span>Spawn protection</span>
                    <input
                      type="number"
                      min={0}
                      max={32}
                      value={settings.spawnProtection}
                      onChange={(event) =>
                        updateSetting(
                          "spawnProtection",
                          event.currentTarget.valueAsNumber,
                        )
                      }
                    />
                  </label>
                  <label>
                    <span>Local port</span>
                    <input
                      type="number"
                      min={1024}
                      max={65535}
                      value={settings.port}
                      onChange={(event) =>
                        updateSetting("port", event.currentTarget.valueAsNumber)
                      }
                    />
                  </label>
                </div>
                <div className="aster-host-toggles">
                  {([
                    ["pvp", "Player combat", "Allow players to damage each other."],
                    ["allowFlight", "Allow flight", "Avoid flight kicks for compatible mods."],
                    ["whitelist", "Whitelist", "Only approved Minecraft names may join."],
                  ] as const).map(([key, label, description]) => (
                    <label key={key}>
                      <span>
                        <strong>{label}</strong>
                        <small>{description}</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={settings[key]}
                        onChange={(event) => updateSetting(key, event.target.checked)}
                      />
                    </label>
                  ))}
                </div>
                <footer className="aster-host-settings-footer">
                  <span className={settingsMessage.includes("could not") ? "error" : ""}>
                    {settingsLoading
                      ? "Loading this world's settings..."
                      : settingsMessage ||
                        (ownSession
                          ? "Changes are stored now and apply after restarting the host."
                          : "These settings will be used the next time this world starts.")}
                  </span>
                  <button
                    type="button"
                    className="primary"
                    disabled={settingsLoading || settingsSaving}
                    onClick={() => void persistSettings()}
                  >
                    {settingsSaving ? <RefreshCw size={13} className="spin" /> : <Check size={13} />}
                    {settingsSaving ? "Saving..." : "Save settings"}
                  </button>
                </footer>
              </div>
            )}
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface ModpackEditorProps {
  editorId: string | null | undefined;
  draft: ModpackDraft;
  minecraftVersions: string[];
  setDraft: React.Dispatch<React.SetStateAction<ModpackDraft>>;
  close: () => void;
  save: () => void;
  chooseIcon: () => void;
}

function ModpackEditor({
  editorId,
  draft,
  minecraftVersions,
  setDraft,
  close,
  save,
  chooseIcon,
}: ModpackEditorProps) {
  return (
    <AnimatePresence>
      {editorId !== undefined && (
        <motion.div
          className="modpack-dialog-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) close();
          }}
        >
          <motion.form
            className="modpack-dialog"
            initial={{ opacity: 0, scale: 0.97, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 6 }}
            transition={{ duration: 0.16 }}
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <button type="button" className="modpack-dialog-close" onClick={close} aria-label="Close">
              <X size={15} />
            </button>
            <header>
              <span><PackageOpen size={18} /></span>
              <div>
                <h2>{editorId ? "Edit modpack" : "Create modpack"}</h2>
                <p>Every stable Minecraft release is available.</p>
              </div>
            </header>
            <div className="modpack-icon-picker">
              <div className="modpack-icon-preview">
                {draft.iconUrl ? (
                  <img src={draft.iconUrl} alt="" />
                ) : (
                  <PackageOpen size={22} />
                )}
              </div>
              <div>
                <strong>Modpack icon</strong>
                <span>PNG, JPG or WebP · max. 5 MB</span>
              </div>
              <button
                type="button"
                onClick={chooseIcon}
                disabled={!editorId}
                title={
                  editorId
                    ? "Choose a custom modpack icon"
                    : "Create the modpack first, then edit it to add an icon"
                }
              >
                {draft.iconUrl ? "Change icon" : "Choose icon"}
              </button>
            </div>
            <label>
              <span>Name</span>
              <input
                autoFocus
                value={draft.name}
                maxLength={48}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="My Modpack"
              />
            </label>
            <div className="modpack-dialog-fields">
              <label>
                <span>Minecraft version</span>
                <select
                  value={draft.version}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, version: event.target.value }))
                  }
                >
                  {minecraftVersions.map((version) => (
                    <option key={version}>{version}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Mod loader</span>
                <select
                  value={draft.loader}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, loader: event.target.value }))
                  }
                >
                  {modLoaders.map((loader) => (
                    <option key={loader}>{loader}</option>
                  ))}
                </select>
              </label>
            </div>
            <footer>
              <button type="button" onClick={close}>Cancel</button>
              <button type="submit" className="primary" disabled={!draft.name.trim()}>
                {editorId ? "Save changes" : "Create modpack"}
              </button>
            </footer>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}

function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modpack-dialog-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="modpack-dialog modpack-delete-dialog"
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98 }}
          >
            <header>
              <span className="danger"><Trash2 size={18} /></span>
              <div>
                <h2>{title}</h2>
                <p>{message}</p>
              </div>
            </header>
            <footer>
              <button type="button" onClick={onCancel}>Cancel</button>
              <button type="button" className="danger" onClick={onConfirm}>
                {confirmLabel}
              </button>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
