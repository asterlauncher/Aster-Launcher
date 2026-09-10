import { AnimatePresence, motion } from "framer-motion";
import { Gift, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  claimAsterGift,
  loadAsterGiftWalletBalance,
  loadPendingAsterGifts,
  type AsterGift,
} from "../services/social";
import { useAppStore } from "../store/AppStore";
import { AsterCreditIcon } from "./AsterCreditIcon";
import { PremiumChest } from "./PremiumChest";

const GIFT_REFRESH_EVENT = "aster-gifts:refresh";

export function requestAsterGiftRefresh() {
  window.dispatchEvent(new CustomEvent(GIFT_REFRESH_EVENT));
}

export function AsterGiftInbox() {
  const {
    asterAccount: account,
    asterLoggedIn: loggedIn,
    releaseGiftAvailable,
    notify,
    pushNotification,
    setGiftCreditBalance,
  } = useAppStore();
  const [gifts, setGifts] = useState<AsterGift[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimedId, setClaimedId] = useState<string | null>(null);
  const [releaseGateOpen, setReleaseGateOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!loggedIn || !account) {
      setGifts([]);
      setGiftCreditBalance(0);
      return;
    }

    try {
      const [pendingGifts, walletBalance] = await Promise.all([
        loadPendingAsterGifts(account),
        loadAsterGiftWalletBalance(account),
      ]);
      setGifts(pendingGifts);
      setGiftCreditBalance(walletBalance);
    } catch {
      // Gift infrastructure is optional until the Supabase migration is live.
      // Do not interrupt normal launcher use with a background inbox error.
    }
  }, [account, loggedIn, setGiftCreditBalance]);

  useEffect(() => {
    setDismissedIds(new Set());
    setClaimedId(null);
    setClaimingId(null);
    void refresh();
  }, [account?.id, refresh]);

  useEffect(() => {
    if (releaseGiftAvailable) {
      setReleaseGateOpen(false);
      return;
    }
    const timer = window.setTimeout(() => setReleaseGateOpen(true), 1_050);
    return () => window.clearTimeout(timer);
  }, [releaseGiftAvailable]);

  useEffect(() => {
    if (!loggedIn || !account) return;
    const interval = window.setInterval(() => void refresh(), 60_000);
    const onFocus = () => void refresh();
    const onGiftRefresh = () => void refresh();
    window.addEventListener("focus", onFocus);
    window.addEventListener(GIFT_REFRESH_EVENT, onGiftRefresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(GIFT_REFRESH_EVENT, onGiftRefresh);
    };
  }, [account, loggedIn, refresh]);

  const currentGift = useMemo(
    () => gifts.find((gift) => !dismissedIds.has(gift.id)) ?? null,
    [dismissedIds, gifts],
  );
  const visible =
    loggedIn &&
    Boolean(account) &&
    releaseGateOpen &&
    Boolean(currentGift);

  const dismiss = () => {
    if (!currentGift || claimingId) return;
    setDismissedIds((current) => new Set(current).add(currentGift.id));
  };

  const claim = async () => {
    if (!account || !currentGift || claimingId) return;
    setClaimingId(currentGift.id);
    try {
      const result = await claimAsterGift(account, currentGift.id);
      setGiftCreditBalance(result.balance);
      setClaimedId(currentGift.id);
      notify({
        title: `${result.amount.toLocaleString()} AC claimed`,
        message: `${currentGift.title} was added to your Aster wallet.`,
        tone: "success",
      });
      pushNotification({
        id: `aster-gift-${currentGift.id}`,
        title: currentGift.title,
        message: `${result.amount.toLocaleString()} Aster Credits from ${currentGift.senderName} were claimed.`,
        tone: "success",
        source: "account",
      });
      window.setTimeout(() => {
        setGifts((items) => items.filter((gift) => gift.id !== currentGift.id));
        setClaimedId(null);
        setClaimingId(null);
      }, 850);
    } catch (error) {
      setClaimingId(null);
      notify({
        title: "Gift could not be claimed",
        message: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    }
  };

  return (
    <AnimatePresence>
      {visible && currentGift && (
        <motion.div
          className="release-gift-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.section
            className={`release-gift-popup owner-gift-popup ${
              claimedId === currentGift.id ? "claimed" : ""
            }`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="aster-gift-title"
            initial={{ opacity: 0, scale: 0.9, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            <button
              type="button"
              className="release-gift-close"
              onClick={dismiss}
              aria-label="Claim later"
              title="Claim later"
            >
              <X size={17} />
            </button>

            <div className="release-gift-art" aria-hidden="true">
              <i className="gift-pixel-star gift-pixel-star-one" />
              <i className="gift-pixel-star gift-pixel-star-two" />
              <i className="gift-pixel-star gift-pixel-star-three" />
              <motion.div
                animate={
                  claimedId === currentGift.id
                    ? { scale: [1, 1.12, 1], y: [0, -8, 0] }
                    : { y: [0, -4, 0] }
                }
                transition={
                  claimedId === currentGift.id
                    ? { duration: 0.5 }
                    : { duration: 2.4, repeat: Infinity, ease: "easeInOut" }
                }
              >
                <PremiumChest />
              </motion.div>
            </div>

            <span className="release-gift-eyebrow">
              <Gift size={13} />
              GIFT FROM {currentGift.senderName.toUpperCase()}
            </span>
            <h2 id="aster-gift-title">
              {claimedId === currentGift.id
                ? "Gift claimed!"
                : currentGift.title}
            </h2>
            <p>{currentGift.message}</p>

            <div className="release-gift-reward">
              <AsterCreditIcon size={40} />
              <span>
                <strong>+{currentGift.amount.toLocaleString()} AC</strong>
                <small>ASTER CREDITS</small>
              </span>
              <Sparkles size={19} />
            </div>

            <button
              type="button"
              className="release-gift-claim"
              onClick={() => void claim()}
              disabled={Boolean(claimingId)}
            >
              {claimedId === currentGift.id
                ? "CLAIMED"
                : claimingId
                  ? "CLAIMING..."
                  : "CLAIM GIFT"}
            </button>
            <small className="release-gift-account">
              For {account?.username} · secured by Aster Gifts
            </small>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
