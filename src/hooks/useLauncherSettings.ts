import { useSyncExternalStore } from "react";
import {
  getLauncherSettings,
  subscribeLauncherSettings,
} from "../services/settings";

export function useLauncherSettings() {
  return useSyncExternalStore(
    subscribeLauncherSettings,
    getLauncherSettings,
    getLauncherSettings,
  );
}
