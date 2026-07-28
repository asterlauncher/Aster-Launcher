import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useAppStore } from "../store/AppStore";

const icons = {
  success: CheckCircle2,
  info: Info,
  warning: AlertTriangle,
  error: XCircle,
};

const toneLabels = {
  success: "COMPLETE",
  info: "ASTER",
  warning: "ATTENTION",
  error: "FAILED",
};

export function ToastViewport() {
  const { toasts, dismissToast } = useAppStore();
  return (
    <div className="toast-viewport" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          const Icon = icons[toast.tone];
          return (
            <motion.div
              key={toast.id}
              className={`toast toast-${toast.tone}`}
              initial={{ opacity: 0, x: 28, scale: 0.97 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.97 }}
            >
              <span className="toast-icon">
                <Icon size={16} />
              </span>
              <div className="toast-content">
                <small>{toneLabels[toast.tone]}</small>
                <strong>{toast.title}</strong>
                <span>{toast.message}</span>
              </div>
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                aria-label="Dismiss notification"
              >
                <X size={14} />
              </button>
              <i className="toast-timer" />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
