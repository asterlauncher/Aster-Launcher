import { describe, expect, it } from "vitest";
import { getAsterInstallConflict } from "./asterProfiles";
import {
  ASTER_1201_PROFILE,
  ensureOfficialAsterProfiles,
  normalizePersistedModpackLibrary,
  type InstalledModpack,
} from "./modpackLibrary";

const custom: InstalledModpack = {
  ...ASTER_1201_PROFILE,
  id: "custom-one",
  name: "Custom",
  official: false,
  systemProfile: undefined,
};

describe("official Aster profiles", () => {
  it("adds Aster 1.20.1 without removing user instances", () => {
    const result = ensureOfficialAsterProfiles([custom]);
    expect(result.map((item) => item.id)).toEqual(["aster-1-20-1", "custom-one"]);
  });

  it("repairs protected identity fields while preserving play history", () => {
    const result = ensureOfficialAsterProfiles([
      { ...ASTER_1201_PROFILE, name: "Renamed", lastPlayed: "Yesterday" },
    ]);
    expect(result[0]).toMatchObject({
      name: "Aster 1.20.1",
      version: "1.20.1",
      loader: "Fabric",
      lastPlayed: "Yesterday",
      official: true,
    });
  });

  it("never restores stale launch activity after the launcher reopens", () => {
    const result = normalizePersistedModpackLibrary([
      { ...ASTER_1201_PROFILE, status: "running" },
      { ...custom, status: "updating" },
    ]);
    expect(result.map((item) => item.status)).toEqual(["ready", "ready"]);
  });
});

describe("Aster content conflicts", () => {
  it("blocks optimization projects in the official profile", () => {
    expect(
      getAsterInstallConflict("aster-1.20.1", "Mods", {
        id: "some-project",
        name: "Fast Renderer",
        categories: ["optimization"],
      }),
    ).toContain("cannot be installed");
  });

  it("allows gameplay mods and shader packs", () => {
    expect(
      getAsterInstallConflict("aster-1.20.1", "Mods", {
        id: "gameplay",
        name: "New Biomes",
        categories: ["adventure"],
      }),
    ).toBeNull();
    expect(
      getAsterInstallConflict("aster-1.20.1", "Shaders", {
        id: "shader-pack",
        name: "A Pretty Shaderpack",
        categories: ["performance"],
      }),
    ).toBeNull();
  });
});
