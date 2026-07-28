import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  Clock3,
  Download,
  FileArchive,
  Image as ImageIcon,
  LoaderCircle,
  MessageSquareText,
  Paperclip,
  Search,
  Send,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  cancelSocialFriendRequest,
  isSocialConfigured,
  loadSocialMessages,
  loadSocialSnapshot,
  removeSocialFriend,
  respondToSocialFriendRequest,
  searchSocialPlayers,
  downloadSocialAttachment,
  sendSocialAttachment,
  sendSocialFriendRequest,
  sendSocialMessage,
  type SocialFriend,
  type SocialMessage,
  type SocialPlayer,
  type SocialSnapshot,
} from "../services/social";
import { useAppStore } from "../store/AppStore";

type FriendsTab = "friends" | "requests" | "add";

function formatMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatAttachmentSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function PlayerAvatar({
  name,
  online,
}: {
  name: string;
  online?: boolean;
}) {
  return (
    <span className="social-player-avatar" aria-hidden="true">
      {name.slice(0, 2).toUpperCase()}
      {online !== undefined && (
        <i className={online ? "is-online" : "is-offline"} />
      )}
    </span>
  );
}

export function FriendsHub() {
  const { account, loggedIn, beginMicrosoftLogin, notify } = useAppStore();
  const [tab, setTab] = useState<FriendsTab>("friends");
  const [snapshot, setSnapshot] = useState<SocialSnapshot | null>(null);
  const [selectedFriendId, setSelectedFriendId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SocialMessage[]>([]);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SocialPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const errorMessage = (caught: unknown, fallback: string) => {
    if (caught instanceof Error && caught.message.trim()) {
      return caught.message.trim();
    }
    return fallback;
  };

  const selectedFriend = useMemo(
    () =>
      snapshot?.friends.find(
        (friend) => friend.friendshipId === selectedFriendId,
      ) ?? null,
    [selectedFriendId, snapshot],
  );

  const refreshSnapshot = useCallback(
    async (silent = false) => {
      if (!account || !loggedIn) {
        setLoading(false);
        return;
      }
      if (!silent) setLoading(true);
      try {
        const next = await loadSocialSnapshot(account);
        setSnapshot(next);
        setError(null);
        setSelectedFriendId((current) => {
          if (current && next.friends.some((friend) => friend.friendshipId === current)) {
            return current;
          }
          return next.friends[0]?.friendshipId ?? null;
        });
      } catch (caught) {
        if (!silent) {
          setError(errorMessage(caught, "Aster Social is unavailable."));
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [account, loggedIn],
  );

  const refreshMessages = useCallback(
    async (friend: SocialFriend, silent = false) => {
      if (!account) return;
      try {
        const next = await loadSocialMessages(account, friend.friendshipId);
        setMessages(next);
        if (!silent) setError(null);
      } catch (caught) {
        if (!silent) {
          setError(errorMessage(caught, "Chat could not be loaded."));
        }
      }
    },
    [account],
  );

  useEffect(() => {
    void refreshSnapshot();
    const timer = window.setInterval(() => void refreshSnapshot(true), 10_000);
    return () => window.clearInterval(timer);
  }, [refreshSnapshot]);

  useEffect(() => {
    if (!selectedFriend) {
      setMessages([]);
      return;
    }
    void refreshMessages(selectedFriend);
    const timer = window.setInterval(
      () => void refreshMessages(selectedFriend, true),
      3_500,
    );
    return () => window.clearInterval(timer);
  }, [refreshMessages, selectedFriend]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  useEffect(() => {
    if (!account || query.trim().length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(() => {
      void searchSocialPlayers(account, query)
        .then((results) => {
          setSearchResults(results);
          setError(null);
        })
        .catch((caught: unknown) =>
          setError(errorMessage(caught, "Search failed.")),
        )
        .finally(() => setSearching(false));
    }, 280);
    return () => window.clearTimeout(timer);
  }, [account, query]);

  const handleSendRequest = async (minecraftName: string) => {
    if (!account) return;
    setBusyId(`add-${minecraftName}`);
    try {
      await sendSocialFriendRequest(account, minecraftName);
      notify({
        title: "Friend request sent",
        message: `${minecraftName} will see your request in Aster.`,
        tone: "success",
      });
      setQuery("");
      setSearchResults([]);
      setTab("requests");
      await refreshSnapshot(true);
    } catch (caught) {
      setError(errorMessage(caught, "Request could not be sent."));
    } finally {
      setBusyId(null);
    }
  };

  const handleRequest = async (requestId: string, accept: boolean) => {
    if (!account) return;
    setBusyId(requestId);
    try {
      await respondToSocialFriendRequest(account, requestId, accept);
      notify({
        title: accept ? "Friend added" : "Request declined",
        message: accept
          ? "You can now start chatting."
          : "The friend request was removed.",
        tone: accept ? "success" : "info",
      });
      await refreshSnapshot(true);
      if (accept) setTab("friends");
    } catch (caught) {
      setError(errorMessage(caught, "Request could not be updated."));
    } finally {
      setBusyId(null);
    }
  };

  const handleCancelRequest = async (requestId: string) => {
    if (!account) return;
    setBusyId(requestId);
    try {
      await cancelSocialFriendRequest(account, requestId);
      await refreshSnapshot(true);
    } catch (caught) {
      setError(errorMessage(caught, "Request could not be cancelled."));
    } finally {
      setBusyId(null);
    }
  };

  const handleRemoveFriend = async (friend: SocialFriend) => {
    if (!account) return;
    setBusyId(friend.friendshipId);
    try {
      await removeSocialFriend(account, friend.friendshipId);
      notify({
        title: "Friend removed",
        message: `${friend.minecraftName} was removed from your friends.`,
        tone: "info",
      });
      await refreshSnapshot(true);
    } catch (caught) {
      setError(errorMessage(caught, "Friend could not be removed."));
    } finally {
      setBusyId(null);
    }
  };

  const handleSendMessage = async (event: FormEvent) => {
    event.preventDefault();
    if (!account || !selectedFriend || !message.trim()) return;
    const pendingMessage = message;
    setMessage("");
    try {
      await sendSocialMessage(account, selectedFriend.friendshipId, pendingMessage);
      await refreshMessages(selectedFriend, true);
    } catch (caught) {
      setMessage(pendingMessage);
      setError(errorMessage(caught, "Message could not be sent."));
    }
  };

  const handleSendAttachment = async (
    kind: "screenshot" | "modpack",
  ) => {
    if (!account || !selectedFriend || uploadingAttachment) return;
    setAttachmentMenuOpen(false);
    setUploadingAttachment(true);
    try {
      const sent = await sendSocialAttachment(
        account,
        selectedFriend.friendshipId,
        kind,
      );
      if (!sent) return;
      await refreshMessages(selectedFriend, true);
      notify({
        title: kind === "screenshot" ? "Screenshot sent" : "Modpack sent",
        message: `${selectedFriend.minecraftName} can now open it in chat.`,
        tone: "success",
      });
    } catch (caught) {
      setError(errorMessage(caught, "The attachment could not be sent."));
    } finally {
      setUploadingAttachment(false);
    }
  };

  const handleDownloadAttachment = async (item: SocialMessage) => {
    if (!item.attachment) return;
    try {
      const saved = await downloadSocialAttachment(item.attachment);
      if (saved) {
        notify({
          title:
            item.attachment.kind === "screenshot"
              ? "Screenshot saved"
              : "Modpack saved",
          message: item.attachment.name,
          tone: "success",
        });
      }
    } catch (caught) {
      setError(errorMessage(caught, "The attachment could not be downloaded."));
    }
  };

  if (!loggedIn || !account) {
    return (
      <div className="friends-gate">
        <span><Users size={27} /></span>
        <h2>Your Friends</h2>
        <p>Connect your Minecraft account before using friends and chat.</p>
        <button type="button" className="social-primary-button" onClick={() => void beginMicrosoftLogin()}>
          Connect Minecraft account
        </button>
      </div>
    );
  }

  if (!isSocialConfigured) {
    return (
      <div className="friends-gate">
        <span><Users size={27} /></span>
        <h2>Aster Social is not configured</h2>
        <p>Add the Supabase values to the launcher environment, then restart it.</p>
      </div>
    );
  }

  return (
    <div className="friends-hub">
      <aside className="friends-hub-sidebar">
        <header>
          <span className="friends-heading-icon"><Users size={17} /></span>
          <div>
            <h2>Your Friends</h2>
            <p>{snapshot?.friends.filter((friend) => friend.online).length ?? 0} online now</p>
          </div>
        </header>

        <nav aria-label="Friends sections">
          {([
            ["friends", "Friends", snapshot?.friends.length ?? 0],
            [
              "requests",
              "Requests",
              snapshot?.requests.filter((request) => request.direction === "incoming").length ?? 0,
            ],
            ["add", "Add player", null],
          ] as const).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              className={tab === value ? "is-active" : ""}
              onClick={() => setTab(value)}
            >
              {value === "friends" ? <MessageSquareText size={13} /> : value === "requests" ? <Clock3 size={13} /> : <UserPlus size={13} />}
              <span>{label}</span>
              {count !== null && count > 0 && <b>{count}</b>}
            </button>
          ))}
        </nav>

        <div className="friends-identity">
          <PlayerAvatar name={account.username} online />
          <div>
            <strong>{account.username}</strong>
            <small>Aster Social connected</small>
          </div>
        </div>
      </aside>

      <section className="friends-hub-content">
        {error && (
          <motion.div
            className="social-error"
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">
              <X size={12} />
            </button>
          </motion.div>
        )}

        <AnimatePresence mode="wait" initial={false}>
          {tab === "friends" && (
            <motion.div
              key="friends"
              className="friends-chat-layout"
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -6 }}
            >
              <div className="friends-list">
                <header>
                  <strong>Friends</strong>
                  <button type="button" onClick={() => setTab("add")}>
                    <UserPlus size={12} /> Add
                  </button>
                </header>
                {loading ? (
                  <div className="social-loading"><LoaderCircle className="spin" size={18} /> Syncing friends...</div>
                ) : snapshot?.friends.length ? (
                  snapshot.friends.map((friend) => (
                    <button
                      key={friend.friendshipId}
                      type="button"
                      className={selectedFriendId === friend.friendshipId ? "is-selected" : ""}
                      onClick={() => setSelectedFriendId(friend.friendshipId)}
                    >
                      <PlayerAvatar name={friend.minecraftName} online={friend.online} />
                      <span>
                        <strong>{friend.minecraftName}</strong>
                        <small>{friend.online ? "Online in Aster" : "Offline"}</small>
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="social-list-empty">
                    <Users size={20} />
                    <strong>No friends yet</strong>
                    <span>Add someone by their Minecraft name.</span>
                  </div>
                )}
              </div>

              <div className="social-chat">
                {selectedFriend ? (
                  <>
                    <header>
                      <PlayerAvatar name={selectedFriend.minecraftName} online={selectedFriend.online} />
                      <div>
                        <strong>{selectedFriend.minecraftName}</strong>
                        <small>{selectedFriend.online ? "Online now" : "Currently offline"}</small>
                      </div>
                      <button
                        type="button"
                        className="social-remove-friend"
                        disabled={busyId === selectedFriend.friendshipId}
                        onClick={() => void handleRemoveFriend(selectedFriend)}
                        title="Remove friend"
                        aria-label={`Remove ${selectedFriend.minecraftName}`}
                      >
                        <UserMinus size={13} />
                      </button>
                    </header>
                    <div className="social-message-list">
                      {messages.length === 0 ? (
                        <div className="social-chat-empty">
                          <MessageSquareText size={22} />
                          <strong>Start the conversation</strong>
                          <span>Messages are only visible to both friends.</span>
                        </div>
                      ) : (
                        messages.map((item) => (
                          <div key={item.id} className={`social-message ${item.mine ? "is-mine" : ""}`}>
                            {item.body && <p>{item.body}</p>}
                            {item.attachment?.kind === "screenshot" && (
                              <div className="social-attachment social-screenshot-attachment">
                                <img
                                  src={item.attachment.url}
                                  alt={item.attachment.name}
                                  loading="lazy"
                                />
                                <div>
                                  <span>
                                    <ImageIcon size={12} />
                                    <strong>{item.attachment.name}</strong>
                                    <small>{formatAttachmentSize(item.attachment.size)}</small>
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => void handleDownloadAttachment(item)}
                                    aria-label={`Save ${item.attachment.name}`}
                                  >
                                    <Download size={12} />
                                  </button>
                                </div>
                              </div>
                            )}
                            {item.attachment?.kind === "modpack" && (
                              <div className="social-attachment social-modpack-attachment">
                                <span className="social-attachment-icon">
                                  <FileArchive size={20} />
                                </span>
                                <span>
                                  <em>ASTER MODPACK</em>
                                  <strong>{item.attachment.name}</strong>
                                  <small>{formatAttachmentSize(item.attachment.size)}</small>
                                </span>
                                <button
                                  type="button"
                                  onClick={() => void handleDownloadAttachment(item)}
                                  aria-label={`Download ${item.attachment.name}`}
                                >
                                  <Download size={13} />
                                </button>
                              </div>
                            )}
                            <time>{formatMessageTime(item.createdAt)}</time>
                          </div>
                        ))
                      )}
                      <div ref={messagesEndRef} />
                    </div>
                    <form className="social-composer" onSubmit={handleSendMessage}>
                      <div className="social-upload-control">
                        <button
                          type="button"
                          className={attachmentMenuOpen ? "is-active" : ""}
                          disabled={uploadingAttachment}
                          onClick={() => setAttachmentMenuOpen((open) => !open)}
                          aria-label="Upload screenshot or modpack"
                          aria-expanded={attachmentMenuOpen}
                        >
                          {uploadingAttachment ? (
                            <LoaderCircle className="spin" size={15} />
                          ) : (
                            <Paperclip size={15} />
                          )}
                        </button>
                        <AnimatePresence>
                          {attachmentMenuOpen && (
                            <motion.div
                              className="social-upload-menu"
                              initial={{ opacity: 0, y: 6, scale: 0.97 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={{ opacity: 0, y: 5, scale: 0.98 }}
                              transition={{ duration: 0.12 }}
                            >
                              <header>
                                <strong>SHARE IN CHAT</strong>
                                <small>Private between friends</small>
                              </header>
                              <button
                                type="button"
                                onClick={() => void handleSendAttachment("screenshot")}
                              >
                                <span><ImageIcon size={15} /></span>
                                <span>
                                  <strong>Screenshot</strong>
                                  <small>PNG, JPG or WebP · max 12 MB</small>
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleSendAttachment("modpack")}
                              >
                                <span><FileArchive size={15} /></span>
                                <span>
                                  <strong>Modpack</strong>
                                  <small>ZIP or MRPACK · max 250 MB</small>
                                </span>
                              </button>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                      <input
                        value={message}
                        maxLength={500}
                        onChange={(event) => setMessage(event.target.value)}
                        placeholder={`Message ${selectedFriend.minecraftName}`}
                        aria-label="Chat message"
                      />
                      <button className="social-send-button" type="submit" disabled={!message.trim()} aria-label="Send message">
                        <Send size={14} />
                      </button>
                    </form>
                  </>
                ) : (
                  <div className="social-chat-empty">
                    <MessageSquareText size={24} />
                    <strong>Select a friend</strong>
                    <span>Your conversation will appear here.</span>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {tab === "requests" && (
            <motion.div
              key="requests"
              className="social-section"
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -6 }}
            >
              <header>
                <span><Clock3 size={16} /></span>
                <div>
                  <h3>Friend requests</h3>
                  <p>Accept players you know and trust.</p>
                </div>
              </header>
              <div className="social-request-list">
                {snapshot?.requests.length ? snapshot.requests.map((request) => (
                  <article key={request.id}>
                    <PlayerAvatar name={request.player.minecraftName} online={request.player.online} />
                    <div>
                      <strong>{request.player.minecraftName}</strong>
                      <small>{request.direction === "incoming" ? "Wants to be your friend" : "Request pending"}</small>
                    </div>
                    {request.direction === "incoming" ? (
                      <span className="social-request-actions">
                        <button type="button" disabled={busyId === request.id} onClick={() => void handleRequest(request.id, true)}>
                          <Check size={12} /> Accept
                        </button>
                        <button type="button" disabled={busyId === request.id} onClick={() => void handleRequest(request.id, false)}>
                          <X size={12} />
                        </button>
                      </span>
                    ) : (
                      <button type="button" className="social-cancel-request" disabled={busyId === request.id} onClick={() => void handleCancelRequest(request.id)}>
                        Cancel
                      </button>
                    )}
                  </article>
                )) : (
                  <div className="social-list-empty large">
                    <Clock3 size={24} />
                    <strong>No pending requests</strong>
                    <span>New requests will appear here and in Notifications.</span>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {tab === "add" && (
            <motion.div
              key="add"
              className="social-section"
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -6 }}
            >
              <header>
                <span><UserPlus size={16} /></span>
                <div>
                  <h3>Add a Minecraft friend</h3>
                  <p>Search for a player who has opened Aster at least once.</p>
                </div>
              </header>
              <label className="social-player-search">
                <Search size={15} />
                <input
                  autoFocus
                  value={query}
                  maxLength={16}
                  onChange={(event) => setQuery(event.target.value.replace(/[^a-zA-Z0-9_]/g, ""))}
                  placeholder="Minecraft username..."
                />
                {searching && (
                  <LoaderCircle
                    className="spin social-search-spinner"
                    size={14}
                  />
                )}
              </label>
              <div className="social-search-results">
                {query.trim().length < 2 ? (
                  <div className="social-search-hint">
                    Enter at least two characters of their Minecraft name.
                  </div>
                ) : !searching && searchResults.length === 0 ? (
                  <div className="social-list-empty large">
                    <Search size={23} />
                    <strong>No Aster player found</strong>
                    <span>Names appear after that player signs in and opens Friends once.</span>
                  </div>
                ) : (
                  searchResults.map((player) => {
                    const friendship = snapshot?.friends.some((friend) => friend.userId === player.userId);
                    const pending = snapshot?.requests.some((request) => request.player.userId === player.userId);
                    return (
                      <article key={player.userId}>
                        <PlayerAvatar name={player.minecraftName} online={player.online} />
                        <div>
                          <strong>{player.minecraftName}</strong>
                          <small>{player.online ? "Online in Aster" : "Aster player"}</small>
                        </div>
                        <button
                          type="button"
                          disabled={Boolean(friendship || pending) || busyId === `add-${player.minecraftName}`}
                          onClick={() => void handleSendRequest(player.minecraftName)}
                        >
                          {friendship ? "Friends" : pending ? "Pending" : <><UserPlus size={12} /> Add friend</>}
                        </button>
                      </article>
                    );
                  })
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </div>
  );
}
