export type ModpackStatus =
  | "ready"
  | "updating"
  | "broken"
  | "missing-loader"
  | "running";

export type ModpackIcon =
  | "tree"
  | "zap"
  | "sparkles"
  | "pickaxe"
  | "package"
  | "game"
  | "archive";

export interface InstalledModpack {
  id: string;
  name: string;
  version: string;
  loader: string;
  lastPlayed: string;
  status: ModpackStatus;
  favorite: boolean;
  icon: ModpackIcon;
  tone: string;
  iconUrl?: string;
  provider?: "Modrinth" | "CurseForge" | "Local";
  projectId?: string;
  releaseId?: string;
}

export const MODPACK_LIBRARY_STORAGE_KEY = "aster.modpacks.v1";
export const MODPACK_LIBRARY_EVENT = "aster:modpack-library-changed";

const legacyDemoIds = new Set([
  "better-minecraft",
  "aster-performance",
  "arcane-depths",
  "create-perfect",
  "vanilla-plus",
  "pixelmon",
]);

function isInstalledModpack(value: unknown): value is InstalledModpack {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "name" in value &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    !legacyDemoIds.has(value.id)
  );
}

export function readModpackLibrary(): InstalledModpack[] {
  try {
    const saved = localStorage.getItem(MODPACK_LIBRARY_STORAGE_KEY);
    if (!saved) return [];
    const value: unknown = JSON.parse(saved);
    return Array.isArray(value) ? value.filter(isInstalledModpack) : [];
  } catch {
    return [];
  }
}

export function writeModpackLibrary(library: InstalledModpack[]) {
  const serialized = JSON.stringify(library);
  if (localStorage.getItem(MODPACK_LIBRARY_STORAGE_KEY) === serialized) return;
  localStorage.setItem(MODPACK_LIBRARY_STORAGE_KEY, serialized);
  window.dispatchEvent(new Event(MODPACK_LIBRARY_EVENT));
}

export function addInstalledModpack(item: InstalledModpack) {
  const current = readModpackLibrary();
  const next = [item, ...current.filter((entry) => entry.id !== item.id)];
  writeModpackLibrary(next);
}

export function subscribeModpackLibrary(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === MODPACK_LIBRARY_STORAGE_KEY) listener();
  };
  window.addEventListener(MODPACK_LIBRARY_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(MODPACK_LIBRARY_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}
