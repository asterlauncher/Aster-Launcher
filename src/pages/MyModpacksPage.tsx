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
  Gamepad2,
  Globe2,
  Image,
  Layers3,
  ListChecks,
  MoreHorizontal,
  Mountain,
  PackageOpen,
  Palette,
  Pickaxe,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Sparkles,
  Star,
  Trash2,
  TreePine,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createInstanceStructure,
  exportModpack,
  listInstanceContent,
  openInstanceContentFolder,
  openInstanceFolder,
  pickAndImportInstanceContent,
  pickAndImportModpack,
  pickAndSetInstanceIcon,
  removeInstanceContent,
  scanInstanceMods,
  setInstanceContentEnabled,
  type InstanceContentFile,
  type InstanceContentSection,
  type InstanceSecurityScanResult,
} from "../services/instances";
import { useAppStore } from "../store/AppStore";
import type { ContentType } from "../services/content";
import {
  readModpackLibrary,
  subscribeModpackLibrary,
  writeModpackLibrary,
  type InstalledModpack,
  type ModpackIcon,
  type ModpackStatus,
} from "../services/modpackLibrary";
import {
  launchInstance,
  listMinecraftVersions,
  listenToLaunchStatus,
} from "../services/launcher";

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

export function MyModpacksPage() {
  const {
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
  const [contentFiles, setContentFiles] = useState<InstanceContentFile[]>([]);
  const [contentLoading, setContentLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ModpackSort>("recent");
  const [minecraftVersions, setMinecraftVersions] =
    useState(fallbackMinecraftVersions);
  const [activeInstanceId, setActiveInstanceId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<InstanceSection>("mods");
  const [contentQuery, setContentQuery] = useState("");
  const [selectedContent, setSelectedContent] = useState<string[]>([]);
  const [contentMenuId, setContentMenuId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
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
            </div>
          </div>

          <div className="instance-sidebar-heading">
            <span>Instance</span>
            <button type="button" onClick={() => openEdit(activeInstance)}>
              <Plus size={12} />
            </button>
          </div>

          <button type="button" className="instance-content-root active">
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
                  className={activeSection === section.id ? "active" : ""}
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

          <div className="instance-sidebar-separator" />

          {sections.slice(4).map((section) => {
            const Icon = section.icon;
            const count = activeItems.filter((item) => item.kind === section.id).length;
            return (
              <button
                type="button"
                key={section.id}
                className={`instance-sidebar-link ${
                  activeSection === section.id ? "active" : ""
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
            <button type="button" className="danger" onClick={() => setDeleteId(activeInstance.id)}>
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
            return (
              <motion.article
                layout
                initial={{ opacity: 0, scale: 0.985, y: -5 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, y: -4 }}
                transition={{ duration: 0.17, ease: [0.22, 1, 0.36, 1] }}
                className="modpack-entry"
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
                  <h2>{item.name}</h2>
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
                    <span>Open to manage content</span>
                  </small>
                </div>
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
