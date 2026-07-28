export type PageId =
  | "home"
  | "modpacks"
  | "mods"
  | "store"
  | "settings";

export type InstanceStatus =
  | "ready"
  | "installing"
  | "updating"
  | "launching"
  | "failed"
  | "missing-java"
  | "conflict";

export interface GameInstance {
  id: string;
  name: string;
  subtitle: string;
  version: string;
  loader: "Fabric" | "Forge" | "NeoForge" | "Vanilla";
  mods: number;
  lastPlayed: string;
  playtime: string;
  status: InstanceStatus;
  progress?: number;
  accent: string;
}

export interface NewsItem {
  id: string;
  category: string;
  title: string;
  summary: string;
  date: string;
  tone: "violet" | "blue" | "ember" | "jade";
}

export interface CatalogItem {
  id: string;
  title: string;
  author: string;
  type: "Modpack" | "Mod";
  description: string;
  downloads: string;
  version: string;
  tags: string[];
  installed?: boolean;
  conflict?: boolean;
  tone: string;
}

export interface DownloadItem {
  id: string;
  title: string;
  detail: string;
  status: "downloading" | "queued" | "paused" | "failed" | "complete";
  progress: number;
  speed?: string;
  remaining?: string;
}

export type ModalKind =
  | "add-account"
  | "manage-account"
  | "aster-subscription"
  | "installation-failure"
  | "mod-conflict"
  | "missing-java"
  | null;

export interface Toast {
  id: number;
  title: string;
  message: string;
  tone: "success" | "info" | "warning" | "error";
}

export interface LauncherNotification {
  id: string;
  title: string;
  message: string;
  tone: "success" | "info" | "warning" | "error";
  source: "system" | "download" | "account";
  createdAt: string;
  read: boolean;
  action?: {
    label: string;
    page?: PageId;
    modal?: Exclude<ModalKind, null>;
  };
}

export type NewLauncherNotification = Omit<
  LauncherNotification,
  "id" | "createdAt" | "read"
> &
  Partial<Pick<LauncherNotification, "id" | "createdAt" | "read">>;
