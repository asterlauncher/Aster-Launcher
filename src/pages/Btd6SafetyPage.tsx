import { Ban, CheckCircle2, LockKeyhole, ScanSearch, ShieldAlert } from "lucide-react";

export function Btd6SafetyPage() {
  return (
    <section className="sprocket-page btd6-page">
      <header className="sprocket-page-header"><div><span>BLOONS TD 6</span><h1>Mod Safety</h1><p>What Aster protects—and what no launcher can promise.</p></div></header>
      <div className="btd6-safety-grid">
        <article className="danger"><ShieldAlert /><div><h2>Account risk remains</h2><p>Ninja Kiwi can flag, restrict or ban accounts that use modified game files. Aster therefore requires an explicit warning before every modded launch.</p></div></article>
        <article><ScanSearch /><div><h2>Scanned on import and launch</h2><p>DLL structure, SHA‑256 identity, suspicious capabilities and Microsoft Defender are checked. Unknown or detected files are blocked.</p></div></article>
        <article><LockKeyhole /><div><h2>Private managed runtime</h2><p>Aster stores the loader in its own data folder and activates only the minimum bridge for the running game session.</p></div></article>
        <article><Ban /><div><h2>Not for public or co-op play</h2><p>Use a separate modded account and offline/private play. A clean antivirus result does not mean a mod is allowed by the game rules.</p></div></article>
        <article><CheckCircle2 /><div><h2>No safety bypass</h2><p>The confirmation is never remembered. Closing the warning cancels the launch, and the native backend rejects missing acknowledgement.</p></div></article>
      </div>
    </section>
  );
}
