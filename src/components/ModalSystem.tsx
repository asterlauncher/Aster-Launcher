import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  BadgeCheck,
  Check,
  CircleAlert,
  Crown,
  ExternalLink,
  FolderSearch,
  GitMerge,
  LogIn,
  LogOut,
  Palette,
  RotateCw,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { useAppStore } from "../store/AppStore";
import { AsterCreditIcon } from "./AsterCreditIcon";
import { Button } from "./ui";

export function ModalSystem() {
  const {
    account,
    modal,
    closeModal,
    notify,
    loggedIn,
    authError,
    authProgress,
    authBusy,
    beginMicrosoftLogin,
    signOut,
  } = useAppStore();

  const complete = (title: string, message: string) => {
    notify({ title, message, tone: "success" });
    closeModal();
  };

  return (
    <AnimatePresence>
      {modal && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeModal();
          }}
        >
          <motion.div
            className={`modal ${
              modal === "aster-subscription" ? "subscription-modal" : ""
            }`}
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.18 }}
          >
            <button
              type="button"
              className="modal-close"
              onClick={closeModal}
              aria-label="Close dialog"
            >
              <X size={17} />
            </button>

            {modal === "aster-subscription" && (
              <>
                <div className="subscription-heading">
                  <div className="modal-icon subscription-icon">
                    <Crown size={22} fill="currentColor" />
                  </div>
                  <span>OPTIONAL SUPPORTER PLAN</span>
                  <h2>Aster Subscription</h2>
                  <p>
                    <strong>$4.99</strong>
                    <small> / month</small>
                  </p>
                </div>

                <div className="subscription-credit-card">
                  <AsterCreditIcon size={39} />
                  <div>
                    <strong>1,000 AC every month</strong>
                    <small>
                      Aster Credits are added to your launcher balance each billing
                      month.
                    </small>
                  </div>
                  <b>+1,000</b>
                </div>

                <div className="subscription-perks">
                  <div>
                    <BadgeCheck size={15} />
                    <span>
                      <strong>Supporter badge</strong>
                      <small>Optional badge beside your Aster profile.</small>
                    </span>
                  </div>
                  <div>
                    <Palette size={15} />
                    <span>
                      <strong>Profile accent</strong>
                      <small>One subtle premium launcher color theme.</small>
                    </span>
                  </div>
                  <div>
                    <Sparkles size={15} />
                    <span>
                      <strong>Small cosmetic previews</strong>
                      <small>Early access when cosmetics become available.</small>
                    </span>
                  </div>
                </div>

                <p className="subscription-fair-note">
                  No gameplay advantages, faster downloads, or priority queues.
                </p>

                <div className="subscription-checkout-note">
                  Payments are disabled during closed alpha. You cannot be charged
                  yet.
                </div>

                <div className="modal-actions subscription-actions">
                  <Button variant="ghost" onClick={closeModal}>
                    Maybe later
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() =>
                      complete(
                        "Aster Subscription",
                        "Checkout is coming soon. No charge was made.",
                      )
                    }
                  >
                    <Crown size={14} />
                    Subscribe · $4.99
                  </Button>
                </div>
              </>
            )}

            {modal === "add-account" && (
              <>
                <div className="modal-icon">
                  <LogIn size={22} />
                </div>
                <h2>Add an account</h2>
                <p className="modal-copy">
                  Continue in your system browser. Aster never asks for or
                  receives your Microsoft password.
                </p>
                <button
                  type="button"
                  className="provider-option"
                  disabled={authBusy}
                  onClick={() => void beginMicrosoftLogin()}
                >
                  <span className="provider-mark">M</span>
                  <span>
                    <strong>
                      {authBusy
                        ? "Waiting for Microsoft..."
                        : "Microsoft account"}
                    </strong>
                    <small>
                      {authProgress
                        ? authProgress.replaceAll("-", " ")
                        : "Required for licensed Java play"}
                    </small>
                  </span>
                  <ExternalLink size={16} />
                </button>
                {authError && <p className="modal-copy">{authError.message}</p>}
                <div className="modal-actions">
                  <Button variant="ghost" onClick={closeModal}>
                    Cancel
                  </Button>
                </div>
              </>
            )}

            {modal === "manage-account" && (
              <>
                <div className="modal-icon">
                  <UserRound size={22} />
                </div>
                <h2>Accounts</h2>
                <p className="modal-copy">
                  {account
                    ? "This Microsoft account is used for Minecraft services."
                    : "Connect a Microsoft account that owns Minecraft Java Edition."}
                </p>
                <div className="modal-account-list">
                  {account ? (
                    <button
                      type="button"
                      key={account.id}
                      className={loggedIn ? "active" : ""}
                      disabled
                    >
                      <span>{account.username.charAt(0)}</span>
                      <div>
                        <strong>{account.username}</strong>
                        <small>
                          Microsoft · {loggedIn ? "Active" : "Session expired"}
                        </small>
                      </div>
                      {loggedIn ? (
                        <ShieldCheck size={15} />
                      ) : (
                        <AlertTriangle size={15} />
                      )}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="provider-option"
                      disabled={authBusy}
                      onClick={() => void beginMicrosoftLogin()}
                    >
                      <span className="provider-mark">M</span>
                      <div>
                        <strong>Microsoft account</strong>
                        <small>Required for licensed Java play</small>
                      </div>
                      <ExternalLink size={15} />
                    </button>
                  )}
                </div>
                {authError && <p className="modal-copy">{authError.message}</p>}
                <button
                  type="button"
                  className="modal-add-account"
                  disabled={authBusy}
                  onClick={() => void beginMicrosoftLogin()}
                >
                  <LogIn size={14} />
                  {account ? "Sign in with another account" : "Sign in"}
                </button>
                <div className="modal-actions">
                  {account && (
                    <Button variant="ghost" onClick={() => void signOut()}>
                      <LogOut size={14} />
                      Sign out
                    </Button>
                  )}
                  <Button variant="primary" onClick={closeModal}>
                    Done
                  </Button>
                </div>
              </>
            )}

            {modal === "installation-failure" && (
              <>
                <div className="modal-icon error">
                  <CircleAlert size={22} />
                </div>
                <h2>Installation failed</h2>
                <p className="modal-copy">
                  Better Survival could not be verified because one archive returned
                  a different checksum.
                </p>
                <div className="error-log">
                  <code>artifact: better-survival-core-1.4.1.jar</code>
                  <code>expected: 8ae7…31c2</code>
                  <code>received: e44b…708a</code>
                </div>
                <div className="modal-actions">
                  <Button variant="ghost" onClick={closeModal}>
                    Close
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() =>
                      complete(
                        "Download restarted",
                        "Damaged files were removed and queued again.",
                      )
                    }
                  >
                    <RotateCw size={15} /> Retry installation
                  </Button>
                </div>
              </>
            )}

            {modal === "mod-conflict" && (
              <>
                <div className="modal-icon warning">
                  <GitMerge size={22} />
                </div>
                <h2>Mod conflict detected</h2>
                <p className="modal-copy">
                  Duality Core targets Fabric, but the selected instance uses
                  NeoForge. Installing it may prevent the game from starting.
                </p>
                <div className="conflict-pair">
                  <span>Duality Core</span>
                  <GitMerge size={17} />
                  <span>Better Survival</span>
                </div>
                <div className="modal-actions">
                  <Button variant="ghost" onClick={closeModal}>
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() =>
                      complete(
                        "Installed with warning",
                        "Duality Core was added despite the loader mismatch.",
                      )
                    }
                  >
                    Install anyway
                  </Button>
                </div>
              </>
            )}

            {modal === "missing-java" && (
              <>
                <div className="modal-icon warning">
                  <FolderSearch size={22} />
                </div>
                <h2>Java runtime not found</h2>
                <p className="modal-copy">
                  Minecraft 1.21.1 needs Java 21. Choose an installed runtime or
                  let the launcher manage one automatically.
                </p>
                <div className="runtime-option">
                  <span>
                    <strong>Managed runtime</strong>
                    <small>Java 21 · Temurin · ~190 MB</small>
                  </span>
                  <Check size={17} />
                </div>
                <div className="modal-actions">
                  <Button
                    variant="ghost"
                    onClick={() =>
                      complete(
                        "Folder selected",
                        "A native folder picker would be opened by Tauri.",
                      )
                    }
                  >
                    Browse manually
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() =>
                      complete(
                        "Runtime queued",
                        "Java 21 was added to the download queue.",
                      )
                    }
                  >
                    Install Java
                  </Button>
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
