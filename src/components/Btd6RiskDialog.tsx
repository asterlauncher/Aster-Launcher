import { useState } from "react";
import {
  AlertTriangle,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
  UsersRound,
  X,
} from "lucide-react";

interface Btd6RiskDialogProps {
  modCount: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function Btd6RiskDialog({
  modCount,
  busy,
  onCancel,
  onConfirm,
}: Btd6RiskDialogProps) {
  const [accepted, setAccepted] = useState(false);

  return (
    <div className="btd6-risk-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="btd6-risk-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="btd6-risk-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <span><ShieldAlert size={21} /></span>
          <div>
            <small>MODDED LAUNCH SAFETY</small>
            <h2 id="btd6-risk-title">Review before launch</h2>
            <p>Required whenever community DLLs are enabled.</p>
          </div>
          <b>REQUIRED</b>
          <button type="button" onClick={onCancel} aria-label="Cancel launch"><X size={18} /></button>
        </header>
        <div className="btd6-risk-body">
          <div className="btd6-risk-copy">
            <span><AlertTriangle size={22} /></span>
            <div>
              <strong>Account flag and ban risk</strong>
              <p>
                Bloons TD 6 mods are unofficial. Ninja Kiwi may flag, restrict or ban an
                account that uses modified game files—even if Aster scanned every DLL.
              </p>
            </div>
          </div>
          <div className="btd6-risk-details">
            <article>
              <ScanSearch size={16} />
              <span><strong>Fresh security scan</strong><small>{modCount} enabled mod{modCount === 1 ? "" : "s"} checked again before launch.</small></span>
            </article>
            <article>
              <UsersRound size={16} />
              <span><strong>Private play only</strong><small>Use a separate modded account and avoid public/co-op games.</small></span>
            </article>
            <article>
              <ShieldCheck size={16} />
              <span><strong>Malware protection</strong><small>Scanning reduces file risk, but cannot make an account ban-safe.</small></span>
            </article>
          </div>
          <label className={`btd6-risk-check ${accepted ? "is-accepted" : ""}`}>
            <input
              type="checkbox"
              checked={accepted}
              onChange={(event) => setAccepted(event.target.checked)}
            />
            <span><strong>I understand the risk</strong><small>My account can be flagged, restricted or banned.</small></span>
          </label>
        </div>
        <footer>
          <span>{accepted ? "Risk acknowledged — ready to scan" : "Confirmation required to continue"}</span>
          <button type="button" className="mc-button" onClick={onCancel} disabled={busy}>Cancel</button>
          <button
            type="button"
            className="mc-button btd6-risk-launch"
            onClick={onConfirm}
            disabled={!accepted || busy}
          >
            {busy ? "SCANNING MODS..." : "LAUNCH MODDED"}
          </button>
        </footer>
      </section>
    </div>
  );
}
