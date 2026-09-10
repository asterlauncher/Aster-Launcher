import type { ContentProject, ContentType } from "./content";
import type { InstalledModpack } from "./modpackLibrary";

const protectedProjectIds = new Set([
  "aster-client", // Built-in Aster menu and client integration
  "AANobbMI", // Sodium
  "gvQqBUqZ", // Lithium
  "uXXizFIs", // FerriteCore
  "5ZwdcRci", // ImmediatelyFast
  "YL57xq9U", // Iris
  "Orvt0mRa", // Indium
]);

const conflictingNameFragments = [
  "sodium",
  "lithium",
  "ferritecore",
  "ferrite core",
  "immediatelyfast",
  "immediately fast",
  "iris shaders",
  "iris shader",
  "optifine",
  "optifabric",
  "oculus",
  "embeddium",
  "rubidium",
  "canvas renderer",
  "vulkanmod",
  "vulkan mod",
  "nvidium",
  "entity culling",
  "modernfix",
  "modern fix",
  "starlight",
  "phosphor",
  "c2me",
  "sodium extra",
  "reeses sodium",
];

export function isOfficialAsterProfile(
  instance: Pick<InstalledModpack, "systemProfile"> | null | undefined,
): boolean {
  return instance?.systemProfile === "aster-1.20.1";
}

export function getAsterInstallConflict(
  systemProfile: InstalledModpack["systemProfile"] | undefined,
  contentType: ContentType,
  project: Pick<ContentProject, "id" | "name" | "categories">,
): string | null {
  if (systemProfile !== "aster-1.20.1" || contentType !== "Mods") return null;

  const normalizedName = project.name.toLowerCase();
  const normalizedCategories = project.categories.map((category) =>
    category.toLowerCase(),
  );
  const conflicts =
    protectedProjectIds.has(project.id) ||
    normalizedCategories.some((category) =>
      ["optimization", "performance", "shader", "shaders"].includes(category),
    ) ||
    conflictingNameFragments.some((fragment) =>
      normalizedName.includes(fragment),
    );

  if (!conflicts) return null;
  return `${project.name} cannot be installed into Aster 1.20.1. This official profile already includes a tested performance and shader stack, so overlapping renderer or optimization mods are blocked.`;
}
