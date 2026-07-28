import { useCallback, useEffect, useRef, useState } from "react";
import {
  isPresenceConfigured,
  leaveLauncherPresence,
  sendPresenceHeartbeat,
  type PresenceSnapshot,
} from "../services/presence";

const heartbeatIntervalMs = 30_000;

const initialSnapshot: PresenceSnapshot = isPresenceConfigured
  ? {
      onlineCount: null,
      status: "connecting",
      updatedAt: null,
      message: "Connecting to launcher presence...",
    }
  : {
      onlineCount: null,
      status: "unconfigured",
      updatedAt: null,
      message: "Presence service is not configured.",
    };

export function useLauncherPresence() {
  const [snapshot, setSnapshot] = useState<PresenceSnapshot>(initialSnapshot);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const nextSnapshot = await sendPresenceHeartbeat();
    if (mounted.current) {
      setSnapshot(nextSnapshot);
      setRefreshing(false);
    }
    return nextSnapshot;
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();

    const heartbeat = window.setInterval(() => {
      void refresh();
    }, heartbeatIntervalMs);

    const reconnect = () => void refresh();
    window.addEventListener("online", reconnect);

    return () => {
      mounted.current = false;
      window.clearInterval(heartbeat);
      window.removeEventListener("online", reconnect);
      void leaveLauncherPresence();
    };
  }, [refresh]);

  return {
    ...snapshot,
    refreshing,
    refresh,
  };
}
