import { useEffect, useRef } from "react";
import {
  loadRecentSocialMessages,
  loadSocialSnapshot,
} from "../services/social";
import { useAppStore } from "../store/AppStore";
import { useLauncherSettings } from "../hooks/useLauncherSettings";

const SEEN_REQUESTS_KEY = "aster-social.seen-requests.v1";
const SEEN_MESSAGES_KEY = "aster-social.seen-messages.v1";

function loadSeen(key: string) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "[]") as unknown;
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string")
        : [],
    );
  } catch {
    return new Set<string>();
  }
}

function saveSeen(key: string, values: Set<string>) {
  window.localStorage.setItem(
    key,
    JSON.stringify([...values].slice(-200)),
  );
}

export function SocialNotificationBridge() {
  const settings = useLauncherSettings();
  const { account, loggedIn, pushNotification } = useAppStore();
  const initializedMessages = useRef(false);

  useEffect(() => {
    if (
      !account ||
      !loggedIn ||
      !settings.activityNotifications ||
      !settings.socialNotifications
    ) {
      return;
    }
    let disposed = false;

    const poll = async () => {
      try {
        const [snapshot, recentMessages] = await Promise.all([
          loadSocialSnapshot(account),
          loadRecentSocialMessages(account),
        ]);
        if (disposed) return;

        const seenRequests = loadSeen(SEEN_REQUESTS_KEY);
        snapshot.requests
          .filter((request) => request.direction === "incoming")
          .forEach((request) => {
            if (seenRequests.has(request.id)) return;
            seenRequests.add(request.id);
            pushNotification({
              id: `social-request-${request.id}`,
              title: "New friend request",
              message: `${request.player.minecraftName} wants to be your friend.`,
              tone: "info",
              source: "social",
              action: { label: "Review request", modal: "friends" },
            });
          });
        saveSeen(SEEN_REQUESTS_KEY, seenRequests);

        const seenMessages = loadSeen(SEEN_MESSAGES_KEY);
        const incomingMessages = recentMessages.filter((message) => !message.mine);
        if (initializedMessages.current) {
          incomingMessages
            .slice()
            .reverse()
            .forEach((message) => {
              if (seenMessages.has(message.id)) return;
              pushNotification({
                id: `social-message-${message.id}`,
                title: message.senderName,
                message:
                  message.body ||
                  (message.attachment?.kind === "screenshot"
                    ? "Sent you a screenshot."
                    : "Shared a modpack with you."),
                tone: "info",
                source: "social",
                action: { label: "Open chat", modal: "friends" },
              });
            });
        }
        incomingMessages.forEach((message) => seenMessages.add(message.id));
        saveSeen(SEEN_MESSAGES_KEY, seenMessages);
        initializedMessages.current = true;
      } catch {
        // The Friends modal shows actionable setup and network errors. Background
        // polling stays silent so a temporary outage cannot flood notifications.
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), 12_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      initializedMessages.current = false;
    };
  }, [
    account,
    loggedIn,
    pushNotification,
    settings.activityNotifications,
    settings.socialNotifications,
  ]);

  return null;
}
