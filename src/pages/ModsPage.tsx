import {
  Check,
  ChevronDown,
  Download,
  ExternalLink,
  Filter,
  LoaderCircle,
  PackageOpen,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  WifiOff,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { siCurseforge, siModrinth } from "simple-icons";
import {
  formatDownloads,
  getContentReleases,
  normalizeContentError,
  openContentProject,
  resolveContentInstall,
  searchContent,
  type ContentError,
  type ContentProject,
  type ContentProvider,
  type ContentRelease,
  type ContentSort,
  type ContentType,
} from "../services/content";
import {
  downloadInstanceContent,
  installModpack,
  listInstanceContent,
  type InstanceContentSection,
} from "../services/instances";
import {
  addInstalledModpack,
  readModpackLibrary,
  subscribeModpackLibrary,
  type InstalledModpack,
} from "../services/modpackLibrary";
import { listMinecraftVersions } from "../services/launcher";
import { useAppStore } from "../store/AppStore";

const contentTabs: ContentType[] = [
  "Modpacks",
  "Mods",
  "Resourcepacks",
  "Shaders",
  "Datapacks",
];

const fallbackGameVersions = [
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
  "1.20.4",
  "1.20.2",
  "1.20.1",
  "1.19.4",
  "1.19.2",
  "1.18.2",
  "1.17.1",
  "1.16.5",
  "1.15.2",
  "1.14.4",
  "1.13.2",
  "1.12.2",
  "1.11.2",
  "1.10.2",
  "1.9.4",
  "1.8.9",
  "1.7.10",
  "1.6.4",
  "1.5.2",
  "1.4.7",
  "1.3.2",
  "1.2.5",
  "1.1",
  "1.0",
];

const DISCOVERY_TAB_KEY = "aster.discovery-tab";
const DISCOVERY_TARGET_KEY = "aster.discovery-target";
const PROJECT_PAGE_SIZE = 30;

const providerIcons = {
  Modrinth: siModrinth,
  CurseForge: siCurseforge,
} satisfies Record<ContentProvider, { path: string }>;

interface DiscoveryTarget {
  instanceId: string;
  instanceName: string;
  gameVersion: string;
  loader: string;
  contentType: ContentType;
}

function loadDiscoveryTarget(): DiscoveryTarget | null {
  try {
    const saved = localStorage.getItem(DISCOVERY_TARGET_KEY);
    if (!saved) return null;
    const value = JSON.parse(saved) as Partial<DiscoveryTarget>;
    if (
      typeof value.instanceId !== "string" ||
      typeof value.instanceName !== "string" ||
      typeof value.gameVersion !== "string" ||
      typeof value.loader !== "string" ||
      !value.contentType ||
      !contentTabs.includes(value.contentType)
    ) {
      return null;
    }
    return value as DiscoveryTarget;
  } catch {
    return null;
  }
}

function contentTypeToSection(contentType: ContentType): InstanceContentSection | null {
  if (contentType === "Mods") return "mods";
  if (contentType === "Resourcepacks") return "resourcepacks";
  if (contentType === "Shaders") return "shaders";
  if (contentType === "Datapacks") return "datapacks";
  return null;
}

const categoryOptions: Record<ContentType, string[]> = {
  Modpacks: ["Adventure", "Technology", "Magic", "Quests", "Lightweight", "Multiplayer"],
  Mods: ["Optimization", "Technology", "Magic", "Adventure", "Utility", "Decoration", "Library"],
  Resourcepacks: ["Realistic", "Simplistic", "Themed", "Vanilla-like", "Audio"],
  Shaders: ["Realistic", "Fantasy", "Vanilla-like", "Performance", "Atmosphere"],
  Datapacks: ["Adventure", "Utility", "Magic", "Technology", "Game Mechanics"],
};

const loaderOptions = ["Fabric", "Forge", "NeoForge", "Quilt"];

const sortOptions: { id: ContentSort; label: string }[] = [
  { id: "relevance", label: "Relevance" },
  { id: "downloads", label: "Most downloaded" },
  { id: "updated", label: "Recently updated" },
  { id: "newest", label: "Newest" },
];

export function ModsPage() {
  const { notify, setPage, setDownloads } = useAppStore();
  const [activeTab, setActiveTab] = useState<ContentType>(() => {
    const saved = localStorage.getItem(DISCOVERY_TAB_KEY) as ContentType | null;
    return saved && contentTabs.includes(saved) ? saved : "Mods";
  });
  const [source, setSource] = useState<ContentProvider>("Modrinth");
  const [query, setQuery] = useState("");
  const [gameVersions, setGameVersions] = useState(fallbackGameVersions);
  const [version, setVersion] = useState("1.21.1");
  const [versionQuery, setVersionQuery] = useState("");
  const [showAllVersions, setShowAllVersions] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(true);
  const [category, setCategory] = useState<string | null>(null);
  const [loader, setLoader] = useState<string | null>(null);
  const [sort, setSort] = useState<ContentSort>("downloads");
  const [sortOpen, setSortOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [loadersOpen, setLoadersOpen] = useState(false);
  const [projects, setProjects] = useState<ContentProject[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMoreProjects, setLoadingMoreProjects] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [error, setError] = useState<ContentError | null>(null);
  const [installed, setInstalled] = useState<string[]>([]);
  const [installing, setInstalling] = useState<string[]>([]);
  const [installTarget, setInstallTarget] =
    useState<DiscoveryTarget | null>(loadDiscoveryTarget);
  const [instanceLibrary, setInstanceLibrary] =
    useState<InstalledModpack[]>(readModpackLibrary);
  const [retryKey, setRetryKey] = useState(0);
  const [openActions, setOpenActions] = useState<string | null>(null);
  const [releases, setReleases] = useState<ContentRelease[]>([]);
  const [releasesTotal, setReleasesTotal] = useState(0);
  const [releasesLoading, setReleasesLoading] = useState(false);
  const [releasesLoadingMore, setReleasesLoadingMore] = useState(false);
  const [releasesError, setReleasesError] = useState<string | null>(null);
  const [selectedReleases, setSelectedReleases] = useState<Record<string, string>>({});

  useEffect(() => {
    let disposed = false;
    void listMinecraftVersions()
      .then((versions) => {
        if (!disposed && versions.length > 0) {
          setGameVersions([
            ...new Set([...fallbackGameVersions, ...versions]),
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
  const [selectedLoaders, setSelectedLoaders] = useState<Record<string, string>>({});
  const requestId = useRef(0);
  const releaseRequestId = useRef(0);
  const projectsPageLoading = useRef(false);
  const resultsListRef = useRef<HTMLElement>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem(DISCOVERY_TAB_KEY, activeTab);
  }, [activeTab]);

  useEffect(
    () =>
      subscribeModpackLibrary(() => {
        setInstanceLibrary(readModpackLibrary());
      }),
    [],
  );

  useEffect(() => {
    if (!installTarget) return;
    setVersion(installTarget.gameVersion);
    setShowAllVersions(false);
  }, [installTarget]);

  useEffect(() => {
    let active = true;
    if (activeTab === "Modpacks") {
      setInstalled(
        instanceLibrary.flatMap((item) =>
          item.provider && item.projectId
            ? [`${item.provider}:${item.projectId}`]
            : [],
        ),
      );
      return () => {
        active = false;
      };
    }
    if (!installTarget) {
      setInstalled([]);
      return () => {
        active = false;
      };
    }
    setInstalled([]);
    void listInstanceContent(installTarget.instanceId)
      .then((files) => {
        if (!active) return;
        setInstalled(
          files.flatMap((file) =>
            file.projectId &&
            (file.source === "Modrinth" || file.source === "CurseForge")
              ? [`${file.source}:${file.projectId}`]
              : [],
          ),
        );
      })
      .catch(() => {
        if (active) setInstalled([]);
      });
    return () => {
      active = false;
    };
  }, [activeTab, installTarget, instanceLibrary]);

  useEffect(() => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setLoadingMoreProjects(false);
    setLoadMoreError(null);
    projectsPageLoading.current = false;
    setError(null);

    const timer = window.setTimeout(() => {
      void searchContent(
        source,
        activeTab,
        query.trim(),
        showAllVersions ? "" : version,
        category?.toLowerCase().replaceAll(" ", "-") ?? null,
        loader,
        sort,
        0,
        PROJECT_PAGE_SIZE,
      )
        .then((result) => {
          if (requestId.current !== currentRequest) return;
          setProjects(result.projects);
          setTotal(result.total);
        })
        .catch((reason: unknown) => {
          if (requestId.current !== currentRequest) return;
          setProjects([]);
          setTotal(0);
          setError(normalizeContentError(reason));
        })
        .finally(() => {
          if (requestId.current === currentRequest) setLoading(false);
        });
    }, 320);

    return () => window.clearTimeout(timer);
  }, [
    activeTab,
    category,
    loader,
    query,
    retryKey,
    showAllVersions,
    sort,
    source,
    version,
  ]);

  useEffect(() => {
    releaseRequestId.current += 1;
    setOpenActions(null);
  }, [activeTab, category, loader, showAllVersions, sort, source, version]);

  const visibleVersions = useMemo(() => {
    const normalized = versionQuery.trim().toLowerCase();
    return normalized
      ? gameVersions.filter((item) => item.toLowerCase().includes(normalized))
      : gameVersions;
  }, [versionQuery]);

  const activeFilterCount =
    Number(Boolean(category)) +
    Number(Boolean(loader)) +
    Number(sort !== "downloads");

  const clearFilters = () => {
    setCategory(null);
    setLoader(null);
    setSort("downloads");
  };

  const loadMoreProjects = useCallback(async () => {
    if (
      loading ||
      error ||
      loadMoreError ||
      projects.length >= total ||
      projectsPageLoading.current
    ) {
      return;
    }

    const currentRequest = requestId.current;
    const offset = projects.length;
    projectsPageLoading.current = true;
    setLoadingMoreProjects(true);

    try {
      const result = await searchContent(
        source,
        activeTab,
        query.trim(),
        showAllVersions ? "" : version,
        category?.toLowerCase().replaceAll(" ", "-") ?? null,
        loader,
        sort,
        offset,
        PROJECT_PAGE_SIZE,
      );
      if (requestId.current !== currentRequest) return;

      setProjects((current) => {
        const known = new Set(current.map((project) => `${project.provider}:${project.id}`));
        const next = result.projects.filter(
          (project) => !known.has(`${project.provider}:${project.id}`),
        );
        return [...current, ...next];
      });
      setTotal(result.total);
    } catch (reason: unknown) {
      if (requestId.current !== currentRequest) return;
      setLoadMoreError(normalizeContentError(reason).message);
    } finally {
      if (requestId.current === currentRequest) {
        projectsPageLoading.current = false;
        setLoadingMoreProjects(false);
      }
    }
  }, [
    activeTab,
    category,
    error,
    loadMoreError,
    loader,
    loading,
    projects.length,
    query,
    showAllVersions,
    sort,
    source,
    total,
    version,
  ]);

  useEffect(() => {
    const root = resultsListRef.current;
    const sentinel = loadMoreSentinelRef.current;
    if (!root || !sentinel || loading || error || projects.length >= total) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void loadMoreProjects();
      },
      {
        root,
        rootMargin: "0px 0px 180px 0px",
        threshold: 0.01,
      },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [error, loadMoreProjects, loading, projects.length, total]);

  const install = async (item: ContentProject) => {
    const key = `${item.provider}:${item.id}`;
    let release = releases.find((entry) => entry.id === selectedReleases[key]);

    if (activeTab === "Modpacks") {
      const downloadId = `modpack-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 7)}`;
      setDownloads((current) => [
        {
          id: downloadId,
          title: item.name,
          detail: `Resolving ${item.provider} release`,
          status: "queued",
          progress: 0,
        },
        ...current.filter((entry) => entry.id !== downloadId),
      ]);
      setInstalling((current) =>
        current.includes(key) ? current : [...current, key],
      );
      try {
        if (!release) {
          const page = await getContentReleases(
            item.provider,
            item.id,
            showAllVersions ? "" : version,
            0,
            1,
          );
          release = page.releases[0];
        }
        if (!release?.downloadUrl) {
          throw new Error(
            item.provider === "CurseForge"
              ? "CurseForge does not allow automatic download of this release."
              : "This release does not provide an automatic download.",
          );
        }
        const instanceId = `pack-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;
        const result = await installModpack(
          instanceId,
          item.provider,
          release.downloadUrl,
          downloadId,
        );
        addInstalledModpack({
          id: instanceId,
          name: result.name || item.name,
          version: result.gameVersion,
          loader: result.loader,
          lastPlayed: "Never played",
          status: "ready",
          favorite: false,
          icon: "archive",
          tone: "violet",
          iconUrl: item.iconUrl ?? undefined,
          provider: item.provider,
          projectId: item.id,
          releaseId: release.id,
        });
        setInstalled((current) =>
          current.includes(key) ? current : [...current, key],
        );
        notify({
          title: `${result.name || item.name} installed`,
          message: `${result.installedFiles} files are ready in My Modpacks.`,
          tone: "success",
        });
        setPage("modpacks");
      } catch (error) {
        setDownloads((current) =>
          current.map((entry) =>
            entry.id === downloadId
              ? {
                  ...entry,
                  status: "failed",
                  detail:
                    error instanceof Error ? error.message : String(error),
                }
              : entry,
          ),
        );
        notify({
          title: `${item.name} could not be installed`,
          message: error instanceof Error ? error.message : String(error),
          tone: "error",
        });
      } finally {
        setInstalling((current) => current.filter((entry) => entry !== key));
      }
      return;
    }

    if (installTarget) {
      const downloadId = `content-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 7)}`;
      setDownloads((current) => [
        {
          id: downloadId,
          title: item.name,
          detail: `Preparing for ${installTarget.instanceName}`,
          status: "queued",
          progress: 0,
        },
        ...current.filter((entry) => entry.id !== downloadId),
      ]);
      const section = contentTypeToSection(activeTab);
      if (!section) {
        notify({
          title: "Choose instance content",
          message: "Modpack archives cannot be inserted into an existing instance.",
          tone: "warning",
        });
        return;
      }
      setInstalling((current) => [...current, key]);
      try {
        if (!release) {
          const page = await getContentReleases(
            item.provider,
            item.id,
            installTarget.gameVersion,
            0,
            20,
          );
          release = page.releases.find(
            (candidate) =>
              candidate.loaders.length === 0 ||
              candidate.loaders.some((candidateLoader) =>
                candidateLoader.toLowerCase().includes(
                  installTarget.loader.toLowerCase(),
                ),
              ),
          );
        }
        if (!release?.downloadUrl || !release.fileName) {
          throw new Error("This release does not provide an automatic download.");
        }
        const plan =
          activeTab === "Mods"
            ? await resolveContentInstall(
                item.provider,
                item.id,
                release.id,
                installTarget.gameVersion,
                installTarget.loader,
              )
            : {
                dependencyCount: 0,
                files: [
                  {
                    projectId: item.id,
                    releaseId: release.id,
                    name: item.name,
                    versionNumber: release.versionNumber,
                    fileName: release.fileName,
                    downloadUrl: release.downloadUrl,
                    iconUrl: item.iconUrl,
                    isDependency: false,
                  },
                ],
              };
        for (const [fileIndex, file] of plan.files.entries()) {
          setDownloads((current) =>
            current.map((entry) =>
              entry.id === downloadId
                ? {
                    ...entry,
                    detail: file.isDependency
                      ? `Installing dependency ${fileIndex + 1} of ${
                          plan.files.length
                        }: ${file.name}`
                      : `Installing ${item.name}`,
                    progress: 1,
                    status: "downloading",
                  }
                : entry,
            ),
          );
          await downloadInstanceContent(
            installTarget.instanceId,
            section,
            file.downloadUrl,
            file.fileName,
            {
              name: file.isDependency ? file.name : item.name,
              version: file.versionNumber,
              source: item.provider,
              projectId: file.projectId,
              releaseId: file.releaseId,
              iconUrl: file.isDependency ? file.iconUrl : item.iconUrl,
            },
            downloadId,
          );
        }
        setInstalled((current) =>
          current.includes(key) ? current : [...current, key],
        );
        notify({
          title: `${item.name} installed`,
          message:
            plan.dependencyCount > 0
              ? `${release.versionNumber} and ${plan.dependencyCount} required ${
                  plan.dependencyCount === 1 ? "dependency were" : "dependencies were"
                } added to ${installTarget.instanceName}.`
              : `${release.versionNumber} was added to ${installTarget.instanceName}.`,
          tone: "success",
        });
      } catch (error) {
        setDownloads((current) =>
          current.map((entry) =>
            entry.id === downloadId
              ? {
                  ...entry,
                  status: "failed",
                  detail:
                    error instanceof Error ? error.message : String(error),
                }
              : entry,
          ),
        );
        notify({
          title: `${item.name} could not be installed`,
          message: error instanceof Error ? error.message : String(error),
          tone: "error",
        });
      } finally {
        setInstalling((current) => current.filter((entry) => entry !== key));
      }
      return;
    }

    notify({
      title: "Choose a modpack first",
      message:
        instanceLibrary.length > 0
          ? "Select an install target above, then try again."
          : "Create or install a modpack before adding content.",
      tone: "warning",
    });
    if (instanceLibrary.length === 0) setPage("modpacks");
  };

  const removeFromQueue = (item: ContentProject) => {
    const key = `${item.provider}:${item.id}`;
    setInstalled((current) => current.filter((entry) => entry !== key));
    notify({
      title: `${item.name} removed`,
      message: "The project was removed from the download queue.",
      tone: "info",
    });
  };

  const toggleActions = (item: ContentProject) => {
    const key = `${item.provider}:${item.id}`;
    if (openActions === key) {
      releaseRequestId.current += 1;
      setOpenActions(null);
      return;
    }

    const currentReleaseRequest = ++releaseRequestId.current;
    setOpenActions(key);
    setReleases([]);
    setReleasesTotal(0);
    setReleasesError(null);
    setReleasesLoading(true);
    void getContentReleases(
      item.provider,
      item.id,
      showAllVersions ? "" : version,
      0,
      2,
    )
      .then((page) => {
        if (releaseRequestId.current !== currentReleaseRequest) return;
        setReleases(page.releases);
        setReleasesTotal(page.total);
        if (page.releases[0]) {
          setSelectedReleases((current) => ({
            ...current,
            [key]: current[key] ?? page.releases[0].id,
          }));
        }
      })
      .catch((reason: unknown) => {
        if (releaseRequestId.current !== currentReleaseRequest) return;
        setReleasesError(normalizeContentError(reason).message);
      })
      .finally(() => {
        if (releaseRequestId.current === currentReleaseRequest) {
          setReleasesLoading(false);
        }
      });
  };

  const loadMoreReleases = (item: ContentProject) => {
    const currentReleaseRequest = ++releaseRequestId.current;
    setReleasesLoadingMore(true);
    setReleasesError(null);
    void getContentReleases(
      item.provider,
      item.id,
      showAllVersions ? "" : version,
      releases.length,
      2,
    )
      .then((page) => {
        if (releaseRequestId.current !== currentReleaseRequest) return;
        setReleases((current) => {
          const known = new Set(current.map((release) => release.id));
          return [
            ...current,
            ...page.releases.filter((release) => !known.has(release.id)),
          ];
        });
        setReleasesTotal(page.total);
      })
      .catch((reason: unknown) => {
        if (releaseRequestId.current !== currentReleaseRequest) return;
        setReleasesError(normalizeContentError(reason).message);
      })
      .finally(() => {
        if (releaseRequestId.current === currentReleaseRequest) {
          setReleasesLoadingMore(false);
        }
      });
  };

  const openProject = (item: ContentProject) => {
    void openContentProject(item.projectUrl).catch((reason: unknown) => {
      notify({
        title: "Could not open project",
        message: normalizeContentError(reason).message,
        tone: "error",
      });
    });
  };

  return (
    <div className="mods-browser">
      <div className="mods-browser-main">
        <nav className="mods-type-tabs" aria-label="Content types">
          {contentTabs.map((tab) => (
            <button
              type="button"
              key={tab}
              className={activeTab === tab ? "active" : ""}
              onClick={() => {
                setActiveTab(tab);
                setCategory(null);
              }}
            >
              {tab}
            </button>
          ))}
        </nav>

        {activeTab !== "Modpacks" && installTarget && (
          <div className="mods-install-target">
            <span>
              <PackageOpen size={13} />
              Installing into
            </span>
            <strong>{installTarget.instanceName}</strong>
            <small>
              Minecraft {installTarget.gameVersion} · {installTarget.loader}
            </small>
            <button
              type="button"
              onClick={() => {
                localStorage.removeItem(DISCOVERY_TARGET_KEY);
                setInstallTarget(null);
              }}
            >
              Browse without target
            </button>
          </div>
        )}

        {activeTab !== "Modpacks" && !installTarget && instanceLibrary.length > 0 && (
          <div className="mods-install-target mods-install-target-picker">
            <span>
              <PackageOpen size={13} />
              Install downloads into
            </span>
            <select
              defaultValue=""
              aria-label="Choose a modpack"
              onChange={(event) => {
                const item = instanceLibrary.find(
                  (candidate) => candidate.id === event.target.value,
                );
                if (!item) return;
                const target: DiscoveryTarget = {
                  instanceId: item.id,
                  instanceName: item.name,
                  gameVersion: item.version,
                  loader: item.loader,
                  contentType: activeTab,
                };
                localStorage.setItem(
                  DISCOVERY_TARGET_KEY,
                  JSON.stringify(target),
                );
                setInstallTarget(target);
              }}
            >
              <option value="" disabled>
                Choose My Modpack...
              </option>
              {instanceLibrary.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.version} · {item.loader}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="mods-toolbar">
          <label className="mods-search">
            <Search size={14} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${activeTab.toLowerCase()}...`}
              aria-label={`Search ${activeTab}`}
            />
          </label>
          <div className="mods-filter-control">
            <button
              type="button"
              className={`mods-filter-button ${sortOpen || activeFilterCount > 0 ? "active" : ""}`}
              aria-label="Sort and filter"
              aria-expanded={sortOpen}
              onClick={() => setSortOpen((value) => !value)}
            >
              <Filter size={14} />
              {activeFilterCount > 0 && <span>{activeFilterCount}</span>}
            </button>
            <AnimatePresence>
              {sortOpen && (
                <motion.div
                  className="mods-sort-menu"
                  initial={{ opacity: 0, y: -5, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.985 }}
                  transition={{ duration: 0.14, ease: "easeOut" }}
                >
                  <header>
                    <strong>SORT RESULTS</strong>
                    {activeFilterCount > 0 && (
                      <button type="button" onClick={clearFilters}>
                        <RotateCcw size={10} />
                        Reset
                      </button>
                    )}
                  </header>
                  {sortOptions.map((option) => (
                    <button
                      type="button"
                      key={option.id}
                      className={sort === option.id ? "active" : ""}
                      onClick={() => {
                        setSort(option.id);
                        setSortOpen(false);
                      }}
                    >
                      <span>{option.label}</span>
                      {sort === option.id && <Check size={12} />}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          {!loading && !error && (
            <span className="mods-result-count">{total.toLocaleString()} projects</span>
          )}
          <div className="mods-source-switch" aria-label="Project source">
            {(["Modrinth", "CurseForge"] as ContentProvider[]).map((item) => {
              const providerIcon = providerIcons[item];
              return (
                <button
                  type="button"
                  key={item}
                  className={`${item.toLowerCase()} ${source === item ? "active" : ""}`}
                  onClick={() => {
                    setSource(item);
                    if (item === "CurseForge") setCategory(null);
                  }}
                >
                  <svg
                    className="provider-source-icon"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path d={providerIcon.path} />
                  </svg>
                  {item}
                </button>
              );
            })}
          </div>
        </div>

        <section
          ref={resultsListRef}
          className="mods-result-list"
          aria-label={`${activeTab} results`}
        >
          {loading && (
            <div className="mods-loading" role="status">
              <LoaderCircle size={20} />
              <strong>Loading from {source}</strong>
              <span>Finding compatible {activeTab.toLowerCase()}…</span>
            </div>
          )}

          {!loading && error && (
            <div className="mods-provider-state" role="alert">
              {error.code === "offline" ? <WifiOff size={23} /> : <PackageOpen size={23} />}
              <strong>
                {error.code === "curseforge_not_configured"
                  ? "CurseForge needs setup"
                  : "Content unavailable"}
              </strong>
              <span>{error.message}</span>
              {error.code !== "curseforge_not_configured" && (
                <button type="button" onClick={() => setRetryKey((value) => value + 1)}>
                  <RefreshCw size={12} />
                  Try again
                </button>
              )}
            </div>
          )}

          {!loading && !error && projects.length === 0 && (
            <div className="mods-provider-state">
              <Search size={23} />
              <strong>No compatible projects</strong>
              <span>Try another search, content type, or Minecraft version.</span>
            </div>
          )}

          {!loading &&
            !error &&
            projects.map((item) => {
              const key = `${item.provider}:${item.id}`;
              const isInstalled = installed.includes(key);
              const isInstalling = installing.includes(key);
              const menuOpen = openActions === key;
              const availableLoaders = menuOpen
                ? Array.from(new Set(releases.flatMap((release) => release.loaders)))
                : [];
              const selectedLoader = selectedLoaders[key] ?? "Any";
              const visibleReleases =
                selectedLoader === "Any"
                  ? releases
                  : releases.filter((release) =>
                      release.loaders.includes(selectedLoader),
                    );
              return (
                <motion.article
                  layout
                  className={`mod-result-row ${menuOpen ? "actions-open" : ""}`}
                  key={key}
                  transition={{
                    layout: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
                  }}
                >
                  <span className="mod-result-icon mod-result-project-icon">
                    <PackageOpen size={20} strokeWidth={1.5} />
                    {item.iconUrl && (
                      <img
                        src={item.iconUrl}
                        alt=""
                        loading="lazy"
                        onError={(event) => {
                          event.currentTarget.style.display = "none";
                        }}
                      />
                    )}
                  </span>
                  <div className="mod-result-copy">
                    <h2>
                      {item.name}
                      <small>by {item.author}</small>
                    </h2>
                    <p>{item.description}</p>
                    <div>
                      {item.categories.slice(0, 3).map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                    </div>
                  </div>
                  <div className="mod-result-meta">
                    <span>
                      <Download size={11} />
                      {formatDownloads(item.downloads)}
                    </span>
                    <div>
                      <button
                        type="button"
                        className={isInstalled ? "installed" : ""}
                        disabled={isInstalling}
                        onClick={() => void install(item)}
                      >
                        {isInstalling ? (
                          <LoaderCircle size={12} className="rotating" />
                        ) : (
                          <Download size={12} />
                        )}
                        {isInstalling
                          ? "INSTALLING"
                          : isInstalled
                            ? installTarget
                              ? "INSTALLED"
                              : "QUEUED"
                            : "INSTALL"}
                      </button>
                      <button
                        type="button"
                        className={menuOpen ? "active" : ""}
                        aria-label={`More options for ${item.name}`}
                        aria-expanded={menuOpen}
                        onClick={() => toggleActions(item)}
                      >
                        <ChevronDown
                          size={13}
                          className={menuOpen ? "rotated" : ""}
                        />
                      </button>
                    </div>
                  </div>
                  <AnimatePresence initial={false}>
                    {menuOpen && (
                      <motion.div
                        layout
                        className="mod-result-actions-motion"
                        initial={{ height: 0, opacity: 0, y: -5 }}
                        animate={{ height: "auto", opacity: 1, y: 0 }}
                        exit={{ height: 0, opacity: 0, y: -4 }}
                        transition={{
                          height: { duration: 0.22, ease: [0.22, 1, 0.36, 1] },
                          opacity: { duration: 0.14 },
                          y: { duration: 0.18, ease: "easeOut" },
                        }}
                      >
                        <div className="mod-result-actions">
                      <div className="mod-actions-header">
                        <div>
                          <strong>Compatible releases</strong>
                          <span>
                            {showAllVersions
                              ? "All Minecraft versions"
                              : `Minecraft ${version}`}
                          </span>
                        </div>
                        <div className="mod-loader-options" aria-label="Mod loader">
                          {["Any", ...availableLoaders].map((loader) => (
                            <button
                              type="button"
                              key={loader}
                              className={selectedLoader === loader ? "active" : ""}
                              onClick={() =>
                                setSelectedLoaders((current) => ({
                                  ...current,
                                  [key]: loader,
                                }))
                              }
                            >
                              {loader}
                            </button>
                          ))}
                        </div>
                      </div>

                      {releasesLoading && (
                        <div className="mod-actions-loading">
                          <LoaderCircle size={14} />
                          Loading releases…
                        </div>
                      )}
                      {!releasesLoading && releasesError && (
                        <div className="mod-actions-error">{releasesError}</div>
                      )}
                      {!releasesLoading &&
                        !releasesError &&
                        visibleReleases.length === 0 && (
                          <div className="mod-actions-error">
                            No releases match this loader and Minecraft version.
                          </div>
                        )}
                          {!releasesLoading && visibleReleases.length > 0 && (
                            <motion.div
                              layout
                              className="mod-release-list"
                              transition={{
                                layout: {
                                  duration: 0.18,
                                  ease: [0.22, 1, 0.36, 1],
                                },
                              }}
                            >
                              <AnimatePresence initial={false} mode="popLayout">
                                {visibleReleases.map((release) => (
                                  <motion.button
                                    layout="position"
                                    type="button"
                                    key={release.id}
                                    initial={{ opacity: 0, y: -7, scale: 0.985 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: -4, scale: 0.985 }}
                                    transition={{
                                      duration: 0.18,
                                      ease: [0.22, 1, 0.36, 1],
                                    }}
                                    className={
                                      selectedReleases[key] === release.id
                                        ? "active"
                                        : ""
                                    }
                                    onClick={() =>
                                      setSelectedReleases((current) => ({
                                        ...current,
                                        [key]: release.id,
                                      }))
                                    }
                                  >
                                    <span className="release-radio" />
                                    <span className="release-copy">
                                      <strong>{release.versionNumber}</strong>
                                      <small>{release.displayName}</small>
                                    </span>
                                    <span className="release-meta">
                                      {release.loaders.join(" · ") || "Universal"}
                                      <small>
                                        {release.dependencyCount}{" "}
                                        {release.dependencyCount === 1
                                          ? "dependency"
                                          : "dependencies"}
                                      </small>
                                    </span>
                                  </motion.button>
                                ))}
                              </AnimatePresence>
                            </motion.div>
                          )}

                      <div className="mod-actions-footer">
                        {releases.length < releasesTotal && (
                          <button
                            type="button"
                            className="load-more"
                            disabled={releasesLoadingMore}
                            onClick={() => loadMoreReleases(item)}
                          >
                            {releasesLoadingMore ? (
                              <LoaderCircle size={12} className="rotating" />
                            ) : (
                              <ChevronDown size={12} />
                            )}
                            Load more
                          </button>
                        )}
                        <button type="button" onClick={() => openProject(item)}>
                          <ExternalLink size={12} />
                          Open on {item.provider}
                        </button>
                        {isInstalled && !installTarget && activeTab !== "Modpacks" && (
                          <button
                            type="button"
                            className="remove"
                            onClick={() => removeFromQueue(item)}
                          >
                            <Trash2 size={12} />
                            Remove from queue
                          </button>
                        )}
                        <button
                          type="button"
                          className="queue-release"
                          disabled={
                            releasesLoading ||
                            releasesLoadingMore ||
                            visibleReleases.length === 0
                          }
                          onClick={() => void install(item)}
                        >
                          <Download size={12} />
                          {activeTab === "Modpacks"
                            ? isInstalled
                              ? "Install selected build again"
                              : "Install as new modpack"
                            : installTarget
                            ? isInstalled
                              ? "Install selected build again"
                              : `Install into ${installTarget.instanceName}`
                            : "Choose a modpack to install"}
                        </button>
                        </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.article>
              );
            })}
          {!loading && !error && projects.length < total && (
            <div
              ref={loadMoreSentinelRef}
              className={`mods-infinite-loader ${loadMoreError ? "has-error" : ""}`}
              role="status"
            >
              {loadingMoreProjects ? (
                <>
                  <LoaderCircle size={14} className="rotating" />
                  <span>Loading more {activeTab.toLowerCase()}…</span>
                </>
              ) : loadMoreError ? (
                <>
                  <span>{loadMoreError}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setLoadMoreError(null);
                      window.setTimeout(() => void loadMoreProjects(), 0);
                    }}
                  >
                    <RefreshCw size={11} />
                    Try again
                  </button>
                </>
              ) : (
                <>
                  <ChevronDown size={13} />
                  <span>Scroll to load more</span>
                </>
              )}
            </div>
          )}
        </section>
      </div>

      <aside className="mods-filters">
        <section className="filter-collapsible">
          <button
            type="button"
            className={`filter-section-button game-versions-button ${
              versionsOpen ? "open" : ""
            }`}
            onClick={() => setVersionsOpen((value) => !value)}
            aria-expanded={versionsOpen}
          >
            <span>GAME VERSIONS</span>
            <ChevronDown size={12} />
          </button>
          <AnimatePresence initial={false}>
            {versionsOpen && (
              <motion.div
                className="version-filter-content"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.17, ease: [0.22, 1, 0.36, 1] }}
              >
                <label className="version-search">
                  <Search size={12} />
                  <input
                    aria-label="Search game versions"
                    placeholder="Search version..."
                    value={versionQuery}
                    onChange={(event) => setVersionQuery(event.target.value)}
                  />
                </label>
                <div className="version-list">
                  <button
                    type="button"
                    className={
                      showAllVersions ? "active all-versions" : "all-versions"
                    }
                    onClick={() => setShowAllVersions(true)}
                  >
                    <span />
                    All versions
                  </button>
                  {visibleVersions.map((item) => (
                    <button
                      type="button"
                      key={item}
                      className={
                        !showAllVersions && version === item ? "active" : ""
                      }
                      onClick={() => {
                        setVersion(item);
                        setShowAllVersions(false);
                      }}
                    >
                      <span />
                      {item}
                    </button>
                  ))}
                </div>
                <label className="show-all-versions">
                  <input
                    type="checkbox"
                    checked={showAllVersions}
                    onChange={(event) =>
                      setShowAllVersions(event.target.checked)
                    }
                  />
                  <span>SHOW ALL VERSIONS</span>
                </label>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
        <section className="filter-collapsible">
          <button
            type="button"
            className={`filter-section-button ${categoriesOpen ? "open" : ""}`}
            onClick={() => setCategoriesOpen((value) => !value)}
            disabled={source === "CurseForge"}
          >
            <span>
              CATEGORIES
              {category && <small>{category}</small>}
            </span>
            <ChevronDown size={12} />
          </button>
          <AnimatePresence initial={false}>
            {categoriesOpen && source === "Modrinth" && (
              <motion.div
                className="filter-options"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.17, ease: [0.22, 1, 0.36, 1] }}
              >
                <div>
                  {categoryOptions[activeTab].map((item) => (
                    <button
                      type="button"
                      key={item}
                      className={category === item ? "active" : ""}
                      onClick={() =>
                        setCategory((current) => (current === item ? null : item))
                      }
                    >
                      <span>{item}</span>
                      {category === item && <Check size={11} />}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        <section className="filter-collapsible">
          <button
            type="button"
            className={`filter-section-button ${loadersOpen ? "open" : ""}`}
            onClick={() => setLoadersOpen((value) => !value)}
          >
            <span>
              MOD LOADERS
              {loader && <small>{loader}</small>}
            </span>
            <ChevronDown size={12} />
          </button>
          <AnimatePresence initial={false}>
            {loadersOpen && (
              <motion.div
                className="filter-options"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.17, ease: [0.22, 1, 0.36, 1] }}
              >
                <div>
                  {loaderOptions.map((item) => (
                    <button
                      type="button"
                      key={item}
                      className={loader === item ? "active" : ""}
                      onClick={() =>
                        setLoader((current) => (current === item ? null : item))
                      }
                    >
                      <span>{item}</span>
                      {loader === item && <Check size={11} />}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
        {activeFilterCount > 0 && (
          <button type="button" className="clear-mod-filters" onClick={clearFilters}>
            <RotateCcw size={11} />
            RESET {activeFilterCount} FILTER{activeFilterCount === 1 ? "" : "S"}
          </button>
        )}
        <div className="mods-filter-note">
          <PackageOpen size={17} />
          <span>
            Installing into
            <strong>
              {showAllVersions ? "Selected instance" : `Minecraft ${version}`}
            </strong>
          </span>
        </div>
      </aside>
    </div>
  );
}
