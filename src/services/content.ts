import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./auth";

export type ContentProvider = "Modrinth" | "CurseForge";
export type ContentType =
  | "Modpacks"
  | "Mods"
  | "Resourcepacks"
  | "Shaders"
  | "Datapacks";
export type ContentSort = "relevance" | "downloads" | "updated" | "newest";

export interface ContentProject {
  id: string;
  name: string;
  author: string;
  description: string;
  categories: string[];
  downloads: number;
  provider: ContentProvider;
  versions: string[];
  iconUrl: string | null;
  projectUrl: string;
}

export interface ContentSearchResult {
  projects: ContentProject[];
  total: number;
}

export interface ContentRelease {
  id: string;
  displayName: string;
  versionNumber: string;
  gameVersions: string[];
  loaders: string[];
  dependencyCount: number;
  fileName: string;
  downloadUrl: string | null;
  fileSize: number;
}

export interface ContentReleasePage {
  releases: ContentRelease[];
  total: number;
}

export interface ResolvedContentFile {
  projectId: string;
  releaseId: string;
  name: string;
  versionNumber: string;
  fileName: string;
  downloadUrl: string;
  iconUrl: string | null;
  isDependency: boolean;
}

export interface ContentInstallPlan {
  files: ResolvedContentFile[];
  dependencyCount: number;
}

export interface ContentError {
  code: string;
  message: string;
}

export async function searchContent(
  provider: ContentProvider,
  contentType: ContentType,
  query: string,
  gameVersion: string,
  category: string | null,
  loader: string | null,
  sort: ContentSort,
  offset = 0,
  limit = 30,
): Promise<ContentSearchResult> {
  if (!isTauriRuntime()) {
    throw {
      code: "native_required",
      message: "Live content browsing is available in the native launcher.",
    } satisfies ContentError;
  }

  return invoke<ContentSearchResult>("search_content", {
    provider: provider.toLowerCase(),
    contentType: contentType.toLowerCase(),
    query,
    gameVersion: gameVersion || null,
    category,
    loader,
    sort,
    offset,
    limit,
  });
}

export async function getContentReleases(
  provider: ContentProvider,
  projectId: string,
  gameVersion: string,
  offset: number,
  limit = 2,
): Promise<ContentReleasePage> {
  return invoke<ContentReleasePage>("get_content_releases", {
    provider: provider.toLowerCase(),
    projectId,
    gameVersion: gameVersion || null,
    offset,
    limit,
  });
}

export async function resolveContentInstall(
  provider: ContentProvider,
  projectId: string,
  releaseId: string,
  gameVersion: string,
  loader: string,
): Promise<ContentInstallPlan> {
  return invoke<ContentInstallPlan>("resolve_content_install", {
    provider: provider.toLowerCase(),
    projectId,
    releaseId,
    gameVersion,
    loader,
  });
}

export async function openContentProject(projectUrl: string): Promise<void> {
  return invoke<void>("open_content_project", { projectUrl });
}

export function normalizeContentError(error: unknown): ContentError {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    typeof error.code === "string" &&
    typeof error.message === "string"
  ) {
    return { code: error.code, message: error.message };
  }

  return {
    code: "internal",
    message: "The content search could not be completed.",
  };
}

export function formatDownloads(value: number) {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}
