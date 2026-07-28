import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_LAUNCHER_SETTINGS,
  getLauncherSettings,
  resetLauncherSettings,
  subscribeLauncherSettings,
  updateLauncherSettings,
} from "./settings";

describe("launcher settings", () => {
  afterEach(() => {
    resetLauncherSettings();
  });

  it("updates functional toggles and publishes one change", () => {
    let notifications = 0;
    const unsubscribe = subscribeLauncherSettings(() => {
      notifications += 1;
    });

    updateLauncherSettings({
      automaticUpdateChecks: false,
      activityNotifications: false,
      socialNotifications: false,
      onlinePresence: false,
      reducedMotion: true,
    });
    unsubscribe();

    expect(getLauncherSettings()).toMatchObject({
      automaticUpdateChecks: false,
      activityNotifications: false,
      socialNotifications: false,
      onlinePresence: false,
      reducedMotion: true,
    });
    expect(notifications).toBe(1);
  });

  it("keeps Minecraft memory inside the supported range", () => {
    updateLauncherSettings({ memoryGb: 128 });
    expect(getLauncherSettings().memoryGb).toBe(24);

    updateLauncherSettings({ memoryGb: -10 });
    expect(getLauncherSettings().memoryGb).toBe(2);
  });

  it("restores all Aster defaults", () => {
    updateLauncherSettings({
      automaticUpdateChecks: false,
      memoryGb: 12,
    });
    resetLauncherSettings();

    expect(getLauncherSettings()).toEqual(DEFAULT_LAUNCHER_SETTINGS);
  });
});
