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
  official?: boolean;
  systemProfile?: "aster-1.20.1";
  sharedModpackId?: string;
  sharedRevision?: number;
  sharedLatestRevision?: number;
  sharedOwnerName?: string;
}

export const MODPACK_LIBRARY_STORAGE_KEY = "aster.modpacks.v1";
export const MODPACK_LIBRARY_EVENT = "aster:modpack-library-changed";
export const ASTER_1201_INSTANCE_ID = "aster-1-20-1";

export const ASTER_1201_PROFILE: InstalledModpack = {
  id: ASTER_1201_INSTANCE_ID,
  name: "Aster 1.20.1",
  version: "1.20.1",
  loader: "Fabric",
  lastPlayed: "Never played",
  status: "ready",
  favorite: true,
  icon: "sparkles",
  tone: "violet",
  provider: "Local",
  official: true,
  systemProfile: "aster-1.20.1",
};

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

export function ensureOfficialAsterProfiles(
  library: InstalledModpack[],
): InstalledModpack[] {
  const existing = library.find((item) => item.id === ASTER_1201_INSTANCE_ID);
  if (!existing) return [ASTER_1201_PROFILE, ...library];

  return library.map((item) =>
    item.id === ASTER_1201_INSTANCE_ID
      ? {
          ...ASTER_1201_PROFILE,
          ...item,
          id: ASTER_1201_INSTANCE_ID,
          name: ASTER_1201_PROFILE.name,
          version: ASTER_1201_PROFILE.version,
          loader: ASTER_1201_PROFILE.loader,
          official: true,
          systemProfile: "aster-1.20.1",
        }
      : item,
  );
}

export function normalizePersistedModpackLibrary(
  library: InstalledModpack[],
): InstalledModpack[] {
  return ensureOfficialAsterProfiles(library).map((item) =>
    item.status === "running" || item.status === "updating"
      ? { ...item, status: "ready" }
      : item,
  );
}

export function readModpackLibrary(): InstalledModpack[] {
  try {
    const saved = localStorage.getItem(MODPACK_LIBRARY_STORAGE_KEY);
    if (!saved) return [ASTER_1201_PROFILE];
    const value: unknown = JSON.parse(saved);
    return normalizePersistedModpackLibrary(
      Array.isArray(value) ? value.filter(isInstalledModpack) : [],
    );
  } catch {
    return [ASTER_1201_PROFILE];
  }
}

export function writeModpackLibrary(library: InstalledModpack[]) {
  const serialized = JSON.stringify(normalizePersistedModpackLibrary(library));
  if (localStorage.getItem(MODPACK_LIBRARY_STORAGE_KEY) === serialized) return;
  localStorage.setItem(MODPACK_LIBRARY_STORAGE_KEY, serialized);
  window.dispatchEvent(new Event(MODPACK_LIBRARY_EVENT));
}

export function addInstalledModpack(item: InstalledModpack) {
  const current = readModpackLibrary();
  const next = [item, ...current.filter((entry) => entry.id !== item.id)];
  writeModpackLibrary(next);
}

export function updateInstalledModpack(
  id: string,
  patch: Partial<InstalledModpack>,
) {
  writeModpackLibrary(
    readModpackLibrary().map((item) =>
      item.id === id ? { ...item, ...patch } : item,
    ),
  );
}

export function hasSharedModpackUpdate(item: InstalledModpack) {
  return Boolean(
    item.sharedModpackId &&
      item.sharedLatestRevision &&
      item.sharedLatestRevision > (item.sharedRevision ?? 0),
  );
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
