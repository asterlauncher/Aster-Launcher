import { AnimatePresence, motion } from "framer-motion";
import { Gift, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { COSMETICS_RELEASE_GIFT_AMOUNT } from "../services/asterWallet";
import { useAppStore } from "../store/AppStore";
import { AsterCreditIcon } from "./AsterCreditIcon";
import { PremiumChest } from "./PremiumChest";

export function CosmeticsReleaseGift() {
  const {
    asterAccount: account,
    asterLoggedIn: loggedIn,
    releaseGiftAvailable,
    claimReleaseGift,
    notify,
    pushNotification,
  } = useAppStore();
  const [dismissed, setDismissed] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);

  useEffect(() => {
    setDismissed(false);
    setClaimed(false);
    setClaiming(false);
  }, [account?.id]);

  const visible =
    loggedIn &&
    (releaseGiftAvailable || claimed) &&
    !dismissed &&
    Boolean(account);

  const claim = () => {
    if (claiming) return;
    setClaiming(true);
    const wasClaimed = claimReleaseGift();

    if (!wasClaimed) {
      setDismissed(true);
      setClaiming(false);
      return;
    }

    setClaimed(true);
    notify({
      title: "1,000 AC claimed",
      message: "Your Cosmetics Release Gift was added to your Aster wallet.",
      tone: "success",
    });
    pushNotification({
      id: `cosmetics-release-gift-${account?.id ?? "account"}`,
      title: "Cosmetics Release Gift claimed",
      message: "1,000 Aster Credits were added to your wallet.",
      tone: "success",
      source: "account",
    });
    window.setTimeout(() => setDismissed(true), 900);
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="release-gift-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.section
            className={`release-gift-popup ${claimed ? "claimed" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="release-gift-title"
            initial={{ opacity: 0, scale: 0.9, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            <button
              type="button"
              className="release-gift-close"
              onClick={() => setDismissed(true)}
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
                  claimed
                    ? { scale: [1, 1.12, 1], y: [0, -8, 0] }
                    : { y: [0, -4, 0] }
                }
                transition={
                  claimed
                    ? { duration: 0.5 }
                    : { duration: 2.4, repeat: Infinity, ease: "easeInOut" }
                }
              >
                <PremiumChest />
              </motion.div>
            </div>

            <span className="release-gift-eyebrow">
              <Gift size={13} />
              COSMETICS RELEASE GIFT
            </span>
            <h2 id="release-gift-title">
              {claimed ? "Gift claimed!" : "A gift for you"}
            </h2>
            <p>
              To celebrate the release of Aster Cosmetics, every Aster player
              receives a one-time launch gift.
            </p>

            <div className="release-gift-reward">
              <AsterCreditIcon size={40} />
              <span>
                <strong>
                  +{COSMETICS_RELEASE_GIFT_AMOUNT.toLocaleString()} AC
                </strong>
                <small>ASTER CREDITS</small>
              </span>
              <Sparkles size={19} />
            </div>

            <button
              type="button"
              className="release-gift-claim"
              onClick={claim}
              disabled={claiming}
            >
              {claimed ? "CLAIMED" : claiming ? "CLAIMING..." : "CLAIM GIFT"}
            </button>
            <small className="release-gift-account">
              For {account?.username} · one claim per Aster account
            </small>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
