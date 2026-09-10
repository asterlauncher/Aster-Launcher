import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDownUp,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Copy,
  FolderOpen,
  Filter,
  Image,
  Layers3,
  LogIn,
  PackageOpen,
  Plus,
  Play,
  Puzzle,
  RefreshCw,
  ScanSearch,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  UploadCloud,
  UserRound,
  Wrench,
  X,
} from "lucide-react";
import { Btd6RiskDialog } from "../components/Btd6RiskDialog";
import {
  chooseBtd6ModIcon,
  detectBtd6,
  importBtd6Mod,
  installBtd6CommunityMod,
  launchBtd6,
  listBtd6Mods,
  loadBtd6CommunityMods,
  loadBtd6Modpacks,
  openBtd6Path,
  removeBtd6Mod,
  repairBtd6Runtime,
  saveBtd6Modpacks,
  scanBtd6Mod,
  setBtd6ModEnabled,
  submitBtd6Mod,
  updateBtd6CommunityMod,
  type Btd6CommunityMod,
  type Btd6Installation,
  type Btd6ModFile,
  type Btd6Modpack,
} from "../services/btd6";
import { useAppStore } from "../store/AppStore";

type MainTab = "modpacks" | "mods";
const normalizedModName = (fileName: string) =>
  fileName.toLowerCase().endsWith(".disabled")
    ? fileName.slice(0, -".disabled".length)
    : fileName;

const BTD6_TARGET_PACK_KEY = "aster-launcher.btd6-target-pack.v1";
const BTD6_OPEN_PACK_KEY = "aster-launcher.btd6-open-pack.v1";

async function createModpackIconDataUrl(file: File) {
  if (!/^image\/(png|jpeg|webp)$/i.test(file.type) || file.size > 5 * 1024 * 1024) {
    throw new Error("Choose a PNG, JPG or WebP icon up to 5 MB.");
  }
  const source = URL.createObjectURL(file);
  try {
    const image = new window.Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("The selected icon could not be read."));
      image.src = source;
    });
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The icon editor is unavailable.");
    const scale = Math.max(256 / image.naturalWidth, 256 / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    context.drawImage(image, (256 - width) / 2, (256 - height) / 2, width, height);
    return canvas.toDataURL("image/webp", 0.88);
  } finally {
    URL.revokeObjectURL(source);
  }
}

export function Btd6CommunityPage({ mode }: { mode: MainTab }) {
  const { asterAccount: account, notify, setPage, openModal } = useAppStore();
  const [installation, setInstallation] = useState<Btd6Installation | null>(null);
  const [installedMods, setInstalledMods] = useState<Btd6ModFile[]>([]);
  const [communityMods, setCommunityMods] = useState<Btd6CommunityMod[]>([]);
  const [modpacks, setModpacks] = useState<Btd6Modpack[]>(loadBtd6Modpacks);
  const [selectedPackId, setSelectedPackId] = useState<string | null>(() =>
    localStorage.getItem(BTD6_TARGET_PACK_KEY),
  );
  const [localReady, setLocalReady] = useState(false);
  const tab = mode;
  const [sort, setSort] = useState<"recent" | "name">("recent");
  const [query, setQuery] = useState("");
  const [catalogScope, setCatalogScope] = useState<"all" | "yours">("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [catalogBusy, setCatalogBusy] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [updateTarget, setUpdateTarget] = useState<Btd6CommunityMod | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [packEditorOpen, setPackEditorOpen] = useState(() =>
    mode === "modpacks" && Boolean(localStorage.getItem(BTD6_OPEN_PACK_KEY)),
  );
  const [packRiskOpen, setPackRiskOpen] = useState(false);
  const [submitDraft, setSubmitDraft] = useState({
    displayName: "",
    description: "",
    version: "1.0.0",
    iconPath: null as string | null,
  });
  const [createDraft, setCreateDraft] = useState({
    name: "",
    iconDataUrl: null as string | null,
  });
  const createIconInput = useRef<HTMLInputElement>(null);

  const refreshLocal = useCallback(async () => {
    setLocalReady(false);
    const [nextInstallation, nextMods] = await Promise.all([detectBtd6(), listBtd6Mods()]);
    setInstallation(nextInstallation);
    setInstalledMods(nextMods);
    setLocalReady(true);
  }, []);

  const refreshCatalog = useCallback(async () => {
    if (!account) {
      setCommunityMods([]);
      setCatalogError(null);
      setCatalogBusy(false);
      return;
    }
    setCatalogBusy(true);
    setCatalogError(null);
    try {
      setCommunityMods(await loadBtd6CommunityMods(account));
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : String(error));
    } finally {
      setCatalogBusy(false);
    }
  }, [account]);

  useEffect(() => { void refreshLocal(); }, [refreshLocal]);
  useEffect(() => { void refreshCatalog(); }, [refreshCatalog]);
  useEffect(() => {
    if (mode === "modpacks") localStorage.removeItem(BTD6_OPEN_PACK_KEY);
  }, [mode]);
  useEffect(() => {
    if (selectedPackId && modpacks.some((pack) => pack.id === selectedPackId)) {
      localStorage.setItem(BTD6_TARGET_PACK_KEY, selectedPackId);
      return;
    }
    const fallback = modpacks[0]?.id ?? null;
    setSelectedPackId(fallback);
    if (fallback) localStorage.setItem(BTD6_TARGET_PACK_KEY, fallback);
    else localStorage.removeItem(BTD6_TARGET_PACK_KEY);
  }, [modpacks, selectedPackId]);

  useEffect(() => {
    if (!localReady || !installation?.installed) return;
    const available = new Set(
      installedMods
        .filter((mod) => !mod.required)
        .map((mod) => normalizedModName(mod.fileName).toLowerCase()),
    );
    const cleaned = modpacks.map((pack) => ({
      ...pack,
      modFileNames: pack.modFileNames.filter((name) => available.has(name.toLowerCase())),
    }));
    if (cleaned.some((pack, index) => pack.modFileNames.length !== modpacks[index].modFileNames.length)) {
      setModpacks(cleaned);
      saveBtd6Modpacks(cleaned);
    }
  }, [installation?.installed, installedMods, localReady, modpacks]);

  const run = async (operation: () => Promise<unknown>, title: string, message: string) => {
    setBusy(true);
    try {
      const result = await operation();
      if (result === false) return;
      await refreshLocal();
      notify({ title, message, tone: "success" });
    } catch (error) {
      notify({ title: `${title} failed`, message: String(error), tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const filteredCommunity = useMemo(() => {
    const search = query.trim().toLowerCase();
    return communityMods.filter((mod) => {
      if (catalogScope === "yours" && !mod.ownedByCurrentUser) return false;
      if (!search) return true;
      return `${mod.displayName} ${mod.creatorName} ${mod.description} ${mod.version}`
        .toLowerCase()
        .includes(search);
    });
  }, [catalogScope, communityMods, query]);

  const visibleModpacks = useMemo(() => {
    const search = query.trim().toLowerCase();
    const matching = search
      ? modpacks.filter((pack) => pack.name.toLowerCase().includes(search))
      : [...modpacks];
    return matching.sort((left, right) => sort === "name"
      ? left.name.localeCompare(right.name)
      : right.updatedAt.localeCompare(left.updatedAt));
  }, [modpacks, query, sort]);

  const selectedPack = modpacks.find((pack) => pack.id === selectedPackId) ?? null;

  const updateModpacks = (next: Btd6Modpack[]) => {
    setModpacks(next);
    saveBtd6Modpacks(next);
  };

  const openCreateModpack = () => {
    setCreateDraft({ name: `BTD6 Modpack ${modpacks.length + 1}`, iconDataUrl: null });
    setCreateOpen(true);
  };

  const createModpack = () => {
    const name = createDraft.name.trim();
    if (!name) return;
    const now = new Date().toISOString();
    const pack: Btd6Modpack = {
      id: crypto.randomUUID(),
      name,
      iconDataUrl: createDraft.iconDataUrl,
      modFileNames: [],
      createdAt: now,
      updatedAt: now,
    };
    updateModpacks([...modpacks, pack]);
    setSelectedPackId(pack.id);
    setCreateOpen(false);
  };

  const patchSelectedPack = (patch: Partial<Btd6Modpack>) => {
    if (!selectedPack) return;
    updateModpacks(modpacks.map((pack) =>
      pack.id === selectedPack.id
        ? { ...pack, ...patch, updatedAt: new Date().toISOString() }
        : pack,
    ));
  };

  const addModToPack = (packId: string, fileName: string) => {
    const normalized = normalizedModName(fileName);
    setModpacks((current) => {
      const next = current.map((pack) => pack.id === packId
        ? {
            ...pack,
            modFileNames: pack.modFileNames.some((item) => item.toLowerCase() === normalized.toLowerCase())
              ? pack.modFileNames
              : [...pack.modFileNames, normalized],
            updatedAt: new Date().toISOString(),
          }
        : pack);
      saveBtd6Modpacks(next);
      return next;
    });
  };

  const importIntoPack = async (packId: string) => {
    const installedName = await importBtd6Mod(false);
    if (installedName === false) return false;
    const nextMods = await listBtd6Mods();
    setInstalledMods(nextMods);
    addModToPack(packId, installedName);
    return installedName;
  };

  const duplicateSelectedPack = () => {
    if (!selectedPack) return;
    const now = new Date().toISOString();
    const duplicate: Btd6Modpack = {
      ...selectedPack,
      id: crypto.randomUUID(),
      name: `${selectedPack.name} Copy`,
      createdAt: now,
      updatedAt: now,
    };
    updateModpacks([...modpacks, duplicate]);
    setSelectedPackId(duplicate.id);
  };

  const activateModpack = async (pack: Btd6Modpack) => {
    const included = new Set(pack.modFileNames.map((name) => name.toLowerCase()));
    await run(async () => {
      for (const mod of installedMods) {
        const desired = mod.required || included.has(normalizedModName(mod.fileName).toLowerCase());
        if (desired !== mod.enabled) await setBtd6ModEnabled(mod.fileName, desired);
      }
    }, "Modpack activated", `${pack.name} is now the active BTD6 mod set.`);
  };

  const manageCommunityMod = async (mod: Btd6CommunityMod) => {
    if (!account || !selectedPack) {
      notify({
        title: "Choose a modpack first",
        message: modpacks.length
          ? "Select the BTD6 modpack you want to manage."
          : "Create a BTD6 modpack before adding community mods.",
        tone: "warning",
      });
      if (!modpacks.length) openCreateModpack();
      return;
    }
    const installed = installedMods.find(
      (item) => normalizedModName(item.fileName).toLowerCase() === mod.fileName.toLowerCase(),
    );
    const exactVersionInstalled = installed?.sha256 === mod.sha256;
    const included = selectedPack.modFileNames.some(
      (name) => name.toLowerCase() === mod.fileName.toLowerCase(),
    );
    if (exactVersionInstalled && included) {
      localStorage.setItem(BTD6_OPEN_PACK_KEY, selectedPack.id);
      setPage("modpacks");
      return;
    }
    await run(async () => {
      if (!exactVersionInstalled) {
        await installBtd6CommunityMod(account, mod, false);
      }
      addModToPack(selectedPack.id, mod.fileName);
    }, "Modpack updated", `${mod.displayName} is now available in ${selectedPack.name}.`);
  };

  const removeFromSelectedPack = async (mod: Btd6ModFile) => {
    if (!selectedPack) return;
    const normalized = normalizedModName(mod.fileName);
    const next = modpacks.map((pack) => pack.id === selectedPack.id
      ? {
          ...pack,
          modFileNames: pack.modFileNames.filter(
            (name) => name.toLowerCase() !== normalized.toLowerCase(),
          ),
          updatedAt: new Date().toISOString(),
        }
      : pack);
    updateModpacks(next);
    const usedElsewhere = next.some((pack) =>
      pack.modFileNames.some((name) => name.toLowerCase() === normalized.toLowerCase()),
    );
    if (!usedElsewhere) await removeBtd6Mod(mod.fileName);
  };

  const submit = async () => {
    if (!account) {
      notify({ title: "Account required", message: "Sign in before submitting a community mod.", tone: "warning" });
      return;
    }
    if (!submitDraft.displayName.trim()) {
      notify({ title: "Mod name required", message: "Enter the public name of the mod.", tone: "warning" });
      return;
    }
    setBusy(true);
    try {
      const result = updateTarget
        ? await updateBtd6CommunityMod(account, updateTarget, submitDraft)
        : await submitBtd6Mod(account, submitDraft);
      if (!result) return;
      setSubmitOpen(false);
      if (updateTarget) {
        setCommunityMods((mods) => mods.filter((mod) => mod.id !== updateTarget.id));
      }
      setSubmitDraft({ displayName: "", description: "", version: "1.0.0", iconPath: null });
      setUpdateTarget(null);
      notify({
        title: updateTarget ? "Mod update submitted" : "Mod submitted for review",
        message: `${submitDraft.displayName} was scanned and is waiting for synoi to approve ${updateTarget ? "the update" : "it"}.`,
        tone: "success",
      });
    } catch (error) {
      notify({ title: updateTarget ? "Mod update failed" : "Mod submission failed", message: String(error), tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const openSubmitDialog = () => {
    setUpdateTarget(null);
    setSubmitDraft({ displayName: "", description: "", version: "1.0.0", iconPath: null });
    setSubmitOpen(true);
  };

  const openUpdateDialog = (mod: Btd6CommunityMod) => {
    setUpdateTarget(mod);
    setSubmitDraft({
      displayName: mod.displayName,
      description: mod.description,
      version: mod.version,
      iconPath: null,
    });
    setSubmitOpen(true);
  };

  const closeSubmitDialog = () => {
    if (busy) return;
    setSubmitOpen(false);
    setUpdateTarget(null);
  };

  const installedLabel = installation?.installed
    ? `Build ${installation.buildId ?? "Steam"}`
    : "Not detected";

  if (tab === "modpacks" && packEditorOpen && selectedPack) {
    const includedNames = new Set(
      selectedPack.modFileNames.map((name) => name.toLowerCase()),
    );
    const manageableMods = installedMods.filter(
      (mod) => !mod.required && includedNames.has(normalizedModName(mod.fileName).toLowerCase()),
    );
    const managerSearch = query.trim().toLowerCase();
    const visibleMods = managerSearch
      ? manageableMods.filter((mod) =>
          `${mod.displayName} ${mod.fileName}`.toLowerCase().includes(managerSearch),
        )
      : manageableMods;
    const launchSelectedPack = async () => {
      await activateModpack(selectedPack);
      setPackRiskOpen(true);
    };

    const confirmPackLaunch = async () => {
      setBusy(true);
      try {
        await launchBtd6(true, true);
        setPackRiskOpen(false);
        notify({
          title: "Bloons TD 6 launched",
          message: `${selectedPack.name} is active. The account-risk warning was accepted for this launch.`,
          tone: "success",
        });
      } catch (error) {
        notify({ title: "BTD6 launch failed", message: String(error), tone: "error" });
      } finally {
        setBusy(false);
      }
    };

    return (
      <div className="instance-manager btd6-instance-manager">
        <main className="instance-manager-main">
          <header className="instance-content-toolbar">
            <label><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search mods..." /></label>
            <button type="button" className="instance-browse-button" onClick={() => setPage("mods")}>Browse</button>
            <button type="button" className="instance-add-file-button" onClick={() => void run(() => importIntoPack(selectedPack.id), "Mod added", `The scanned DLL was added to ${selectedPack.name}.`)}><Plus size={13} /> Add file</button>
            <button type="button" className="instance-refresh-button" onClick={() => void openBtd6Path("mods")} aria-label="Open mods folder"><FolderOpen size={14} /></button>
          </header>

          <section className="instance-content-list">
            {visibleMods.map((mod) => {
              const catalogMod = communityMods.find(
                (item) => item.sha256.toLowerCase() === mod.sha256.toLowerCase(),
              ) ?? communityMods.find(
                (item) => item.fileName.toLowerCase() === normalizedModName(mod.fileName).toLowerCase(),
              );
              return (
                <article className="instance-content-row" key={mod.fileName}>
                  <div className="instance-content-icon">
                    {catalogMod?.iconUrl
                      ? <img src={catalogMod.iconUrl} alt="" />
                      : <ShieldCheck size={21} />}
                  </div>
                  <div className="instance-content-copy">
                    <h2>{catalogMod?.displayName ?? mod.displayName}</h2>
                    <p>{mod.fileName}</p>
                    <div><span className="enabled">In modpack</span><span>{mod.scanStatus === "passed" ? "Scanned" : "Needs scan"}</span><span>DLL mod</span></div>
                  </div>
                  <button type="button" className="instance-more-button" onClick={() => void run(() => scanBtd6Mod(mod.fileName), "Scan passed", `${mod.displayName} passed the security scan.`)} aria-label={`Scan ${mod.displayName}`}><ScanSearch size={13} /></button>
                  <button type="button" className="instance-remove-button" onClick={() => void run(() => removeFromSelectedPack(mod), "Mod removed", `${mod.displayName} was removed from ${selectedPack.name}.`)} aria-label={`Remove ${mod.displayName} from ${selectedPack.name}`}><Trash2 size={13} /></button>
                </article>
              );
            })}

            {!visibleMods.length && (
              <div className="instance-content-empty">
                <PackageOpen size={25} />
                <strong>{query ? "No matching mods" : "No mods in this modpack"}</strong>
                <span>Browse community projects and add them to this modpack.</span>
                <div><button type="button" onClick={() => setPage("mods")}>Browse content</button><button type="button" className="secondary" onClick={() => void run(() => importIntoPack(selectedPack.id), "Mod added", `The scanned DLL was added to ${selectedPack.name}.`)}><Plus size={12} /> Add local file</button></div>
              </div>
            )}
          </section>
        </main>

        <aside className="instance-manager-sidebar">
          <header>
            <button type="button" className="instance-back-button" onClick={() => { setPackEditorOpen(false); setQuery(""); }}><ArrowLeft size={13} /> Back</button>
            <button type="button" className="instance-sidebar-action" onClick={() => notify({ title: "Modpack name", message: "Click the modpack name below to rename it.", tone: "info" })} aria-label="Edit modpack"><Settings size={14} /></button>
            <button type="button" className="instance-sidebar-action" onClick={() => void refreshLocal()} aria-label="Refresh modpack"><RefreshCw size={14} /></button>
          </header>

          <div className="instance-sidebar-scroll">
            <div className="instance-sidebar-profile">
              <div className="modpack-entry-icon icon-purple">{selectedPack.iconDataUrl ? <img src={selectedPack.iconDataUrl} alt="" /> : <Layers3 size={24} />}</div>
              <div><input className="btd6-manager-name" value={selectedPack.name} maxLength={50} onChange={(event) => patchSelectedPack({ name: event.target.value })} /><p>Bloons TD 6 · {selectedPack.modFileNames.length} mods</p></div>
            </div>

            <div className="instance-sidebar-heading"><span>Instance</span><button type="button" onClick={() => void run(() => importIntoPack(selectedPack.id), "Mod added", `The scanned DLL was added to ${selectedPack.name}.`)}><Plus size={12} /></button></div>
            <button type="button" className="instance-content-root active"><Layers3 size={14} /> Content</button>
            <nav className="instance-content-nav" aria-label="BTD6 modpack content">
              <button type="button" className="active"><i /><Puzzle size={12} /><span>Mods</span><small>{selectedPack.modFileNames.length}</small></button>
            </nav>
            <div className="instance-sidebar-separator" />
            <button type="button" className="instance-sidebar-link" onClick={() => void openBtd6Path("mods")}><FolderOpen size={14} /><span>Mods folder</span></button>
          </div>

          <div className="instance-sidebar-footer">
            <div className="instance-sidebar-utilities">
              <button type="button" onClick={duplicateSelectedPack}><Copy size={12} /> Duplicate</button>
              <button type="button" className="danger" onClick={() => { updateModpacks(modpacks.filter((pack) => pack.id !== selectedPack.id)); setSelectedPackId(null); setPackEditorOpen(false); }}><Trash2 size={12} /> Delete</button>
            </div>
            <button type="button" className="instance-sidebar-launch" disabled={busy || !installation?.installed} onClick={() => void launchSelectedPack()}>
              <span className="instance-launch-icon"><Play size={17} fill="currentColor" /></span>
              <span><strong>Launch game</strong><small>{installation?.installed ? "Modpack ready" : "BTD6 not detected"}</small></span>
              <ChevronRight size={16} />
            </button>
          </div>
        </aside>

        {packRiskOpen && <Btd6RiskDialog modCount={selectedPack.modFileNames.length} busy={busy} onCancel={() => setPackRiskOpen(false)} onConfirm={() => void confirmPackLaunch()} />}
      </div>
    );
  }

  return (
    <section className={`mods-browser btd6-mod-browser btd6-community-page ${tab === "modpacks" ? "is-modpacks" : ""}`}>
      <div className="mods-browser-main">
        {tab === "mods" && modpacks.length > 0 && (
          <div className="mods-install-target btd6-install-target btd6-pack-target">
            <span><Layers3 size={13} /> Managing modpack</span>
            <select
              value={selectedPack?.id ?? ""}
              aria-label="Choose a BTD6 modpack"
              onChange={(event) => setSelectedPackId(event.target.value)}
            >
              {modpacks.map((pack) => <option key={pack.id} value={pack.id}>{pack.name}</option>)}
            </select>
            <small>Bloons TD 6 · {selectedPack?.modFileNames.length ?? 0} mods</small>
            <button type="button" onClick={() => {
              if (!selectedPack) return;
              localStorage.setItem(BTD6_OPEN_PACK_KEY, selectedPack.id);
              setPage("modpacks");
            }}>Manage</button>
          </div>
        )}

        {tab === "mods" && modpacks.length === 0 && (
          <div className="mods-install-target mods-install-target-picker btd6-pack-target empty">
            <span><Layers3 size={13} /> Add downloads to</span>
            <strong>Create your first BTD6 modpack</strong>
            <button type="button" onClick={openCreateModpack}><Plus size={12} /> Create modpack</button>
          </div>
        )}

        {tab === "mods" ? (
          <>
            <div className="mods-toolbar btd6-browser-toolbar">
              <label className="mods-search">
                <Search size={14} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search community mods..." />
              </label>
              <div className="mods-filter-control">
                <button type="button" className={`mods-filter-button ${filterOpen || catalogScope !== "all" ? "active" : ""}`} aria-label="Filter community mods" aria-expanded={filterOpen} onClick={() => setFilterOpen((value) => !value)}><Filter size={14} />{catalogScope !== "all" && <span>1</span>}</button>
                {filterOpen && (
                  <div className="mods-sort-menu btd6-catalog-filter">
                    <header><strong>SHOW MODS</strong></header>
                    <button type="button" className={catalogScope === "all" ? "active" : ""} onClick={() => { setCatalogScope("all"); setFilterOpen(false); }}><span>All mods</span>{catalogScope === "all" && <Check size={12} />}</button>
                    <button type="button" className={catalogScope === "yours" ? "active" : ""} onClick={() => { setCatalogScope("yours"); setFilterOpen(false); }}><span>Your mods</span>{catalogScope === "yours" && <Check size={12} />}</button>
                  </div>
                )}
              </div>
              <span className="mods-result-count">{filteredCommunity.length.toLocaleString()} projects</span>
              <div className="btd6-browser-actions">
                <button type="button" className="import" onClick={() => selectedPack && void run(() => importIntoPack(selectedPack.id), "Mod added", `The scanned DLL was added to ${selectedPack.name}.`)} disabled={busy || !installation?.installed || !selectedPack}><Download size={13} /> Import mod</button>
                <button type="button" onClick={() => account ? openSubmitDialog() : openModal("aster-auth")} disabled={busy}><UploadCloud size={13} /> Submit mod</button>
              </div>
            </div>

            <div className="mods-result-list btd6-browser-list">
              {!account && (
                <div className="mods-provider-state"><UserRound size={23} /><strong>Sign in to browse community mods</strong><span>Your Aster account is separate from Microsoft and works across every supported game.</span><button type="button" onClick={() => openModal("aster-auth")}><LogIn size={12} /> Sign in / Register</button></div>
              )}
              {filteredCommunity.map((mod) => {
                const installedFile = installedMods.find((item) => normalizedModName(item.fileName).toLowerCase() === mod.fileName.toLowerCase());
                const exactVersionInstalled = installedFile?.sha256 === mod.sha256;
                const installedInSelectedPack = Boolean(
                  exactVersionInstalled
                  && selectedPack?.modFileNames.some(
                    (name) => name.toLowerCase() === mod.fileName.toLowerCase(),
                  ),
                );
                const updateAvailable = Boolean(installedFile && !exactVersionInstalled);
                return (
                  <article className="mod-result-row btd6-mod-row btd6-community-row" key={mod.id}>
                    <span className="mod-result-icon btd6-community-icon">
                      {mod.iconUrl ? <img src={mod.iconUrl} alt="" /> : <Puzzle size={23} />}
                    </span>
                    <div className="mod-result-copy">
                      <small className="btd6-community-creator">by {mod.creatorName}</small>
                      <h2>{mod.displayName}<small>v{mod.version}</small></h2>
                      <p>{mod.description || "Community BTD6 mod approved for the Aster catalog."}</p>
                    </div>
                    <div className="btd6-community-install">
                      <button type="button" className={installedInSelectedPack ? "installed" : ""} disabled={busy || !installation?.installed || !account || !selectedPack} onClick={() => void manageCommunityMod(mod)} title={installedInSelectedPack ? `Open ${selectedPack?.name ?? "modpack"}` : updateAvailable ? `Update ${mod.displayName} in ${selectedPack?.name ?? "a modpack"}` : `Install ${mod.displayName} into ${selectedPack?.name ?? "a modpack"}`}>
                        {installedInSelectedPack ? <Check size={12} /> : <Download size={12} />}
                        {installedInSelectedPack ? "INSTALLED" : "INSTALL"}
                      </button>
                      {mod.ownedByCurrentUser && (
                        <button type="button" className="owner-update" disabled={busy || !account} onClick={() => openUpdateDialog(mod)} title={`Upload a new version of ${mod.displayName}`}>
                          <RefreshCw size={12} /> UPDATE
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}

              {account && !catalogBusy && !catalogError && !filteredCommunity.length && (
                <div className="mods-provider-state"><Puzzle size={23} /><strong>{catalogScope === "yours" ? "You have no approved mods" : "No approved community mods yet"}</strong><span>{catalogScope === "yours" ? "Your approved submissions will appear in this view." : "Submitted mods appear here after synoi approves them."}</span></div>
              )}
              {catalogBusy && (
                <div className="mods-provider-state"><RefreshCw className="spin" size={23} /><strong>Loading community catalog</strong><span>Checking approved BTD6 mods…</span></div>
              )}
              {catalogError && (
                <div className="mods-provider-state error"><AlertTriangle size={23} /><strong>Community catalog unavailable</strong><span>{catalogError}</span><button type="button" onClick={() => void refreshCatalog()}><RefreshCw size={12} /> Try again</button></div>
              )}
            </div>
          </>
        ) : (
          <div className="my-modpacks btd6-my-modpacks">
            <header className="modpacks-toolbar">
              <div className="modpacks-title"><h1>My Modpacks</h1><span>{modpacks.length} profiles</span></div>
              <label className="modpacks-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search modpacks..." /></label>
              <button type="button" className="modpacks-tool-control" onClick={() => setSort(sort === "recent" ? "name" : "recent")}><ArrowDownUp size={12} />{sort === "recent" ? "Recent" : "Name"}</button>
              <span className="modpacks-toolbar-spacer" />
              <button type="button" className="modpacks-create-button" onClick={openCreateModpack}><Plus size={14} /> Create</button>
            </header>

            <section className="modpack-entry-grid" aria-label="BTD6 modpacks">
              {visibleModpacks.map((pack, index) => (
                <article className="modpack-entry" key={pack.id} role="button" tabIndex={0} onClick={() => { setSelectedPackId(pack.id); setPackEditorOpen(true); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { setSelectedPackId(pack.id); setPackEditorOpen(true); } }}>
                  <div className={`modpack-entry-icon icon-${index % 2 === 0 ? "purple" : "green"}`}>{pack.iconDataUrl ? <img src={pack.iconDataUrl} alt="" /> : <Layers3 size={25} />}</div>
                  <div className="modpack-entry-copy">
                    <h2>{pack.name}</h2>
                    <p><span>Bloons TD 6</span><i /><span>{pack.modFileNames.length} mods</span><i /><span>Local</span></p>
                    <small className="instance-state state-ready"><Check size={11} />Ready<b>·</b><span>Open to manage mods</span></small>
                  </div>
                  <div className="modpack-quick-actions">
                    <button type="button" onClick={(event) => { event.stopPropagation(); setSelectedPackId(pack.id); setPackEditorOpen(true); }} aria-label={`Open ${pack.name}`}><Settings size={13} /></button>
                    <button type="button" onClick={(event) => { event.stopPropagation(); setSelectedPackId(pack.id); void activateModpack(pack); }} aria-label={`Activate ${pack.name}`}><Play size={12} fill="currentColor" /></button>
                  </div>
                </article>
              ))}
            </section>

            {!visibleModpacks.length && (
              <div className="modpacks-empty"><PackageOpen size={22} /><strong>{modpacks.length ? "No matching modpacks" : "No modpacks created"}</strong><span>{modpacks.length ? "Clear the search to show your BTD6 profiles." : "Create a profile containing its own selection of BTD6 mods."}</span>{!modpacks.length && <button type="button" className="modpacks-create-button" onClick={openCreateModpack}><Plus size={13} /> Create Modpack</button>}</div>
            )}
          </div>
        )}
      </div>

      {tab === "mods" && <aside className="mods-filters btd6-browser-sidebar">
        <section className="filter-collapsible"><button type="button" className={`filter-section-button game-versions-button ${statusOpen ? "open" : ""}`} aria-expanded={statusOpen} onClick={() => setStatusOpen((value) => !value)}><span>BTD6 STATUS</span><ChevronDown size={12} /></button>{statusOpen && <div className="btd6-filter-content"><div><small>GAME</small><strong>{installedLabel}</strong><i className={installation?.installed ? "ready" : "missing"} /></div><div><small>PRIVATE LOADER</small><strong>{installation?.melonLoaderReady ? "Ready" : "Install on launch"}</strong><i className={installation?.melonLoaderReady ? "ready" : "pending"} /></div><div><small>MOD HELPER</small><strong>{installation?.modHelperInstalled ? "Installed" : "Added automatically"}</strong><i className={installation?.modHelperInstalled ? "ready" : "pending"} /></div></div>}</section>
        <div className="btd6-sidebar-tools"><button type="button" onClick={() => void run(repairBtd6Runtime, "Runtime repaired", "The private BTD6 runtime is ready.")} disabled={busy || !installation?.installed}><Wrench size={12} /> Repair runtime</button><button type="button" onClick={() => void openBtd6Path("mods")} disabled={!installation?.installed}><FolderOpen size={12} /> Open folder</button><button type="button" onClick={() => { void refreshLocal(); void refreshCatalog(); }} disabled={busy}><RefreshCw size={12} /> Refresh</button></div>
      </aside>}

      {createOpen && (
        <div className="modpack-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setCreateOpen(false)}>
          <form className="modpack-dialog btd6-create-modpack-dialog" onSubmit={(event) => { event.preventDefault(); createModpack(); }}>
            <button type="button" className="modpack-dialog-close" onClick={() => setCreateOpen(false)} aria-label="Close"><X size={15} /></button>
            <header><span><Layers3 size={18} /></span><div><h2>Create modpack</h2><p>Create an isolated Bloons TD 6 mod profile.</p></div></header>
            <div className="modpack-icon-picker">
              <div className="modpack-icon-preview">{createDraft.iconDataUrl ? <img src={createDraft.iconDataUrl} alt="" /> : <Layers3 size={22} />}</div>
              <div><strong>Modpack icon</strong><span>PNG, JPG or WebP · max. 5 MB</span></div>
              <button type="button" onClick={() => createIconInput.current?.click()}>{createDraft.iconDataUrl ? "Change icon" : "Choose icon"}</button>
              <input
                ref={createIconInput}
                className="visually-hidden"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  void createModpackIconDataUrl(file)
                    .then((iconDataUrl) => setCreateDraft((draft) => ({ ...draft, iconDataUrl })))
                    .catch((error) => notify({ title: "Icon unavailable", message: String(error), tone: "error" }));
                }}
              />
            </div>
            <label><span>Name</span><input autoFocus value={createDraft.name} maxLength={48} placeholder="My Modpack" onChange={(event) => setCreateDraft((draft) => ({ ...draft, name: event.target.value }))} /></label>
            <div className="modpack-dialog-fields">
              <label><span>Game</span><select value="Bloons TD 6" disabled><option>Bloons TD 6</option></select></label>
              <label><span>Mod loader</span><select value="MelonLoader" disabled><option>MelonLoader</option></select></label>
            </div>
            <footer><button type="button" onClick={() => setCreateOpen(false)}>Cancel</button><button type="submit" className="primary" disabled={!createDraft.name.trim()}>Create modpack</button></footer>
          </form>
        </div>
      )}

      {submitOpen && (
        <div className="btd6-submit-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeSubmitDialog()}>
          <form className="btd6-submit-dialog" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
            <header><span>{updateTarget ? <RefreshCw size={19} /> : <UploadCloud size={19} />}</span><div><small>{updateTarget ? "CREATOR UPDATE" : "COMMUNITY UPLOAD"}</small><strong>{updateTarget ? `Update ${updateTarget.displayName}` : "Submit a BTD6 mod"}</strong><p>The new DLL is scanned and stays hidden until synoi approves {updateTarget ? "the update" : "it"}.</p></div><button type="button" onClick={closeSubmitDialog} aria-label="Close"><X size={14} /></button></header>
            <label><span>MOD NAME</span><input value={submitDraft.displayName} maxLength={120} required placeholder="Public mod name" onChange={(event) => setSubmitDraft((draft) => ({ ...draft, displayName: event.target.value }))} /></label>
            <label className="version"><span>VERSION</span><input value={submitDraft.version} maxLength={32} required placeholder="1.0.0" onChange={(event) => setSubmitDraft((draft) => ({ ...draft, version: event.target.value }))} /></label>
            <label className="description"><span>DESCRIPTION</span><textarea value={submitDraft.description} maxLength={600} rows={4} placeholder="What does this mod do?" onChange={(event) => setSubmitDraft((draft) => ({ ...draft, description: event.target.value }))} /><small>{submitDraft.description.length}/600</small></label>
            <div className="btd6-icon-picker"><span><Image size={18} /></span><div><strong>{submitDraft.iconPath ? submitDraft.iconPath.replace(/^.*[\\/]/, "") : updateTarget?.iconStoragePath ? "Keep current icon" : "No icon selected"}</strong><small>{updateTarget ? "Choose a file only to replace the current icon" : "PNG, JPG or WEBP · maximum 5 MB"}</small></div><button type="button" onClick={() => void chooseBtd6ModIcon().then((iconPath) => iconPath && setSubmitDraft((draft) => ({ ...draft, iconPath })))}>CHOOSE ICON</button></div>
            <footer><span>The DLL file picker opens after you press {updateTarget ? "update" : "submit"}.</span><button type="button" onClick={closeSubmitDialog}>CANCEL</button><button type="submit" className="primary" disabled={busy}>{busy ? <RefreshCw className="spin" size={13} /> : updateTarget ? <RefreshCw size={13} /> : <UploadCloud size={13} />}{busy ? "SCANNING…" : updateTarget ? "CHOOSE DLL & UPDATE" : "CHOOSE DLL & SUBMIT"}</button></footer>
          </form>
        </div>
      )}
    </section>
  );
}
